require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');

let _persistentSession = null;

async function getOrCreateSession() {
  if (!_persistentSession) {
    _persistentSession = await createAvitoSession();
  }
  return _persistentSession;
}


const BASE_URL = 'https://www.avito.ru';

function buildSearchUrl({ query, location = 'rossiya', page = 1 }) {
  const url = new URL(`${BASE_URL}/${location}`);
  url.searchParams.set('q', query);
  if (page > 1) url.searchParams.set('p', page);
  return url.toString();
}

// Ротация портов прокси: AVITO_PROXY_PORT_START=10000, AVITO_PROXY_PORT_END=10100
let _currentProxyPort = null;

function getNextProxyPort() {
  if (!process.env.AVITO_PROXY_PORT_START) {
    return null;
  }

  const start = parseInt(process.env.AVITO_PROXY_PORT_START, 10);
  const end = parseInt(process.env.AVITO_PROXY_PORT_END || start.toString(), 10);
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new Error('Invalid AVITO_PROXY_PORT_START or AVITO_PROXY_PORT_END');
  }

  if (start === end) return start;
  if (_currentProxyPort === null || _currentProxyPort >= end) {
    _currentProxyPort = start;
  } else {
    _currentProxyPort++;
  }
  console.log(`Using proxy port: ${_currentProxyPort}`);
  return _currentProxyPort;
}

function getProxyConfig() {
  const enabled = process.env.AVITO_PROXY_ENABLED === 'true';
  const server = process.env.AVITO_PROXY_SERVER?.trim();

  if (!enabled || !server) {
    return undefined;
  }

  // Подставляем текущий порт ротации
  const port = getNextProxyPort();
  const serverWithPort = port ? server.replace(/:\d+$/, `:${port}`) : server;

  const validScheme =
    serverWithPort.startsWith('http://') ||
    serverWithPort.startsWith('https://') ||
    serverWithPort.startsWith('socks5://');

  if (!validScheme) {
    throw new Error(
      'Invalid proxy scheme. Use http://, https:// or socks5:// in AVITO_PROXY_SERVER'
    );
  }

  const proxyUrl = new URL(serverWithPort);
  const username =
    process.env.AVITO_PROXY_USERNAME?.trim() ||
    decodeURIComponent(proxyUrl.username || '');
  const password =
    process.env.AVITO_PROXY_PASSWORD?.trim() ||
    decodeURIComponent(proxyUrl.password || '');

  proxyUrl.username = '';
  proxyUrl.password = '';

  const proxy = { server: proxyUrl.toString() };

  if (username) {
    proxy.username = username;
  }

  if (password) {
    proxy.password = password;
  }

  return proxy;
}

function getHeadlessMode() {
  return process.env.AVITO_HEADLESS !== 'false';
}

function attachPageLogging(page) {
  if (page.__avitoLoggingAttached) return;
  page.__avitoLoggingAttached = true;

  page.on('request', (request) => {
    console.log('REQUEST:', request.method(), request.url());
  });

  page.on('response', (response) => {
    console.log('RESPONSE:', response.status(), response.url());
  });

  page.on('requestfailed', (request) => {
    console.log('REQUEST FAILED:', request.url(), request.failure()?.errorText);
  });

  page.on('pageerror', (error) => {
    console.log('PAGE ERROR:', error.message);
  });
}

async function createAvitoSession() {
  const userDataDir = path.join(__dirname, '..', 'storage', 'pw-profile');
  const lockFile = path.join(userDataDir, 'SingletonLock');
  if (fs.existsSync(lockFile)) {
    fs.unlinkSync(lockFile);
    console.log('Removed stale SingletonLock');
  }
  const proxy = getProxyConfig();
  const headless = getHeadlessMode();

  console.log('Launching Avito browser context');
  console.log('Proxy enabled:', Boolean(proxy));
  if (proxy) {
    console.log('Proxy server:', proxy.server);
    console.log('Proxy auth:', Boolean(proxy.username || proxy.password));
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless,
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    proxy,
    args: [
      ...(process.getuid && process.getuid() === 0 ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
    ],
  });

  const page = context.pages()[0] || (await context.newPage());
  attachPageLogging(page);

  return {
    context,
    page,
    close: () => context.close(),
  };
}

function isBlockedByAvito(title, html) {
  return (
    title.includes('\u0414\u043e\u0441\u0442\u0443\u043f \u043e\u0433\u0440\u0430\u043d\u0438\u0447\u0435\u043d') ||
    html.includes('hcaptcha') ||
    html.includes('\u043f\u0440\u043e\u0431\u043b\u0435\u043c\u0430 \u0441 IP')
  );
}

async function waitForManualUnblock(page) {
  console.log('Avito blocked this session. Waiting 2 minutes for manual captcha solving...');
  await page.waitForTimeout(120000);

  const html = await page.content();
  const title = await page.title();

  if (isBlockedByAvito(title, html)) {
    throw new Error('Avito blocked this session');
  }
}

async function parseCurrentPage(page, query) {
  return page.evaluate((searchQuery) => {
    const results = [];
    const seen = new Set();

    function normalizeLink(href) {
      if (!href) return null;
      if (href.startsWith('http')) return href;
      return `https://www.avito.ru${href}`;
    }

    function parsePrice(text) {
      if (!text) return null;
      const digits = text.replace(/[^\d]/g, '');
      return digits ? Number(digits) : null;
    }

    function detectCategory(title = '', query = '') {
      const text = `${title} ${query}`.toLowerCase();

      if (
        text.includes('\u0442\u0440\u0435\u043d\u0435\u0440') ||
        text.includes('\u0442\u0440\u0435\u043d\u0438\u0440\u043e\u0432\u043a\u0430') ||
        text.includes('\u0441\u043f\u0430\u0440\u0440\u0438\u043d\u0433')
      ) {
        return 'coach';
      }

      if (text.includes('\u0432\u043e\u043b\u0430\u043d')) return 'shuttles';
      if (text.includes('\u0440\u0430\u043a\u0435\u0442')) return 'rackets';
      return 'other';
    }

    const items = document.querySelectorAll('[data-marker="item"]');

    for (const item of items) {
      const titleEl =
        item.querySelector('[data-marker="item-title"]') ||
        item.querySelector('h3');

      const title = titleEl?.textContent?.trim();
      if (!title || title.length < 5) continue;

      const linkEl =
        item.querySelector('[data-marker="item-title"] a') ||
        item.querySelector('a[href*="_"]');

      const locationEl = item.querySelector('[data-marker="item-location"]')
        || item.querySelector('.geo-root')
        || item.querySelector('.geo-address');


      const locationText = locationEl?.textContent?.trim() || null;
      const location = locationText ? locationText.split(',')[0].trim() : null;


      const href = linkEl?.getAttribute('href');
      const url = normalizeLink(href);
      if (!url) continue;

      const idMatch = url.match(/_(\d+)(?:\?|$)/);
      const id = idMatch ? idMatch[1] : url;
      if (seen.has(id)) continue;

      const priceEl = item.querySelector('[data-marker="item-price"]');
      const price = parsePrice(priceEl?.textContent || '');

      results.push({
        id,
        title: title.replace(/\s+/g, ' '),
        price,
        url,
        location,
        seller_name: null,
        category: detectCategory(title, searchQuery),
        query: searchQuery,
      });

      seen.add(id);
    }

    return results.slice(0, 100);
  }, query);
}

async function searchAvitoPage(page, query, options = {}) {
  const searchUrl = buildSearchUrl({
    query,
    location: options.location || process.env.AVITO_LOCATION || 'rossiya',
    page: options.page || 1,
  });

  console.log('Going to:', searchUrl);

  await page.goto(searchUrl, {
    waitUntil: 'domcontentloaded',
    timeout: 60000,
  });

  await page
    .waitForSelector('[data-marker="item"], [data-marker="catalog-serp"], .firewall-title', {
      timeout: 15000,
    })
    .catch(() => {});

  // Добавить после waitForSelector
  await page.evaluate(() => window.scrollBy(0, Math.random() * 400 + 100));
  await page.waitForTimeout(800 + Math.random() * 1500);


  const finalUrl = page.url();
  const title = await page.title();
  const html = await page.content();

  if (process.env.DEBUG_AVITO === 'true') {
    fs.writeFileSync('debug-avito.html', html);
  }

  console.log('Final URL:', finalUrl);
  console.log('Title:', title);
  console.log('HTML length:', html.length);

  const blocked = isBlockedByAvito(title, html);
  console.log('Blocked:', blocked);

  if (blocked) {
    if (!getHeadlessMode()) {
      await waitForManualUnblock(page);
    } else {
      throw new Error('Avito blocked this session');
    }
  }

  const items = await parseCurrentPage(page, query);
  console.log('Parsed items preview:', items.slice(0, 5));

  if (options.locationName) {
  for (const item of items) {
    item.location = options.locationName;
  }
}

  return {
    searchUrl,
    finalUrl,
    items,
  };
}

async function searchAvitoPages(query, options = {}) {
  const session = await createAvitoSession();
  const startPage = Number(options.startPage || options.page || 1);
  const maxPages = Number(options.maxPages || process.env.AVITO_MAX_PAGES || 1);
  const collectedItems = [];
  const seenIds = new Set();
  const pages = [];
  let stopReason = '';

  try {
    for (let pageNumber = startPage; pageNumber < startPage + maxPages; pageNumber++) {
      const result = await searchAvitoPage(session.page, query, {
        ...options,
        page: pageNumber,
      });

      pages.push({
        page: pageNumber,
        searchUrl: result.searchUrl,
        finalUrl: result.finalUrl,
        itemsCount: result.items.length,
      });

      if (result.items.length === 0) {
        stopReason = `No items on page ${pageNumber}`;
        break;
      }

      const newItems = result.items.filter((item) => {
        if (seenIds.has(item.id)) return false;
        seenIds.add(item.id);
        return true;
      });

      if (newItems.length === 0) {
        stopReason = `Page ${pageNumber} repeats already parsed items`;
        break;
      }

      collectedItems.push(...newItems);

      const delay = 2000 + Math.random() * 7000
      await session.page.waitForTimeout(delay);
    }

 


    if (!stopReason) {
      stopReason = `Reached ${maxPages} page limit`;
    }

    return {
      items: collectedItems,
      pages,
      stopReason,
    };
  } finally {
    console.log('Closing Avito browser context');
    await session.close();
  }
}

async function searchAvito(query, options = {}) {
  const session = await getOrCreateSession();
  return await searchAvitoPage(session.page, query, options);
  // НЕ закрываем сессию
}

async function canReachAvitoWithProxy() {
  const proxy = getProxyConfig();

  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-features=IsolateOrigins,site-per-process',
      '--disable-web-security',
    ],
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto('https://www.avito.ru', {
      waitUntil: 'domcontentloaded',
      timeout: 20000,
    });

    return true;
  } catch (error) {
    console.log('Proxy health check failed for Avito:', error.message);
    return false;
  } finally {
    await browser.close();
  }
}

async function closeSession() {
  if (_persistentSession) {
    await _persistentSession.close().catch(() => {});
    _persistentSession = null;
  }
}

process.on('SIGTERM', async () => { await closeSession(); process.exit(0); });
process.on('SIGINT', async () => { await closeSession(); process.exit(0); });

module.exports = {
  searchAvito,
  searchAvitoPage,
  searchAvitoPages,
  createAvitoSession,
  canReachAvitoWithProxy,
};
