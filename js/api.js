/* =========================================================
   Live market data via CoinGecko public API (no key needed)
   Falls back to the deterministic simulator in data-chart.js
   if the network/API is unavailable.
   ========================================================= */

const MARKETS = {
  BTC: { id: "bitcoin",   symbol: "BTC/USD", name: "Bitcoin",   icon: "fa-bitcoin",      color: "#f7931a" },
  ETH: { id: "ethereum",  symbol: "ETH/USD", name: "Ethereum",  icon: "fa-ethereum",     color: "#627eea" },
  SOL: { id: "solana",    symbol: "SOL/USD", name: "Solana",    icon: "fa-bolt",         color: "#14f195" },
  DOGE:{ id: "dogecoin",  symbol: "DOGE/USD",name: "Dogecoin",  icon: "fa-coins",        color: "#c2a633" }
};

const DAY_MS = 86400000;

async function fetchWithTimeout(url, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

/**
 * Fetch daily OHLC candles for a CoinGecko asset id.
 * Returns array of { x: Date, o, h, l, c } (newest last).
 * CoinGecko /ohlc returns [time(ms), open, high, low, close].
 */
async function fetchOHLC(assetId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${assetId}/ohlc?vs_currency=usd&days=${days}`;
  const raw = await fetchWithTimeout(url);
  if (!Array.isArray(raw) || raw.length < 10) throw new Error("bad payload");
  return raw.map(r => ({
    x: new Date(r[0]),
    o: +r[1], h: Math.max(r[1], r[2], r[3], r[4]),
    l: Math.min(r[1], r[2], r[3], r[4]),
    c: +r[4]
  }));
}

/** Current spot price + 24h change (%). */
async function fetchSpot(assetId) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${assetId}&vs_currencies=usd&include_24hr_change=true`;
  const j = await fetchWithTimeout(url);
  const d = j[assetId];
  if (!d) throw new Error("no spot data");
  return { price: d.usd, change24h: d.usd_24h_change };
}

/** Volume series approximated from market_chart (hourly). Scales to daily buckets. */
async function fetchVolume(assetId, days) {
  const url = `https://api.coingecko.com/api/v3/coins/${assetId}/market_chart?vs_currency=usd&days=${days}`;
  const j = await fetchWithTimeout(url);
  const total = (j.total_volumes || []).map(p => [p[0], p[1]]);
  if (!total.length) throw new Error("no volume data");
  // Bucket hourly points into per-day sums
  const byDay = {};
  total.forEach(([ms, v]) => {
    const key = Math.floor(ms / DAY_MS);
    byDay[key] = (byDay[key] || 0) + v / 24;
  });
  return Object.entries(byDay).map(([k, v]) => [Number(k) * DAY_MS, v]);
}
