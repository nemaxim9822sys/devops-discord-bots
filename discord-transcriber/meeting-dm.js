const JSZip = require('jszip');
const {
  EmbedBuilder,
  AttachmentBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle
} = require('discord.js');

async function sendMeetingDM(client, session, transcript, summary) {
  const user = await client.users.fetch(session.startedBy);

  const duration = Math.max(
    1,
    Math.ceil((Date.now() - session.startedAt) / 60000)
  );

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('📋 Итоги вашей встречи')
    .setDescription(
      summary
        ? summary.slice(0, 3500)
        : 'Саммари отсутствует. Расшифровка приложена.'
    )
    .addFields(
      { name: 'Комната', value: session.channelName, inline: true },
      { name: 'Продолжительность', value: `${duration} мин.`, inline: true }
    )
    .setFooter({ text: `Meeting ID: ${session.meetingId}` })
    .setTimestamp();

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

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('dm-meeting:summary')
      .setLabel('Протокол')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('dm-meeting:transcript')
      .setLabel('Расшифровка')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('dm-meeting:tasks')
      .setLabel('Задачи')
      .setStyle(ButtonStyle.Secondary)
  );

  if (summary) {
    const match = summary.match(
      /^##\s+Задачи\s*\r?\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/m
    );

    const tasks = match
      ? match[1].trim()
      : 'Раздел задач не найден в протоколе.';

    files.push(
      new AttachmentBuilder(
        Buffer.from(`# Задачи\n\n${tasks}`, 'utf8'),
        { name: 'meeting-tasks.md' }
      )
    );
  }

  const zip = new JSZip();

  for (const file of files) {
    zip.file(file.name, file.attachment);
  }

  const zipBuffer = await zip.generateAsync({
    type: 'nodebuffer',
    compression: 'DEFLATE'
  });

  return user.send({
    embeds: [embed],
    files: [
      new AttachmentBuilder(zipBuffer, {
        name: 'meeting-materials.zip'
      })
    ],
    components: [buttons]
  });
}

module.exports = { sendMeetingDM };
