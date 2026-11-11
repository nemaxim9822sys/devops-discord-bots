const { EndBehaviorType } = require('@discordjs/voice');
const { processAudioSegment } = require('./audio-segment-processor');

const MERGE_PAUSE_MS = 1500;
const MAX_SEGMENT_MS = 30000;
const MAX_PACKETS = 1500;

function startAudioReceiver(connection, client, startedAt, meetingId) {
  const receiver = connection.receiver;
  const active = new Map();
  const pending = new Set();
  const transcript = [];
  let stopping = false;

  function processSegment(userId, name, packets, timestamp) {
    if (!packets.length) return;

    const task = (async () => {
      console.log(
        `[STT] Распознавание: ${name}, ` +
        `пакетов: ${packets.length}, ` +
        `примерная длительность: ${(packets.length * 0.02).toFixed(2)} сек`
      );

      try {
        const result = await processAudioSegment(
          meetingId, userId, name, packets, timestamp
        );

        if (result?.segment) {
          transcript.push(result.segment);
          console.log(`[STT] ${name}: ${result.segment.text}`);
        } else if (result?.pending) {
          console.warn(
            `[AUDIO PENDING] ${name}: ` +
            `фрагмент ${result.segmentId} ожидает повторной обработки`
          );
        }
      } catch (error) {
        console.error(
          `[AUDIO PROCESSING ERROR] ${name}:`,
          error.message
        );
        console.error(
          '[AUDIO WARNING] Проверьте audio-pending и журнал сервиса'
        );
      }
    })();

    pending.add(task);

    void task.then(
      () => pending.delete(task),
      () => pending.delete(task)
    );
  }

  function flushSegment(userId, state) {
    if (!state.packets.length) return;

    const packets = state.packets;
    const timestamp = state.segmentStartedAt;

    state.packets = [];
    state.segmentStartedAt = Date.now();

    processSegment(userId, state.name, packets, timestamp);
  }

  function clearFlushTimer(state) {
    if (state.flushTimer !== null) {
      clearTimeout(state.flushTimer);
      state.flushTimer = null;
    }
  }

  function scheduleFlush(userId, state) {
    clearFlushTimer(state);

    state.flushTimer = setTimeout(() => {
      state.flushTimer = null;

      // Старый таймер не должен затронуть новый поток.
      if (active.get(userId) !== state) return;

      flushSegment(userId, state);
      active.delete(userId);
    }, MERGE_PAUSE_MS);
  }

  function onSpeakingStart(userId) {
    if (stopping || userId === client.user.id) return;

    let state = active.get(userId);

    if (state) {
      // Не подписываемся повторно на ещё работающий поток.
      if (state.stream &&
          !state.stream.destroyed &&
          !state.stream.readableEnded) {
        return;
      }

      // Сохраняем накопленные пакеты предыдущей реплики.
      clearFlushTimer(state);
    } else {
      const user = client.users.cache.get(userId);
      const name = user?.globalName || user?.username || userId;

      state = {
        name,
        packets: [],
        segmentStartedAt: Date.now(),
        stream: null,
        flushTimer: null
      };

      active.set(userId, state);
    }

    const stream = receiver.subscribe(userId, {
      end: {
        behavior: EndBehaviorType.AfterSilence,
        duration: 1000
      }
    });

    state.stream = stream;

    console.log(`[AUDIO] Начал говорить: ${state.name}`);

    stream.on('data', packet => {
      if (stopping || active.get(userId) !== state) return;

      if (!state.packets.length) {
        state.segmentStartedAt = Date.now();
      }

      state.packets.push(Buffer.from(packet));

      if (
        state.packets.length >= MAX_PACKETS ||
        Date.now() - state.segmentStartedAt >= MAX_SEGMENT_MS
      ) {
        flushSegment(userId, state);
      }
    });

    stream.on('end', () => {
      if (state.stream !== stream) return;
      if (stopping || active.get(userId) !== state) return;

      console.log(`[AUDIO] Закончил говорить: ${state.name}`);
      scheduleFlush(userId, state);
    });

    stream.on('error', error => {
      console.error(`[AUDIO ERROR] ${state.name}:`, error.message);

      if (state.stream !== stream) return;
      if (active.get(userId) !== state) return;

      clearFlushTimer(state);
      flushSegment(userId, state);
      active.delete(userId);
    });
  }

  receiver.speaking.on('start', onSpeakingStart);

  console.log('[AUDIO] Приём аудио и транскрибация активированы');

  return {
    async stop() {
      stopping = true;
      receiver.speaking.off('start', onSpeakingStart);

      for (const [userId, state] of active) {
        clearFlushTimer(state);
        flushSegment(userId, state);

        if (state.stream && !state.stream.destroyed) {
          state.stream.destroy();
        }
      }

      active.clear();

      while (pending.size) {
        await Promise.allSettled([...pending]);
      }

      transcript.sort((a, b) => a.timestamp - b.timestamp);

      return transcript.map(item => {
        const seconds = Math.max(
          0,
          Math.floor((item.timestamp - startedAt) / 1000)
        );

        const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
        const ss = String(seconds % 60).padStart(2, '0');

        return `[${mm}:${ss}] ${item.name}:\n${item.text}`;
      }).join('\n\n');
    }
  };
}

module.exports = { startAudioReceiver };
