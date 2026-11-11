const fs = require('node:fs/promises');
const path = require('node:path');

const DATA_DIR = path.join(__dirname, 'meeting-data');

function getMeetingPath(meetingId) {
  if (!/^[a-zA-Z0-9_-]+$/.test(meetingId)) {
    throw new Error('Invalid meeting ID');
  }

  return path.join(DATA_DIR, `${meetingId}.jsonl`);
}

async function saveSegment(meetingId, segment) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

  const filePath = getMeetingPath(meetingId);
  const line = JSON.stringify(segment) + '\n';

  const handle = await fs.open(filePath, 'a', 0o600);

  try {
    await handle.writeFile(line);
    await handle.sync();
  } finally {
    await handle.close();
  }

  // Сохраняем также запись о файле в каталоге.
  const dirHandle = await fs.open(DATA_DIR, 'r');

  try {
    await dirHandle.sync();
  } finally {
    await dirHandle.close();
  }
}

async function loadSegments(meetingId) {
  let content;

  try {
    content = await fs.readFile(getMeetingPath(meetingId), 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return content
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
    .sort((a, b) => a.timestamp - b.timestamp);
}

async function hasSegment(meetingId, segmentId) {
  const segments = await loadSegments(meetingId);
  return segments.some(segment => segment.segmentId === segmentId);
}

async function deleteMeeting(meetingId) {
  const transcriptPath = getMeetingPath(meetingId);
  const metadataPath = transcriptPath.replace(/\.jsonl$/, '.meta.json');

  for (const filePath of [transcriptPath, metadataPath]) {
    try {
      await fs.unlink(filePath);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function saveMeetingMetadata(meetingId, metadata) {
  await fs.mkdir(DATA_DIR, { recursive: true, mode: 0o700 });

  const filePath = getMeetingPath(meetingId).replace(/\.jsonl$/, '.meta.json');
  const tempPath = filePath + '.tmp';

  await fs.writeFile(
    tempPath,
    JSON.stringify(metadata, null, 2),
    { mode: 0o600 }
  );

  await fs.rename(tempPath, filePath);
}

async function loadMeetingMetadata(meetingId) {
  const filePath = getMeetingPath(meetingId).replace(/\.jsonl$/, '.meta.json');

  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

async function markMeetingDelivered(meetingId, messageId) {
  const metadata = await loadMeetingMetadata(meetingId);

  if (!metadata) {
    throw new Error('Метаданные встречи не найдены');
  }

  await saveMeetingMetadata(meetingId, {
    ...metadata,
    deliveredMessageId: messageId
  });
}

module.exports = {
  markMeetingDelivered,
  saveMeetingMetadata,
  loadMeetingMetadata,
  saveSegment,
  loadSegments,
  hasSegment,
  deleteMeeting
};
