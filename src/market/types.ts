export type Exchange = "binance" | "bybit";
export type Market = "spot" | "futures";
export type Status = "connecting" | "live" | "reconnecting" | "offline";
export type Instrument = {
  symbol: string;
  base: string;
  quote: string;
  tick: string;
  lot: string;
};
export type Venue = {
  exchange: Exchange;
  market: Market;
  instrument: Instrument;
};
export type Entries = [string, string][];
export type DepthEvent = {
  U: number;
  u: number;
  pu?: number;
  b: Entries;
  a: Entries;
};
export type Snapshot = { lastUpdateId: number; bids: Entries; asks: Entries };
export type Level = {
  key: string;
  price: string;
  quantity: number;
  total: number;
  side: "bid" | "ask";
};
export type Projection = {
  asks: Level[];
  bids: Level[];
  mid: string;
  spread: string;
  step: string;
  updateId: number | null;
  maxQuantity: number;
};
export type RatioPoint = {
  timestamp: number;
  long: number;
  short: number;
  ratio: number | null;
};
export type Series = {
  points: RatioPoint[];
  status: Status;
  error?: string;
  unsupported?: boolean;
};
export const venueKey = (venue: Venue) =>
  `${venue.exchange}:${venue.market}:${venue.instrument.symbol}`;
