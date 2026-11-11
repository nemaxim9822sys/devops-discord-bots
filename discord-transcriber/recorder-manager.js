const fs = require('node:fs');
const path = require('node:path');
const dotenv = require('dotenv');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  joinVoiceChannel,
  getVoiceConnection,
  VoiceConnectionStatus,
  entersState
} = require('@discordjs/voice');

const configPath = path.join(__dirname, '.env.recorders');
const config = dotenv.parse(fs.readFileSync(configPath));

const recorders = [];

for (let i = 1; i <= 5; i++) {
  const number = String(i).padStart(2, '0');
  const token = config[`RECORDER_${number}_TOKEN`];

  if (!token) {
    throw new Error(`Не заполнен токен рекордера ${number}`);
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildVoiceStates
    ]
  });

  recorders.push({
    number,
    client,
    token,
    busy: false
  });
}

async function connectRecorders() {
  for (const recorder of recorders) {
    await recorder.client.login(recorder.token);
    console.log(
      `[RECORDER ${recorder.number}] Подключён: ${recorder.client.user.tag}`
    );
  }
}

async function disconnectRecorders() {
  for (const recorder of recorders) {
    recorder.client.destroy();
  }
}

function acquireRecorder() {
  const recorder = recorders.find(
    item => !item.busy && item.client.isReady()
  );

  if (!recorder) return null;

  recorder.busy = true;
  return recorder;
}

function releaseRecorder(recorder) {
  if (!recorder || !recorders.includes(recorder)) {
    throw new Error('Неизвестный рекордер');
  }

  recorder.busy = false;
}

async function joinRecorderChannel(recorder, guildId, channelId) {
  if (!recorders.includes(recorder) || !recorder.busy) {
    throw new Error('Рекордер не выделен');
  }

  if (!recorder.client.isReady()) {
    throw new Error('Рекордер не подключён к Discord');
  }

  const guild = await recorder.client.guilds.fetch(guildId);

  const connection = joinVoiceChannel({
    guildId,
    channelId,
    adapterCreator: guild.voiceAdapterCreator,
    selfDeaf: false,
    selfMute: true,
    group: `recorder-${recorder.number}`
  });

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30000);
    return connection;
  } catch (error) {
    connection.destroy();
    throw error;
  }
}

function leaveRecorderChannel(recorder, guildId) {
  if (!recorders.includes(recorder)) {
    throw new Error('Неизвестный рекордер');
  }

  const connection = getVoiceConnection(
    guildId,
    `recorder-${recorder.number}`
  );

  if (connection) connection.destroy();
}

module.exports = {
  recorders,
  connectRecorders,
  disconnectRecorders,
  acquireRecorder,
  releaseRecorder,
  joinRecorderChannel,
  leaveRecorderChannel
};
