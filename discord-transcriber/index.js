require('dotenv').config();
const { sendMeetingDM } = require('./meeting-dm');
const { createMeetingSummary } = require('./meeting-summary');
const { mergeTranscripts } = require('./merge-transcripts');
const { startAudioReceiver } = require('./audio-receiver');

const {
  connectRecorders,
  acquireRecorder,
  releaseRecorder,
  joinRecorderChannel,
  leaveRecorderChannel
} = require('./recorder-manager');

const {
  loadSegments,
  deleteMeeting,
  saveMeetingMetadata,
  markMeetingDelivered
} = require('./meeting-storage');
const {
  findRecoverableMeetings,
  recoverMeeting
} = require('./meeting-recovery');

const {
  Client,
  GatewayIntentBits,
  REST,
  Routes,
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder
} = require('discord.js');

const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates
  ]
});

// Ключ: ID голосового канала.
// Каждая комната имеет собственную сессию записи.
const sessions = new Map();
const MAX_CONCURRENT_MEETINGS = 6;
const recoveryInProgress = new Set();
const startingChannels = new Set();
let mainRecorderReserved = false;


function getGuildSessions(guildId) {
  return [...sessions.values()].filter(
    session => session.guildId === guildId
  );
}

function isMainRecorderBusy(guildId) {
  return getGuildSessions(guildId).some(
    session => session.recorderType === 'main'
  );
}

function allocateMeetingRecorder(guildId) {
  if (!mainRecorderReserved && !isMainRecorderBusy(guildId)) {
    mainRecorderReserved = true;

    return {
      recorderType: 'main',
      recorder: null,
      recorderClient: client
    };
  }

  const recorder = acquireRecorder();

  if (!recorder) return null;

  return {
    recorderType: 'additional',
    recorder,
    recorderClient: recorder.client
  };
}

function releaseMeetingRecorder(allocation) {
  if (!allocation) return;

  if (allocation.recorderType === 'main') {
    mainRecorderReserved = false;
  } else if (allocation.recorderType === 'additional') {
    releaseRecorder(allocation.recorder);
  }
}

function getChannelSession(channelId) {
  return sessions.get(channelId) || null;
}


const commands = [
  new SlashCommandBuilder()
    .setName('start')
    .setDescription('Начать транскрибацию голосовой встречи'),

  new SlashCommandBuilder()
    .setName('stop')
    .setDescription('Завершить голосовую встречу'),

  new SlashCommandBuilder()
    .setName('status')
    .setDescription('Показать состояние встречи'),

  new SlashCommandBuilder()
    .setName('recover')
    .setDescription('Восстановить протокол после сбоя')
    .setDefaultMemberPermissions(
      PermissionFlagsBits.Administrator
    )
].map(command => command.toJSON());

client.once('ready', async () => {
  console.log(`Meeting Assistant запущен: ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  if (interaction.isButton()) {
    try {
      if (interaction.customId.startsWith('dm-meeting:')) {
        const { handleMeetingDMButton } = require('./meeting-dm-buttons');
        return await handleMeetingDMButton(interaction);
      }

      return await interaction.reply({
        content: 'Кнопки старого архива отключены.',
        ephemeral: true
      });
    } catch (error) {
      console.error('[MEETING BUTTON ERROR]', error);

      const response = {
        content: 'Не удалось открыть материалы встречи.'
      };

      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(response).catch(console.error);
      } else {
        await interaction.reply(response).catch(console.error);
      }
      return;
    }
  }

  if (!interaction.isChatInputCommand()) return;

  const guild = interaction.guild;
  if (!guild) return;

  try {
    if (interaction.commandName === 'recover') {
      if (
        !interaction.memberPermissions?.has(
          PermissionFlagsBits.Administrator
        )
      ) {
        return interaction.reply({
          content: 'Команда доступна только администраторам.',
          ephemeral: true
        });
      }

      if (getGuildSessions(guild.id).length > 0 || startingChannels.size > 0) {
        return interaction.reply({
          content: 'Сначала завершите активную встречу.',
          ephemeral: true
        });
      }

      if (recoveryInProgress.has(guild.id)) {
        return interaction.reply({
          content: 'Восстановление уже выполняется.',
          ephemeral: true
        });
      }

      recoveryInProgress.add(guild.id);

      try {
        await interaction.deferReply({ ephemeral: true });

        const meetings = await findRecoverableMeetings(guild.id);

        if (!meetings.length) {
          return interaction.editReply(
            'Незавершённых расшифровок не найдено.'
          );
        }

        // Восстанавливаем одну встречу за вызов команды.
        const meetingId = meetings[0];

        const result = await recoverMeeting(
          client,
          guild.id,
          meetingId
        );

        await interaction.editReply({
          content: result.alreadyArchived
            ? 'Протокол уже был отправлен организатору. Повторная отправка не требуется.'
            : 'Протокол восстановлен и отправлен организатору в личные сообщения.'
        });
      } finally {
        recoveryInProgress.delete(guild.id);
      }

      return;
    }

    if (interaction.commandName === 'start') {
      const member = await guild.members.fetch(interaction.user.id);
      const channel = member.voice.channel;

      if (!channel) {
        return interaction.reply({
          content: 'Сначала зайди в голосовой канал.',
          ephemeral: true
        });
      }

      if (getChannelSession(channel.id) || startingChannels.has(channel.id)) {
        return interaction.reply({
          content: 'Встреча уже идёт или запускается.',
          ephemeral: true
        });
      }

      if (getGuildSessions(guild.id).length +
          [...startingChannels].filter(id => !sessions.has(id)).length >= MAX_CONCURRENT_MEETINGS) {
        return interaction.reply({
          content: 'Все шесть рекордеров заняты. Дождитесь завершения одной из встреч.',
          ephemeral: true
        });
      }

      startingChannels.add(channel.id);
      let allocation = null;
      let sessionCreated = false;
      try {
        await interaction.deferReply();

      allocation = allocateMeetingRecorder(guild.id);

      if (!allocation) {
        return interaction.editReply({
          content: 'Нет свободных рекордеров. Попробуйте позже.'
        });
      }

      const connection = allocation.recorderType === 'main'
        ? joinVoiceChannel({
            channelId: channel.id,
            guildId: guild.id,
            adapterCreator: guild.voiceAdapterCreator,
            selfDeaf: false,
            selfMute: true
          })
        : await joinRecorderChannel(
            allocation.recorder,
            guild.id,
            channel.id
          );

      connection.on('stateChange', (oldState, newState) => {
        console.log(
          `[VOICE] ${oldState.status} -> ${newState.status}`
        );
      });

      connection.on('error', error => {
        console.error('[VOICE ERROR]', error);
      });

      console.log(
        `[VOICE] Подключение: guild=${guild.id}, channel=${channel.id}`
      );

      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 30000);
        // Приём аудио запускаем после создания сессии ниже.
      } catch (error) {
        console.error(
          '[VOICE] Не удалось подключиться. Текущее состояние:',
          connection.state.status
        );
        connection.destroy();
        throw error;
      }

      const startedAt = Date.now();
      const meetingId = `${guild.id}_${channel.id}_${startedAt}`;

      await saveMeetingMetadata(meetingId, {
        guildId: guild.id,
        channelId: channel.id,
        channelName: channel.name,
        startedAt,
        startedBy: interaction.user.id
      });

      const audioReceiver = startAudioReceiver(
        connection,
        allocation.recorderClient,
        startedAt,
        meetingId
      );

      sessions.set(channel.id, {
        guildId: guild.id,
        recorderType: allocation.recorderType,
        recorder: allocation.recorder,
        channelId: channel.id,
        channelName: channel.name,
        startedAt,
        meetingId,
        startedBy: interaction.user.id,
        audioReceiver,
        stopping: false
      });

      sessionCreated = true;


      const embed = new EmbedBuilder()
        .setColor(0x5865F2)
        .setTitle('Встреча началась')
        .setDescription(`Голосовой канал: **${channel.name}**`)
        .addFields(
          { name: 'Запустил', value: `<@${interaction.user.id}>`, inline: true },
          { name: 'Статус', value: 'Подключено к голосовому каналу', inline: true }
        )
        .setTimestamp();

      return interaction.editReply({ embeds: [embed] });
      } finally {
        if (allocation && !sessionCreated) {
          try {
            if (allocation.recorderType === 'main') {
              const voice = getVoiceConnection(guild.id);
              if (voice) voice.destroy();
            } else {
              leaveRecorderChannel(allocation.recorder, guild.id);
            }
          } catch (cleanupError) {
            console.error('[VOICE CLEANUP ERROR]', cleanupError);
          } finally {
            releaseMeetingRecorder(allocation);
          }
        }
        startingChannels.delete(channel.id);
      }
    }

    if (interaction.commandName === 'stop') {
      const { recoverPendingAudio } = require('./audio-recovery');
      const { listAudioSegments } = require('./audio-storage');

      const member = await guild.members.fetch(interaction.user.id);
      const channelId = member.voice.channelId;
      const session = channelId ? getChannelSession(channelId) : null;

      if (!session) {
        return interaction.reply({
          content: 'Сейчас нет активной встречи.',
          ephemeral: true
        });
      }

      const isAdmin = interaction.memberPermissions?.has(
        PermissionFlagsBits.Administrator
      );

      if (
        interaction.user.id !== session.startedBy &&
        !isAdmin
      ) {
        return interaction.reply({
          content:
            'Остановить встречу может только её организатор ' +
            'или администратор сервера.',
          ephemeral: true
        });
      }

      if (session.stopping) {
        return interaction.reply({
          content: 'Встреча уже завершается, идёт обработка речи.',
          ephemeral: true
        });
      }

      session.stopping = true;
      await interaction.deferReply();

      const connection = session.recorderType === 'main'
        ? getVoiceConnection(guild.id)
        : null;
      let transcript = '';

      try {
        transcript = await session.audioReceiver.stop();

        // Используем сохранённую на диске расшифровку.
        const segments = await loadSegments(session.meetingId);

        if (segments.length) {
          segments.sort((a, b) => a.timestamp - b.timestamp);

          const diskTranscript = segments.map(item => {
            const seconds = Math.max(
              0,
              Math.floor((item.timestamp - session.startedAt) / 1000)
            );

            const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
            const ss = String(seconds % 60).padStart(2, '0');

            return `[${mm}:${ss}] ${item.name}:\n${item.text}`;
          }).join('\n\n');

          transcript = mergeTranscripts(transcript, diskTranscript);
        }
      } catch (error) {
        console.error('[RECORDING STOP ERROR]', error);

        await interaction.editReply({
          content:
            'Встреча остановлена, но при завершении записи произошла ошибка. ' +
            'Сохранённые данные можно восстановить командой /recover.'
        }).catch(replyError => {
          console.error('[STOP REPLY ERROR]', replyError);
        });

        return;
      } finally {
        try {
          if (session.recorderType === 'main') {
            if (connection) connection.destroy();
          } else {
            leaveRecorderChannel(session.recorder, guild.id);
          }
        } finally {
          sessions.delete(session.channelId);
          releaseMeetingRecorder({
            recorderType: session.recorderType,
            recorder: session.recorder
          });
        }
      }

      // Повторяем распознавание сохранённого аудио перед публикацией.
      let remainingAudio;

      try {
        await recoverPendingAudio(session.meetingId);
        remainingAudio = await listAudioSegments(session.meetingId);
      } catch (error) {
        console.error('[AUDIO RECOVERY ERROR]', error);

        await interaction.editReply({
          content:
            'Встреча остановлена, но проверить сохранённое аудио ' +
            'не удалось. Данные оставлены на сервере. ' +
            'После устранения ошибки используйте /recover.'
        });

        return;
      }

      if (remainingAudio.length) {
        await interaction.editReply({
          content:
            'Встреча остановлена, но часть аудио ещё не распознана (' +
            remainingAudio.length + ' фрагм.). ' +
            'Исходные записи сохранены на сервере. ' +
            'Позже используйте /recover. ' +
            'Неполный протокол не опубликован.'
        });
        return;
      }

      // Восстановление могло добавить новые текстовые сегменты.
      const finalSegments = await loadSegments(session.meetingId);
      if (finalSegments.length) {
        finalSegments.sort((a, b) => a.timestamp - b.timestamp);
        transcript = finalSegments.map(item => {
          const seconds = Math.max(
            0,
            Math.floor((item.timestamp - session.startedAt) / 1000)
          );
          const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
          const ss = String(seconds % 60).padStart(2, '0');
          return `[${mm}:${ss}] ${item.name}:\n${item.text}`;
        }).join('\n\n');
      }

      const minutes = Math.round(
        (Date.now() - session.startedAt) / 60000
      );

      // Формируем протокол, не публикуя его в обычном канале.
      let summary = null;

      if (transcript) {
        try {
          summary = await createMeetingSummary(transcript);
        } catch (error) {
          console.error('[SUMMARY ERROR]', error.message);

          await interaction.editReply({
            content:
              'Встреча завершена, но создать протокол не удалось. ' +
              'Расшифровка сохранена на сервере. ' +
              'После устранения ошибки используйте /recover.'
          });

          return;
        }
      }

      try {
        const message = await sendMeetingDM(
          client,
          session,
          transcript,
          summary
        );

        await markMeetingDelivered(session.meetingId, message.id);

        await deleteMeeting(session.meetingId).catch(error => {
          console.error('[CLEANUP ERROR]', error);
        });

        await interaction.editReply({
          content:
            `Встреча завершена.\n` +
            `Канал: **${session.channelName}**\n` +
            `Продолжительность: **${minutes} мин.**\n` +
            `Саммари и расшифровка отправлены вам в личные сообщения.`
        });

      } catch (error) {
        console.error('[ARCHIVE ERROR]', error);

        await interaction.editReply({
          content:
            'Встреча завершена, но отправить материалы в личные ' +
            'сообщения не удалось. Данные сохранены на сервере. ' +
            'Проверь настройки личных сообщений Discord.'
        });
      }
    }

    if (interaction.commandName === 'status') {
      const member = await guild.members.fetch(interaction.user.id);
      const channelId = member.voice.channelId;
      const session = channelId ? getChannelSession(channelId) : null;

      if (!session) {
        return interaction.reply({
          content: 'Сейчас встречи нет.',
          ephemeral: true
        });
      }

      const minutes = Math.floor(
        (Date.now() - session.startedAt) / 60000
      );

      return interaction.reply({
        content:
          `Идёт встреча.\n` +
          `Канал: **${session.channelName}**\n` +
          `Продолжительность: **${minutes} мин.**`,
        ephemeral: true
      });
    }
  } catch (error) {
    console.error('Ошибка команды:', error);

    const message = 'Произошла ошибка. Проверь логи бота.';

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content: message, embeds: [] });
    } else {
      await interaction.reply({ content: message, ephemeral: true });
    }
  }
});

async function main() {
  const required = [
    'DISCORD_TOKEN',
    'DISCORD_CLIENT_ID',
    'DISCORD_GUILD_ID'
  ];

  for (const key of required) {
    if (!process.env[key]) {
      throw new Error(`Не заполнена переменная ${key} в .env`);
    }
  }

  const rest = new REST({ version: '10' })
    .setToken(process.env.DISCORD_TOKEN);

  await rest.put(
    Routes.applicationGuildCommands(
      process.env.DISCORD_CLIENT_ID,
      process.env.DISCORD_GUILD_ID
    ),
    { body: commands }
  );

  console.log('Команды /start, /stop, /status, /recover зарегистрированы');

  await client.login(process.env.DISCORD_TOKEN);

  // Подключаем пять дополнительных голосовых рекордеров.
  await connectRecorders();
  console.log('[RECORDERS] Все пять рекордеров подключены');
}

main().catch(error => {
  console.error('Ошибка запуска:', error);
  process.exit(1);
});
