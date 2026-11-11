require('dotenv').config();

const { REST, Routes, SlashCommandBuilder } = require('discord.js');

const { Pool } = require('pg');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const { Client, GatewayIntentBits } = require('discord.js');

const FREE_TIME_ZONE_ID = process.env.FREE_TIME_ZONE_ID || '';

function isInFreeTimeZone(guild, userId) {
  if (!FREE_TIME_ZONE_ID) return false;
  return guild.voiceStates.cache.get(userId)?.channelId === FREE_TIME_ZONE_ID;
}

async function closeTrackedSessions(guildId, userId) {
  await pool.query(
    `UPDATE presence_sessions
     SET offline_at = NOW()
     WHERE guild_id = $1 AND user_id = $2 AND offline_at IS NULL`,
    [guildId, userId]
  );

  await pool.query(
    `UPDATE voice_sessions
     SET left_at = NOW()
     WHERE guild_id = $1 AND user_id = $2 AND left_at IS NULL`,
    [guildId, userId]
  );
}

const allowedUserIds = (process.env.ALLOWED_USER_IDS || '')
  .split(',')
  .map(id => id.trim())
  .filter(Boolean);

async function getDisplayName(userId, fallbackUsername) {
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    const member = await guild.members.fetch(userId);

    return member.nickname || member.user.globalName || member.user.username;
  } catch (error) {
    console.error(
      `Не удалось получить Display Name для ${userId}:`,
      error.message
    );

    return fallbackUsername;
  }
}

async function recordActivityEvent(guildId, userId, username, eventType, occurredAt = new Date()) {
  try {
    await pool.query(
      `INSERT INTO activity_events
       (guild_id, user_id, username, event_type, occurred_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [guildId, userId, username, eventType, occurredAt]
    );

    console.log(
      `[ACTIVITY] ${username} -> ${eventType} @ ${occurredAt.toISOString()}`
    );
  } catch (error) {
    console.error('[ACTIVITY DB ERROR]', error.message);
  }
}

const commands = [
  new SlashCommandBuilder()
    .setName('stats')
    .setDescription('Показать статистику Online и Voice за сегодня')
    .toJSON(),
  new SlashCommandBuilder()
    .setName('presencecheck')
    .setDescription('Проверить статусы и открытые Online-сессии')
    .toJSON()
];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
  ],
});


async function reconcilePresenceSessions() {
    try {
      const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
      const members = await guild.members.fetch({ withPresences: true });

      let closedCount = 0;
      let restoredCount = 0;
      const statusCounts = {
        online: 0,
        idle: 0,
        dnd: 0,
        offline: 0,
        missing: 0,
        other: 0
      };

      for (const [, member] of members) {
        if (member.voice.channelId === FREE_TIME_ZONE_ID ||
            isInFreeTimeZone(guild, member.id)) {
          await closeTrackedSessions(guild.id, member.id);
          continue;
        }

        const status = member.presence?.status;

        if (!status) {
          statusCounts.missing++;

          // Discord обычно не присылает presence-объект для offline-участников.
          // Закрываем только давно открытые сессии, не затрагивая свежие.
          const result = await pool.query(
            `UPDATE presence_sessions
             SET offline_at = NOW()
             WHERE guild_id = $1
               AND user_id = $2
               AND offline_at IS NULL
               AND online_at < NOW() - INTERVAL '5 minutes'`,
            [guild.id, member.user.id]
          );

          if (result.rowCount > 0) {
            closedCount += result.rowCount;
            console.log(
              `Online-сессия закрыта: статус Discord отсутствует, ${member.user.username} (${member.user.id})`
            );
          }

          continue;
        }

        if (Object.prototype.hasOwnProperty.call(statusCounts, status)) {
          statusCounts[status]++;
        } else {
          statusCounts.other++;
        }

        if (status === 'offline') {
          const result = await pool.query(
            `UPDATE presence_sessions
             SET offline_at = NOW()
             WHERE guild_id = $1
               AND user_id = $2
               AND offline_at IS NULL`,
            [guild.id, member.user.id]
          );

          closedCount += result.rowCount;
          continue;
        }

        if (!['online', 'idle', 'dnd'].includes(status)) continue;

        const existing = await pool.query(
          `SELECT id
           FROM presence_sessions
           WHERE guild_id = $1
             AND user_id = $2
             AND offline_at IS NULL
           LIMIT 1`,
          [guild.id, member.user.id]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO presence_sessions
              (guild_id, user_id, username, online_at)
             VALUES ($1, $2, $3, NOW())`,
            [guild.id, member.user.id, member.user.username]
          );
          restoredCount++;
        }
      }

      console.log(
        `Сверка Online-сессий: участников=${members.size}, статусы=${JSON.stringify(statusCounts)}, закрыто=${closedCount}, восстановлено=${restoredCount}`
      );
    } catch (error) {
      console.error('Ошибка сверки Online-сессий:', error);
    }

}

client.once('ready', async () => {
  console.log(`Бот запущен: ${client.user.tag}`);

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

    await rest.put(
      Routes.applicationGuildCommands(
        client.user.id,
        process.env.DISCORD_GUILD_ID
      ),
      { body: commands }
    );

    console.log('Команда /stats зарегистрирована');


    await reconcilePresenceSessions();

    setInterval(() => {
      reconcilePresenceSessions().catch(error => {
        console.error('Ошибка периодической сверки:', error);
      });
    }, 5 * 60 * 1000);


  } catch (error) {
    console.error('Ошибка регистрации команды:', error);
  }
});

client.on('presenceUpdate', async (oldPresence, newPresence) => {
  if (newPresence.guild.id !== process.env.DISCORD_GUILD_ID) {
    return;
  }

  const user = newPresence.user;

  if (isInFreeTimeZone(newPresence.guild, user.id)) {
    try {
      await closeTrackedSessions(newPresence.guild.id, user.id);
    } catch (error) {
      console.error('[FREE ZONE]', error.message);
    }
    return;
  }

  const oldStatus = oldPresence?.status ?? 'offline';
  const newStatus = newPresence.status;

  if (oldStatus === newStatus) {
    return;
  }

  console.log(
    `[PRESENCE] ${user.tag}: ${oldStatus} -> ${newStatus}`
  );

  try {
    const wasActive = ['online', 'dnd'].includes(oldStatus);
    const isActive = ['online', 'dnd'].includes(newStatus);

    if (!wasActive && isActive) {
      await recordActivityEvent(
        newPresence.guild.id,
        user.id,
        user.tag,
        'active_start'
      );
    }

    if (wasActive && !isActive) {
      await recordActivityEvent(
        newPresence.guild.id,
        user.id,
        user.tag,
        'active_end'
      );
    }

    // Переход в Online
    if (
      ['online', 'idle', 'dnd'].includes(newStatus)
    ) {
      const result = await pool.query(
        `SELECT id
         FROM presence_sessions
         WHERE guild_id = $1
           AND user_id = $2
           AND offline_at IS NULL
         LIMIT 1`,
        [newPresence.guild.id, user.id]
      );

      if (result.rows.length === 0) {
        await pool.query(
          `INSERT INTO presence_sessions
           (guild_id, user_id, username, online_at)
           VALUES ($1, $2, $3, NOW())`,
          [newPresence.guild.id, user.id, user.tag]
        );

        console.log(`[DB] ${user.tag} -> ONLINE`);
      }
    }

    // Переход в Offline
    if (
      newStatus === 'offline'
    ) {
      const result = await pool.query(
        `UPDATE presence_sessions
         SET offline_at = NOW()
         WHERE guild_id = $1
           AND user_id = $2
           AND offline_at IS NULL`,
        [newPresence.guild.id, user.id]
      );

      if (result.rowCount > 0) {
        console.log(`[DB] ${user.tag} -> OFFLINE`);
      }
    }
  } catch (error) {
    console.error('[DB ERROR]', error.message);
  }
});
client.on('voiceStateUpdate', async (oldState, newState) => {
  if (newState.guild.id !== process.env.DISCORD_GUILD_ID) return;

  const user = newState.member?.user || oldState.member?.user;
  if (!user) return;

  const oldChannel = oldState.channelId;
  const newChannel = newState.channelId;

  if (oldChannel === newChannel) return;

  const wasTracked = Boolean(oldChannel && oldChannel !== FREE_TIME_ZONE_ID);
  const isTracked = Boolean(newChannel && newChannel !== FREE_TIME_ZONE_ID);

  try {
    // Закрываем прежнюю учитываемую Voice-сессию.
    if (wasTracked) {
      await pool.query(
        `UPDATE voice_sessions
         SET left_at = NOW()
         WHERE guild_id = $1
           AND user_id = $2
           AND left_at IS NULL`,
        [newState.guild.id, user.id]
      );
    }

    // Вход в Free Time Zone: полностью прекращаем учёт.
    if (newChannel === FREE_TIME_ZONE_ID) {
      await closeTrackedSessions(newState.guild.id, user.id);
      console.log(`[FREE ZONE] ${user.tag} -> учёт остановлен`);
      return;
    }

    // Выход из Free Time Zone.
    if (oldChannel === FREE_TIME_ZONE_ID) {
      const status = newState.member?.presence?.status;

      if (['online', 'idle', 'dnd'].includes(status)) {
        const existing = await pool.query(
          `SELECT id FROM presence_sessions
           WHERE guild_id = $1
             AND user_id = $2
             AND offline_at IS NULL
           LIMIT 1`,
          [newState.guild.id, user.id]
        );

        if (existing.rows.length === 0) {
          await pool.query(
            `INSERT INTO presence_sessions
               (guild_id, user_id, username, online_at)
             VALUES ($1, $2, $3, NOW())`,
            [newState.guild.id, user.id, user.tag]
          );
        }
      }

      if (['online', 'dnd'].includes(status)) {
        await recordActivityEvent(
          newState.guild.id, user.id, user.tag, 'active_start'
        );
      }

      console.log(`[FREE ZONE] ${user.tag} -> учёт возобновлён`);
    } else if (!oldChannel && isTracked) {
      await recordActivityEvent(
        newState.guild.id, user.id, user.tag, 'active_start'
      );
    } else if (wasTracked && !newChannel) {
      await recordActivityEvent(
        newState.guild.id, user.id, user.tag, 'active_end'
      );
    } else if (wasTracked && isTracked) {
      await recordActivityEvent(
        newState.guild.id, user.id, user.tag, 'active_end'
      );
      await recordActivityEvent(
        newState.guild.id, user.id, user.tag, 'active_start'
      );
    }

    // Создаём Voice-сессию только для обычных комнат.
    if (isTracked) {
      await pool.query(
        `INSERT INTO voice_sessions
           (guild_id, user_id, username, channel_id, channel_name, joined_at)
         VALUES ($1, $2, $3, $4, $5, NOW())`,
        [
          newState.guild.id,
          user.id,
          user.tag,
          newChannel,
          newState.channel?.name || ''
        ]
      );
    }

  } catch (error) {
    console.error('[VOICE DB ERROR]', error.message);
  }
});

client.on('messageCreate', async (message) => {
  if (message.guild?.id !== process.env.DISCORD_GUILD_ID) {
    return;
  }

  if (message.author.bot) {
    return;
  }

  if (isInFreeTimeZone(message.guild, message.author.id)) {
    return;
  }

  await recordActivityEvent(
    message.guild.id,
    message.author.id,
    message.author.tag,
    'message',
    new Date(message.createdTimestamp)
  );
});

client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) {
    return;
  }

  if (interaction.commandName === 'presencecheck') {
    if (!allowedUserIds.includes(interaction.user.id)) {
      await interaction.reply({
        content: '❌ У тебя нет доступа к этой команде.',
        ephemeral: true
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });

    try {
      const guild = await client.guilds.fetch(
        process.env.DISCORD_GUILD_ID
      );

      const ids = (process.env.DEBUG_USER_IDS || '')
        .split(',')
        .map(id => id.trim())
        .filter(Boolean);

      const lines = [];

      for (const id of ids) {
        let member;

        try {
          member = await guild.members.fetch({
            user: id,
            force: true
          });
        } catch {
          lines.push(`ID ${id}: участник не найден или недоступен`);
          continue;
        }

        const status = member.presence?.status ?? 'нет данных';

        const result = await pool.query(
          `SELECT online_at
           FROM presence_sessions
           WHERE guild_id = $1
             AND user_id = $2
             AND offline_at IS NULL
           ORDER BY online_at ASC`,
          [guild.id, id]
        );

        const sessions = result.rows.map(row =>
          new Date(row.online_at).toLocaleString('ru-RU', {
            timeZone: 'Asia/Novosibirsk'
          })
        );

        lines.push(
          `${member.user.username} (${id})\\n` +
          `Статус Discord: ${status}\\n` +
          `Открытых сессий: ${result.rowCount}\\n` +
          `Начало сессии: ${sessions.join(', ') || 'нет'}`
        );
      }

      await interaction.editReply(lines.join('\\n\\n'));
    } catch (error) {
      console.error('Ошибка /presencecheck:', error);
      await interaction.editReply(
        'Ошибка проверки. Подробности в логах бота.'
      );
    }

    return;
  }

  if (interaction.commandName === 'stats') {
    if (!allowedUserIds.includes(interaction.user.id)) {
      await interaction.reply({
        content: '❌ У тебя нет доступа к этой команде.',
        ephemeral: true
      });
      return;
    }

    try {
      const result = await pool.query(`
  WITH
  presence AS (
    SELECT
      user_id,
      username,
      GREATEST(online_at, CURRENT_DATE) AS start_at,
      LEAST(COALESCE(offline_at, NOW()), CURRENT_DATE + INTERVAL '1 day') AS end_at
    FROM presence_sessions
    WHERE online_at < CURRENT_DATE + INTERVAL '1 day'
      AND COALESCE(offline_at, NOW()) > CURRENT_DATE
  ),
  voice AS (
    SELECT
      user_id,
      username,
      GREATEST(joined_at, CURRENT_DATE) AS start_at,
      LEAST(COALESCE(left_at, NOW()), CURRENT_DATE + INTERVAL '1 day') AS end_at
    FROM voice_sessions
    WHERE joined_at < CURRENT_DATE + INTERVAL '1 day'
      AND COALESCE(left_at, NOW()) > CURRENT_DATE
  ),
  all_intervals AS (
    SELECT user_id, username, start_at, end_at FROM presence
    UNION ALL
    SELECT user_id, username, start_at, end_at FROM voice
  ),
  events AS (
    SELECT user_id, start_at AS event_at, 1 AS delta
    FROM all_intervals
    WHERE end_at > start_at

    UNION ALL

    SELECT user_id, end_at AS event_at, -1 AS delta
    FROM all_intervals
    WHERE end_at > start_at
  ),
  timeline AS (
    SELECT
      user_id,
      event_at,
      SUM(delta) OVER (
        PARTITION BY user_id
        ORDER BY event_at, delta DESC
        ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
      ) AS active_count,
      LEAD(event_at) OVER (
        PARTITION BY user_id
        ORDER BY event_at, delta DESC
      ) AS next_event
    FROM events
  ),
  online AS (
    SELECT
      user_id,
      SUM(
        CASE
          WHEN active_count > 0
          THEN EXTRACT(EPOCH FROM (next_event - event_at))
          ELSE 0
        END
      ) AS online_seconds
    FROM timeline
    WHERE next_event IS NOT NULL
    GROUP BY user_id
  ),
  voice_total AS (
    SELECT
      user_id,
      SUM(EXTRACT(EPOCH FROM (end_at - start_at))) AS voice_seconds
    FROM voice
    WHERE end_at > start_at
    GROUP BY user_id
  ),
  all_users AS (
    SELECT DISTINCT ON (user_id)
      user_id,
      username
    FROM (
      SELECT user_id, username, online_at AS activity_at
      FROM presence_sessions
      WHERE online_at < CURRENT_DATE + INTERVAL '1 day'
        AND COALESCE(offline_at, NOW()) > CURRENT_DATE

      UNION ALL

      SELECT user_id, username, joined_at AS activity_at
      FROM voice_sessions
      WHERE joined_at < CURRENT_DATE + INTERVAL '1 day'
        AND COALESCE(left_at, NOW()) > CURRENT_DATE
    ) users
    ORDER BY user_id, activity_at DESC
  )
  SELECT
    all_users.user_id,
    all_users.username,
    COALESCE(online.online_seconds, 0) AS online_seconds,
    COALESCE(voice_total.voice_seconds, 0) AS voice_seconds
  FROM all_users
  LEFT JOIN online
    ON online.user_id = all_users.user_id
  LEFT JOIN voice_total
    ON voice_total.user_id = all_users.user_id
  ORDER BY online_seconds DESC;
`);

const messages = [];
let message = '**📊 Статистика за сегодня:**\n';

for (const row of result.rows) {
  const displayName = await getDisplayName(row.user_id, row.username);

  const onlineSeconds = Math.floor(Number(row.online_seconds));
  const voiceSeconds = Math.floor(Number(row.voice_seconds));

  const onlineHours = Math.floor(onlineSeconds / 3600);
  const onlineMinutes = Math.floor((onlineSeconds % 3600) / 60);
  const onlineSecs = onlineSeconds % 60;

  const voiceHours = Math.floor(voiceSeconds / 3600);
  const voiceMinutes = Math.floor((voiceSeconds % 3600) / 60);
  const voiceSecs = voiceSeconds % 60;

  const userMessage =
    `**${displayName}**\n` +
    `🟢 Online: ${onlineHours} ч ${onlineMinutes} мин ${onlineSecs} сек\n` +
    `🎙️ Voice: ${voiceHours} ч ${voiceMinutes} мин ${voiceSecs} сек\n\n`;

  if (message.length + userMessage.length > 1900) {
    messages.push(message);
    message = '';
  }

  message += userMessage;
}

if (message.length > 0) {
  messages.push(message);
}

await interaction.reply(messages[0]);

for (let i = 1; i < messages.length; i++) {
  await interaction.followUp(messages[i]);
}
    } catch (error) {
      console.error('[STATS ERROR]', error);
      await interaction.reply('Ошибка при получении статистики.');
    }
  }
});

client.login(process.env.DISCORD_TOKEN);
