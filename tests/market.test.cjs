const { test } = require("node:test");
const assert = require("node:assert/strict");
const { OrderBook } = require("../src/market/order-book.ts");
const { BookSession } = require("../src/market/book-session.ts");
const {
  defaultStep,
  validateStep,
  quantity,
  units,
} = require("../src/market/decimal.ts");
const {
  fetchCatalog,
  fetchRatio,
  request,
  ApiError,
} = require("../src/market/api.ts");

const instrument = {
  symbol: "BTCUSDT",
  base: "BTC",
  quote: "USDT",
  tick: "0.01",
  lot: "0.00001",
};
const snapshot = {
  lastUpdateId: 100,
  bids: [["100.01", "2"]],
  asks: [["100.03", "3"]],
};
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => {
    resolve = a;
    reject = b;
  });
  return { promise, resolve, reject };
};
const flush = async () => {
  for (let i = 0; i < 10; i++) await Promise.resolve();
};
class Clock {
  now = 0;
  next = 1;
  timers = new Map();
  install() {
    this.original = {
      setTimeout,
      clearTimeout,
      setInterval,
      clearInterval,
      now: Date.now,
    };
    global.setTimeout = (callback, delay) => this.add(callback, delay, false);
    global.setInterval = (callback, delay) => this.add(callback, delay, true);
    global.clearTimeout = global.clearInterval = (id) => this.timers.delete(id);
    Date.now = () => this.now;
  }
  add(callback, delay, repeat) {
    const id = this.next++;
    this.timers.set(id, { callback, at: this.now + delay, delay, repeat });
    return id;
  }
  async tick(ms) {
    const end = this.now + ms;
    while (true) {
      const entry = [...this.timers]
        .filter(([, timer]) => timer.at <= end)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!entry) break;
      const [id, timer] = entry;
      this.now = timer.at;
      this.timers.delete(id);
      if (timer.repeat) {
        timer.at += timer.delay;
        this.timers.set(id, timer);
      }
      timer.callback();
      await flush();
    }
    this.now = end;
    await flush();
  }
  restore() {
    Object.assign(global, {
      setTimeout: this.original.setTimeout,
      clearTimeout: this.original.clearTimeout,
      setInterval: this.original.setInterval,
      clearInterval: this.original.clearInterval,
    });
    Date.now = this.original.now;
  }
}
function setup(t, exchange = "binance", market = "spot", deps = {}, selected = instrument) {
  const clock = new Clock();
  clock.install();
  const sockets = [],
    pending = [];
  const session = new BookSession(
    { exchange, market, instrument: selected },
    {
      random: () => 0,
      socket: () => {
        const socket = {
          onopen: null,
          onmessage: null,
          onclose: null,
          onerror: null,
          sent: [],
          closed: false,
          send(value) {
            this.sent.push(JSON.parse(value));
          },
          close() {
            this.closed = true;
          },
          message(value) {
            this.onmessage?.({ data: JSON.stringify(value) });
          },
        };
        sockets.push(socket);
        return socket;
      },
      snapshot: (_, signal) => {
        const task = deferred();
        pending.push({ ...task, signal });
        return task.promise;
      },
      health: async () => snapshot,
      ...deps,
    },
  );
  t.after(() => {
    session.stop();
    clock.restore();
  });
  session.start();
  sockets[0].onopen();
  return { session, sockets, pending, clock };
}
const event = (U, u, pu, b = []) => ({ s: "BTCUSDT", U, u, pu, b, a: [] });

const btw = { ...instrument, symbol: "BTWUSDT", base: "BTW", tick: "0.0001000", lot: "1" };
// Prices observed in Binance's public BTW snapshot on 2026-10-04.
const btwSnapshot = {
  lastUpdateId: 100,
  bids: [["1.1627000", "97"], ["1.1603700", "12"]],
  asks: [["1.2494000", "101"], ["1.2511300", "11"]],
};

test("BTW depth finer than the advertised tick is retained exactly", () => {
  const book = new OrderBook(btw);
  book.replace(btwSnapshot.bids, btwSnapshot.asks, 100);
  assert.equal(book.digits, 5);
  assert.equal(book.bids.get(116037), 12);
  book.setStep(defaultStep(1.2, btw.tick));
  assert.equal(book.step, "0.0100");
  assert.deepEqual(book.project().bids.map(row => [row.price, row.quantity]), [["1.1600", 109]]);
  assert.equal(book.project().spread, "0.08670");
  book.setStep("0.0001");
  assert.equal(book.project().bids[1].price, "1.1603");
  assert.equal(book.project().asks[1].price, "1.2512");
  book.apply([["1.1603700", "0"]], [["1.2511300", "20"]], 101);
  assert.equal(book.bids.size, 1);
  assert.equal(book.asks.get(125113), 20);
});

test("a finer live price rescales existing levels without changing the custom step", () => {
  const book = new OrderBook(btw);
  book.replace([["1.1627", "97"]], [["1.1630", "100"]], 1);
  book.setStep("0.01");
  book.project();
  book.apply([["1.16037", "12"]], [["1.1630", "99"]], 2);
  assert.equal(book.digits, 5);
  assert.equal(book.bids.get(116270), 97);
  assert.equal(book.project().bids[0].quantity, 109);
  assert.equal(book.project().asks[0].quantity, 99);
  assert.equal(book.step, "0.0100");
  book.apply([["1.16037", "0"], ["1.1627", "0"]], [], 3);
  assert.equal(book.project().bids.length, 0);
  book.replace([["1.1600", "5"]], [["1.1700", "6"]], 4);
  assert.equal(book.project().bids[0].quantity, 5);
});

test("off-grid prices at the existing precision are valid feed data", () => {
  const book = new OrderBook({ ...instrument, tick: "0.05" });
  book.replace([["1.03", "1"]], [["1.07", "2"]], 1);
  assert.equal(book.project().bids[0].price, "1.00");
  assert.equal(book.project().asks[0].price, "1.10");
  assert.equal(book.project().spread, "0.04");
});

test("failed precision expansion leaves prices, buckets, step and sequence untouched", () => {
  const book = new OrderBook(instrument);
  book.replace(snapshot.bids, snapshot.asks, 100);
  const before = book.project();
  assert.throws(() => book.apply([["0.000000000000001", "1"]], [], 101), /safe/);
  assert.equal(book.digits, 2);
  assert.deepEqual(book.project(), before);
  assert.throws(() => book.apply([["100.011", "5"]], [["100.04", "NaN"]], 101));
  assert.equal(book.digits, 2);
  assert.deepEqual(book.project(), before);
});

test("BTW futures synchronizes, chooses its default, and keeps manual steps on reconnect", async (t) => {
  const { session, sockets, pending, clock } = setup(t, "binance", "futures", {}, btw);
  const unsubscribe = session.subscribeData(() => {});
  t.after(unsubscribe);
  sockets[0].message({ ...event(99, 101, 98), s: btw.symbol });
  pending[0].resolve(btwSnapshot);
  await flush();
  await clock.tick(100);
  assert.equal(session.getStatus(), "live");
  assert.equal(session.getProjection().step, "0.0100");
  session.setStep("0.001");
  await clock.tick(100);
  assert.equal(session.getProjection().step, "0.0010");
  session.stop();
  session.start();
  sockets[1].onopen();
  sockets[1].message({ ...event(99, 101, 98), s: btw.symbol });
  pending[1].resolve(btwSnapshot);
  await flush();
  await clock.tick(100);
  assert.equal(session.getStatus(), "live");
  assert.equal(session.getProjection().step, "0.0010");
});

test("order rows never opt into native auto-shrinking text", () => {
  const fs = require("node:fs");
  const source = fs.readFileSync(require.resolve("../src/components/order-book-view.tsx"), "utf8");
  assert.doesNotMatch(source, /adjustsFontSizeToFit/);
});

test("tick aggregation respects exact boundaries, raw spread and mid", () => {
  const book = new OrderBook({ ...instrument, tick: "0.01" });
  book.replace([["0.30", "1"]], [["0.31", "2"]], 1);
  book.setStep("0.1");
  const data = book.project();
  assert.equal(data.bids[0].price, "0.30");
  assert.equal(data.asks[0].price, "0.40");
  assert.equal(data.spread, "0.01");
  assert.equal(data.mid, "0.305");
  book.replace([["0.06", "1"]], [["0.07", "2"]], 2);
  book.setStep("0.01");
  assert.equal(book.project().asks[0].price, "0.07");
});
test("micro and cross-quote values stay nonzero and defaults are tick aligned", () => {
  assert.equal(defaultStep(84000, "0.01"), "200.00");
  assert.equal(defaultStep(0.1, "0.00001"), "0.01000");
  const book = new OrderBook({ ...instrument, tick: "0.00000001" });
  book.replace([["0.00001234", "0.00001"]], [["0.00001235", "0.00002"]], 1);
  book.setStep(defaultStep(0.000012345, book.instrument.tick));
  assert.ok(Number(book.project().bids[0].price) > 0);
  assert.equal(quantity(0.00001, "0.00001"), "0.00001");
  assert.equal(quantity(10, "0.1"), "10");
  assert.throws(() => validateStep("0.007", "0.005"));
  assert.throws(() => validateStep("1..2", "0.01"));
  assert.throws(() => validateStep("-2", "0.01"));
  assert.equal(validateStep("0,015", "0.005"), "0.015");
  assert.throws(() => units("9007199254740992", 0));
});
test("invalid payload cannot partially mutate maps", () => {
  const book = new OrderBook(instrument);
  book.replace(snapshot.bids, snapshot.asks, 100);
  assert.throws(() =>
    book.apply([["100.01", "10"]], [["100.03", "Infinity"]], 101),
  );
  assert.equal(book.bids.get(10001), 2);
  assert.equal(book.updateId, 100);
  assert.throws(() => book.replace([["0", "1"]], snapshot.asks, 101));
  assert.equal(book.bids.size, 1);
});
test("empty buckets cannot survive as floating residuals after deletions", () => {
  const book = new OrderBook(instrument);
  book.replace(
    [
      ["100.01", "0.1"],
      ["100.02", "0.2"],
    ],
    [["100.04", "0.1"]],
    1,
  );
  book.setStep("1");
  book.apply(
    [
      ["100.01", "0"],
      ["100.02", "0"],
    ],
    [],
    2,
  );
  assert.equal(book.project().bids.length, 0);
});
test("unsafe bucket rounding rejects a step without changing the previous step", () => {
  const book = new OrderBook({ ...instrument, tick: "1" });
  book.replace([["9007199254740990", "1"]], [["9007199254740991", "1"]], 1);
  assert.throws(() => book.setStep("9007199254740990"), /safe price precision/);
  assert.equal(book.step, "1");
});
test("incremental projection matches independent integer-tick aggregation and reuses rows", () => {
  const book = new OrderBook(instrument);
  book.replace(
    [
      ["100.01", "2"],
      ["99.98", "1"],
      ["99.93", "3"],
    ],
    [
      ["100.03", "3"],
      ["100.09", "4"],
    ],
    1,
  );
  book.setStep("0.05");
  book.apply(
    [
      ["99.98", "2"],
      ["99.93", "0"],
    ],
    [["100.09", "5"]],
    2,
  );
  const data = book.project();
  assert.deepEqual(
    data.bids.map((row) => [row.price, row.quantity, row.total]),
    [
      ["100.00", 2, 2],
      ["99.95", 2, 4],
    ],
  );
  assert.deepEqual(
    data.asks.map((row) => [row.price, row.quantity, row.total]),
    [
      ["100.05", 3, 3],
      ["100.10", 5, 8],
    ],
  );
  assert.equal(book.project().asks[0], data.asks[0]);
  assert.equal(data.maxQuantity, 5);
});
test("spot buffers then bridges once, duplicates do not publish", async (t) => {
  const { session, sockets, pending, clock } = setup(t);
  let publications = 0;
  session.subscribeData(() => publications++);
  sockets[0].message(event(99, 100));
  sockets[0].message(event(101, 102, undefined, [["100.01", "4"]]));
  pending[0].resolve(snapshot);
  await flush();
  await clock.tick(100);
  assert.equal(session.getStatus(), "live");
  assert.equal(publications, 1);
  assert.equal(session.book.bids.get(10001), 4);
  sockets[0].message(event(101, 102));
  await clock.tick(100);
  assert.equal(publications, 1);
});
test("futures equality bridge validates every buffered pu and never publishes gap as LIVE", async (t) => {
  const { session, sockets, pending } = setup(t, "binance", "futures");
  sockets[0].message(event(99, 100, 98));
  sockets[0].message(event(101, 102, 99));
  pending[0].resolve(snapshot);
  await flush();
  assert.equal(session.getStatus(), "reconnecting");
  assert.ok(sockets[0].closed);
  assert.equal(session.getProjection(), null);
});
test("futures valid replay and subsequent live gap", async (t) => {
  const { session, sockets, pending } = setup(t, "binance", "futures");
  sockets[0].message(event(99, 100, 98));
  sockets[0].message(event(101, 102, 100));
  pending[0].resolve(snapshot);
  await flush();
  assert.equal(session.getStatus(), "live");
  sockets[0].message(event(103, 104, 101));
  assert.equal(session.getStatus(), "reconnecting");
});
test("snapshot failure owns one retry; obsolete responses and callbacks cannot mutate a new generation", async (t) => {
  const { session, sockets, pending, clock } = setup(t);
  const oldMessage = sockets[0].onmessage,
    oldOpen = sockets[0].onopen;
  sockets[0].onerror();
  assert.ok(pending[0].signal.aborted);
  assert.ok(sockets[0].closed);
  await clock.tick(2000);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  oldOpen();
  oldMessage({ data: JSON.stringify(event(101, 102)) });
  pending[0].resolve({ ...snapshot, lastUpdateId: 10000 });
  await flush();
  assert.equal(session.book.updateId, null);
  assert.equal(pending.length, 2);
  pending[1].reject(new Error("snapshot failed"));
  await flush();
  assert.ok(sockets[1].closed);
  assert.equal(clock.timers.size, 2);
  session.stop();
  assert.equal(clock.timers.size, 0);
});
test("startup buffers and hung connections are bounded", async (t) => {
  const { session, sockets, clock } = setup(t);
  for (let i = 0; i <= 1000; i++) sockets[0].message(event(i, i));
  assert.equal(session.getStatus(), "reconnecting");
  assert.ok(sockets[0].closed);
  await clock.tick(2000);
  sockets[1].onopen();
  await clock.tick(20000);
  assert.ok(sockets[1].closed);
  assert.notEqual(session.getStatus(), "live");
});
test("Bybit starts from stream snapshot, ignores stale deltas and supports server reset", async (t) => {
  const { session, sockets, pending, clock } = setup(t, "bybit");
  assert.equal(pending.length, 0);
  assert.deepEqual(sockets[0].sent[0].args, ["orderbook.1000.BTCUSDT"]);
  const message = (type, u, b, a) => ({
    topic: "orderbook.1000.BTCUSDT",
    type,
    data: { s: "BTCUSDT", u, b, a },
  });
  sockets[0].message(message("snapshot", 20, snapshot.bids, snapshot.asks));
  sockets[0].message(message("delta", 25, [["100.01", "8"]], []));
  sockets[0].message(message("delta", 24, [["100.01", "20"]], []));
  assert.equal(session.book.bids.get(10001), 8);
  sockets[0].message(
    message("snapshot", 1, [["99.01", "3"]], [["99.03", "4"]]),
  );
  assert.equal(session.book.bids.size, 1);
  assert.equal(session.book.updateId, 1);
  await clock.tick(20000);
  assert.equal(sockets[0].sent.at(-1).op, "ping");
});
test("Bybit subscription failure and silence recover rather than remaining LIVE", async (t) => {
  const { session, sockets, clock } = setup(t, "bybit");
  sockets[0].message({
    op: "subscribe",
    success: false,
    ret_msg: "Not supported",
  });
  assert.equal(session.getStatus(), "reconnecting");
  await clock.tick(2000);
  sockets[1].onopen();
  sockets[1].message({
    topic: "orderbook.1000.BTCUSDT",
    type: "snapshot",
    data: { s: "BTCUSDT", u: 1, b: snapshot.bids, a: snapshot.asks },
  });
  await clock.tick(35000);
  assert.ok(sockets[1].closed);
});
test("quiet Binance book verifies freshness cheaply; background stop and restart require new synchronization", async (t) => {
  const { session, sockets, pending, clock } = setup(t);
  pending[0].resolve(snapshot);
  await flush();
  await clock.tick(20000);
  assert.equal(session.getStatus(), "live");
  session.subscribeData(() => {});
  await clock.tick(100);
  const previous = session.getProjection();
  session.stop();
  assert.equal(clock.timers.size, 0);
  session.start();
  assert.equal(session.getStatus(), "reconnecting");
  assert.equal(session.getProjection(), previous);
  assert.equal(sockets.length, 2);
  sockets[1].onopen();
  pending[1].resolve({ ...snapshot, lastUpdateId: 200 });
  await flush();
  sockets[1].message(event(201, 202));
  assert.equal(session.getStatus(), "live");
});
test("hidden book has zero publications; bursts coalesce at 10Hz", async (t) => {
  const { session, sockets, pending, clock } = setup(t);
  sockets[0].message(event(101, 101));
  pending[0].resolve(snapshot);
  await flush();
  await clock.tick(1000);
  assert.equal(session.getProjection(), null);
  let count = 0;
  const unsubscribe = session.subscribeData(() => count++);
  for (let i = 102; i < 202; i++)
    sockets[0].message(event(i, i, undefined, [["100.01", String(i)]]));
  await clock.tick(100);
  assert.equal(count, 1);
  assert.equal(session.getProjection().updateId, 201);
  unsubscribe();
  sockets[0].message(event(202, 202));
  await clock.tick(1000);
  assert.equal(count, 1);
});
test("rate limits respect server cooldown", async (t) => {
  const { sockets, pending, clock } = setup(t);
  pending[0].reject(new ApiError("HTTP 429", 60000));
  await flush();
  await clock.tick(59999);
  assert.equal(sockets.length, 1);
  await clock.tick(1);
  assert.equal(sockets.length, 2);
});
test("catalog pagination rejects errors and repeated cursors; cursor is encoded", async (t) => {
  const previous = global.fetch;
  t.after(() => {
    global.fetch = previous;
  });
  const item = {
    symbol: "BTCUSDT",
    baseCoin: "BTC",
    quoteCoin: "USDT",
    status: "Trading",
    priceFilter: { tickSize: "0.01" },
    lotSizeFilter: { qtyStep: "0.001" },
  };
  const urls = [];
  let count = 0;
  global.fetch = async (url) => {
    urls.push(url);
    return {
      ok: true,
      json: async () =>
        ++count === 1
          ? { retCode: 0, result: { list: [item], nextPageCursor: "a+b=" } }
          : { retCode: 10000, retMsg: "page failed" },
    };
  };
  await assert.rejects(
    fetchCatalog("bybit", "futures", new AbortController().signal),
    /page failed/,
  );
  assert.ok(urls[1].includes("cursor=a%2Bb%3D"));
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      retCode: 0,
      result: { list: [item], nextPageCursor: "same" },
    }),
  });
  await assert.rejects(
    fetchCatalog("bybit", "futures", new AbortController().signal),
    /Repeated/,
  );
});
test("HTTP timeout cancels fetch; parent abort cancels obsolete request", async (t) => {
  const clock = new Clock();
  clock.install();
  const previous = global.fetch;
  t.after(() => {
    global.fetch = previous;
    clock.restore();
  });
  global.fetch = (_, { signal }) =>
    new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(new Error("Aborted")), {
        once: true,
      });
    });
  const task = assert.rejects(
    request("https://example.test", new AbortController().signal),
    /timed out/,
  );
  await clock.tick(15000);
  await task;
  const controller = new AbortController();
  const aborted = assert.rejects(
    request("https://example.test", controller.signal),
    /Aborted/,
  );
  controller.abort();
  await aborted;
  assert.equal(clock.timers.size, 0);
});
test("ratio adapters sort, preserve zero shares and reject invalid payloads independently", async (t) => {
  const previous = global.fetch;
  t.after(() => {
    global.fetch = previous;
  });
  global.fetch = async (url) => ({
    ok: true,
    json: async () =>
      url.includes("topLong")
        ? { code: -1 }
        : [
            {
              timestamp: "2000",
              longAccount: "1",
              shortAccount: "0",
              longShortRatio: "0",
            },
            {
              timestamp: "1000",
              longAccount: "0.6",
              shortAccount: "0.4",
              longShortRatio: "1.5",
            },
          ],
  });
  await assert.rejects(
    fetchRatio("binance", "BTCUSDT", true, new AbortController().signal),
  );
  const points = await fetchRatio(
    "binance",
    "BTCUSDT",
    false,
    new AbortController().signal,
  );
  assert.equal(points[0].timestamp, 1000);
  assert.equal(points[1].short, 0);
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      retCode: 0,
      result: { list: [{ timestamp: "1000", buyRatio: "1", sellRatio: "0" }] },
    }),
  });
  assert.equal(
    (
      await fetchRatio("bybit", "BTCUSDT", false, new AbortController().signal)
    )[0].ratio,
    null,
  );
  await assert.rejects(
    fetchRatio("bybit", "BTCUSDT", true, new AbortController().signal),
    /does not publish/,
  );
});
