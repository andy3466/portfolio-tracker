// 從 GitHub Actions 排程執行，把每檔股票的現價 + 5 天走勢跟 USD/TWD 匯率
// 一起寫進 data.json，讓 index.html 只需要讀這個 static file。
// Yahoo Finance 會擋掉機房 IP（GitHub Actions/雲端 IP 直接打會 429），
// 所以跟瀏覽器版一樣，準備多個公開 CORS proxy 依序嘗試。
import { readFile, writeFile } from "node:fs/promises";

const CHART_RANGE = "5d";
const CHART_INTERVAL = "15m";
const FX_SYMBOL = "TWD=X";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const PROXIES = [
  (url) => url, // 先直接打打看，機房 IP 常被擋但偶爾能過
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?url=${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
];

async function fetchYahoo(symbol) {
  const target = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${CHART_RANGE}&interval=${CHART_INTERVAL}`;
  let lastErr;
  for (const wrap of PROXIES) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12000);
      const res = await fetch(wrap(target), { headers: { "User-Agent": UA, Accept: "application/json" }, signal: ctrl.signal });
      clearTimeout(t);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const result = data?.chart?.result?.[0];
      const price = result?.meta?.regularMarketPrice;
      if (typeof price !== "number") throw new Error("no price in response");
      const timestamps = result.timestamp || [];
      const closes = result.indicators?.quote?.[0]?.close || [];
      return {
        price,
        name: result.meta?.shortName || symbol,
        series: timestamps
          .map((t, i) => [t * 1000, closes[i]])
          .filter(([, v]) => typeof v === "number"),
      };
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error(`${symbol}: all sources failed`);
}

async function main() {
  const holdings = JSON.parse(await readFile(new URL("../holdings.json", import.meta.url), "utf8"));

  const results = {};
  for (const h of holdings) {
    try {
      results[h.symbol] = await fetchYahoo(h.symbol);
    } catch (e) {
      console.error(`failed to fetch ${h.symbol}:`, e.message);
    }
    await new Promise(r => setTimeout(r, 400));
  }

  let fx = null;
  try {
    fx = (await fetchYahoo(FX_SYMBOL)).price;
  } catch (e) {
    console.error("failed to fetch FX:", e.message);
  }

  const out = {
    generatedAt: new Date().toISOString(),
    fx,
    holdings: holdings.map(h => ({ ...h, ...(results[h.symbol] || {}) })),
  };

  await writeFile(new URL("../data.json", import.meta.url), JSON.stringify(out, null, 2) + "\n");
  console.log("wrote data.json:", out.generatedAt, "fx:", fx);
}

main().catch(e => { console.error(e); process.exit(1); });
