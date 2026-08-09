import crypto from 'node:crypto';

const BASE58_ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(value) {
  let n = 0n;
  for (const ch of String(value)) {
    const i = BASE58_ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('Invalid base58 character');
    n = n * 58n + BigInt(i);
  }
  let hex = n.toString(16);
  if (hex.length % 2) hex = '0' + hex;
  let out = hex ? Buffer.from(hex, 'hex') : Buffer.alloc(0);
  let zeros = 0;
  for (const ch of String(value)) { if (ch === '1') zeros++; else break; }
  if (zeros) out = Buffer.concat([Buffer.alloc(zeros), out]);
  return out;
}

export function normalizeTronAddressToHex(address) {
  const raw = String(address || '').trim();
  if (/^(41)?[0-9a-fA-F]{40}$/.test(raw)) return (raw.length === 40 ? '41' + raw : raw).toLowerCase();
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(raw)) throw new Error('Invalid TRON address');
  const decoded = base58Decode(raw);
  if (decoded.length !== 25) throw new Error('Invalid TRON address length');
  const payload = decoded.subarray(0, 21), checksum = decoded.subarray(21);
  if (payload[0] !== 0x41) throw new Error('Invalid TRON address prefix');
  const expected = crypto.createHash('sha256').update(crypto.createHash('sha256').update(payload).digest()).digest().subarray(0, 4);
  if (!crypto.timingSafeEqual(checksum, expected)) throw new Error('Invalid TRON address checksum');
  return payload.toString('hex').toLowerCase();
}

export function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function sha256Buffer(input) {
  return crypto.createHash('sha256').update(input).digest();
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']';
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}';
}

export function parseDecimalToAtomic(value, decimals) {
  const s = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(s)) throw new Error('Invalid decimal amount');
  const [whole, frac = ''] = s.split('.');
  if (frac.length > decimals) {
    const extra = frac.slice(decimals);
    if (/[^0]/.test(extra)) throw new Error(`Amount has more than ${decimals} decimal places`);
  }
  const padded = (frac.slice(0, decimals) + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole) * (10n ** BigInt(decimals)) + BigInt(padded || '0');
}

export function normalizeEvmAddress(address) {
  const v = String(address || '').toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(v)) throw new Error('Invalid EVM address');
  return v;
}

export function normalizeTxHash(hash) {
  const v = String(hash || '').trim();
  if (!/^(0x[0-9a-fA-F]{64}|[0-9a-fA-F]{64})$/.test(v)) throw new Error('Invalid transaction hash');
  return v.toLowerCase().replace(/^0x/, '');
}

export function encodeErc20Transfer(receiverAddress, amountAtomic) {
  const to = normalizeEvmAddress(receiverAddress).slice(2).padStart(64, '0');
  const amount = BigInt(amountAtomic).toString(16).padStart(64, '0');
  return '0xa9059cbb' + to + amount;
}

export function canonicalEntry(entry) {
  return [
    String(entry.public_id),
    String(entry.wallet_address),
    String(entry.tx_hash).toLowerCase(),
    String(entry.network_key),
    String(entry.amount_atomic)
  ].join('|');
}

export function buildMerkle(entries) {
  if (!entries.length) throw new Error('Cannot build a Merkle root for an empty entry list');
  const lines = entries.map(canonicalEntry);
  let level = lines.map(line => sha256Buffer(Buffer.from(line, 'utf8')));
  const entriesHash = sha256Hex(Buffer.from(lines.join('\n'), 'utf8'));
  while (level.length > 1) {
    const next = [];
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = level[i + 1] || left;
      next.push(sha256Buffer(Buffer.concat([left, right])));
    }
    level = next;
  }
  return { merkleRoot: level[0].toString('hex'), entriesHash, lines };
}

export function randomId(prefix = '') {
  return prefix + crypto.randomBytes(12).toString('hex');
}

export function makeAdminToken(secret, hours) {
  const payload = { exp: Date.now() + hours * 3600000, nonce: crypto.randomBytes(12).toString('hex') };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

export function verifyAdminToken(token, secret) {
  try {
    const [body, sig] = String(token || '').split('.');
    if (!body || !sig) return false;
    const expected = crypto.createHmac('sha256', secret).update(body).digest('base64url');
    const a = Buffer.from(sig); const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return false;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return Number(payload.exp) > Date.now();
  } catch { return false; }
}
