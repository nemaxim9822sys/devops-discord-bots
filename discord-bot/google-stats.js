require('dotenv').config();

const { Pool } = require('pg');
const { google } = require('googleapis');
const { REST, Routes } = require('discord.js');

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

const discordRest = new REST({ version: '10' }).setToken(
  process.env.DISCORD_TOKEN
);

async function getDisplayName(userId, fallbackUsername) {
  try {
    const member = await discordRest.get(
      Routes.guildMember(
        process.env.DISCORD_GUILD_ID,
        userId
      )
    );

    return member.nick || member.user.global_name || member.user.username;
  } catch (error) {
    console.error(
      `Не удалось получить Display Name для ${userId}:`,
      error.message
    );

    return fallbackUsername;
  }
}

const EXCLUDED_USER_IDS = new Set(
  (process.env.EXCLUDED_USER_IDS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)
);

function isExcludedUser(userId) {
  return EXCLUDED_USER_IDS.has(String(userId || '').trim());
}

function getMonthlySheetName(targetDate) {
  const [year, month] = targetDate.split('-').map(Number);

  if (year === 2026 && month === 10) {
    return 'Лист1';
  }

  const months = [
    'Январь', 'Февраль', 'Март', 'Апрель',
    'Май', 'Июнь', 'Июль', 'Август',
    'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
  ];

  return `${months[month - 1]} ${year}`;
}

async function ensureMonthlySheet(sheets, spreadsheetId, sheetName) {
  const response = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets(properties(sheetId,title))',
  });

  const existing = response.data.sheets || [];

  if (existing.some(sheet => sheet.properties.title === sheetName)) {
    if (sheetName !== 'Лист1') {
      const check = await sheets.spreadsheets.values.get({
        spreadsheetId,
        range: `'${sheetName.replace(/'/g, "''")}'!A2:A`,
      });

      const dates = (check.data.values || [])
        .map(row => String(row[0] || '').trim())
        .filter(value => /^\\d{2}\\.\\d{2}\\.\\d{4}$/.test(value));

      const [monthName, year] = sheetName.split(' ');
      const months = [
        'Январь', 'Февраль', 'Март', 'Апрель',
        'Май', 'Июнь', 'Июль', 'Август',
        'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'
      ];

      const expectedMonth = String(months.indexOf(monthName) + 1).padStart(2, '0');

      if (dates.some(date =>
        date.slice(3, 5) !== expectedMonth ||
        date.slice(6) !== year
      )) {
        throw new Error(
          `На листе ${sheetName} обнаружены данные другого месяца. Экспорт остановлен.`
        );
      }
    }

    return;
  }

  if (sheetName === 'Лист1') {
    throw new Error('Исходный лист Лист1 не найден.');
  }

  const template = existing.find(
    sheet => sheet.properties.title === 'Лист1'
  );

  if (!template) {
    throw new Error('Не найден Лист1 для копирования оформления.');
  }

  const result = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        duplicateSheet: {
          sourceSheetId: template.properties.sheetId,
          newSheetName: sheetName,
          insertSheetIndex: existing.length,
        },
      }],
    },
  });

  const newSheetId = result.data.replies[0].duplicateSheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        updateCells: {
          range: {
            sheetId: newSheetId,
            startRowIndex: 1,
          },
          fields: 'userEnteredValue',
        },
      }],
    },
  });

  console.log(`Создан новый месячный лист: ${sheetName}`);
}

async function exportStats() {
 const arg = process.argv[2];

const targetDate =
  arg === 'today'
    ? new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Novosibirsk'
      })
    : arg || new Date(
        Date.now() - 24 * 60 * 60 * 1000
      ).toLocaleDateString('en-CA', {
        timeZone: 'Asia/Novosibirsk'
      });
  const result = await pool.query(`
    WITH target_day AS (
      SELECT
        ($1::date::timestamp AT TIME ZONE 'Asia/Novosibirsk') AS day_start,
        (($1::date + INTERVAL '1 day')::timestamp AT TIME ZONE 'Asia/Novosibirsk') AS day_end
    ),
     presence AS (
       SELECT
         user_id,
         username,
        GREATEST(online_at, target_day.day_start) AS start_time,
        LEAST(COALESCE(offline_at, NOW()), target_day.day_end) AS end_time
      FROM presence_sessions, target_day
      WHERE online_at < target_day.day_end
        AND COALESCE(offline_at, NOW()) > target_day.day_start
    ),
    voice AS (
  SELECT
    user_id,
    username,
        GREATEST(joined_at, target_day.day_start) AS start_time,
        LEAST(COALESCE(left_at, NOW()), target_day.day_end) AS end_time
      FROM voice_sessions, target_day
      WHERE joined_at < target_day.day_end
        AND COALESCE(left_at, NOW()) > target_day.day_start
    ),
    activity_events_day AS (
      SELECT
        user_id,
        username,
        event_type,
        occurred_at
      FROM activity_events, target_day
      WHERE occurred_at >= target_day.day_start + INTERVAL '6 hours'
        AND occurred_at < target_day.day_end + INTERVAL '6 hours'
    ),
    activity_times AS (
      SELECT
        user_id,
        MIN(occurred_at) FILTER (
          WHERE event_type IN ('active_start', 'message')
            AND occurred_at >= target_day.day_start + INTERVAL '6 hours'
            AND occurred_at < target_day.day_start + INTERVAL '21 hours'
        ) AS first_activity_at,
        MAX(occurred_at) AS last_activity_at
      FROM activity_events_day, target_day
      GROUP BY user_id
    ),
    all_users AS (
      SELECT user_id, MAX(username) AS username
      FROM (
        SELECT user_id, username FROM presence
        UNION ALL
        SELECT user_id, username FROM voice
        UNION ALL
        SELECT user_id, username FROM activity_events_day
      ) users
      GROUP BY user_id
    ),
    events AS (
      SELECT user_id, start_time AS event_time, 1 AS delta
      FROM presence
      UNION ALL
      SELECT user_id, end_time AS event_time, -1 AS delta
      FROM presence
      UNION ALL
      SELECT user_id, start_time AS event_time, 1 AS delta
      FROM voice
      UNION ALL
      SELECT user_id, end_time AS event_time, -1 AS delta
      FROM voice
    ),
    timeline AS (
      SELECT
        user_id,
        event_time,
        SUM(delta) OVER (
          PARTITION BY user_id
          ORDER BY event_time, delta DESC
        ) AS active_count,
        LEAD(event_time) OVER (
          PARTITION BY user_id
          ORDER BY event_time, delta DESC
        ) AS next_time
      FROM events
    ),
    activity AS (
      SELECT
        user_id,
        SUM(
          EXTRACT(EPOCH FROM (next_time - event_time))
        ) AS online_seconds
      FROM timeline
      WHERE active_count > 0
        AND next_time IS NOT NULL
      GROUP BY user_id
    ),
    voice_total AS (
      SELECT
        user_id,
        SUM(
          EXTRACT(EPOCH FROM (end_time - start_time))
        ) AS voice_seconds
      FROM voice
      GROUP BY user_id
    )
    SELECT
      all_users.user_id,
      all_users.username,
      activity_times.first_activity_at,
      GREATEST(
        activity_times.last_activity_at,
        (
          SELECT MAX(LEAST(NOW(), target_day.day_end + INTERVAL '6 hours'))
          FROM presence_sessions ps
          CROSS JOIN target_day
          WHERE ps.user_id = all_users.user_id
            AND ps.offline_at IS NULL
            AND ps.online_at < target_day.day_end
            AND NOW() >= target_day.day_start
        )
      ) AS last_activity_at,
      COALESCE(activity.online_seconds, 0) AS online_seconds,
      COALESCE(voice_total.voice_seconds, 0) AS voice_seconds
    FROM all_users
    CROSS JOIN target_day
    LEFT JOIN activity
      ON activity.user_id = all_users.user_id
    LEFT JOIN voice_total
      ON voice_total.user_id = all_users.user_id
    LEFT JOIN activity_times
      ON activity_times.user_id = all_users.user_id
    WHERE ($2::varchar[] IS NULL OR cardinality($2::varchar[]) = 0 OR NOT (all_users.user_id = ANY($2::varchar[])))
    ORDER BY all_users.username;
  `, [targetDate, Array.from(EXCLUDED_USER_IDS)]);

  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  const reportDate = new Date(`${targetDate}T12:00:00`).toLocaleDateString(
    'ru-RU',
    { timeZone: 'Asia/Novosibirsk' }
  );

  const sheetName = getMonthlySheetName(targetDate);
  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  await ensureMonthlySheet(sheets, spreadsheetId, sheetName);

  const sheetRange = `'${sheetName.replace(/'/g, "''")}'!`;

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetRange}A:G`,
  });

  const existingRows = existing.data.values || [];

  const header = [
    'Дата',
    'User ID',
    'Пользователь',
    '🌅 Первый активный',
    '🌙 Последняя активность',
    '🟢 Online',
    '🎙️ Voice',
  ];

  const rowsWithoutTargetDate = existingRows
    .slice(1)
    .filter(row =>
      row[0] !== reportDate &&
      !isExcludedUser(row[1]) &&
      String(row[2] || '').trim() !== 'Tracker'
    )
    .map(row => {
      const hasNewStats = row[5] || row[6];

      if (hasNewStats) {
        return row;
      }

      return [
        row[0] || '',
        row[1] || '',
        row[2] || '',
        '',
        '',
        row[3] || '',
        row[4] || '',
      ];
    });

  const newRows = [];

for (const row of result.rows.filter(row => !isExcludedUser(row.user_id))) {
  const onlineSeconds = Math.floor(Number(row.online_seconds));
  const voiceSeconds = Math.floor(Number(row.voice_seconds));

  const formatActivityTime = (value) => {
    if (!value) {
      return '';
    }

    return new Date(value).toLocaleTimeString('ru-RU', {
      timeZone: 'Asia/Novosibirsk',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  };

  const firstActivity = formatActivityTime(row.first_activity_at);
  const lastActivity = (() => {
    if (!row.last_activity_at) return '';

    const time = formatActivityTime(row.last_activity_at);
    const actualDate = new Date(row.last_activity_at)
      .toLocaleDateString('ru-RU', {
        timeZone: 'Asia/Novosibirsk',
        day: '2-digit',
        month: '2-digit'
      });

    const reportDay = reportDate.slice(0, 5);

    return actualDate !== reportDay
      ? `${time} (${actualDate})`
      : time;
  })();

  const onlineHours = Math.floor(onlineSeconds / 3600);
  const onlineMinutes = Math.floor((onlineSeconds % 3600) / 60);
  const onlineSecs = onlineSeconds % 60;

  const voiceHours = Math.floor(voiceSeconds / 3600);
  const voiceMinutes = Math.floor((voiceSeconds % 3600) / 60);
  const voiceSecs = voiceSeconds % 60;

  const displayName = await getDisplayName(
    row.user_id,
    row.username
  );

  newRows.push([
    reportDate,
    row.user_id,
    displayName,
    firstActivity,
    lastActivity,
    `${onlineHours} ч ${onlineMinutes} мин ${onlineSecs} сек`,
    `${voiceHours} ч ${voiceMinutes} мин ${voiceSecs} сек`,
  ]);
}

  const dataRows = [
    ...rowsWithoutTargetDate,
    ...newRows,
  ].filter(row =>
    row.some(value => String(value || '').trim() !== '') &&
    !isExcludedUser(row[1]) &&
    String(row[2] || '').trim() !== 'Tracker'
  );

  // Сортируем по дате и вставляем ровно одну пустую строку
  // при переходе к следующему дню.
  dataRows.sort((a, b) => {
    const toDateKey = (value) => {
      const [day, month, year] = String(value || '').split('.').map(Number);
      return year * 10000 + month * 100 + day;
    };
    return toDateKey(a[0]) - toDateKey(b[0]);
  });

  const finalRows = [header];
  let previousDate = null;

  for (const row of dataRows) {
    const currentDate = String(row[0] || '');

    if (previousDate !== null && currentDate !== previousDate) {
      finalRows.push(['', '', '', '', '', '', '']);
    }

    finalRows.push(row);
    previousDate = currentDate;
  }

  await sheets.spreadsheets.values.clear({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetRange}A:G`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: `${sheetRange}A1:G`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: finalRows,
    },
  });

  console.log(
    `Google Sheets: статистика за ${reportDate} обновлена. Строк: ${newRows.length}`
  );
}

exportStats()
  .catch((error) => {
    console.error('Ошибка экспорта:', error.message);
  })
  .finally(() => {
    pool.end();
  });
