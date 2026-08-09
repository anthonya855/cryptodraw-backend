const base = String(process.argv[2] || process.env.DRAND_BASE_URL || 'https://api.drand.sh').replace(/\/$/, '');
const r = await fetch(base + '/info', { headers: { accept: 'application/json' } });
if (!r.ok) throw new Error(`drand /info returned HTTP ${r.status}`);
const info = await r.json();
console.log('DRAND_BASE_URL=' + base);
console.log('DRAND_CHAIN_HASH=' + info.hash);
console.log('DRAND_PUBLIC_KEY=' + info.public_key);
console.log('period=' + info.period + ' seconds');
console.log('genesis_time=' + info.genesis_time);
