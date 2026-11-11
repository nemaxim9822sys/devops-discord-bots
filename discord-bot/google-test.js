require('dotenv').config();

const { google } = require('googleapis');

async function testGoogleSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  const result = await sheets.spreadsheets.values.get({
    spreadsheetId: process.env.GOOGLE_SHEET_ID,
    range: 'A1:D5',
  });

  console.log('Google Sheets: подключение успешно');
  console.log(result.data.values || 'Таблица пока пустая');
}

testGoogleSheets().catch((error) => {
  console.error('Ошибка Google Sheets:', error.message);
});
