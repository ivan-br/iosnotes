import type {
  Exchange,
  Instrument,
  Market,
  RatioPoint,
  Snapshot,
  Venue,
} from "./types";

export class ApiError extends Error {
  constructor(
    message: string,
    readonly retryAfter = 0,
  ) {
    super(message);
  }
}

export async function request(url: string, signal: AbortSignal): Promise<any> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(abort, 15000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      const retry = response.headers.get("Retry-After");
      const delay = retry
        ? Number.isFinite(Number(retry))
          ? Number(retry) * 1000
          : Math.max(0, Date.parse(retry) - Date.now())
        : 0;
      throw new ApiError(
        `HTTP ${response.status}`,
        Math.max(
          delay,
          response.status === 429 || response.status === 418 ? 60000 : 0,
        ),
      );
    }
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted)
      throw new ApiError("Request timed out");
    throw error;
  } finally {
    clearTimeout(timeout);
    signal.removeEventListener("abort", abort);
  }
}

export async function fetchCatalog(
  exchange: Exchange,
  market: Market,
  signal: AbortSignal,
): Promise<Instrument[]> {
  if (exchange === "binance") {
    const data = await request(
      market === "spot"
        ? "https://api.binance.com/api/v3/exchangeInfo"
        : "https://fapi.binance.com/fapi/v1/exchangeInfo",
      signal,
    );
    if (!Array.isArray(data.symbols))
      throw new ApiError("Invalid instrument catalog");
    return data.symbols
      .filter((item: any) => item.status === "TRADING")
      .map((item: any) => {
        const tick = item.filters?.find(
          (filter: any) => filter.filterType === "PRICE_FILTER",
        )?.tickSize;
        const lot = item.filters?.find(
          (filter: any) => filter.filterType === "LOT_SIZE",
        )?.stepSize;
        return instrument(
          item.symbol,
          item.baseAsset,
          item.quoteAsset,
          tick,
          lot,
        );
      })
      .sort((a: Instrument, b: Instrument) => a.symbol.localeCompare(b.symbol));
  }
  const results = new Map<string, Instrument>(),
    seen = new Set<string>();
  let cursor = "";
  do {
    const url = `https://api.bybit.com/v5/market/instruments-info?category=${market === "spot" ? "spot" : "linear"}&limit=1000${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const data = await request(url, signal);
    if (data.retCode !== 0 || !Array.isArray(data.result?.list))
      throw new ApiError(data.retMsg || "Invalid instrument catalog");
    for (const item of data.result.list) {
      if (item.status !== "Trading") continue;
      const parsed = instrument(
        item.symbol,
        item.baseCoin,
        item.quoteCoin,
        item.priceFilter?.tickSize,
        item.lotSizeFilter?.qtyStep ?? item.lotSizeFilter?.basePrecision,
      );
      results.set(parsed.symbol, parsed);
    }
    cursor = data.result.nextPageCursor || "";
    if (cursor && seen.has(cursor))
      throw new ApiError("Repeated catalog cursor");
    seen.add(cursor);
  } while (cursor);
  return [...results.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function instrument(
  symbol: unknown,
  base: unknown,
  quote: unknown,
  tick: unknown,
  lot: unknown,
): Instrument {
  if (
    [symbol, base, quote, tick, lot].some(
      (value) => typeof value !== "string",
    ) ||
    !(Number(tick) > 0) ||
    !(Number(lot) > 0)
  )
    throw new ApiError("Invalid instrument metadata");
  return { symbol, base, quote, tick, lot } as Instrument;
}

export async function fetchSnapshot(
  venue: Venue,
  signal: AbortSignal,
  limit = venue.market === "spot" ? 5000 : 1000,
): Promise<Snapshot> {
  const data = await request(
    venue.market === "spot"
      ? `https://api.binance.com/api/v3/depth?symbol=${venue.instrument.symbol}&limit=${limit}`
      : `https://fapi.binance.com/fapi/v1/depth?symbol=${venue.instrument.symbol}&limit=${limit}`,
    signal,
  );
  if (
    !Number.isSafeInteger(data.lastUpdateId) ||
    !Array.isArray(data.bids) ||
    !Array.isArray(data.asks)
  )
    throw new ApiError("Invalid depth snapshot");
  return data;
}

export async function fetchRatio(
  exchange: Exchange,
  symbol: string,
  top: boolean,
  signal: AbortSignal,
): Promise<RatioPoint[]> {
  const url =
    exchange === "binance"
      ? `https://fapi.binance.com/futures/data/${top ? "topLongShortPositionRatio" : "globalLongShortAccountRatio"}?symbol=${symbol}&period=5m&limit=30`
      : `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=5min&limit=30`;
  if (exchange === "bybit" && top)
    throw new ApiError("Bybit does not publish top-trader position ratios");
  const data = await request(url, signal);
  const list =
    exchange === "binance"
      ? data
      : data.retCode === 0
        ? data.result?.list
        : null;
  if (!Array.isArray(list)) throw new ApiError("Invalid ratio response");
  const points = list.map((item: any): RatioPoint => {
    const timestamp = Number(item.timestamp),
      long = Number(item.longAccount ?? item.buyRatio),
      short = Number(item.shortAccount ?? item.sellRatio);
    const ratio =
      short === 0
        ? null
        : exchange === "binance"
          ? Number(item.longShortRatio)
          : long / short;
    if (
      !Number.isFinite(timestamp) ||
      timestamp <= 0 ||
      !Number.isFinite(long) ||
      !Number.isFinite(short) ||
      long < 0 ||
      short < 0 ||
      long > 1 ||
      short > 1 ||
      Math.abs(long + short - 1) > 0.002 ||
      (ratio !== null && (!Number.isFinite(ratio) || ratio < 0))
    )
      throw new ApiError("Invalid ratio values");
    return {
      timestamp,
      long: long / (long + short),
      short: short / (long + short),
      ratio,
    };
  });
  return [
    ...new Map(points.map((point) => [point.timestamp, point])).values(),
  ].sort((a, b) => a.timestamp - b.timestamp);
}
