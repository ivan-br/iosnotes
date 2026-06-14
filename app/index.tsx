import { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type DimensionValue,
} from 'react-native';

type MarketType = 'spot' | 'futures';
type TradingSymbol = string;
type ConnectionStatus = 'connecting' | 'live' | 'reconnecting' | 'offline';
type BookSide = 'ask' | 'bid';
type MarketAvailability = 'loading' | 'available' | 'unavailable';

type BookLevel = {
  price: number;
  quantity: number;
  total: number;
};

type BookEntry = [number, number];

type DepthSnapshot = {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
};

type DepthEvent = {
  U: number;
  u: number;
  pu?: number;
  b: [string, string][];
  a: [string, string][];
};

type ExchangeInfo = {
  symbols?: {
    symbol: string;
    status?: string;
    contractStatus?: string;
  }[];
};

const MARKETS: MarketType[] = ['spot', 'futures'];
const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_PRICE_STEP = '200';
const MAX_VISIBLE_ROWS = 40;

const MARKET_CONFIG: Record<
  MarketType,
  {
    label: string;
    exchangeInfoUrl: string;
    depthUrl: string;
    snapshotLimit: number;
    streamUrl: (symbol: TradingSymbol) => string;
  }
> = {
  spot: {
    label: 'Spot',
    exchangeInfoUrl: 'https://api.binance.com/api/v3/exchangeInfo',
    depthUrl: 'https://api.binance.com/api/v3/depth',
    snapshotLimit: 5000,
    streamUrl: (symbol) =>
      `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth@100ms`,
  },
  futures: {
    label: 'Futures',
    exchangeInfoUrl: 'https://fapi.binance.com/fapi/v1/exchangeInfo',
    depthUrl: 'https://fapi.binance.com/fapi/v1/depth',
    snapshotLimit: 1000,
    streamUrl: (symbol) =>
      `wss://fstream.binance.com/public/stream?streams=${symbol.toLowerCase()}@depth@100ms`,
  },
};

export default function OrderBookScreen() {
  const [market, setMarket] = useState<MarketType>('spot');
  const [symbolsByMarket, setSymbolsByMarket] = useState<Record<MarketType, TradingSymbol[]>>({
    spot: [DEFAULT_SYMBOL, 'ETHUSDT', 'SOLUSDT'],
    futures: [DEFAULT_SYMBOL, 'ETHUSDT', 'SOLUSDT'],
  });
  const [marketAvailability, setMarketAvailability] = useState<Record<MarketType, MarketAvailability>>({
    spot: 'loading',
    futures: 'loading',
  });
  const [symbol, setSymbol] = useState<TradingSymbol>(DEFAULT_SYMBOL);
  const [isSymbolMenuOpen, setIsSymbolMenuOpen] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [draftPriceStepInput, setDraftPriceStepInput] = useState(DEFAULT_PRICE_STEP);
  const [priceStepInput, setPriceStepInput] = useState(DEFAULT_PRICE_STEP);
  const [rawBids, setRawBids] = useState<BookEntry[]>([]);
  const [rawAsks, setRawAsks] = useState<BookEntry[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdateId, setLastUpdateId] = useState<number | null>(null);

  const priceStep = parsePriceStep(priceStepInput);
  const bids = useMemo(() => toPriceBuckets(rawBids, 'bid', priceStep), [priceStep, rawBids]);
  const asks = useMemo(() => toPriceBuckets(rawAsks, 'ask', priceStep), [priceStep, rawAsks]);
  const availableSymbols = symbolsByMarket[market];
  const filteredSymbols = useMemo(
    () =>
      availableSymbols
        .filter((item) => item.includes(symbolFilter.trim().toUpperCase()))
        .slice(0, 80),
    [availableSymbols, symbolFilter]
  );

  useEffect(() => {
    let isActive = true;

    async function loadSymbols(nextMarket: MarketType) {
      try {
        const response = await fetch(MARKET_CONFIG[nextMarket].exchangeInfoUrl);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const exchangeInfo = (await response.json()) as ExchangeInfo;
        const nextSymbols = (exchangeInfo.symbols ?? [])
          .filter((item) =>
            nextMarket === 'spot'
              ? item.status === 'TRADING'
              : (item.contractStatus ?? item.status) === 'TRADING'
          )
          .map((item) => item.symbol)
          .sort();

        if (!isActive) {
          return;
        }

        if (nextSymbols.length === 0) {
          setMarketAvailability((current) => ({ ...current, [nextMarket]: 'unavailable' }));
          return;
        }

        setMarketAvailability((current) => ({ ...current, [nextMarket]: 'available' }));
        setSymbolsByMarket((current) => ({ ...current, [nextMarket]: nextSymbols }));

        if (nextMarket === market && !nextSymbols.includes(symbol)) {
          setSymbol(nextSymbols.includes(DEFAULT_SYMBOL) ? DEFAULT_SYMBOL : nextSymbols[0]);
        }
      } catch {
        if (isActive) {
          setMarketAvailability((current) => ({ ...current, [nextMarket]: 'unavailable' }));
          setStatus('offline');
        }
      }
    }

    loadSymbols('spot');
    loadSymbols('futures');

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (marketAvailability[market] === 'unavailable') {
      setMarket('spot');
      return;
    }

    const nextSymbols = symbolsByMarket[market];

    if (!nextSymbols.includes(symbol)) {
      setSymbol(nextSymbols.includes(DEFAULT_SYMBOL) ? DEFAULT_SYMBOL : nextSymbols[0]);
    }
  }, [market, marketAvailability, symbol, symbolsByMarket]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isActive = true;
    let isInitialized = false;
    let localUpdateId = 0;
    let eventBuffer: DepthEvent[] = [];
    const bidBook = new Map<number, number>();
    const askBook = new Map<number, number>();

    function connect() {
      setStatus((current) => (current === 'offline' ? 'reconnecting' : 'connecting'));

      socket = new WebSocket(MARKET_CONFIG[market].streamUrl(symbol));

      socket.onopen = () => {
        loadSnapshot();
      };

      socket.onmessage = (event) => {
        if (!isActive) {
          return;
        }

        try {
          const depthEvent = normalizeDepthEvent(JSON.parse(event.data));

          if (!depthEvent) {
            return;
          }

          if (!isInitialized) {
            eventBuffer.push(depthEvent);
            return;
          }

          applyDepthEvent(depthEvent);
        } catch {
          setStatus('offline');
        }
      };

      socket.onerror = () => {
        if (isActive) {
          setStatus('offline');
        }
      };

      socket.onclose = () => {
        if (!isActive) {
          return;
        }

        setStatus('reconnecting');
        reconnectTimer = setTimeout(connect, 1800);
      };
    }

    async function loadSnapshot() {
      try {
        const config = MARKET_CONFIG[market];
        const url = `${config.depthUrl}?symbol=${symbol}&limit=${config.snapshotLimit}`;
        const response = await fetch(url);
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const snapshot = (await response.json()) as DepthSnapshot;

        if (!isActive || !snapshot.lastUpdateId) {
          return;
        }

        bidBook.clear();
        askBook.clear();
        hydrateBook(bidBook, snapshot.bids);
        hydrateBook(askBook, snapshot.asks);
        localUpdateId = snapshot.lastUpdateId;

        const usableEvents = eventBuffer.filter((item) => item.u > snapshot.lastUpdateId);
        eventBuffer = [];

        for (const bufferedEvent of usableEvents) {
          applyDepthEvent(bufferedEvent, true);
        }

        isInitialized = true;
        publishBook();
        setStatus('live');
      } catch {
        if (isActive) {
          setStatus('offline');
          reconnectTimer = setTimeout(connect, 1800);
        }
      }
    }

    function applyDepthEvent(depthEvent: DepthEvent, isBuffered = false) {
      if (depthEvent.u <= localUpdateId) {
        return;
      }

      if (market === 'futures' && !isBuffered && depthEvent.pu && depthEvent.pu !== localUpdateId) {
        restartStream();
        return;
      }

      if (market === 'spot' && depthEvent.U > localUpdateId + 1) {
        restartStream();
        return;
      }

      applyUpdates(bidBook, depthEvent.b);
      applyUpdates(askBook, depthEvent.a);
      localUpdateId = depthEvent.u;
      publishBook();
      setStatus('live');
    }

    function publishBook() {
      setRawBids(toSortedEntries(bidBook, 'bid'));
      setRawAsks(toSortedEntries(askBook, 'ask'));
      setLastUpdateId(localUpdateId);
    }

    function restartStream() {
      isInitialized = false;
      eventBuffer = [];
      socket?.close();
    }

    connect();

    return () => {
      isActive = false;

      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
      }

      socket?.close();
    };
  }, [market, symbol]);

  const spread = useMemo(() => {
    const bestAsk = asks[0]?.price;
    const bestBid = bids[0]?.price;

    if (!bestAsk || !bestBid) {
      return null;
    }

    return bestAsk - bestBid;
  }, [asks, bids]);

  const maxQuantity = useMemo(() => {
    const quantities = [...asks, ...bids].map((level) => level.quantity);
    return Math.max(...quantities, 1);
  }, [asks, bids]);

  function selectSymbol(nextSymbol: TradingSymbol) {
    setSymbol(nextSymbol);
    setSymbolFilter('');
    setIsSymbolMenuOpen(false);
  }

  function selectMarket(nextMarket: MarketType) {
    if (nextMarket === 'futures' && marketAvailability.futures !== 'available') {
      return;
    }

    setMarket(nextMarket);
    setSymbolFilter('');
    setIsSymbolMenuOpen(false);
  }

  function applyPriceStep() {
    setPriceStepInput(draftPriceStepInput || DEFAULT_PRICE_STEP);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>OrderBook</Text>
          <Text style={styles.subtitle}>Binance market data</Text>
        </View>
        <View style={[styles.statusPill, status === 'live' ? styles.statusLive : styles.statusOff]}>
          <Text style={styles.statusText}>{statusLabel(status)}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.marketTabs}>
          {MARKETS.map((item) => {
            const isDisabled = item === 'futures' && marketAvailability.futures !== 'available';

            return (
              <Pressable
                disabled={isDisabled}
                key={item}
                onPress={() => selectMarket(item)}
                style={[
                  styles.marketTab,
                  market === item && styles.marketTabActive,
                  isDisabled && styles.marketTabDisabled,
                ]}
              >
                <Text
                  style={[
                    styles.marketText,
                    market === item && styles.marketTextActive,
                    isDisabled && styles.marketTextDisabled,
                  ]}
                >
                  {MARKET_CONFIG[item].label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <View style={styles.selectorRow}>
          <View style={styles.symbolSelector}>
            <Pressable
              onPress={() => setIsSymbolMenuOpen((current) => !current)}
              style={styles.dropdownButton}
            >
              <Text style={styles.dropdownLabel}>{formatSymbol(symbol)}</Text>
              <Text style={styles.dropdownChevron}>{isSymbolMenuOpen ? '▲' : '▼'}</Text>
            </Pressable>

            {isSymbolMenuOpen ? (
              <View style={styles.dropdownMenu}>
                <TextInput
                  autoCapitalize="characters"
                  onChangeText={setSymbolFilter}
                  placeholder="Search symbol"
                  placeholderTextColor="#75688c"
                  style={styles.symbolSearch}
                  value={symbolFilter}
                />
                <ScrollView style={styles.symbolList} keyboardShouldPersistTaps="handled">
                  {filteredSymbols.map((item) => (
                    <Pressable
                      key={item}
                      onPress={() => selectSymbol(item)}
                      style={[styles.symbolOption, symbol === item && styles.symbolOptionActive]}
                    >
                      <Text
                        style={[
                          styles.symbolOptionText,
                          symbol === item && styles.symbolOptionTextActive,
                        ]}
                      >
                        {formatSymbol(item)}
                      </Text>
                    </Pressable>
                  ))}
                </ScrollView>
              </View>
            ) : null}
          </View>

          <View style={styles.rangeInputWrap}>
            <Text style={styles.inputLabel}>Price step</Text>
            <TextInput
              keyboardType="decimal-pad"
              maxLength={10}
              onChangeText={(value) => setDraftPriceStepInput(normalizePriceStepInput(value))}
              onSubmitEditing={applyPriceStep}
              placeholder={DEFAULT_PRICE_STEP}
              placeholderTextColor="#75688c"
              returnKeyType="done"
              style={styles.rangeInput}
              value={draftPriceStepInput}
            />
            <Pressable onPress={applyPriceStep} style={styles.applyButton}>
              <Text style={styles.applyButtonText}>Apply</Text>
            </Pressable>
          </View>
        </View>
      </View>

      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{MARKET_CONFIG[market].label}</Text>
        <Text style={styles.metaText}>Step {formatPrice(priceStep, symbol)}</Text>
        <Text style={styles.metaText}>#{lastUpdateId ?? '-'}</Text>
      </View>

      <View style={styles.columns}>
        <Text style={[styles.columnText, styles.priceColumn]}>Price</Text>
        <Text style={styles.columnText}>Amount</Text>
        <Text style={[styles.columnText, styles.totalColumn]}>Total</Text>
      </View>

      <ScrollView contentContainerStyle={styles.book} showsVerticalScrollIndicator={false}>
        {asks
          .slice()
          .reverse()
          .map((level) => (
            <BookRow
              key={`ask-${level.price}`}
              level={level}
              maxQuantity={maxQuantity}
              side="ask"
              symbol={symbol}
            />
          ))}

        <View style={styles.spreadRow}>
          <Text style={styles.spreadPrice}>{formatPrice(midPrice(asks, bids), symbol)}</Text>
          <Text style={styles.spreadText}>
            Spread {spread === null ? '-' : formatPrice(spread, symbol)}
          </Text>
        </View>

        {bids.map((level) => (
          <BookRow
            key={`bid-${level.price}`}
            level={level}
            maxQuantity={maxQuantity}
            side="bid"
            symbol={symbol}
          />
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

type BookRowProps = {
  level: BookLevel;
  maxQuantity: number;
  side: BookSide;
  symbol: TradingSymbol;
};

function BookRow({ level, maxQuantity, side, symbol }: BookRowProps) {
  const depthPercent = maxQuantity > 0 ? Math.min(100, (level.quantity / maxQuantity) * 100) : 0;
  const width = `${Math.max(1, depthPercent)}%` as DimensionValue;
  const isBid = side === 'bid';

  return (
    <View style={styles.row}>
      <View
        pointerEvents="none"
        style={[styles.depthBar, isBid ? styles.bidDepth : styles.askDepth, { width }]}
      />
      <Text style={[styles.rowText, styles.priceColumn, isBid ? styles.bidText : styles.askText]}>
        {formatPrice(level.price, symbol)}
      </Text>
      <Text style={styles.rowText}>{formatQuantity(level.quantity)}</Text>
      <Text style={[styles.rowText, styles.totalColumn]}>{formatQuantity(level.total)}</Text>
    </View>
  );
}

function normalizeDepthEvent(payload: unknown): DepthEvent | null {
  const maybeCombined = payload as { data?: unknown };
  const data = (maybeCombined.data ?? payload) as Partial<DepthEvent>;

  if (
    typeof data.U !== 'number' ||
    typeof data.u !== 'number' ||
    !Array.isArray(data.b) ||
    !Array.isArray(data.a)
  ) {
    return null;
  }

  return {
    U: data.U,
    u: data.u,
    pu: data.pu,
    b: data.b as [string, string][],
    a: data.a as [string, string][],
  };
}

function hydrateBook(book: Map<number, number>, levels: [string, string][]) {
  levels.forEach(([priceValue, quantityValue]) => {
    const price = Number(priceValue);
    const quantity = Number(quantityValue);

    if (price > 0 && quantity > 0) {
      book.set(price, quantity);
    }
  });
}

function applyUpdates(book: Map<number, number>, updates: [string, string][]) {
  updates.forEach(([priceValue, quantityValue]) => {
    const price = Number(priceValue);
    const quantity = Number(quantityValue);

    if (!Number.isFinite(price)) {
      return;
    }

    if (quantity === 0) {
      book.delete(price);
      return;
    }

    if (quantity > 0) {
      book.set(price, quantity);
    }
  });
}

function toSortedEntries(book: Map<number, number>, side: BookSide): BookEntry[] {
  return [...book.entries()].sort(([firstPrice], [secondPrice]) =>
    side === 'bid' ? secondPrice - firstPrice : firstPrice - secondPrice
  );
}

function toPriceBuckets(entries: BookEntry[], side: BookSide, priceStep: number): BookLevel[] {
  let runningTotal = 0;
  const buckets = new Map<number, number>();

  entries.forEach(([price, quantity]) => {
    const bucketPrice =
      side === 'bid'
        ? Math.floor(price / priceStep) * priceStep
        : Math.ceil(price / priceStep) * priceStep;

    buckets.set(bucketPrice, (buckets.get(bucketPrice) ?? 0) + quantity);
  });

  const sortedEntries = [...buckets.entries()].sort(([firstPrice], [secondPrice]) =>
    side === 'bid' ? secondPrice - firstPrice : firstPrice - secondPrice
  );

  return sortedEntries.slice(0, MAX_VISIBLE_ROWS).map(([price, quantity]) => {
    runningTotal += quantity;

    return {
      price,
      quantity,
      total: runningTotal,
    };
  });
}

function midPrice(asks: BookLevel[], bids: BookLevel[]): number | null {
  const bestAsk = asks[0]?.price;
  const bestBid = bids[0]?.price;

  if (!bestAsk || !bestBid) {
    return null;
  }

  return (bestAsk + bestBid) / 2;
}

function parsePriceStep(value: string): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return Number(DEFAULT_PRICE_STEP);
  }

  return parsed;
}

function normalizePriceStepInput(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^0-9.]/g, '');
  const [integerPart, ...decimalParts] = normalized.split('.');

  if (decimalParts.length === 0) {
    return integerPart;
  }

  return `${integerPart}.${decimalParts.join('').slice(0, 8)}`;
}

function formatSymbol(symbol: TradingSymbol): string {
  return symbol.endsWith('USDT') ? symbol.replace('USDT', '/USDT') : symbol;
}

function formatPrice(value: number | null, symbol?: TradingSymbol): string {
  if (value === null || Number.isNaN(value)) {
    return '-';
  }

  const decimals = symbol?.includes('BTC') || symbol?.includes('ETH') ? 2 : 4;
  return value.toFixed(decimals);
}

function formatQuantity(value: number): string {
  if (value >= 1000) {
    return `${(value / 1000).toFixed(2)}k`;
  }

  if (value >= 10) {
    return value.toFixed(2);
  }

  return value.toFixed(4);
}

function statusLabel(status: ConnectionStatus): string {
  switch (status) {
    case 'live':
      return 'LIVE';
    case 'reconnecting':
      return 'RECONNECT';
    case 'offline':
      return 'OFFLINE';
    default:
      return 'CONNECTING';
  }
}

const styles = StyleSheet.create({
  screen: {
    backgroundColor: '#120b1e',
    flex: 1,
  },
  header: {
    alignItems: 'center',
    borderBottomColor: '#2a1d3e',
    borderBottomWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  appName: {
    color: '#f4efff',
    fontSize: 22,
    fontWeight: '800',
  },
  subtitle: {
    color: '#8b7aa7',
    fontSize: 12,
    marginTop: 2,
  },
  statusPill: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  statusLive: {
    backgroundColor: '#1f6f5b',
  },
  statusOff: {
    backgroundColor: '#3a284e',
  },
  statusText: {
    color: '#ffffff',
    fontSize: 11,
    fontWeight: '800',
  },
  controls: {
    gap: 10,
    paddingHorizontal: 12,
    paddingTop: 12,
    zIndex: 2,
  },
  marketTabs: {
    backgroundColor: '#1b102c',
    borderColor: '#2b1c43',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    gap: 6,
    padding: 5,
  },
  marketTab: {
    alignItems: 'center',
    borderRadius: 6,
    flex: 1,
    paddingVertical: 9,
  },
  marketTabActive: {
    backgroundColor: '#3b2a59',
  },
  marketTabDisabled: {
    opacity: 0.35,
  },
  marketText: {
    color: '#9b8db4',
    fontSize: 13,
    fontWeight: '800',
  },
  marketTextActive: {
    color: '#ffffff',
  },
  marketTextDisabled: {
    color: '#625571',
  },
  selectorRow: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    gap: 10,
    zIndex: 3,
  },
  symbolSelector: {
    flex: 1,
    zIndex: 4,
  },
  dropdownButton: {
    alignItems: 'center',
    backgroundColor: '#1b102c',
    borderColor: '#2b1c43',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    minHeight: 48,
    paddingHorizontal: 14,
  },
  dropdownLabel: {
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
  },
  dropdownChevron: {
    color: '#66d5c6',
    fontSize: 12,
    fontWeight: '900',
  },
  dropdownMenu: {
    backgroundColor: '#1b102c',
    borderColor: '#382652',
    borderRadius: 8,
    borderWidth: 1,
    left: 0,
    marginTop: 6,
    overflow: 'hidden',
    position: 'absolute',
    right: 0,
    top: 48,
    zIndex: 5,
  },
  symbolSearch: {
    borderBottomColor: '#2b1c43',
    borderBottomWidth: 1,
    color: '#ffffff',
    fontSize: 14,
    minHeight: 42,
    paddingHorizontal: 12,
  },
  symbolList: {
    maxHeight: 230,
  },
  symbolOption: {
    borderBottomColor: '#241733',
    borderBottomWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 11,
  },
  symbolOptionActive: {
    backgroundColor: '#2c2141',
  },
  symbolOptionText: {
    color: '#d7cfea',
    fontSize: 14,
    fontWeight: '800',
  },
  symbolOptionTextActive: {
    color: '#66d5c6',
  },
  rangeInputWrap: {
    width: 112,
  },
  inputLabel: {
    color: '#75688c',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 4,
  },
  rangeInput: {
    backgroundColor: '#1b102c',
    borderColor: '#2b1c43',
    borderRadius: 8,
    borderWidth: 1,
    color: '#ffffff',
    fontSize: 16,
    fontWeight: '900',
    minHeight: 48,
    paddingHorizontal: 12,
    textAlign: 'center',
  },
  applyButton: {
    alignItems: 'center',
    backgroundColor: '#2f2445',
    borderColor: '#40305e',
    borderRadius: 8,
    borderWidth: 1,
    marginTop: 6,
    minHeight: 34,
    justifyContent: 'center',
  },
  applyButtonText: {
    color: '#66d5c6',
    fontSize: 12,
    fontWeight: '900',
  },
  metaRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
    zIndex: 1,
  },
  metaText: {
    color: '#75688c',
    fontSize: 12,
    fontWeight: '700',
  },
  columns: {
    borderBottomColor: '#2a1d3e',
    borderBottomWidth: 1,
    borderTopColor: '#2a1d3e',
    borderTopWidth: 1,
    flexDirection: 'row',
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  columnText: {
    color: '#75688c',
    flex: 1,
    fontSize: 12,
    fontWeight: '800',
    textAlign: 'right',
  },
  priceColumn: {
    textAlign: 'left',
  },
  totalColumn: {
    paddingRight: 6,
  },
  book: {
    paddingBottom: 18,
  },
  row: {
    flexDirection: 'row',
    minHeight: 28,
    overflow: 'hidden',
    paddingHorizontal: 14,
    position: 'relative',
  },
  depthBar: {
    bottom: 2,
    position: 'absolute',
    right: 8,
    top: 2,
  },
  askDepth: {
    backgroundColor: 'rgba(238, 91, 104, 0.32)',
  },
  bidDepth: {
    backgroundColor: 'rgba(74, 190, 174, 0.34)',
  },
  rowText: {
    color: '#d7cfea',
    flex: 1,
    fontSize: 13,
    fontVariant: ['tabular-nums'],
    lineHeight: 28,
    textAlign: 'right',
  },
  askText: {
    color: '#ff737f',
  },
  bidText: {
    color: '#62d0c0',
  },
  spreadRow: {
    alignItems: 'center',
    backgroundColor: '#170f25',
    borderBottomColor: '#2a1d3e',
    borderBottomWidth: 1,
    borderTopColor: '#2a1d3e',
    borderTopWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  spreadPrice: {
    color: '#f4efff',
    fontSize: 20,
    fontWeight: '900',
  },
  spreadText: {
    color: '#8b7aa7',
    fontSize: 12,
    fontWeight: '700',
  },
});
