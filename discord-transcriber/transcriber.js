const OpenAI = require('openai');
const { toFile } = require('openai/uploads');
const prism = require('prism-media');
const { PassThrough } = require('stream');
const { spawn } = require('child_process');
const ffmpegPath = require('ffmpeg-static');



const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

function calculateRms(pcm) {
  const sampleCount = Math.floor(pcm.length / 2);
  if (!sampleCount) return 0;

  let sum = 0;

  for (let i = 0; i < sampleCount; i++) {
    const sample = pcm.readInt16LE(i * 2) / 32768;
    sum += sample * sample;
  }

  return Math.sqrt(sum / sampleCount);
}

async function transcribeOpusPackets(packets) {
  if (!packets.length) return '';

  // Opus -> PCM, 48 kHz, stereo
  const decoder = new prism.opus.Decoder({
    rate: 48000,
    channels: 2,
    frameSize: 960,
  });

  const input = new PassThrough();
  const pcmChunks = [];

  const pcm = await new Promise((resolve, reject) => {
    decoder.on('data', chunk => pcmChunks.push(chunk));
    decoder.on('error', reject);
    decoder.on('end', () => resolve(Buffer.concat(pcmChunks)));

    input.pipe(decoder);

    for (const packet of packets) {
      input.write(packet);
    }

    input.end();
  });

  if (!pcm.length) return '';

  // PCM: 48000 Hz, stereo, 16-bit = 192000 bytes/sec.
  const durationMs = (pcm.length / 192000) * 1000;

  if (durationMs < 300) {
    console.log(
      `[STT SKIP] Слишком короткий фрагмент: ${Math.round(durationMs)} мс`
    );
    return '';
  }

  // Отсекаем только практически бесшумные фрагменты.
  const rms = calculateRms(pcm);

  console.log(
    `[AUDIO LEVEL] duration=${durationMs.toFixed(0)}ms RMS=${rms.toFixed(5)}`
  );

  if (false && rms < 0.001) {
    console.log(
      `[STT SKIP] Почти тишина, RMS=${rms.toFixed(5)}`
    );
    return '';
  }

  // PCM -> WAV в оперативной памяти
  const ffmpeg = spawn(ffmpegPath, [
    '-hide_banner',
    '-loglevel', 'error',
    '-f', 's16le',
    '-ar', '48000',
    '-ac', '2',
    '-i', 'pipe:0',
    '-f', 'wav',
    'pipe:1',
  ]);

  const wavChunks = [];
  const errors = [];

  const wav = await new Promise((resolve, reject) => {
    ffmpeg.stdout.on('data', chunk => wavChunks.push(chunk));
    ffmpeg.stderr.on('data', chunk => errors.push(chunk));
    ffmpeg.on('error', reject);

    ffmpeg.on('close', code => {
      if (code !== 0) {
        return reject(new Error(Buffer.concat(errors).toString()));
      }
      resolve(Buffer.concat(wavChunks));
    });

    ffmpeg.stdin.on('error', reject);
    ffmpeg.stdin.end(pcm);
  });

  const file = await toFile(wav, 'speech.wav', {
    type: 'audio/wav',
  });

  const result = await openai.audio.transcriptions.create({
    file,
    model: 'gpt-4o-transcribe',
    language: 'ru',
    prompt: 'Запись деловой встречи на русском языке. Участники говорят по-русски, иногда быстро. Точно передавай произнесённые слова, имена, названия проектов и технические термины. Не добавляй слова, которых нет в аудио.',
  });

  return result.text?.trim() || '';
}

module.exports = { transcribeOpusPackets };
