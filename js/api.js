/* =========================================================
   Live market data via CoinGecko public API (no key needed),
   with a CORS-proxy chain fallback, in-memory cache and
   per-endpoint rate limiting. Falls back to the deterministic
   simulator in data-chart.js when everything fails.
   ========================================================= */

const MARKETS = {
  AAPL: { id: "apple",       symbol: "AAPL/USD", name: "Apple",            icon: "fa-apple",      color: "#999" },
  MSFT: { id: "microsoft",   symbol: "MSFT/USD", name: "Microsoft",        icon: "fa-windows",    color: "#999" },
  GOOGL:{ id: "google",      symbol: "GOOGL/USD",name: "Alphabet (Google)",icon: "fa-google",     color: "#999" },
  AMZN: { id: "amazon",      symbol: "AMZN/USD", name: "Amazon",           icon: "fa-amazon",     color: "#999" },
  TSLA: { id: "tesla",       symbol: "TSLA/USD", name: "Tesla",            icon: "fa-car",        color: "#999" },
  NVDA: { id: "nvidia",      symbol: "NVDA/USD", name: "Nvidia",           icon: "fa-microchip",  color: "#999" },
  META: { id: "meta-platforms", symbol: "META/USD", name: "Meta Platforms", icon: "fa-facebook",  color: "#999" }
};

// ---- proxy chain (first direct, then public read-only proxies) ----
const PROXIES = [
  u => u,
  u => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  u => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  u => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u)
];

// CoinGecko ids that are NOT backed by a real price feed — never display these.
const BANNED_IDS = new Set(["apple", "microsoft", "google", "amazon", "tesla", "nvidia", "meta-platforms"]);

// ---- US stock universe (real tickers for the Home screen) ----
const STOCKS = [
  { symbol: "AAPL",  name: "Apple" },
  { symbol: "MSFT",  name: "Microsoft" },
  { symbol: "GOOGL", name: "Alphabet" },
  { symbol: "AMZN",  name: "Amazon" },
  { symbol: "TSLA",  name: "Tesla" },
  { symbol: "NVDA",  name: "Nvidia" },
  { symbol: "META",  name: "Meta" },
  { symbol: "JPM",   name: "JPMorgan Chase" },
  { symbol: "V",     name: "Visa" },
  { symbol: "NFLX",  name: "Netflix" },
  { symbol: "AMD",   name: "Advanced Micro Devices" },
  { symbol: "INTC",  name: "Intel" },
  { symbol: "DIS",   name: "Disney" },
  { symbol: "NKE",   name: "Nike" },
  { symbol: "KO",    name: "Coca-Cola" },
  { symbol: "PEP",   name: "PepsiCo" }
];

/**
 * Daily OHLC candles for a US stock from the deterministic simulator.
 * (No free, CORS-friendly stock API exists without a key — see README.)
 */
async function fetchStockDaily(symbol, days) {
  throw new Error("stock feed is simulated");   // data-chart.js falls back to simulator
}

const DAY_MS = 86400000;


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

/** Batch spot prices for many ids at once (one request). Banned ids are skipped. */
async function fetchSpots(ids) {
  const safe = (Array.isArray(ids) ? ids : []).filter(id => !BANNED_IDS.has(id));
  if (!safe.length) return {};
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${safe.join(",")}&vs_currencies=usd&include_24hr_change=true`;
  return cached("spots:" + safe.slice().sort().join(","), 12000, 12000, async () => {
    return await cgFetch(url, j => j && Object.keys(j).length);
  });
}
