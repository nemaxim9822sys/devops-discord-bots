const fs = require('node:fs/promises');
const path = require('node:path');

const AUDIO_DIR = path.join(__dirname, 'audio-pending');

function validateId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(id)) {
    throw new Error('Invalid audio ID');
  }
  return id;
}

function meetingDir(meetingId) {
  return path.join(AUDIO_DIR, validateId(meetingId));
}

function segmentPath(meetingId, segmentId) {
  return path.join(
    meetingDir(meetingId),
    `${validateId(segmentId)}.json`
  );
}

async function saveAudioSegment(meetingId, segmentId, metadata, packets) {
  if (!Array.isArray(packets) || !packets.length) {
    throw new Error('Empty audio segment');
  }

  const dir = meetingDir(meetingId);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });

  const target = segmentPath(meetingId, segmentId);
  const temporary = `${target}.${process.pid}.tmp`;

  const record = {
    version: 1,
    segmentId,
    userId: metadata.userId,
    name: metadata.name,
    timestamp: metadata.timestamp,
    packets: packets.map(packet => Buffer.from(packet).toString('base64'))
  };

  let handle;

  try {
    handle = await fs.open(temporary, 'wx', 0o600);
    await handle.writeFile(JSON.stringify(record));
    await handle.sync();
    await handle.close();
    handle = null;

    // Создаём итоговое имя без перезаписи существующего файла.
    await fs.link(temporary, target);

    // Синхронизируем каталог после появления итогового имени.
    const dirHandle = await fs.open(dir, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }

    await fs.unlink(temporary);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => {});
    }

    await fs.unlink(temporary).catch(() => {});
    throw error;
  }

  return target;
}

async function loadAudioSegment(meetingId, segmentId) {
  const content = await fs.readFile(
    segmentPath(meetingId, segmentId),
    'utf8'
  );

  const record = JSON.parse(content);

  if (record.version !== 1 || record.segmentId !== segmentId) {
    throw new Error('Invalid audio segment format');
  }

  return {
    ...record,
    packets: record.packets.map(packet =>
      Buffer.from(packet, 'base64')
    )
  };
}

async function listAudioSegments(meetingId) {
  let files;

  try {
    files = await fs.readdir(meetingDir(meetingId));
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  return files
    .filter(name => /^[a-zA-Z0-9_-]+\.json$/.test(name))
    .map(name => name.slice(0, -5))
    .sort();
}

async function deleteAudioSegment(meetingId, segmentId) {
  try {
    await fs.unlink(segmentPath(meetingId, segmentId));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}

module.exports = {
  saveAudioSegment,
  loadAudioSegment,
  listAudioSegments,
  deleteAudioSegment
};
