// 從 GitHub Actions 排程執行：直接打 Yahoo Finance（伺服器端沒有瀏覽器 CORS 限制，
// 不需要透過公開 proxy），把每檔股票的現價 + 5 天走勢，跟 USD/TWD 匯率，
// 一起寫進 data.json，讓 index.html 只需要讀這個 static file。
import { readFile, writeFile } from "node:fs/promises";

const CHART_RANGE = "5d";
const CHART_INTERVAL = "15m";
const FX_SYMBOL = "TWD=X";
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchYahoo(symbol, attempt = 1) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${CHART_RANGE}&interval=${CHART_INTERVAL}`;
  const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) {
    if (attempt < 3) {
      await new Promise(r => setTimeout(r, 1500 * attempt));
      return fetchYahoo(symbol, attempt + 1);
    }
    throw new Error(`${symbol}: HTTP ${res.status}`);
  }
  const data = await res.json();
  const result = data?.chart?.result?.[0];
  const price = result?.meta?.regularMarketPrice;
  if (typeof price !== "number") throw new Error(`${symbol}: no price in response`);
  const timestamps = result.timestamp || [];
  const closes = result.indicators?.quote?.[0]?.close || [];
  return {
    price,
    name: result.meta?.shortName || symbol,
    series: timestamps
      .map((t, i) => [t * 1000, closes[i]])
      .filter(([, v]) => typeof v === "number"),
  };
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
