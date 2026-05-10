const { createSheetsClient } = require('./sheetsClient');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;

const HEADERS = ['ID', 'Название', 'Цена (₽)', 'Категория', 'Локация', 'Ссылка', 'Первый раз', 'Последний раз'];

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
    item.location ?? '',
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

async function getSheetNames() {
  if (!SHEET_ID) return [];
  const sheets = createSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  return spreadsheet.data.sheets.map(s => s.properties.title);
}

async function deleteSheet(sheetName) {
  if (!SHEET_ID) return;
  const sheets = createSheetsClient();
  const spreadsheet = await sheets.spreadsheets.get({ spreadsheetId: SHEET_ID });
  const sheet = spreadsheet.data.sheets.find(s => s.properties.title === sheetName);
  if (!sheet) return;
  
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: SHEET_ID,
    requestBody: {
      requests: [{
        deleteSheet: {
          sheetId: sheet.properties.sheetId
        }
      }]
    }
  });
}

module.exports = { syncToSheets, getSheetNames, deleteSheet };
