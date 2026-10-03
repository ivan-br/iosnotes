require("./register.cjs");
const { performance } = require("node:perf_hooks");
const assert = require("node:assert/strict");
const { OrderBook } = require("../src/market/order-book.ts");

// Deterministic CPU comparison of the old sorting pipeline and the current engine.
// This excludes React rendering, network latency and device frame rates.
const instrument = {
  symbol: "BTCUSDT",
  base: "BTC",
  quote: "USDT",
  tick: "0.01",
  lot: "0.00001",
};
const bids = Array.from({ length: 5000 }, (_, i) => [
  (84000 - i * 5).toFixed(2),
  (((i % 31) + 1) / 100).toFixed(5),
]);
const asks = Array.from({ length: 5000 }, (_, i) => [
  (84000.01 + i * 5).toFixed(2),
  (((i % 37) + 1) / 100).toFixed(5),
]);
const engine = new OrderBook(instrument);
engine.replace(bids, asks, 1);
engine.setStep("200");
const oldBids = new Map(bids.map(([p, q]) => [Number(p), Number(q)]));
const oldAsks = new Map(asks.map(([p, q]) => [Number(p), Number(q)]));
function reference(side, levels) {
  const sorted = [...levels].sort((a, b) =>
    side === "bid" ? b[0] - a[0] : a[0] - b[0],
  );
  const buckets = new Map();
  for (const [price, amount] of sorted) {
    const key =
      (side === "bid" ? Math.floor(price / 200) : Math.ceil(price / 200)) * 200;
    buckets.set(key, (buckets.get(key) || 0) + amount);
  }
  return [...buckets]
    .sort((a, b) => (side === "bid" ? b[0] - a[0] : a[0] - b[0]))
    .slice(0, 120);
}
const oldTimes = [],
  currentTimes = [];
for (let update = 0; update < 1200; update++) {
  const changes = Array.from({ length: 20 }, (_, i) => {
    const index = (update * 19 + i * 41) % 5000;
    return [bids[index][0], (((update + i) % 43) / 100).toFixed(5)];
  });
  let start = performance.now();
  for (const [price, amount] of changes) {
    if (Number(amount)) oldBids.set(Number(price), Number(amount));
    else oldBids.delete(Number(price));
  }
  const expectedBids = reference("bid", oldBids),
    expectedAsks = reference("ask", oldAsks);
  const oldTime = performance.now() - start;
  start = performance.now();
  engine.apply(changes, [], update + 2);
  const result = engine.project();
  const currentTime = performance.now() - start;
  if (update >= 200) {
    oldTimes.push(oldTime);
    currentTimes.push(currentTime);
  }
  for (const [levels, expected] of [
    [result.bids, expectedBids],
    [result.asks, expectedAsks],
  ]) {
    assert.equal(levels.length, expected.length);
    levels.forEach((level, i) => {
      assert.equal(Number(level.price), expected[i][0]);
      assert.ok(Math.abs(level.quantity - expected[i][1]) < 1e-9);
    });
  }
}
const summary = (values) => {
  const sorted = values.slice().sort((a, b) => a - b);
  return {
    p50_ms: Number(sorted[500].toFixed(3)),
    p95_ms: Number(sorted[950].toFixed(3)),
    total_ms: Number(values.reduce((a, b) => a + b, 0).toFixed(1)),
  };
};
console.log(
  JSON.stringify(
    {
      initial_levels: 10000,
      changes_per_event: 20,
      measured_events: 1000,
      reference: summary(oldTimes),
      current: summary(currentTimes),
      all_projections_match: true,
    },
    null,
    2,
  ),
);
