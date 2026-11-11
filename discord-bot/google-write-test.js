require('dotenv').config();

const { google } = require('googleapis');

async function writeTest() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  await sheets.spreadsheets.values.append({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'A:D',
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[
        '08.10.2026',
        'TEST',
        '1 ч 20 мин 30 сек',
        '25 мин 10 сек'
      ]],
    },
  });

  console.log('Google Sheets: запись успешно выполнена');
}

writeTest().catch((error) => {
  console.error('Ошибка записи:', error.message);
});
