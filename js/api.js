/* =========================================================
   Live market data via CoinGecko public API (no key needed),
   with a CORS-proxy chain fallback, in-memory cache and
   per-endpoint rate limiting. Falls back to the deterministic
   simulator in data-chart.js when everything fails.
   ========================================================= */

const MARKETS = {
  BTC: { id: "bitcoin",   symbol: "BTC/USD", name: "Bitcoin",   icon: "fa-bitcoin",  color: "#f7931a" },
  ETH: { id: "ethereum",  symbol: "ETH/USD", name: "Ethereum",  icon: "fa-ethereum", color: "#627eea" },
  SOL: { id: "solana",    symbol: "SOL/USD", name: "Solana",    icon: "fa-bolt",     color: "#14f195" },
  DOGE:{ id: "dogecoin",  symbol: "DOGE/USD",name: "Dogecoin",  icon: "fa-coins",    color: "#c2a633" }
};

const DAY_MS = 86400000;

// ---- proxy chain (first direct, then public read-only proxies) ----
const PROXIES = [
  u => u,
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
];

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally { clearTimeout(t); }
}

/** Try each proxy until one returns JSON that passes validate(). */
async function cgFetch(url, validate) {
  for (const wrap of PROXIES) {
    try {
      const j = await fetchWithTimeout(wrap(url));
      if (!validate || validate(j)) return j;
    } catch (e) { /* next proxy */ }
  }
  throw new Error("all endpoints failed for " + url.slice(0, 80));
}

// ---- tiny TTL cache + minimum-interval limiter ----
const _cache = {};
async function cached(key, ttlMs, minGapMs, producer) {
  const now = Date.now();
  const hit = _cache[key];
  if (hit && (now - hit.t) < ttlMs) return hit.v;          // fresh enough
  if (hit && (now - hit.req) < (minGapMs || 0)) return hit.v; // stale but rate-limited -> reuse
  _cache[key] = _cache[key] || { t: 0, req: 0, v: null };
  _cache[key].req = now;
  const v = await producer();
  _cache[key] = { t: now, req: now, v };
  return v;
}

/**
 * Fetch daily OHLC candles for a CoinGecko asset id.
 * Returns array of { x: Date, o, h, l, c } (newest last).
 */
async function fetchOHLC(assetId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${assetId}/ohlc?vs_currency=usd&days=${days}`;
  return cached("ohlc:" + assetId + ":" + days, 5 * 60000, 60000, async () => {
    const raw = await cgFetch(url, j => Array.isArray(j) && j.length >= 10);
    return raw.map(r => ({
      x: new Date(r[0]),
      o: +r[1], h: Math.max(r[1], r[2], r[3], r[4]),
      l: Math.min(r[1], r[2], r[3], r[4]),
      c: +r[4]
    }));
  });
}

/** Current spot price + 24h change (%). */
async function fetchSpot(assetId) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd&include_24hr_change=true`;
  return cached("spot:" + assetId, 10000, 10000, async () => {
    const j = await cgFetch(url, d => d && d[assetId] && d[assetId].usd);
    const d = j[assetId];
    return { price: d.usd, change24h: d.usd_24h_change };
  });
}

/** Volume series approximated from market_chart (hourly), bucketed per day. */
async function fetchVolume(assetId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${assetId}/market_chart?vs_currency=usd&days=${days}`;
  return cached("vol:" + assetId + ":" + days, 10 * 60000, 60000, async () => {
    const j = await cgFetch(url, d => d && Array.isArray(d.total_volumes) && d.total_volumes.length);
    const total = (j.total_volumes || []).map(p => [p[0], p[1]]);
    const byDay = {};
    total.forEach(([ms, v]) => {
      const key = Math.floor(ms / DAY_MS);
      byDay[key] = (byDay[key] || 0) + v / 24;
    });
    return Object.entries(byDay).map(([k, v]) => [Number(k) * DAY_MS, v]);
  });
}

/** Batch spot prices for many ids at once (one request). */
async function fetchSpots(ids) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(",")}&vs_currencies=usd&include_24hr_change=true`;
  return cached("spots:" + ids.slice().sort().join(","), 12000, 12000, async () => {
    return await cgFetch(url, j => j && Object.keys(j).length);
  });
}
