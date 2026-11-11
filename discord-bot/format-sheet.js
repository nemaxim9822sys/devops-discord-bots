require('dotenv').config();

const { google } = require('googleapis');

async function formatSheet() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_FILE,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({
    version: 'v4',
    auth,
  });

  const spreadsheetId = process.env.GOOGLE_SHEET_ID;

  const spreadsheet = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: 'sheets.properties',
  });

  const sheet = spreadsheet.data.sheets[0];
  const sheetId = sheet.properties.sheetId;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          updateSheetProperties: {
            properties: {
              sheetId,
              gridProperties: {
                frozenRowCount: 1,
              },
            },
            fields: 'gridProperties.frozenRowCount',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 0,
              endRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 7,
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: {
                  red: 0.12,
                  green: 0.16,
                  blue: 0.22,
                },
                textFormat: {
                  foregroundColor: {
                    red: 1,
                    green: 1,
                    blue: 1,
                  },
                  bold: true,
                },
                horizontalAlignment: 'CENTER',
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 1,
              endColumnIndex: 2,
            },
            cell: {
              userEnteredFormat: {
                numberFormat: {
                  type: 'TEXT',
                },
              },
            },
            fields: 'userEnteredFormat.numberFormat',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 0,
              endIndex: 1,
            },
            properties: {
              pixelSize: 110,
            },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 1,
              endIndex: 2,
            },
            properties: {
              pixelSize: 210,
            },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 2,
              endIndex: 3,
            },
            properties: {
              pixelSize: 210,
            },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 3,
              endIndex: 4,
            },
            properties: {
              pixelSize: 155,
            },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'COLUMNS',
              startIndex: 4,
              endIndex: 7,
            },
            properties: {
              pixelSize: 170,
            },
            fields: 'pixelSize',
          },
        },
        {
          updateDimensionProperties: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: 0,
              endIndex: 1,
            },
            properties: {
              pixelSize: 32,
            },
            fields: 'pixelSize',
          },
        },
        {
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: 1,
              startColumnIndex: 0,
              endColumnIndex: 7,
            },
            cell: {
              userEnteredFormat: {
                verticalAlignment: 'MIDDLE',
              },
            },
            fields: 'userEnteredFormat.verticalAlignment',
          },
        },
        {
          setBasicFilter: {
            filter: {
              range: {
                sheetId,
                startRowIndex: 0,
                startColumnIndex: 0,
                endColumnIndex: 7,
              },
            },
          },
        },
      ],
    },
  });

  console.log('Google Sheets: оформление применено');
}

formatSheet().catch((error) => {
  console.error('Ошибка форматирования:', error.message);
});
