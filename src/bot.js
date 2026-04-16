require('dotenv').config();
const { Telegraf } = require('telegraf');
const cron = require('node-cron');
const { initDb } = require('./db/initDb');
const { createItemsRepository } = require('./db/itemsRepository');
const { searchAvito } = require('./provider/avitoProvider');
const { syncToSheets } = require('./sheets/syncToSheets');


const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID; 
const QUERY = process.env.AVITO_QUERY || 'ракетка бадминтон'; 
const LOCATION = process.env.AVITO_LOCATION || 'sankt-peterburg'; 

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set in the environment variables');
  process.exit(1);
}
const bot = new Telegraf(TOKEN);

let db;
let repo;
let currentPage = 1;

async function runScraper(ctx, page = 1) {
  try {
    await ctx.reply('🔍 Запускаю парсинг...')

    const { items } = await searchAvito(QUERY, { location: LOCATION, page });

    for (const item of items) {
      await repo.upsertItem(item);
    }

    const allItems = await repo.getAllItems();
    await syncToSheets(allItems);

    await ctx.reply(`✅ Готово! Страница ${page}\n📦 Найдено: ${items.length}\n📊 Всего в таблице: ${allItems.length}`,
      { reply_markup: {
        inline_keyboard: [[
          { text: '➕ Спарсить ещё страницу', callback_data: `scrape_page_${page + 1}` }
        ]]
      }}
    )

    currentPage = page;

  } catch (error) {
    await ctx.reply(`❌ Произошла ошибка: ${error.message}`);
    console.error('Error in runScraper:', error);
  }
}

async function clearAll(ctx) {
  try {
    await repo.clearAllItems();
    await syncToSheets([]);
    await ctx.reply('🗑️ База и таблица очищены');
  } catch (error) {
    await ctx.reply(`❌ Произошла ошибка: ${error.message}`);
  }
}

bot.command('start', async (ctx) => {
  ctx.reply(
    '👋 Привет! Выбери действие:\n\n', {
    reply_markup: {
      keyboard: [
        [{ text: '🔍 Спарсить объявления', callback_data: 'scrape'  }],
        [{ text: '🗑️ Очистить базу и таблицу', callback_data: 'clear' }],
        [{ text: '📊 Статистика', callback_data: 'status'  }]
      ],
      resize_keyboard: true,
      persistent: true
    }
  });
});

bot.action('scrape', async (ctx) => {
  ctx.answerCbQuery();
  await runScraper(ctx, 1);
});

bot.action('clear', async (ctx) => {
  ctx.answerCbQuery();
  await clearAll(ctx);
});

bot.action('status', async (ctx) => {
  ctx.answerCbQuery();
  const items = await repo.getAllItems();
  ctx.reply(`📊 Всего объявлений в базе: ${items.length}`);
});

bot.command('search', async (ctx) => {
  await runScraper(ctx, 1);
});

bot.command('status', async (ctx) => {
  const items = await repo.getAllItems();
  ctx.reply(`📊 Всего объявлений в базе: ${items.length}`);
});

bot.action(/scrape_page_(\d+)/, async (ctx) => {
  const page = parseInt(ctx.match[1]);
  ctx.answerCbQuery();
  await runScraper(ctx, page);
});

bot.hears('🔍 Спарсить объявления', async (ctx) => {
  await runScraper(ctx, 1);
});

bot.hears('🗑️ Очистить базу и таблицу', async (ctx) => {
  await clearAll(ctx);
});

bot.hears('📊 Статистика', async (ctx) => {
  const items = await repo.getAllItems();
  ctx.reply(`📊 Всего объявлений в базе: ${items.length}`);
});

async function main() {
  db = await initDb();
  repo = createItemsRepository(db);

  bot.launch();
  console.log('🤖 Telegram bot started');

  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main().catch((error) => {
  console.error('❌ Failed to start the bot:', error);
  process.exit(1);
});
