const express = require('express');
const router = express.Router();

let tickerCache = null;
let lastFetch = 0;
const CACHE_TTL = 15000; // 15 seconds

router.get('/', async (req, res) => {
  // Return cached data if fresh
  if (tickerCache && Date.now() - lastFetch < CACHE_TTL) {
    return res.json(tickerCache);
  }

  try {
    const tokens = await fetchBoostedTokens();
    if (tokens.length > 0) {
      tickerCache = tokens;
      lastFetch = Date.now();
      return res.json(tokens);
    }
    // Fallback to search
    const fallback = await fetchSearchFallback();
    tickerCache = fallback;
    lastFetch = Date.now();
    return res.json(fallback);
  } catch (err) {
    console.error('Ticker API error:', err.message);
    if (tickerCache) return res.json(tickerCache);
    res.status(502).json({ error: 'Failed to fetch ticker data' });
  }
});

async function fetchBoostedTokens() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const boostRes = await fetch('https://api.dexscreener.com/token-boosts/top/v1', {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!boostRes.ok) throw new Error('Boost API HTTP ' + boostRes.status);

    const boostData = await boostRes.json();
    const list = Array.isArray(boostData) ? boostData : [];

    // Deduplicate and group by chain
    const seen = new Set();
    const byChain = {};
    for (const item of list) {
      if (!item.tokenAddress || !item.chainId || seen.has(item.tokenAddress)) continue;
      seen.add(item.tokenAddress);
      if (!byChain[item.chainId]) byChain[item.chainId] = [];
      if (byChain[item.chainId].length < 15) {
        byChain[item.chainId].push(item);
      }
    }

    // Batch fetch price data per chain (up to 30 addresses per call)
    const results = [];
    for (const [chainId, items] of Object.entries(byChain)) {
      const addresses = items.map(i => i.tokenAddress).join(',');
      try {
        const ctrl2 = new AbortController();
        const t2 = setTimeout(() => ctrl2.abort(), 8000);
        const pairRes = await fetch(
          `https://api.dexscreener.com/tokens/v1/${chainId}/${addresses}`,
          { signal: ctrl2.signal }
        );
        clearTimeout(t2);
        if (!pairRes.ok) continue;

        const pairs = await pairRes.json();
        const pairsArr = Array.isArray(pairs) ? pairs : (pairs.pairs || []);

        // Pick the best pair per base token (highest liquidity)
        const bestByToken = {};
        for (const p of pairsArr) {
          const addr = p.baseToken?.address;
          if (!addr) continue;
          const liq = p.liquidity?.usd || 0;
          if (!bestByToken[addr] || liq > (bestByToken[addr].liquidity?.usd || 0)) {
            bestByToken[addr] = p;
          }
        }

        for (const p of Object.values(bestByToken)) {
          results.push({
            symbol: p.baseToken?.symbol || '???',
            name: p.baseToken?.name || '',
            price: p.priceUsd || '0',
            priceChange: p.priceChange?.h24 ?? 0,
            icon: p.info?.imageUrl || '',
            chain: p.chainId || chainId,
            url: p.url || ''
          });
        }
      } catch (_) { /* skip chain on error */ }

      if (results.length >= 20) break;
    }

    return results.slice(0, 20);
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchSearchFallback() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const res = await fetch('https://api.dexscreener.com/latest/dex/search?q=SOL', {
      signal: controller.signal
    });
    clearTimeout(timeout);
    if (!res.ok) throw new Error('Search HTTP ' + res.status);

    const data = await res.json();
    const pairs = (data.pairs || []).slice(0, 20);

    return pairs.map(p => ({
      symbol: p.baseToken?.symbol || '???',
      name: p.baseToken?.name || '',
      price: p.priceUsd || '0',
      priceChange: p.priceChange?.h24 ?? 0,
      icon: p.info?.imageUrl || '',
      chain: p.chainId || '',
      url: p.url || ''
    }));
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = router;
