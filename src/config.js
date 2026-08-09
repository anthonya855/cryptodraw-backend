import 'dotenv/config';

function parseJsonEnv(name, fallback = []) {
  const raw = process.env[name];
  if (!raw) return fallback;
  try {
    const value = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error('must be a JSON array');
    return value;
  } catch (err) {
    throw new Error(`${name} is invalid JSON: ${err.message}`);
  }
}

function requireValue(name) {
  const value = String(process.env[name] || '').trim();
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const evmNetworks = parseJsonEnv('EVM_NETWORKS_JSON').map(n => ({
  ...n,
  chainFamily: 'evm',
  chainId: Number(n.chainId),
  amountDecimals: Number(n.amountDecimals),
  confirmations: Math.max(1, Number(n.confirmations || 1)),
  key: String(n.key || ''),
  name: String(n.name || n.key || 'EVM')
}));

const tronNetworks = parseJsonEnv('TRON_NETWORKS_JSON').map(n => ({
  ...n,
  chainFamily: 'tron',
  amountDecimals: Number(n.amountDecimals),
  feeLimitSun: Number(n.feeLimitSun || 100000000),
  key: String(n.key || ''),
  name: String(n.name || n.key || 'TRON')
}));

export const config = {
  port: Number(process.env.PORT || 8080),
  nodeEnv: process.env.NODE_ENV || 'development',
  databaseUrl: requireValue('DATABASE_URL'),
  publicOrigins: String(process.env.PUBLIC_ORIGINS || '').split(',').map(v => v.trim()).filter(Boolean),
  adminPassword: requireValue('ADMIN_PASSWORD'),
  adminSessionSecret: requireValue('ADMIN_SESSION_SECRET'),
  adminSessionHours: Math.max(1, Number(process.env.ADMIN_SESSION_HOURS || 12)),
  evmNetworks,
  tronNetworks,
  drandBaseUrl: String(process.env.DRAND_BASE_URL || 'https://api.drand.sh').replace(/\/$/, ''),
  drandChainHash: requireValue('DRAND_CHAIN_HASH'),
  drandPublicKey: requireValue('DRAND_PUBLIC_KEY'),
  seedPool: {
    id: process.env.SEED_POOL_ID || 'POOL-2026-0142',
    prizeLabel: process.env.SEED_POOL_PRIZE || '0.42 BTC',
    prizeUsd: process.env.SEED_POOL_PRIZE_USD || '$27,300',
    entryFeeUsdt: process.env.SEED_POOL_ENTRY_FEE_USDT || '1.000000',
    maxEntries: Number(process.env.SEED_POOL_MAX_ENTRIES || 25000),
    closesAt: process.env.SEED_POOL_CLOSES_AT || null
  }
};

export function assertProductionConfig() {
  if (!config.evmNetworks.length && !config.tronNetworks.length) {
    throw new Error('Configure at least one payment network in EVM_NETWORKS_JSON or TRON_NETWORKS_JSON.');
  }
  for (const n of [...config.evmNetworks, ...config.tronNetworks]) {
    for (const field of ['key','usdtContract','receiverAddress']) {
      if (!String(n[field] || '').trim()) throw new Error(`Network ${n.key || '(unnamed)'} is missing ${field}.`);
    }
    if (!Number.isInteger(n.amountDecimals) || n.amountDecimals < 0 || n.amountDecimals > 30) {
      throw new Error(`Network ${n.key} has invalid amountDecimals.`);
    }
    if (n.chainFamily === 'evm' && (!n.rpcUrl || !Number.isInteger(n.chainId))) {
      throw new Error(`EVM network ${n.key} needs rpcUrl and numeric chainId.`);
    }
    if (n.chainFamily === 'tron' && !n.apiBase) throw new Error(`TRON network ${n.key} needs apiBase.`);
  }
}
