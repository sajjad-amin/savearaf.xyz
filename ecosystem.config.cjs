module.exports = {
  apps: [
    {
      name: 'savearaf',
      script: './dist/server/entry.mjs',
      node_args: '--env-file=.env',
      env: {
        HOST: '127.0.0.1',
        PORT: 4321,
        NODE_ENV: 'production',
        AUTH_URL: 'https://savearaf.xyz/api/auth',
        AUTH_TRUST_HOST: 'true'
      }
    }
  ]
};
