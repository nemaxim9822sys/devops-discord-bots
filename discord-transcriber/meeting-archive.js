const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags
} = require('discord.js');

const { createHash } = require('node:crypto');

function meetingKey(meetingId) {
  return createHash('sha256')
    .update(String(meetingId))
    .digest('hex')
    .slice(0, 20);
}

async function publishMeetingArchive(client, session, transcript, summary) {
  const channelId = process.env.MEETING_ARCHIVE_CHANNEL_ID;

  if (!channelId) {
    throw new Error('Не задан MEETING_ARCHIVE_CHANNEL_ID');
  }

  const channel = await client.channels.fetch(channelId);

  if (
    !channel ||
    !channel.isTextBased() ||
    channel.isDMBased() ||
    channel.guildId !== process.env.DISCORD_GUILD_ID
  ) {
    throw new Error('Неверный канал архива');
  }

  const permissions = channel.permissionsFor(client.user);

  const required = [
    PermissionFlagsBits.ViewChannel,
    PermissionFlagsBits.SendMessages,
    PermissionFlagsBits.EmbedLinks,
    PermissionFlagsBits.AttachFiles,
    PermissionFlagsBits.CreatePublicThreads,
    PermissionFlagsBits.ReadMessageHistory
  ];

  if (!permissions || required.some(p => !permissions.has(p))) {
    throw new Error('Недостаточно прав для архива и веток');
  }

  const duration = Math.max(
    1,
    Math.ceil((Date.now() - session.startedAt) / 60000)
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📋 Протокол встречи')
    .setDescription(
      summary
        ? summary.slice(0, 3500)
        : 'Протокол отсутствует. Проверь расшифровку.'
    )
    .addFields(
      {
        name: 'Канал',
        value: session.channelName,
        inline: true
      },
      {
        name: 'Продолжительность',
        value: `${duration} мин.`,
        inline: true
      },
      {
        name: 'Запустил',
        value: `<@${session.startedBy}>`,
        inline: true
      }
    )
    .setFooter({
      text: `Meeting ID: ${session.meetingId || 'legacy'}`
    })
    .setTimestamp();

  const key = meetingKey(session.meetingId || Date.now());

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`meeting:summary:${key}`)
      .setLabel('Протокол')
      .setStyle(ButtonStyle.Primary),

    new ButtonBuilder()
      .setCustomId(`meeting:transcript:${key}`)
      .setLabel('Расшифровка')
      .setStyle(ButtonStyle.Secondary),

    new ButtonBuilder()
      .setCustomId(`meeting:tasks:${key}`)
      .setLabel('Задачи')
      .setStyle(ButtonStyle.Secondary)
  );

  const files = [
    new AttachmentBuilder(
      Buffer.from(transcript || 'Нет расшифровки', 'utf8'),
      { name: 'meeting-transcript.txt' }
    )
  ];

  if (summary) {
    files.push(
      new AttachmentBuilder(
        Buffer.from(summary, 'utf8'),
        { name: 'meeting-summary.md' }
      )
    );
  }

  // Сначала публикуем карточку без вложений.
  const message = await channel.send({
    embeds: [embed],
    components: [buttons]
  });

  // При ошибке не оставляем карточку без материалов.
  try {
    const thread = await message.startThread({
      name: `Материалы встречи ${session.meetingId || message.id}`,
      autoArchiveDuration: 1440
    });

    await thread.send({
      content: `Материалы встречи\nMeeting ID: ${session.meetingId || 'legacy'}`,
      files
    });
  } catch (error) {
    console.error('[ARCHIVE MATERIALS ERROR]', error);

    try {
      await message.delete();
    } catch (cleanupError) {
      console.error('[ARCHIVE CLEANUP ERROR]', cleanupError);
      throw new Error(
        'Не удалось завершить публикацию и удалить неполную карточку. ' +
        'Проверь архив вручную перед повторным восстановлением.',
        { cause: error }
      );
    }

    throw error;
  }

  return message;
}

async function handleArchiveButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('meeting:')) return false;

  if (interaction.channelId !== process.env.MEETING_ARCHIVE_CHANNEL_ID) {
    await interaction.reply({
      content: 'Кнопка доступна только в архиве.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const [, action] = interaction.customId.split(':');

  if (!['summary', 'transcript', 'tasks'].includes(action)) {
    return false;
  }

  const thread = interaction.message.thread;

  if (!thread) {
    // Поддержка старых архивных карточек.
    const name = action === 'transcript'
      ? 'meeting-transcript.txt'
      : 'meeting-summary.md';

    const attachment = interaction.message.attachments.find(
      file => file.name === name
    );

    if (!attachment) {
      await interaction.reply({
        content: 'Материалы встречи не найдены.',
        flags: MessageFlags.Ephemeral
      });
      return true;
    }

    await interaction.reply({
      content: `📄 ${name}\n${attachment.url}`,
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const messages = await thread.messages.fetch({ limit: 20 });

  const fileMessage = messages.find(message =>
    message.author.id === interaction.client.user.id &&
    message.attachments.size > 0
  );

  if (!fileMessage) {
    await interaction.reply({
      content: 'Файлы встречи не найдены.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  if (action === 'tasks') {
    await interaction.reply({
      content: 'Задачи перечислены в протоколе встречи.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  const name = action === 'transcript'
    ? 'meeting-transcript.txt'
    : 'meeting-summary.md';

  const attachment = fileMessage.attachments.find(
    file => file.name === name
  );

  if (!attachment) {
    await interaction.reply({
      content: 'Файл не найден.',
      flags: MessageFlags.Ephemeral
    });
    return true;
  }

  await interaction.reply({
    content: `📄 ${name}\n${attachment.url}`,
    flags: MessageFlags.Ephemeral
  });

  return true;
}

module.exports = {
  publishMeetingArchive,
  handleArchiveButton
};
