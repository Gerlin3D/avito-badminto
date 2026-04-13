require('dotenv').config();

const { chromium } = require('playwright');

const TARGETS = [
  { name: 'example', url: 'https://example.com' },
  { name: 'httpbin_ip', url: 'https://httpbin.org/ip' },
  { name: 'avito_home', url: 'https://www.avito.ru' },
  {
    name: 'avito_search',
    url: 'https://www.avito.ru/sankt-peterburg?q=%D1%80%D0%B0%D0%BA%D0%B5%D1%82%D0%BA%D0%B0+%D0%B1%D0%B0%D0%B4%D0%BC%D0%B8%D0%BD%D1%82%D0%BE%D0%BD',
  },
];

function parseProxyString(proxyString) {
  if (!proxyString) return null;

  const trimmed = proxyString.trim();

  const hasScheme =
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('socks5://');

  if (!hasScheme) {
    throw new Error(
      `Proxy "${trimmed}" has no valid scheme. Use http://, https:// or socks5://`
    );
  }

  const url = new URL(trimmed);

  const username = decodeURIComponent(url.username || '');
  const password = decodeURIComponent(url.password || '');

  url.username = '';
  url.password = '';

  return {
    raw: trimmed,
    server: url.toString(),
    username: username || undefined,
    password: password || undefined,
  };
}

function getProxyList() {
  const listRaw = process.env.AVITO_PROXY_LIST || '';
  const singleEnabled = process.env.AVITO_PROXY_ENABLED === 'true';

  const proxies = [];

  if (listRaw.trim()) {
    const rows = listRaw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((line) => !line.startsWith('#'));

    for (const row of rows) {
      proxies.push(parseProxyString(row));
    }
  } else if (singleEnabled && process.env.AVITO_PROXY_SERVER) {
    proxies.push({
      raw: process.env.AVITO_PROXY_SERVER,
      server: process.env.AVITO_PROXY_SERVER,
      username: process.env.AVITO_PROXY_USERNAME || undefined,
      password: process.env.AVITO_PROXY_PASSWORD || undefined,
    });
  }

  return proxies;
}

async function testTarget(proxy, target) {
  const browser = await chromium.launch({
    headless: true,
    proxy: {
      server: proxy.server,
      username: proxy.username,
      password: proxy.password,
    },
    args: ['--no-sandbox'],
  });

  const startedAt = Date.now();

  try {
    const context = await browser.newContext({
      locale: 'ru-RU',
      viewport: { width: 1440, height: 900 },
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36',
    });

    const page = await context.newPage();

    let failedRequestError = null;

    page.on('requestfailed', (request) => {
      if (request.url() === target.url || request.url().startsWith(target.url)) {
        failedRequestError = request.failure()?.errorText || 'request failed';
      }
    });

    const response = await page.goto(target.url, {
      waitUntil: 'domcontentloaded',
      timeout: 25000,
    });

    const title = await page.title().catch(() => '');
    const html = await page.content().catch(() => '');
    const bodyText = await page.textContent('body').catch(() => '');

    const durationMs = Date.now() - startedAt;

    const blocked =
      title.includes('Доступ ограничен') ||
      html.includes('hcaptcha') ||
      html.includes('captcha') ||
      html.includes('проблема с IP') ||
      bodyText.includes('Доступ ограничен') ||
      bodyText.includes('проблема с IP');

    let detectedIp = null;
    if (target.name === 'httpbin_ip') {
      try {
        const jsonText = bodyText || html;
        const match = jsonText.match(/"origin"\s*:\s*"([^"]+)"/);
        detectedIp = match ? match[1] : null;
      } catch {
        detectedIp = null;
      }
    }

    return {
      ok: true,
      status: response?.status() ?? null,
      finalUrl: page.url(),
      title,
      blocked,
      detectedIp,
      error: failedRequestError,
      durationMs,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      finalUrl: null,
      title: '',
      blocked: false,
      detectedIp: null,
      error: error.message,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    await browser.close();
  }
}

function summarizeResult(result, targetName) {
  if (!result.ok) {
    if (result.error?.includes('ERR_TUNNEL_CONNECTION_FAILED')) {
      return '❌ tunnel';
    }
    if (result.error?.includes('ERR_TIMED_OUT')) {
      return '❌ timeout';
    }
    return '❌ error';
  }

  if (result.blocked) {
    return '⚠ blocked';
  }

  if (targetName === 'httpbin_ip') {
    return result.detectedIp ? `✅ ${result.detectedIp}` : '✅ ok';
  }

  return `✅ ${result.status || 'ok'}`;
}

function getFinalVerdict(resultsByTarget) {
  const example = resultsByTarget.example;
  const httpbin = resultsByTarget.httpbin_ip;
  const avitoHome = resultsByTarget.avito_home;
  const avitoSearch = resultsByTarget.avito_search;

  if (!example?.ok || !httpbin?.ok) return 'нерабочий';
  if (!avitoHome?.ok && !avitoSearch?.ok) return 'не подходит';
  if (avitoHome?.blocked || avitoSearch?.blocked) return 'спорный';
  if (avitoHome?.ok && avitoSearch?.ok) return 'годится';

  return 'спорный';
}

async function run() {
  const proxies = getProxyList();

  if (!proxies.length) {
    console.error('No proxies found. Set AVITO_PROXY_LIST or AVITO_PROXY_SERVER');
    process.exit(1);
  }

  const matrix = [];

  for (let i = 0; i < proxies.length; i++) {
    const proxy = proxies[i];
    console.log(`\n========== PROXY ${i + 1}/${proxies.length} ==========`);
    console.log(`Server: ${proxy.server}`);
    console.log(`Has auth: ${Boolean(proxy.username || proxy.password)}`);

    const row = {
      proxy: proxy.server,
      hasAuth: Boolean(proxy.username || proxy.password),
      results: {},
    };

    for (const target of TARGETS) {
      console.log(`\n--- Checking ${target.name}: ${target.url}`);

      const result = await testTarget(proxy, target);
      row.results[target.name] = result;

      console.log({
        summary: summarizeResult(result, target.name),
        status: result.status,
        blocked: result.blocked,
        detectedIp: result.detectedIp,
        error: result.error,
        durationMs: result.durationMs,
      });
    }

    row.verdict = getFinalVerdict(row.results);
    matrix.push(row);
  }

  console.log('\n================ MATRIX SUMMARY ================\n');

  for (const row of matrix) {
    console.log({
      proxy: row.proxy,
      example: summarizeResult(row.results.example, 'example'),
      httpbin_ip: summarizeResult(row.results.httpbin_ip, 'httpbin_ip'),
      avito_home: summarizeResult(row.results.avito_home, 'avito_home'),
      avito_search: summarizeResult(row.results.avito_search, 'avito_search'),
      verdict: row.verdict,
    });
  }
}

run().catch((err) => {
  console.error('Matrix run failed:', err);
  process.exit(1);
});