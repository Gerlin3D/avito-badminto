module.exports = {
  apps: [{
    name: 'avito-parser',
    script: 'src/server.js',
    env: {
      NODE_ENV: 'production',
      https_proxy: 'http://user408160o23416r384487:o9qahx@pool.proxys.io:10000',
      http_proxy: 'http://user408160o23416r384487:o9qahx@pool.proxys.io:10000',
      AVITO_PROXY_ENABLED: 'false',
      AVITO_HEADLESS: 'true',
    }
  }]
};
