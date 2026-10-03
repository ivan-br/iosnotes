import { ApiError, fetchSnapshot } from "./api";
import { defaultStep } from "./decimal";
import { OrderBook } from "./order-book";
import type { DepthEvent, Projection, Snapshot, Status, Venue } from "./types";

export type Socket = {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send: (value: string) => void;
  close: () => void;
};
type Dependencies = {
  socket: (url: string) => Socket;
  snapshot: (venue: Venue, signal: AbortSignal) => Promise<Snapshot>;
  health: (venue: Venue, signal: AbortSignal) => Promise<Snapshot>;
  random: () => number;
};

export class BookSession {
  readonly book: OrderBook;
  private socket: Socket | null = null;
  private controller: AbortController | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private publish: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  private running = false;
  private initialized = false;
  private bridged = false;
  private buffered: DepthEvent[] = [];
  private snapshotId: number | null = null;
  private receivedAt = 0;
  private startedAt = 0;
  private pingAt = 0;
  private attempts = 0;
  private probing = false;
  private autoStep = true;
  private status: Status = "connecting";
  private statusListeners = new Set<() => void>();
  private dataListeners = new Set<() => void>();
  private projection: Projection | null = null;
  error = "";
  readonly dependencies: Dependencies;

  constructor(
    readonly venue: Venue,
    deps: Partial<Dependencies> = {},
  ) {
    this.book = new OrderBook(venue.instrument);
    this.dependencies = {
      socket: (url) => new WebSocket(url) as unknown as Socket,
      snapshot: fetchSnapshot,
      health: (venue, signal) => fetchSnapshot(venue, signal, 5),
      random: Math.random,
      ...deps,
    };
  }
  getStatus = () => this.status;
  getNotice = () => (this.status === "live" ? "" : this.error);
  getProjection = () => this.projection;
  subscribeStatus = (listener: () => void) => {
    this.statusListeners.add(listener);
    return () => {
      this.statusListeners.delete(listener);
    };
  };
  subscribeData = (listener: () => void) => {
    this.dataListeners.add(listener);
    if (this.initialized) this.queuePublish();
    return () => {
      this.dataListeners.delete(listener);
      if (!this.dataListeners.size && this.publish) {
        clearTimeout(this.publish);
        this.publish = null;
      }
    };
  };
  setStep(step: string) {
    this.book.setStep(step);
    this.autoStep = false;
    this.queuePublish();
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
    this.watchdog = setInterval(() => {
      const now = Date.now();
      if (!this.socket) return;
      if (
        (!this.initialized && now - this.startedAt > 15000) ||
        (this.venue.exchange === "bybit" && now - this.receivedAt > 30000)
      ) {
        this.fail("Feed timed out");
        return;
      }
      if (
        this.venue.exchange === "binance" &&
        this.initialized &&
        !this.bridged &&
        now - this.startedAt > 15000 &&
        !this.probing
      )
        this.probe();
      if (
        this.venue.exchange === "binance" &&
        this.bridged &&
        now - this.receivedAt > 30000 &&
        !this.probing
      )
        this.probe();
      if (this.venue.exchange === "bybit" && now - this.pingAt >= 20000) {
        try {
          this.socket.send(JSON.stringify({ op: "ping" }));
          this.pingAt = now;
        } catch {
          this.fail("Heartbeat failed");
        }
      }
    }, 5000);
  }

  stop() {
    this.running = false;
    this.release();
    if (this.retry) clearTimeout(this.retry);
    if (this.watchdog) clearInterval(this.watchdog);
    this.retry = null;
    this.watchdog = null;
    this.setStatus("offline");
  }

  private setStatus(status: Status, error = "") {
    if (this.status === status && this.error === error) return;
    this.status = status;
    this.error = error;
    for (const listener of this.statusListeners) listener();
  }

  private release() {
    ++this.generation;
    this.controller?.abort();
    this.controller = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = null;
      socket.onmessage = null;
      socket.onclose = null;
      socket.onerror = null;
      try {
        socket.close();
      } catch {
        /* Already closed by the native transport. */
      }
    }
    if (this.publish) clearTimeout(this.publish);
    this.publish = null;
    this.buffered = [];
    this.initialized = false;
    this.bridged = false;
    this.snapshotId = null;
    this.probing = false;
  }

  private fail(message: string, retryAfter = 0) {
    if (!this.running) return;
    this.release();
    this.setStatus("reconnecting", message);
    if (this.retry) clearTimeout(this.retry);
    const delay = Math.max(
      retryAfter,
      Math.min(60000, 2000 * 2 ** Math.min(this.attempts++, 5)) +
        this.dependencies.random() * 1000,
    );
    this.retry = setTimeout(() => {
      this.retry = null;
      this.connect();
    }, delay);
  }

  private connect() {
    if (!this.running) return;
    this.release();
    this.setStatus(this.projection ? "reconnecting" : "connecting", this.error);
    const token = this.generation,
      { exchange, market, instrument } = this.venue;
    const topic = `orderbook.1000.${instrument.symbol}`;
    const url =
      exchange === "bybit"
        ? `wss://stream.bybit.com/v5/public/${market === "spot" ? "spot" : "linear"}`
        : market === "spot"
          ? `wss://stream.binance.com:9443/ws/${instrument.symbol.toLowerCase()}@depth@100ms`
          : `wss://fstream.binance.com/public/stream?streams=${instrument.symbol.toLowerCase()}@depth@100ms`;
    this.receivedAt = this.startedAt = this.pingAt = Date.now();
    let socket: Socket;
    try {
      socket = this.dependencies.socket(url);
      this.socket = socket;
    } catch {
      this.fail("Connection failed");
      return;
    }
    const current = () =>
      this.running && token === this.generation && this.socket === socket;
    socket.onerror = () => {
      if (current()) this.fail("Connection error");
    };
    socket.onclose = () => {
      if (current()) this.fail("Connection closed");
    };
    socket.onopen = () => {
      if (!current()) return;
      if (exchange === "bybit") {
        try {
          socket.send(JSON.stringify({ op: "subscribe", args: [topic] }));
        } catch {
          this.fail("Subscription failed");
        }
      } else {
        this.controller = new AbortController();
        this.dependencies
          .snapshot(this.venue, this.controller.signal)
          .then((snapshot) => {
            if (!current()) return;
            try {
              this.book.replace(
                snapshot.bids,
                snapshot.asks,
                snapshot.lastUpdateId,
              );
              this.controller = null;
              this.snapshotId = snapshot.lastUpdateId;
              this.initialized = true;
              const pending = this.buffered;
              this.buffered = [];
              for (const event of pending) this.applyBinance(event);
              if (current() && this.bridged) this.live();
            } catch (error) {
              if (current())
                this.fail(
                  error instanceof Error ? error.message : "Invalid snapshot",
                );
            }
          })
          .catch((error) => {
            if (current())
              this.fail(
                error.message || "Snapshot failed",
                error instanceof ApiError ? error.retryAfter : 0,
              );
          });
      }
    };
    socket.onmessage = (event) => {
      if (!current()) return;
      try {
        const message = JSON.parse(event.data);
        this.receivedAt = Date.now();
        if (exchange === "bybit") {
          if (message.op) {
            if (message.success === false)
              throw new Error(message.ret_msg || "Subscription rejected");
            return;
          }
          if (message.topic !== topic) return;
          const data = message.data;
          if (
            data?.s !== instrument.symbol ||
            !Number.isSafeInteger(data.u) ||
            !["snapshot", "delta"].includes(message.type)
          )
            throw new Error("Invalid Bybit depth");
          if (message.type === "snapshot") {
            this.book.replace(data.b, data.a, data.u);
            this.initialized = true;
          } else {
            if (!this.initialized || data.u === 1)
              throw new Error("Snapshot required");
            if (data.u <= this.book.updateId!) return;
            this.book.apply(data.b, data.a, data.u);
          }
          this.live();
        } else {
          const data = message.data ?? message;
          if (
            data.s !== instrument.symbol ||
            !Number.isSafeInteger(data.U) ||
            !Number.isSafeInteger(data.u) ||
            data.U < 0 ||
            data.u < 0 ||
            data.U > data.u ||
            (market === "futures" &&
              (!Number.isSafeInteger(data.pu) || data.pu < 0))
          )
            throw new Error("Invalid Binance depth");
          if (!this.initialized) {
            if (
              this.buffered.length >= 1000 ||
              Date.now() - this.startedAt > 15000
            )
              throw new Error("Snapshot buffer exceeded");
            this.buffered.push(data);
          } else if (this.applyBinance(data)) this.live();
        }
      } catch (error) {
        if (current())
          this.fail(error instanceof Error ? error.message : "Invalid feed");
      }
    };
  }

  private applyBinance(event: DepthEvent) {
    const id = this.book.updateId!,
      futures = this.venue.market === "futures";
    if (!this.bridged) {
      const anchor = this.snapshotId! + (futures ? 0 : 1);
      if (event.u < anchor) return false;
      if (event.U > anchor) throw new Error("Snapshot sequence gap");
    } else {
      if (event.u <= id) return false;
      if (futures ? event.pu !== id : event.U > id + 1)
        throw new Error("Depth sequence gap");
    }
    this.book.apply(event.b, event.a, event.u);
    this.bridged = true;
    return true;
  }

  private live() {
    if (
      !this.initialized ||
      (this.venue.exchange === "binance" && !this.bridged)
    )
      return;
    if (this.autoStep) {
      const { bid, ask } = this.book.best();
      if (bid && ask) {
        this.book.setStep(
          defaultStep(
            (bid + ask) / 2 / 10 ** this.book.digits,
            this.venue.instrument.tick,
          ),
        );
        this.autoStep = false;
      }
    }
    if (Date.now() - this.startedAt > 30000) this.attempts = 0;
    this.setStatus("live");
    this.queuePublish();
  }

  private probe() {
    // Binance has no application-level pong. Verify quiet books using a cheap depth read,
    // rather than repeatedly downloading 5,000 levels for inactive symbols.
    const token = this.generation;
    this.probing = true;
    const controller = new AbortController();
    this.controller = controller;
    this.setStatus("reconnecting", "Checking feed freshness");
    this.dependencies
      .health(this.venue, controller.signal)
      .then((snapshot) => {
        if (!this.running || token !== this.generation) return;
        this.controller = null;
        this.probing = false;
        if (snapshot.lastUpdateId > this.book.updateId!)
          this.fail("Feed stopped delivering updates");
        else {
          this.receivedAt = Date.now();
          this.bridged = true;
          this.live();
        }
      })
      .catch((error) => {
        if (this.running && token === this.generation)
          this.fail(
            error.message || "Feed unavailable",
            error instanceof ApiError ? error.retryAfter : 0,
          );
      });
  }

  private queuePublish() {
    if (
      this.publish ||
      !this.dataListeners.size ||
      !this.initialized ||
      (this.venue.exchange === "binance" && !this.bridged)
    )
      return;
    this.publish = setTimeout(() => {
      this.publish = null;
      if (!this.initialized) return;
      try {
        this.projection = this.book.project();
      } catch (error) {
        this.fail(
          error instanceof Error ? error.message : "Invalid order book",
        );
        return;
      }
      for (const listener of this.dataListeners) listener();
    }, 100);
  }
}
