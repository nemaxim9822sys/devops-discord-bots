async function handleMeetingDMButton(interaction) {
  if (!interaction.isButton()) return false;
  if (!interaction.customId.startsWith('dm-meeting:')) return false;

  if (!interaction.channel?.isDMBased() || interaction.guildId) {
    await interaction.reply({
      content: 'Эти кнопки доступны только в личных сообщениях.'
    });
    return true;
  }

  const action = interaction.customId.split(':')[1];

  const filenames = {
    summary: 'meeting-summary.md',
    transcript: 'meeting-transcript.txt',
    tasks: 'meeting-tasks.md'
  };

  const filename = filenames[action];

  if (!filename) {
    await interaction.reply({ content: 'Неизвестная кнопка.' });
    return true;
  }

  await interaction.deferReply();

  const archive = interaction.message.attachments.find(
    file => file.name === 'meeting-materials.zip'
  );

  if (!archive) {
    await interaction.editReply('Архив встречи не найден.');
    return true;
  }

  const response = await fetch(archive.url);

  if (!response.ok) {
    throw new Error(`Ошибка загрузки ZIP: ${response.status}`);
  }

  const JSZip = require('jszip');
  const { AttachmentBuilder } = require('discord.js');

  const zip = await JSZip.loadAsync(
    Buffer.from(await response.arrayBuffer())
  );

  const document = zip.file(filename);

  if (!document) {
    await interaction.editReply('Документ не найден в архиве.');
    return true;
  }

  const content = await document.async('nodebuffer');

  await interaction.editReply({
    content: `📄 ${filename}`,
    files: [
      new AttachmentBuilder(content, { name: filename })
    ]
  });

  return true;
}

module.exports = { handleMeetingDMButton };
