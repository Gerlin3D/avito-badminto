require('dotenv').config();
const { Telegraf } = require('telegraf');
const { SocksProxyAgent } = require('socks-proxy-agent');
const { HttpsProxyAgent } = require('https-proxy-agent');
const { initDb } = require('./db/initDb');
const { createItemsRepository } = require('./db/itemsRepository');
const { searchAvito } = require('./provider/avitoProvider');
const { syncToSheets } = require('./sheets/syncToSheets');


const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ALLOWED_IDS = (process.env.TELEGRAM_ALLOWED_IDS || '').split(',').map(s => s.trim()); 
const QUERY = process.env.AVITO_QUERY || 'ракетка бадминтон'; 
const LOCATION = process.env.AVITO_LOCATION || 'sankt-peterburg'; 
const MAX_PAGES = Number(process.env.AVITO_MAX_PAGES || 20);
const TELEGRAM_HANDLER_TIMEOUT_MS = Number(process.env.TELEGRAM_HANDLER_TIMEOUT_MS || 600000);

function createTelegramAgent() {
  const proxyUrl = process.env.TELEGRAM_PROXY_URL?.trim();

  if (!proxyUrl) {
    return undefined;
  }

  if (proxyUrl.startsWith('socks://') || proxyUrl.startsWith('socks5://')) {
    console.log('🌐 Telegram proxy enabled: SOCKS');
    return new SocksProxyAgent(proxyUrl);
  }

  if (proxyUrl.startsWith('http://') || proxyUrl.startsWith('https://')) {
    console.log('🌐 Telegram proxy enabled: HTTP');
    return new HttpsProxyAgent(proxyUrl);
  }

  throw new Error('Invalid TELEGRAM_PROXY_URL. Use socks5://, http:// or https://');
}

if (!TOKEN) {
  console.error('❌ TELEGRAM_BOT_TOKEN is not set in the environment variables');
  process.exit(1);
}

const bot = new Telegraf(TOKEN, {
  handlerTimeout: TELEGRAM_HANDLER_TIMEOUT_MS,
  telegram: {
    agent: createTelegramAgent(),
  },
});

bot.use((ctx, next) => {
  if (!ALLOWED_IDS.includes(String(ctx.chat.id))) {
    return ctx.reply('⛔ Доступ запрещён');
  }
  return next();
});

let db;
let repo;

async function runScraper(ctx, startPage = 1) {
  try {
    await ctx.reply('🔍 Запускаю парсинг...')

    const collectedItems = [];
    const seenIds = new Set();
    let parsedPages = 0;
    let stopReason = '';

    for (let page = startPage; page < startPage + MAX_PAGES; page++) {
      const { items } = await searchAvito(QUERY, { location: LOCATION, page });
      parsedPages += 1;

      if (items.length === 0) {
        stopReason = `на странице ${page} нет объявлений`;
        break;
      }

      const newItems = items.filter((item) => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });

      if (newItems.length === 0) {
        stopReason = `страница ${page} повторяет уже найденные объявления`;
        break;
      }

      for (const item of newItems) {
        await repo.upsertItem(item);
      }

      collectedItems.push(...newItems);
    }

    if (!stopReason) {
      stopReason = `достигнут лимит ${MAX_PAGES} страниц`;
    }

    const allItems = await repo.getAllItems();
    await syncToSheets(allItems);

    await ctx.reply(`✅ Готово!\n📄 Страниц проверено: ${parsedPages}\n📦 Найдено за запуск: ${collectedItems.length}\n📊 Всего в таблице: ${allItems.length}\nℹ️ Остановка: ${stopReason}`);
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
        [{ text: '🔄 Обновить объявления'}],
        [{ text: '🗑️ Очистить базу и таблицу'}],
        [{ text: '📊 Статистика'}]
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

bot.hears('🔄 Обновить объявления', async (ctx) => {
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
