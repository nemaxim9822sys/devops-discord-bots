const crypto = require('node:crypto');

const { transcribeOpusPackets } = require('./transcriber');
const { saveSegment, hasSegment } = require('./meeting-storage');
const {
  saveAudioSegment,
  loadAudioSegment,
  deleteAudioSegment
} = require('./audio-storage');

const activeSegments = new Map();

async function processAudioSegment(
  meetingId,
  userId,
  name,
  packets,
  timestamp
) {
  if (!packets.length) return null;

  const segmentId = crypto.randomUUID().replace(/-/g, '');

  await saveAudioSegment(
    meetingId,
    segmentId,
    { userId, name, timestamp },
    packets
  );

  return transcribeSavedSegment(meetingId, segmentId, {
    userId, name, timestamp, packets
  });
}

function transcribeSavedSegment(meetingId, segmentId, audio) {
  const key = JSON.stringify([meetingId, segmentId]);

  if (activeSegments.has(key)) {
    return activeSegments.get(key);
  }

  const task = transcribeSavedSegmentOnce(meetingId, segmentId, audio);
  activeSegments.set(key, task);

  // Удаляем блокировку после завершения, включая ошибки.
  // Не создаём отдельный необработанный rejected Promise.
  void task.then(
    () => activeSegments.delete(key),
    () => activeSegments.delete(key)
  );

  return task;
}

async function transcribeSavedSegmentOnce(meetingId, segmentId, audio) {
  if (await hasSegment(meetingId, segmentId)) {
    await deleteAudioSegment(meetingId, segmentId);
    return { segmentId, pending: false, alreadySaved: true };
  }

  const { userId, name, timestamp, packets } = audio;

  let text;

  try {
    text = await transcribeOpusPackets(packets);
  } catch (error) {
    console.error(`[STT ERROR] ${name}:`, error.message);
    throw error;
  }

  if (!text || !text.trim()) {
    // Один Opus-пакет содержит 20 мс аудио.
    // Пропускаем только заведомо короткие фрагменты.
    if (packets.length * 20 < 300) {
      console.warn(
        `[STT SKIP] ${name}: короткий фрагмент ${segmentId}`
      );
      await deleteAudioSegment(meetingId, segmentId);
      return { segmentId, pending: false, skipped: true };
    }

    console.warn(`[STT EMPTY] ${name}: фрагмент ${segmentId} сохранён`);
    return { segmentId, pending: true, text: null };
  }

  const segment = {
    segmentId, userId, name, timestamp, text
  };

  await saveSegment(meetingId, segment);
  await deleteAudioSegment(meetingId, segmentId);

  return { segmentId, pending: false, segment };
}

async function retryAudioSegment(meetingId, segmentId) {
  const audio = await loadAudioSegment(meetingId, segmentId);
  return transcribeSavedSegment(meetingId, segmentId, audio);
}

module.exports = { processAudioSegment, retryAudioSegment };
