const { createSheetsClient } = require('./sheetsClient');

const SHEET_ID = process.env.GOOGLE_SHEET_ID;
const SHEET_NAME = 'Объявления';

const HEADERS = ['ID', 'Название', 'Цена (₽)', 'Категория', 'Ссылка', 'Первый раз', 'Последний раз'];

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

async function syncToSheets(items) {
  if (!SHEET_ID) {
    console.log('⚠️ GOOGLE_SHEET_ID not set, skipping sync');
    return;
  }

  const sheets = createSheetsClient();
  const range = `${SHEET_NAME}!A1`;

  const rows = [HEADERS, ...items.map(formatRow)];

  await sheets.spreadsheets.values.clear({
    spreadsheetId: SHEET_ID,
    range: `${SHEET_NAME}!A:Z`,
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: SHEET_ID,
    range,
    valueInputOption: 'RAW',
    requestBody: { values: rows },
  });

  console.log(`✅ Synced ${items.length} items to Google Sheets`);
}

module.exports = { syncToSheets };
