const { initDb } = require('./db/initDb');
const { createItemsRepository } = require('./db/itemsRepository');
const { searchAvito } = require('./provider/avitoProvider');

async function start() {
  const db = await initDb();
  const repo = createItemsRepository(db);

  try {
    const query = 'ракетка бадминтон';

    const { searchUrl, finalUrl, items } = await searchAvito(query, {
      location: 'sankt-peterburg',
    });

    console.log('🔎 Search URL:', searchUrl);
    console.log('➡️ Final URL:', finalUrl);
    console.log('📦 Found items:', items.length);
    console.log('First 5:', items.slice(0, 5));

    for (const item of items) {
      await repo.upsertItem(item);
    }

    const unnotified = await repo.getUnnotifiedItems();
    console.log('🆕 Unnotified in DB:', unnotified.length);
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    db.close();
  }
}

start();