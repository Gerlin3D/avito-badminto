const { createSheetsClient } = require('./sheetsClient');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const HEADERS = ['ID', 'Название', 'Цена (₽)', 'Категория', 'Ссылка', 'Первый раз', 'Последний раз'];

function normalizeSheetName(name) {
  return String(name).trim().replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').slice(0, 100) || 'Объявления';
}

async function ensureSheetExists(sheets, spreadsheetId, sheetName) {
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId });

  const exists = spreadsheet.data.sheets.some(s => s.properties.title === sheetName);
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [{
        addSheet: {
          properties: {
            title: sheetName
          }
        }
      }]
    } 
  });
}

function formatRow(item) {
  return [
    item.id,
    item.title,
    item.price ?? '',
    item.category,
    item.url,
    item.first_seen_at,
    item.last_seen_at,
  ];
}

async function syncToSheets(items, sheetNameInput  = 'Объявления') {
  if (!SHEET_ID) {
    console.log('⚠️ GOOGLE_SHEET_ID not set, skipping sync');
    return;
  }

  const sheets = createSheetsClient();
  const sheetName = normalizeSheetName(sheetNameInput);

  await ensureSheetExists(sheets, SHEET_ID, sheetName);

  const rows = [HEADERS, ...items.map(formatRow)];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range: `${sheetName}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✅ Synced ${items.length} items to Google Sheets`);
}

module.exports = { syncToSheets };
