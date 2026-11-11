const fs = require('node:fs/promises');
const path = require('node:path');

const {
  loadSegments,
  deleteMeeting,
  loadMeetingMetadata,
  markMeetingDelivered
} = require('./meeting-storage');
const { createMeetingSummary } = require('./meeting-summary');
const { sendMeetingDM } = require('./meeting-dm');
const { recoverPendingAudio } = require('./audio-recovery');
const { listAudioSegments } = require('./audio-storage');

const DATA_DIR = path.join(__dirname, 'meeting-data');

async function findRecoverableMeetings(guildId) {
  let files;

  try {
    files = await fs.readdir(DATA_DIR);
  } catch (error) {
    if (error.code === 'ENOENT') {
      files = [];
    } else {
      throw error;
    }
  }

  const prefix = `${guildId}_`;

  const meetingIds = new Set(
    files
      .filter(name =>
        name.startsWith(prefix) &&
        name.endsWith('.jsonl')
      )
      .map(name => name.slice(0, -6))
  );

  const audioDir = path.join(__dirname, 'audio-pending');
  let audioEntries = [];

  try {
    audioEntries = await fs.readdir(audioDir, {
      withFileTypes: true
    });
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  for (const entry of audioEntries) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) {
      continue;
    }

    const pending = await listAudioSegments(entry.name);

    if (pending.length > 0) {
      meetingIds.add(entry.name);
    }
  }

  return [...meetingIds].sort();
}

function formatTranscript(segments, startedAt) {
  return segments
    .sort((a, b) => a.timestamp - b.timestamp)
    .map(item => {
      const seconds = Math.max(
        0,
        Math.floor((item.timestamp - startedAt) / 1000)
      );

      const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
      const ss = String(seconds % 60).padStart(2, '0');

      return `[${mm}:${ss}] ${item.name}:\n${item.text}`;
    })
    .join('\n\n');
}

async function recoverMeeting(client, guildId, meetingId) {
  if (!meetingId.startsWith(`${guildId}_`)) {
    throw new Error('Встреча принадлежит другому серверу');
  }

  const metadata = await loadMeetingMetadata(meetingId);

  if (
    !metadata ||
    metadata.guildId !== guildId ||
    !metadata.startedBy ||
    !/^[0-9]+$/.test(metadata.startedBy)
  ) {
    throw new Error(
      'Не найден ID организатора встречи. ' +
      'Исходные данные сохранены; автоматическая отправка невозможна.'
    );
  }

  if (metadata.deliveredMessageId) {
    await deleteMeeting(meetingId);
    return {
      alreadyArchived: true,
      url: null
    };
  }

  await recoverPendingAudio(meetingId);

  const remainingAudio = await listAudioSegments(meetingId);

  if (remainingAudio.length) {
    throw new Error(
      'Остались нераспознанные аудиофрагменты: ' +
      remainingAudio.length +
      '. Файлы сохранены; повторите /recover позже.'
    );
  }

  const segments = await loadSegments(meetingId);

  if (!segments.length) {
    throw new Error('Сохранённая расшифровка пуста');
  }

  const startedAt = Number(metadata.startedAt);

  if (!Number.isSafeInteger(startedAt) || startedAt <= 0) {
    throw new Error('Некорректное время начала встречи');
  }

  const transcript = formatTranscript(segments, startedAt);
  const summary = await createMeetingSummary(transcript);

  const session = {
    meetingId,
    startedAt,
    channelName: metadata.channelName || 'Восстановленная встреча',
    startedBy: metadata.startedBy
  };

  const message = await sendMeetingDM(
    client,
    session,
    transcript,
    summary
  );

  await markMeetingDelivered(meetingId, message.id);
  await deleteMeeting(meetingId);

  return {
    alreadyArchived: false,
    url: message.url
  };
}

module.exports = {
  findRecoverableMeetings,
  recoverMeeting
};
