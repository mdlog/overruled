// Entry point: `npm start`.
// By default the database is reset to the seed data on every start, so delivery
// dates stay relative to today. Set KEEP_DB=1 to keep existing data.
import { openDb, DEFAULT_DB_PATH, listCustomers } from './src/db.js';
import { seed } from './src/seed.js';
import { createApp } from './src/app.js';
import { loadConfig } from './src/assistant.js';

const PORT = Number.parseInt(process.env.PORT ?? '3000', 10) || 3000;
const db = openDb(DEFAULT_DB_PATH);

if (process.env.KEEP_DB === '1' && listCustomers(db).length) {
  console.log(`Using existing database ${DEFAULT_DB_PATH} (KEEP_DB=1)`);
} else {
  seed(db);
  console.log(`Database ${DEFAULT_DB_PATH} reset to seed data`);
}

const config = loadConfig();
const app = createApp(db, { config });
const server = app.listen(PORT, () => {
  console.log(`Trailhead Supply running at http://localhost:${PORT}`);
  console.log(`Support assistant: ${config.model} via ${config.url} (temperature ${config.temperature})`);
  console.log(`Sign in: http://localhost:${PORT}/login-as/cust-ana  or  /login-as/cust-ben`);
});

function shutdown(signal) {
  console.log(`\n${signal} received, shutting down`);
  server.close(() => {
    db.close();
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
