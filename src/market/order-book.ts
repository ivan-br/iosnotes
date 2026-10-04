import { decimal, precision, units, validateStep } from "./decimal";
import type { Entries, Instrument, Level, Projection } from "./types";

export class OrderBook {
  readonly bids = new Map<number, number>();
  readonly asks = new Map<number, number>();
  private bidBuckets = new Map<number, number>();
  private askBuckets = new Map<number, number>();
  private bidCounts = new Map<number, number>();
  private askCounts = new Map<number, number>();
  private stepUnits: number;
  digits: number;
  private previous = new Map<string, Level>();
  updateId: number | null = null;
  step: string;

  constructor(readonly instrument: Instrument) {
    this.digits = precision(instrument.tick);
    const tickUnits = units(instrument.tick, this.digits);
    if (tickUnits <= 0) throw new Error("Invalid tick size");
    this.stepUnits = tickUnits;
    this.step = decimal(this.stepUnits, this.digits);
  }

  setStep(step: string) {
    const valid = validateStep(step, this.instrument.tick);
    if (valid === this.step) return;
    const nextUnits = units(valid, this.digits);
    for (const price of this.asks.keys()) this.bucket("ask", price, nextUnits);
    this.step = valid;
    this.stepUnits = nextUnits;
    this.bidBuckets.clear();
    this.askBuckets.clear();
    this.bidCounts.clear();
    this.askCounts.clear();
    for (const [price, amount] of this.bids)
      this.addBucket("bid", price, 0, amount);
    for (const [price, amount] of this.asks)
      this.addBucket("ask", price, 0, amount);
  }

  private bucket(side: "bid" | "ask", price: number, step = this.stepUnits) {
    const key =
      (side === "bid" ? Math.floor(price / step) : Math.ceil(price / step)) *
      step;
    if (!Number.isSafeInteger(key))
      throw new Error("Step exceeds safe price precision");
    return key;
  }

  private addBucket(
    side: "bid" | "ask",
    price: number,
    previous: number,
    amount: number,
  ) {
    const buckets = side === "bid" ? this.bidBuckets : this.askBuckets;
    const counts = side === "bid" ? this.bidCounts : this.askCounts;
    const key = this.bucket(side, price);
    const count =
      (counts.get(key) ?? 0) + Number(amount > 0) - Number(previous > 0);
    // Membership, not a floating epsilon, determines whether a bucket is empty.
    if (!count) {
      buckets.delete(key);
      counts.delete(key);
      return;
    }
    counts.set(key, count);
    buckets.set(key, (buckets.get(key) ?? 0) + (amount - previous));
  }

  private pricePrecision(entries: Entries): number {
    if (!Array.isArray(entries)) throw new Error("Missing depth entries");
    let digits = this.digits;
    for (const entry of entries) {
      if (
        !Array.isArray(entry) ||
        typeof entry[0] !== "string" ||
        entry[0].length > 64 ||
        !/^\d+(?:\.\d+)?$/.test(entry[0])
      )
        throw new Error("Invalid depth price");
      digits = Math.max(digits, precision(entry[0]));
    }
    return digits;
  }

  private parse(entries: Entries, digits: number): [number, number][] {
    if (!Array.isArray(entries)) throw new Error("Missing depth entries");
    return entries.map((entry) => {
      if (
        !Array.isArray(entry) ||
        entry.length !== 2 ||
        typeof entry[0] !== "string" ||
        typeof entry[1] !== "string"
      ) {
        throw new Error("Invalid depth entry");
      }
      if (
        !/^\d+(?:\.\d+)?$/.test(entry[1]) ||
        entry[0].length > 64 ||
        entry[1].length > 64
      )
        throw new Error("Invalid depth value");
      const price = units(entry[0], digits),
        amount = Number(entry[1]);
      if (
        price <= 0 ||
        !Number.isFinite(amount) ||
        amount < 0 ||
        amount > Number.MAX_SAFE_INTEGER
      )
        throw new Error("Invalid depth value");
      return [price, amount];
    });
  }

  replace(bids: Entries, asks: Entries, id: number) {
    this.apply(bids, asks, id, true);
  }

  apply(bids: Entries, asks: Entries, id: number, replace = false) {
    if (!Number.isSafeInteger(id) || id < 0)
      throw new Error("Invalid depth sequence");
    // Validate both sides before mutating either, including replacement snapshots.
    const digits = Math.max(this.pricePrecision(bids), this.pricePrecision(asks));
    const stepUnits = units(this.step, digits);
    let parsedBids = this.parse(bids, digits),
      parsedAsks = this.parse(asks, digits);
    // Published depth can contain orders finer than today's order-entry tick.
    // Rescale exactly, before mutation, rather than rejecting or rounding them.
    if (digits !== this.digits && !replace) {
      const rescale = (levels: Map<number, number>): [number, number][] =>
        [...levels].map(([price, amount]) => [
          units(decimal(price, this.digits), digits),
          amount,
        ]);
      parsedBids = [...rescale(this.bids), ...parsedBids];
      parsedAsks = [...rescale(this.asks), ...parsedAsks];
    }
    for (const [price] of parsedAsks) this.bucket("ask", price, stepUnits);
    if (digits !== this.digits) {
      replace = true;
      this.previous.clear();
    }
    this.digits = digits;
    this.stepUnits = stepUnits;
    if (replace) {
      this.bids.clear();
      this.asks.clear();
      this.bidBuckets.clear();
      this.askBuckets.clear();
      this.bidCounts.clear();
      this.askCounts.clear();
    }
    for (const [side, entries] of [
      ["bid", parsedBids],
      ["ask", parsedAsks],
    ] as const) {
      const levels = side === "bid" ? this.bids : this.asks;
      for (const [price, amount] of entries) {
        this.addBucket(side, price, levels.get(price) ?? 0, amount);
        if (amount === 0) levels.delete(price);
        else levels.set(price, amount);
      }
    }
    this.updateId = id;
  }

  best() {
    let bid = 0,
      ask = Infinity;
    for (const price of this.bids.keys()) if (price > bid) bid = price;
    for (const price of this.asks.keys()) if (price < ask) ask = price;
    return { bid, ask: Number.isFinite(ask) ? ask : 0 };
  }

  project(limit = 120): Projection {
    const next = new Map<string, Level>();
    const extraDigits = this.digits - precision(this.instrument.tick);
    const build = (side: "bid" | "ask", buckets: Map<number, number>) => {
      let total = 0;
      return [...buckets.keys()]
        .sort((a, b) => (side === "bid" ? b - a : a - b))
        .slice(0, limit)
        .map((price) => {
          const amount = buckets.get(price)!;
          total += amount;
          const key = `${side}:${price}`,
            old = this.previous.get(key);
          const level =
            old && old.quantity === amount && old.total === total
              ? old
              : {
                  key,
                  price: extraDigits
                    ? decimal(price, this.digits)
                        .slice(0, -extraDigits)
                        .replace(/\.$/, "")
                    : decimal(price, this.digits),
                  quantity: amount,
                  total,
                  side,
                };
          next.set(key, level);
          return level;
        });
    };
    const bids = build("bid", this.bidBuckets),
      asks = build("ask", this.askBuckets);
    this.previous = next;
    const { bid, ask } = this.best();
    return {
      bids,
      asks,
      step: this.step,
      updateId: this.updateId,
      mid:
        bid && ask
          ? Number.isSafeInteger((bid + ask) * 5)
            ? decimal((bid + ask) * 5, this.digits + 1)
            : decimal(Math.floor((bid + ask) / 2), this.digits)
          : "-",
      spread: bid && ask && ask >= bid ? decimal(ask - bid, this.digits) : "-",
      maxQuantity: Math.max(
        0,
        ...bids.map((level) => level.quantity),
        ...asks.map((level) => level.quantity),
      ),
    };
  }
}
