// Load .env file into process.env so PM2 has access to production secrets
if (typeof process.loadEnvFile === 'function') {
  try {
    process.loadEnvFile('.env');
  } catch {
    // .env may not exist in development or build environments
  }
}

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
        AUTH_TRUST_HOST: 'true',
        AUTH_SECRET: process.env.AUTH_SECRET || '',
        GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID || '',
        GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET || '',
        DATABASE_URL: process.env.DATABASE_URL || '',
        ADMIN_EMAILS: process.env.ADMIN_EMAILS || ''
      }
    }
  ]
};
