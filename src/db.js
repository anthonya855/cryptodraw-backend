import pg from 'pg';
import { config } from './config.js';

const { Pool } = pg;
export const db = new Pool({
  connectionString: config.databaseUrl,
  ssl: config.nodeEnv === 'production' && !/localhost|127\.0\.0\.1/.test(config.databaseUrl) ? { rejectUnauthorized: false } : undefined,
  max: 12
});

export async function tx(fn) {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const value = await fn(client);
    await client.query('COMMIT');
    return value;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

export async function audit(action, { entityType = null, entityId = null, details = null, ip = null } = {}) {
  await db.query(
    'INSERT INTO audit_logs(action,entity_type,entity_id,details,ip) VALUES ($1,$2,$3,$4,$5)',
    [action, entityType, entityId, details, ip]
  );
}
