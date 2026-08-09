import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { db } from './db.js';
import { config } from './config.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const sql = await fs.readFile(path.join(here, '..', 'sql', '001_init.sql'), 'utf8');
await db.query(sql);

const count = await db.query('SELECT COUNT(*)::int AS n FROM pools');
if (count.rows[0].n === 0) {
  await db.query(
    `INSERT INTO pools(id,prize_label,prize_usd,entry_fee_usdt,max_entries,status,opens_at,closes_at)
     VALUES($1,$2,$3,$4,$5,'open',NOW(),$6)`,
    [config.seedPool.id, config.seedPool.prizeLabel, config.seedPool.prizeUsd, config.seedPool.entryFeeUsdt, config.seedPool.maxEntries || null, config.seedPool.closesAt]
  );
  console.log(`Seeded pool ${config.seedPool.id}`);
}
console.log('Migration complete.');
await db.end();
