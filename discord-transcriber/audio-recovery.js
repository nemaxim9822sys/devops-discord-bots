const { listAudioSegments } = require('./audio-storage');
const { retryAudioSegment } = require('./audio-segment-processor');

async function recoverPendingAudio(meetingId) {
  const segmentIds = await listAudioSegments(meetingId);

  const result = {
    total: segmentIds.length,
    recovered: 0,
    pending: 0,
    errors: []
  };

  for (const segmentId of segmentIds) {
    try {
      const outcome = await retryAudioSegment(meetingId, segmentId);

      if (outcome.pending) {
        result.pending++;
      } else {
        result.recovered++;
      }
    } catch (error) {
      result.pending++;
      result.errors.push({
        segmentId,
        message: error.message
      });

      console.error(
        `[AUDIO RECOVERY ERROR] ${meetingId}/${segmentId}:`,
        error.message
      );
    }
  }

  return result;
}

module.exports = { recoverPendingAudio };
