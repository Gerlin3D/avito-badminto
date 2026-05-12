const optionalEnv = [
  'AVITO_PROXY_ENABLED',
  'AVITO_PROXY_SERVER',
  'AVITO_PROXY_USERNAME',
  'AVITO_PROXY_PASSWORD',
  'AVITO_HEADLESS',
].reduce((env, key) => {
  if (process.env[key]) {
    env[key] = process.env[key];
  }
  return env;
}, {});

module.exports = {
  apps: [{
    name: 'avito-parser',
    script: 'src/server.js',
    env: {
      NODE_ENV: 'production',
      ...optionalEnv,
e',
    }
  }]
};
