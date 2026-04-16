require('dotenv').config();

const fs = require('fs');
const path = require('path');
const { chromium } = require('patchright');

const BASE_URL = 'https://www.avito.ru';

function buildSearchUrl({ query, location = 'rossiya', page = 1 }) {
  const url = new URL(`${BASE_URL}/${location}`);
  url.searchParams.set('q', query);
  if (page > 1) url.searchParams.set('p', page);
  return url.toString();
}

function getProxyConfig() {
  const enabled = process.env.AVITO_PROXY_ENABLED === 'true';
  const server = process.env.AVITO_PROXY_SERVER?.trim();
  const username = process.env.AVITO_PROXY_USERNAME?.trim();
  const password = process.env.AVITO_PROXY_PASSWORD?.trim();

  if (!enabled || !server) {
    return undefined;
  }

  const validScheme =
    server.startsWith('http://') ||
    server.startsWith('https://') ||
    server.startsWith('socks5://');

  if (!validScheme) {
    throw new Error(
      'Invalid proxy scheme. Use http://, https:// or socks5:// in AVITO_PROXY_SERVER'
    );
  }

  return {
    server,
    username: username || undefined,
    password: password || undefined,
  };
}

async function searchAvito(query, options = {}) {
  const searchUrl = buildSearchUrl({
    query,
    location: options.location || process.env.AVITO_LOCATION || 'rossiya',
    page: options.page || 1,
  });

  const userDataDir = path.join(__dirname, '..', 'storage', 'pw-profile');
  const proxy = getProxyConfig();
  const headless = process.env.AVITO_HEADLESS !== 'false';

  console.log('1) before persistent context launch');
  console.log('Proxy enabled:', Boolean(proxy));
  if (proxy) {
    console.log('Proxy server:', proxy.server);
  }

  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: 'chrome',
    headless,
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    proxy,
    args: ['--no-sandbox'],
  });

  console.log('2) persistent context launched');

  const page = context.pages()[0] || (await context.newPage());

  page.on('request', (request) => {
    console.log('➡️ REQUEST:', request.method(), request.url());
  });

  page.on('response', (response) => {
    console.log('⬅️ RESPONSE:', response.status(), response.url());
  });

  page.on('requestfailed', (request) => {
    console.log('❌ REQUEST FAILED:', request.url(), request.failure()?.errorText);
  });

  page.on('pageerror', (error) => {
    console.log('📄 PAGE ERROR:', error.message);
  });

  try {
    console.log('3) going to:', searchUrl);

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    await page.waitForSelector('[data-marker="item"], [data-marker="catalog-serp"], .firewall-title', { timeout: 15000 }).catch(() => {});

    const finalUrl = page.url();
    const title = await page.title();
    const html = await page.content();

    fs.writeFileSync('debug-avito.html', html);

    console.log('Final URL:', finalUrl);
    console.log('Title:', title);
    console.log('HTML length:', html.length);

    const blocked =
      title.includes('Доступ ограничен') ||
      html.includes('hcaptcha') ||
      html.includes('проблема с IP');

    console.log('Blocked:', blocked);

    const linksCount = await page.locator('a[href]').count();
    console.log('🔗 Links on page:', linksCount);

    const hrefs = await page.locator('a[href]').evaluateAll((links) =>
      links.map((a) => a.getAttribute('href')).filter(Boolean).slice(0, 50)
    );

    console.log('🔍 First hrefs:', hrefs);

    if (blocked) {
      throw new Error('Avito blocked this session');
    }

    const items = await page.evaluate((query) => {
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
        if (text.includes('тренер') || text.includes('тренировка') || text.includes('спарринг')) {
          return 'coach';
        }
        if (text.includes('волан')) return 'shuttles';
        if (text.includes('ракет')) return 'rackets';
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
          location: null,
          seller_name: null,
          category: detectCategory(title, query),
          query,
        });

        seen.add(id);
      }

      return results.slice(0, 100);
    }, query);

    console.log('🧪 Parsed items preview:', items.slice(0, 5));

    return {
      searchUrl,
      finalUrl,
      items,
    };
  } finally {
    console.log('4) closing context');
    await context.close();
  }
}

async function canReachAvitoWithProxy() {
  const proxy = getProxyConfig();

  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: ['--no-sandbox'],
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

module.exports = { searchAvito };