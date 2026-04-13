require('dotenv').config();

const { chromium } = require('playwright');

function getProxyConfig() {
  const enabled = process.env.AVITO_PROXY_ENABLED === 'true';
  const server = process.env.AVITO_PROXY_SERVER;
  const username = process.env.AVITO_PROXY_USERNAME;
  const password = process.env.AVITO_PROXY_PASSWORD;

  if (!enabled || !server) return undefined;

  return {
    server,
    username: username || undefined,
    password: password || undefined,
  };
}

async function testProxy(url = 'https://example.com') {
  const proxy = getProxyConfig();

  console.log('Proxy config:', {
    enabled: Boolean(proxy),
    server: proxy?.server,
    hasUsername: Boolean(proxy?.username),
    hasPassword: Boolean(proxy?.password),
  });

  const browser = await chromium.launch({
    headless: true,
    proxy,
    args: ['--no-sandbox'],
  });

  const context = await browser.newContext({
    locale: 'ru-RU',
    viewport: { width: 1440, height: 900 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
  });

  const page = await context.newPage();

  page.on('request', (request) => {
    console.log('➡️ REQUEST:', request.method(), request.url());
  });

  page.on('response', (response) => {
    console.log('⬅️ RESPONSE:', response.status(), response.url());
  });

  page.on('requestfailed', (request) => {
    console.log('❌ REQUEST FAILED:', request.url(), request.failure()?.errorText);
  });

  try {
    console.log('Going to:', url);

    const response = await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    console.log('Main response status:', response?.status());
    console.log('Final URL:', page.url());
    console.log('Title:', await page.title());

    const bodyText = await page.textContent('body').catch(() => null);
    console.log('Body preview:', bodyText?.slice(0, 300));
  } finally {
    await browser.close();
  }
}

testProxy(process.argv[2]).catch((err) => {
  console.error('TEST FAILED:', err);
  process.exit(1);
});