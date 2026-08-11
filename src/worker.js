const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', ...headers }
});

const text = (body, status = 200, headers = {}) => new Response(body, { status, headers });

const encoder = new TextEncoder();

function timingSafeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(message));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('');
}

function canonicalProxyMessage(url) {
  const pairs = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key === 'signature') continue;
    pairs.push([key, value]);
  }
  pairs.sort(([a, av], [b, bv]) => a === b ? av.localeCompare(bv) : a.localeCompare(b));
  return pairs.map(([k, v]) => `${k}=${v}`).join('');
}

async function verifyShopifyProxy(request, env) {
  if (!env.SHOPIFY_API_SECRET) return { ok: false, reason: 'SHOPIFY_API_SECRET is not configured' };
  const url = new URL(request.url);
  const signature = url.searchParams.get('signature') || '';
  const shop = url.searchParams.get('shop') || '';
  const timestamp = Number(url.searchParams.get('timestamp') || 0);
  if (!signature || !shop || !timestamp) return { ok: false, reason: 'Missing signed proxy parameters' };
  if (env.SHOPIFY_SHOP_DOMAIN && shop !== env.SHOPIFY_SHOP_DOMAIN) return { ok: false, reason: 'Unexpected shop' };
  const maxAge = Number(env.SHOPIFY_PROXY_MAX_AGE_SECONDS || 300);
  if (Math.abs(Math.floor(Date.now() / 1000) - timestamp) > maxAge) return { ok: false, reason: 'Expired proxy request' };
  const expected = await hmacHex(env.SHOPIFY_API_SECRET, canonicalProxyMessage(url));
  return { ok: timingSafeEqualHex(expected, signature), reason: 'Invalid signature' };
}

function requireDb(env) {
  if (!env.DB) throw new Error('D1 database binding DB is not configured yet');
  return env.DB;
}

async function initDb(env) {
  const db = requireDb(env);
  await db.exec(`
    CREATE TABLE IF NOT EXISTS pools (
      id TEXT PRIMARY KEY,
      prize TEXT NOT NULL,
      prize_usd TEXT,
      entry_fee_usdt TEXT NOT NULL DEFAULT '1.000000',
      max_entries INTEGER NOT NULL DEFAULT 25000,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      closes_at TEXT,
      frozen_at TEXT,
      finalized_at TEXT,
      winner_entry_id TEXT,
      draw_randomness TEXT,
      draw_round INTEGER,
      merkle_root TEXT,
      payout_tx_hash TEXT
    );
    CREATE TABLE IF NOT EXISTS entries (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pool_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      network TEXT NOT NULL,
      tx_hash TEXT NOT NULL UNIQUE,
      amount_usdt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_entries_pool ON entries(pool_id);
    CREATE INDEX IF NOT EXISTS idx_entries_wallet ON entries(wallet);
    CREATE TABLE IF NOT EXISTS payment_sessions (
      id TEXT PRIMARY KEY,
      pool_id TEXT NOT NULL,
      wallet TEXT NOT NULL,
      network TEXT NOT NULL,
      expected_amount_usdt TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      tx_hash TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      expires_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const seed = await db.prepare('SELECT id FROM pools WHERE id = ?').bind(env.SEED_POOL_ID || 'POOL-2026-0142').first();
  if (!seed) {
    await db.prepare('INSERT INTO pools (id, prize, prize_usd, entry_fee_usdt, max_entries) VALUES (?, ?, ?, ?, ?)')
      .bind(
        env.SEED_POOL_ID || 'POOL-2026-0142',
        env.SEED_POOL_PRIZE || '0.42 BTC',
        env.SEED_POOL_PRIZE_USD || '$27,300',
        env.SEED_POOL_ENTRY_FEE_USDT || '1.000000',
        Number(env.SEED_POOL_MAX_ENTRIES || 25000)
      ).run();
  }
}

async function currentPool(env) {
  await initDb(env);
  const pool = await env.DB.prepare(`
    SELECT p.*, (SELECT COUNT(*) FROM entries e WHERE e.pool_id = p.id AND e.status = 'confirmed') AS entries_count
    FROM pools p
    WHERE p.status IN ('open','frozen')
    ORDER BY p.created_at DESC LIMIT 1
  `).first();
  return pool;
}

async function makeAdminToken(env) {
  const exp = Math.floor(Date.now() / 1000) + 12 * 3600;
  const payload = `${exp}`;
  const sig = await hmacHex(env.ADMIN_SESSION_SECRET, payload);
  return `${payload}.${sig}`;
}

async function verifyAdminToken(request, env) {
  const auth = request.headers.get('authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const token = auth.slice(7);
  const [expStr, sig] = token.split('.');
  const exp = Number(expStr);
  if (!exp || !sig || exp < Math.floor(Date.now() / 1000)) return false;
  const expected = await hmacHex(env.ADMIN_SESSION_SECRET, expStr);
  return timingSafeEqualHex(expected, sig);
}

async function routeApi(request, env, pathname) {
  if (pathname === '/health') {
    return json({ ok: true, service: 'cryptodraw-api', runtime: 'cloudflare-workers', database: env.DB ? 'bound' : 'not-bound' });
  }

  if (pathname === '/public/networks') {
    const evm = env.EVM_NETWORKS_JSON ? JSON.parse(env.EVM_NETWORKS_JSON) : [];
    const tron = env.TRON_NETWORKS_JSON ? JSON.parse(env.TRON_NETWORKS_JSON) : [];
    return json({ networks: [...evm, ...tron] });
  }

  if (pathname === '/public/current-pool' && request.method === 'GET') {
    try { return json(await currentPool(env)); } catch (e) { return json({ error: e.message }, 503); }
  }

  if (pathname === '/public/recent-entries' && request.method === 'GET') {
    try {
      await initDb(env);
      const { results } = await env.DB.prepare('SELECT id, pool_id, wallet, network, amount_usdt, status, created_at FROM entries ORDER BY id DESC LIMIT 25').all();
      return json({ entries: results });
    } catch (e) { return json({ error: e.message }, 503); }
  }

  if (pathname === '/public/my-entries' && request.method === 'GET') {
    try {
      await initDb(env);
      const wallet = new URL(request.url).searchParams.get('wallet') || '';
      const { results } = await env.DB.prepare('SELECT id, pool_id, network, amount_usdt, status, created_at FROM entries WHERE lower(wallet)=lower(?) ORDER BY id DESC').bind(wallet).all();
      return json({ wallet, entries: results });
    } catch (e) { return json({ error: e.message }, 503); }
  }

  if (pathname === '/public/winners' && request.method === 'GET') {
    try {
      await initDb(env);
      const { results } = await env.DB.prepare("SELECT id, prize, prize_usd, winner_entry_id, finalized_at, payout_tx_hash FROM pools WHERE status='finalized' ORDER BY finalized_at DESC LIMIT 20").all();
      return json({ winners: results });
    } catch (e) { return json({ error: e.message }, 503); }
  }

  if (pathname === '/public/transparency' && request.method === 'GET') {
    try {
      await initDb(env);
      const pool = await currentPool(env);
      return json({ pool, randomness_source: 'drand', drand_base_url: env.DRAND_BASE_URL || 'https://api.drand.sh' });
    } catch (e) { return json({ error: e.message }, 503); }
  }

  if (pathname === '/public/payment-session' && request.method === 'POST') {
    try {
      await initDb(env);
      const body = await request.json();
      const pool = await currentPool(env);
      if (!pool || pool.status !== 'open') return json({ error: 'Pool is not open' }, 409);
      const available = [
        ...(env.EVM_NETWORKS_JSON ? JSON.parse(env.EVM_NETWORKS_JSON) : []),
        ...(env.TRON_NETWORKS_JSON ? JSON.parse(env.TRON_NETWORKS_JSON) : [])
      ];
      const network = available.find(n => n.key === body.network);
      if (!network) return json({ error: 'Payment network is not configured yet' }, 503);
      const id = crypto.randomUUID();
      const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
      await env.DB.prepare('INSERT INTO payment_sessions (id, pool_id, wallet, network, expected_amount_usdt, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
        .bind(id, pool.id, body.wallet || '', body.network, pool.entry_fee_usdt, expiresAt).run();
      return json({ id, pool_id: pool.id, amount_usdt: pool.entry_fee_usdt, network, expires_at: expiresAt }, 201);
    } catch (e) { return json({ error: e.message }, 400); }
  }

  if (pathname === '/public/entries/confirm' && request.method === 'POST') {
    return json({ error: 'Blockchain verification is disabled until a verified USDT network and RPC/API provider are configured.' }, 503);
  }

  return null;
}

async function routeAdmin(request, env, pathname) {
  if (pathname === '/admin' && request.method === 'GET') {
    return text(`<!doctype html><html><head><meta charset="utf-8"><title>CryptoDraw Admin</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:system-ui;background:#0b1020;color:#fff;max-width:760px;margin:60px auto;padding:24px}.card{background:#141b31;padding:24px;border-radius:16px}input,button{font:inherit;padding:12px;border-radius:10px;border:1px solid #34405f}input{width:100%;box-sizing:border-box;margin:8px 0;background:#0d1428;color:#fff}button{cursor:pointer}.muted{color:#aab4cf}pre{white-space:pre-wrap}</style></head><body><div class="card"><h1>CryptoDraw Admin</h1><p class="muted">Backend-only dashboard. Customer storefront does not expose this page.</p><input id="pw" type="password" placeholder="Admin password"><button id="login">Sign in</button><pre id="out"></pre></div><script>let token='';document.getElementById('login').onclick=async()=>{const r=await fetch('/admin/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})});const d=await r.json();if(!r.ok){out.textContent=d.error||'Login failed';return}token=d.token;const o=await fetch('/admin/api/overview',{headers:{authorization:'Bearer '+token}});out.textContent=JSON.stringify(await o.json(),null,2)};</script></body></html>`);
  }

  if (pathname === '/admin/api/login' && request.method === 'POST') {
    if (!env.ADMIN_PASSWORD || !env.ADMIN_SESSION_SECRET) return json({ error: 'Admin secrets are not configured' }, 503);
    const body = await request.json();
    if (body.password !== env.ADMIN_PASSWORD) return json({ error: 'Invalid password' }, 401);
    return json({ token: await makeAdminToken(env) });
  }

  if (!pathname.startsWith('/admin/api/')) return null;
  if (!(await verifyAdminToken(request, env))) return json({ error: 'Unauthorized' }, 401);

  if (pathname === '/admin/api/overview' && request.method === 'GET') {
    try {
      await initDb(env);
      const pool = await currentPool(env);
      const entries = await env.DB.prepare('SELECT COUNT(*) AS c FROM entries').first();
      const sessions = await env.DB.prepare('SELECT COUNT(*) AS c FROM payment_sessions').first();
      return json({ pool, totals: { entries: entries?.c || 0, payment_sessions: sessions?.c || 0 }, payments_configured: Boolean(env.EVM_NETWORKS_JSON || env.TRON_NETWORKS_JSON) });
    } catch (e) { return json({ error: e.message }, 503); }
  }

  if (pathname === '/admin/api/pools' && request.method === 'GET') {
    await initDb(env);
    const { results } = await env.DB.prepare('SELECT * FROM pools ORDER BY created_at DESC').all();
    return json({ pools: results });
  }

  if (pathname === '/admin/api/entries' && request.method === 'GET') {
    await initDb(env);
    const { results } = await env.DB.prepare('SELECT * FROM entries ORDER BY id DESC LIMIT 500').all();
    return json({ entries: results });
  }

  if (pathname === '/admin/api/audit' && request.method === 'GET') {
    await initDb(env);
    const { results } = await env.DB.prepare('SELECT * FROM audit_log ORDER BY id DESC LIMIT 500').all();
    return json({ audit: results });
  }

  return json({ error: 'Not found' }, 404);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname.startsWith('/apps/cryptodraw')) {
      const verification = await verifyShopifyProxy(request, env);
      if (!verification.ok) return json({ error: verification.reason }, 401);
      const proxiedPath = pathname.slice('/apps/cryptodraw'.length) || '/';
      const apiResponse = await routeApi(request, env, proxiedPath);
      return apiResponse || json({ error: 'Not found' }, 404);
    }

    if (pathname === '/health') return routeApi(request, env, pathname);

    if (pathname.startsWith('/admin')) {
      const adminResponse = await routeAdmin(request, env, pathname);
      return adminResponse || json({ error: 'Not found' }, 404);
    }

    return json({ error: 'Direct public API disabled. Use Shopify App Proxy.' }, 404);
  }
};
