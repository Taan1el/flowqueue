import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function createDatabase(dbPath?: string): DatabaseSync {
  const finalPath = dbPath || process.env.DB_PATH || './data/flowqueue.db';

  if (finalPath !== ':memory:') {
    const dir = path.dirname(path.resolve(finalPath));
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const db = new DatabaseSync(finalPath);

  // Enable WAL mode for high concurrency read/write
  if (finalPath !== ':memory:') {
    db.exec('PRAGMA journal_mode = WAL;');
  }
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  return db;
}
