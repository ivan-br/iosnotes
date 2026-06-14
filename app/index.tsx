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

type ExchangeType = 'binance' | 'bybit';
type MarketType = 'spot' | 'futures';
type AppView = 'book' | 'ratio';
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

type RatioPoint = {
  timestamp: number;
  longRatio: number;
  shortRatio: number;
  longShortRatio: number;
};

type RatioState = {
  global: RatioPoint[];
  topPositions: RatioPoint[];
  status: ConnectionStatus;
};

type BinanceDepthSnapshot = {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
};

type BinanceDepthEvent = {
  U: number;
  u: number;
  pu?: number;
  b: [string, string][];
  a: [string, string][];
};

type BinanceExchangeInfo = {
  symbols?: {
    symbol: string;
    status?: string;
    contractStatus?: string;
  }[];
};

type BinanceRatioItem = {
  timestamp: string;
  longAccount: string;
  shortAccount: string;
  longShortRatio: string;
};

type BybitInstrumentsInfo = {
  retCode?: number;
  result?: {
    nextPageCursor?: string;
    list?: {
      symbol: string;
      status?: string;
    }[];
  };
};

type BybitOrderbookSnapshot = {
  retCode?: number;
  result?: {
    u?: number;
    b?: [string, string][];
    a?: [string, string][];
  };
};

type BybitDepthMessage = {
  topic?: string;
  type?: 'snapshot' | 'delta';
  data?: {
    u?: number;
    b?: [string, string][];
    a?: [string, string][];
  };
};

type BybitRatioResponse = {
  retCode?: number;
  result?: {
    list?: {
      timestamp: string;
      buyRatio: string;
      sellRatio: string;
    }[];
  };
};

const EXCHANGES: ExchangeType[] = ['binance', 'bybit'];
const MARKETS: MarketType[] = ['spot', 'futures'];
const VIEWS: AppView[] = ['book', 'ratio'];
const DEFAULT_SYMBOL = 'BTCUSDT';
const DEFAULT_PRICE_STEP = '200';
const MAX_VISIBLE_ROWS = 64;
const RATIO_PERIOD = '5m';
const BYBIT_RATIO_PERIOD = '5min';

const EXCHANGE_LABELS: Record<ExchangeType, string> = {
  binance: 'Binance',
  bybit: 'Bybit',
};

const MARKET_LABELS: Record<MarketType, string> = {
  spot: 'Spot',
  futures: 'Futures',
};

const VIEW_LABELS: Record<AppView, string> = {
  book: 'Book',
  ratio: 'Long/Short',
};

const DEFAULT_SYMBOLS: Record<ExchangeType, Record<MarketType, TradingSymbol[]>> = {
  binance: {
    spot: [DEFAULT_SYMBOL, 'ETHUSDT', 'SOLUSDT'],
    futures: [DEFAULT_SYMBOL, 'ETHUSDT', 'SOLUSDT'],
  },
  bybit: {
    spot: [DEFAULT_SYMBOL, 'ETHUSDT', 'SOLUSDT'],
    futures: [DEFAULT_SYMBOL, 'ETHUSDT', 'SOLUSDT'],
  },
};

const DEFAULT_AVAILABILITY: Record<ExchangeType, Record<MarketType, MarketAvailability>> = {
  binance: {
    spot: 'loading',
    futures: 'loading',
  },
  bybit: {
    spot: 'loading',
    futures: 'loading',
  },
};

export default function OrderBookScreen() {
  const [exchange, setExchange] = useState<ExchangeType>('binance');
  const [market, setMarket] = useState<MarketType>('spot');
  const [view, setView] = useState<AppView>('book');
  const [symbolsByVenue, setSymbolsByVenue] = useState(DEFAULT_SYMBOLS);
  const [marketAvailability, setMarketAvailability] = useState(DEFAULT_AVAILABILITY);
  const [symbol, setSymbol] = useState<TradingSymbol>(DEFAULT_SYMBOL);
  const [isSymbolMenuOpen, setIsSymbolMenuOpen] = useState(false);
  const [symbolFilter, setSymbolFilter] = useState('');
  const [draftPriceStepInput, setDraftPriceStepInput] = useState(DEFAULT_PRICE_STEP);
  const [priceStepInput, setPriceStepInput] = useState(DEFAULT_PRICE_STEP);
  const [rawBids, setRawBids] = useState<BookEntry[]>([]);
  const [rawAsks, setRawAsks] = useState<BookEntry[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('connecting');
  const [lastUpdateId, setLastUpdateId] = useState<number | null>(null);
  const [ratioState, setRatioState] = useState<RatioState>({
    global: [],
    topPositions: [],
    status: 'connecting',
  });

  const priceStep = parsePriceStep(priceStepInput);
  const bids = useMemo(() => toPriceBuckets(rawBids, 'bid', priceStep), [priceStep, rawBids]);
  const asks = useMemo(() => toPriceBuckets(rawAsks, 'ask', priceStep), [priceStep, rawAsks]);
  const availableSymbols = symbolsByVenue[exchange][market];
  const futuresSymbols = symbolsByVenue[exchange].futures;
  const ratioSymbol = futuresSymbols.includes(symbol)
    ? symbol
    : futuresSymbols.includes(DEFAULT_SYMBOL)
      ? DEFAULT_SYMBOL
      : futuresSymbols[0] ?? DEFAULT_SYMBOL;
  const filteredSymbols = useMemo(
    () =>
      availableSymbols
        .filter((item) => item.includes(symbolFilter.trim().toUpperCase()))
        .slice(0, 80),
    [availableSymbols, symbolFilter]
  );

  useEffect(() => {
    let isActive = true;

    async function loadAllSymbols() {
      await Promise.all(
        EXCHANGES.flatMap((nextExchange) =>
          MARKETS.map(async (nextMarket) => {
            try {
              const nextSymbols = await fetchSymbols(nextExchange, nextMarket);

              if (!isActive) {
                return;
              }

              if (nextSymbols.length === 0) {
                setMarketAvailability((current) => updateVenueValue(current, nextExchange, nextMarket, 'unavailable'));
                return;
              }

              setMarketAvailability((current) => updateVenueValue(current, nextExchange, nextMarket, 'available'));
              setSymbolsByVenue((current) => updateVenueValue(current, nextExchange, nextMarket, nextSymbols));
            } catch {
              if (isActive) {
                setMarketAvailability((current) => updateVenueValue(current, nextExchange, nextMarket, 'unavailable'));
              }
            }
          })
        )
      );
    }

    loadAllSymbols();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (marketAvailability[exchange][market] === 'unavailable') {
      setMarket('spot');
      return;
    }

    const nextSymbols = symbolsByVenue[exchange][market];

    if (!nextSymbols.includes(symbol)) {
      setSymbol(nextSymbols.includes(DEFAULT_SYMBOL) ? DEFAULT_SYMBOL : nextSymbols[0] ?? DEFAULT_SYMBOL);
    }
  }, [exchange, market, marketAvailability, symbol, symbolsByVenue]);

  useEffect(() => {
    let socket: WebSocket | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let isActive = true;
    let isInitialized = false;
    let localUpdateId = 0;
    let eventBuffer: BinanceDepthEvent[] = [];
    const bidBook = new Map<number, number>();
    const askBook = new Map<number, number>();

    function connect() {
      setStatus((current) => (current === 'offline' ? 'reconnecting' : 'connecting'));

      socket = new WebSocket(getStreamUrl(exchange, market, symbol));

      socket.onopen = () => {
        if (exchange === 'bybit') {
          loadInitialSnapshot().finally(() => {
            if (isActive) {
              socket?.send(JSON.stringify({ op: 'subscribe', args: [`orderbook.1000.${symbol}`] }));
            }
          });
          return;
        }

        loadInitialSnapshot();
      };

      socket.onmessage = (event) => {
        if (!isActive) {
          return;
        }

        try {
          const payload = JSON.parse(event.data);

          if (exchange === 'bybit') {
            applyBybitMessage(payload);
            return;
          }

          const depthEvent = normalizeBinanceDepthEvent(payload);

          if (!depthEvent) {
            return;
          }

          if (!isInitialized) {
            eventBuffer.push(depthEvent);
            return;
          }

          applyBinanceDepthEvent(depthEvent);
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

    async function loadInitialSnapshot() {
      try {
        const snapshot = await fetchOrderbookSnapshot(exchange, market, symbol);

        if (!isActive) {
          return;
        }

        bidBook.clear();
        askBook.clear();
        hydrateBook(bidBook, snapshot.bids);
        hydrateBook(askBook, snapshot.asks);
        localUpdateId = snapshot.lastUpdateId;

        if (exchange === 'binance') {
          const usableEvents = eventBuffer.filter((item) => item.u > snapshot.lastUpdateId);
          eventBuffer = [];

          for (const bufferedEvent of usableEvents) {
            applyBinanceDepthEvent(bufferedEvent, true);
          }
        } else {
          eventBuffer = [];
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

    function applyBinanceDepthEvent(depthEvent: BinanceDepthEvent, isBuffered = false) {
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

    function applyBybitMessage(payload: unknown) {
      const depthMessage = normalizeBybitDepthMessage(payload);

      if (!depthMessage) {
        return;
      }

      if (depthMessage.type === 'snapshot') {
        bidBook.clear();
        askBook.clear();
        hydrateBook(bidBook, depthMessage.data?.b ?? []);
        hydrateBook(askBook, depthMessage.data?.a ?? []);
      } else {
        applyUpdates(bidBook, depthMessage.data?.b ?? []);
        applyUpdates(askBook, depthMessage.data?.a ?? []);
      }

      localUpdateId = depthMessage.data?.u ?? localUpdateId;
      isInitialized = true;
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
  }, [exchange, market, symbol]);

  useEffect(() => {
    let isActive = true;
    let refreshTimer: ReturnType<typeof setInterval> | null = null;

    async function loadRatioData() {
      setRatioState((current) => ({ ...current, status: current.status === 'offline' ? 'reconnecting' : 'connecting' }));

      try {
        const nextRatioState = await fetchRatioState(exchange, ratioSymbol);

        if (!isActive) {
          return;
        }

        setRatioState({ ...nextRatioState, status: 'live' });
      } catch {
        if (isActive) {
          setRatioState((current) => ({ ...current, status: 'offline' }));
        }
      }
    }

    if (view === 'ratio') {
      loadRatioData();
      refreshTimer = setInterval(loadRatioData, 30000);
    }

    return () => {
      isActive = false;

      if (refreshTimer) {
        clearInterval(refreshTimer);
      }
    };
  }, [exchange, ratioSymbol, view]);

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

  function selectExchange(nextExchange: ExchangeType) {
    setExchange(nextExchange);
    setSymbolFilter('');
    setIsSymbolMenuOpen(false);
  }

  function selectMarket(nextMarket: MarketType) {
    if (marketAvailability[exchange][nextMarket] !== 'available') {
      return;
    }

    setMarket(nextMarket);
    setSymbolFilter('');
    setIsSymbolMenuOpen(false);
  }

  function selectSymbol(nextSymbol: TradingSymbol) {
    setSymbol(nextSymbol);
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
          <Text style={styles.subtitle}>{EXCHANGE_LABELS[exchange]} market data</Text>
        </View>
        <View style={[styles.statusPill, activeStatus(view, status, ratioState.status) === 'live' ? styles.statusLive : styles.statusOff]}>
          <Text style={styles.statusText}>{statusLabel(activeStatus(view, status, ratioState.status))}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <SegmentedTabs
          items={EXCHANGES}
          labels={EXCHANGE_LABELS}
          selected={exchange}
          onSelect={selectExchange}
        />
        <SegmentedTabs items={VIEWS} labels={VIEW_LABELS} selected={view} onSelect={setView} />

        <View style={styles.marketTabs}>
          {MARKETS.map((item) => {
            const isDisabled = marketAvailability[exchange][item] !== 'available';

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
                  {MARKET_LABELS[item]}
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

          {view === 'book' ? (
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
          ) : (
            <View />
          )}
        </View>

      </View>

      {view === 'book' ? (
        <OrderBookView
          asks={asks}
          bids={bids}
          exchange={exchange}
          lastUpdateId={lastUpdateId}
          market={market}
          maxQuantity={maxQuantity}
          priceStep={priceStep}
          spread={spread}
          symbol={symbol}
        />
      ) : (
        <LongShortView
          exchange={exchange}
          ratioState={ratioState}
          symbol={ratioSymbol}
        />
      )}
    </SafeAreaView>
  );
}

type SegmentedTabsProps<T extends string> = {
  items: T[];
  labels: Record<T, string>;
  selected: T;
  onSelect: (item: T) => void;
};

function SegmentedTabs<T extends string>({ items, labels, selected, onSelect }: SegmentedTabsProps<T>) {
  return (
    <View style={styles.marketTabs}>
      {items.map((item) => (
        <Pressable
          key={item}
          onPress={() => onSelect(item)}
          style={[styles.marketTab, selected === item && styles.marketTabActive]}
        >
          <Text style={[styles.marketText, selected === item && styles.marketTextActive]}>
            {labels[item]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

type OrderBookViewProps = {
  asks: BookLevel[];
  bids: BookLevel[];
  exchange: ExchangeType;
  lastUpdateId: number | null;
  market: MarketType;
  maxQuantity: number;
  priceStep: number;
  spread: number | null;
  symbol: TradingSymbol;
};

function OrderBookView({
  asks,
  bids,
  exchange,
  lastUpdateId,
  market,
  maxQuantity,
  priceStep,
  spread,
  symbol,
}: OrderBookViewProps) {
  return (
    <>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{EXCHANGE_LABELS[exchange]}</Text>
        <Text style={styles.metaText}>{MARKET_LABELS[market]}</Text>
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
    </>
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

type LongShortViewProps = {
  exchange: ExchangeType;
  ratioState: RatioState;
  symbol: TradingSymbol;
};

function LongShortView({ exchange, ratioState, symbol }: LongShortViewProps) {
  const latest = ratioState.global.at(-1);

  return (
    <ScrollView contentContainerStyle={styles.ratioContent} showsVerticalScrollIndicator={false}>
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>{EXCHANGE_LABELS[exchange]}</Text>
        <Text style={styles.metaText}>{formatSymbol(symbol)}</Text>
        <Text style={styles.metaText}>{statusLabel(ratioState.status)}</Text>
      </View>

      <RatioChart
        longLabel="Long Position %"
        points={ratioState.topPositions}
        ratioLabel="Long/Short Ratio (Positions)"
        shortLabel="Short Position %"
        subtitle="By Positions"
        title="Top Traders Position Ratio"
      />

      <RatioChart
        longLabel="Long Position %"
        points={ratioState.global}
        ratioLabel="Long/Short Ratio"
        shortLabel="Short Position %"
        subtitle={exchange === 'binance' ? 'All Positions' : 'All Position Holders'}
        title="All Positions Ratio"
      />

      <View style={styles.ratioSummary}>
        <View>
          <Text style={styles.summaryLabel}>Current Long</Text>
          <Text style={styles.summaryLong}>{latest ? formatPercent(latest.longRatio) : '-'}</Text>
        </View>
        <View>
          <Text style={styles.summaryLabel}>Current Short</Text>
          <Text style={styles.summaryShort}>{latest ? formatPercent(latest.shortRatio) : '-'}</Text>
        </View>
        <View>
          <Text style={styles.summaryLabel}>Ratio</Text>
          <Text style={styles.summaryValue}>{latest ? latest.longShortRatio.toFixed(3) : '-'}</Text>
        </View>
      </View>
    </ScrollView>
  );
}

type RatioChartProps = {
  longLabel: string;
  points: RatioPoint[];
  ratioLabel: string;
  shortLabel: string;
  subtitle: string;
  title: string;
};

function RatioChart({ longLabel, points, ratioLabel, shortLabel, subtitle, title }: RatioChartProps) {
  const visiblePoints = points.slice(-30);
  const ratios = visiblePoints.map((point) => point.longShortRatio);
  const minRatio = Math.min(...ratios, 1);
  const maxRatio = Math.max(...ratios, 1);

  return (
    <View style={styles.ratioSection}>
      <View style={styles.ratioHeader}>
        <View>
          <Text style={styles.ratioTitle}>{title}</Text>
          <Text style={styles.ratioSubtitle}>{subtitle}</Text>
        </View>
        <Text style={styles.shareGlyph}>⌁</Text>
      </View>

      <View style={styles.chart}>
        <View style={styles.gridLineTop} />
        <View style={styles.gridLineMid} />
        <View style={styles.gridLineBottom} />
        <Text style={[styles.axisLabel, styles.axisTop]}>100%</Text>
        <Text style={[styles.axisLabel, styles.axisMiddle]}>50%</Text>
        <Text style={[styles.axisLabel, styles.axisBottom]}>0%</Text>

        {visiblePoints.length === 0 ? (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>No public data</Text>
          </View>
        ) : (
          <View style={styles.chartBars}>
            {visiblePoints.map((point) => {
              const longHeight = `${Math.max(2, point.longRatio * 100)}%` as DimensionValue;
              const shortHeight = `${Math.max(2, point.shortRatio * 100)}%` as DimensionValue;
              const ratioRange = maxRatio - minRatio || 1;
              const ratioTop = `${Math.max(0, Math.min(88, 88 - ((point.longShortRatio - minRatio) / ratioRange) * 70))}%` as DimensionValue;

              return (
                <View key={`${title}-${point.timestamp}`} style={styles.ratioColumn}>
                  <View style={[styles.ratioLineDot, { top: ratioTop }]} />
                  <View style={[styles.shortRatioBar, { height: shortHeight }]} />
                  <View style={[styles.longRatioBar, { height: longHeight }]} />
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.shortLegend]} />
          <Text style={styles.legendText}>{shortLabel}</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.longLegend]} />
          <Text style={styles.legendText}>{longLabel}</Text>
        </View>
      </View>
      <View style={styles.legendItemCenter}>
        <View style={styles.ratioLineSample} />
        <Text style={styles.legendText}>{ratioLabel}</Text>
      </View>
    </View>
  );
}

async function fetchSymbols(exchange: ExchangeType, market: MarketType): Promise<TradingSymbol[]> {
  if (exchange === 'binance') {
    const url =
      market === 'spot'
        ? 'https://api.binance.com/api/v3/exchangeInfo'
        : 'https://fapi.binance.com/fapi/v1/exchangeInfo';
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const exchangeInfo = (await response.json()) as BinanceExchangeInfo;

    return (exchangeInfo.symbols ?? [])
      .filter((item) =>
        market === 'spot'
          ? item.status === 'TRADING'
          : (item.contractStatus ?? item.status) === 'TRADING'
      )
      .map((item) => item.symbol)
      .sort();
  }

  const category = market === 'spot' ? 'spot' : 'linear';
  let cursor = '';
  const symbols: TradingSymbol[] = [];

  do {
    const url = `https://api.bybit.com/v5/market/instruments-info?category=${category}${cursor ? `&cursor=${cursor}` : ''}`;
    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = (await response.json()) as BybitInstrumentsInfo;

    if (data.retCode !== 0 || !data.result?.list) {
      break;
    }

    symbols.push(
      ...data.result.list
        .filter((item) => item.status === 'Trading')
        .map((item) => item.symbol)
    );
    cursor = data.result.nextPageCursor ?? '';
  } while (cursor);

  return [...new Set(symbols)].sort();
}

async function fetchOrderbookSnapshot(
  exchange: ExchangeType,
  market: MarketType,
  symbol: TradingSymbol
): Promise<BinanceDepthSnapshot> {
  if (exchange === 'binance') {
    const baseUrl =
      market === 'spot'
        ? 'https://api.binance.com/api/v3/depth'
        : 'https://fapi.binance.com/fapi/v1/depth';
    const limit = market === 'spot' ? 5000 : 1000;
    const response = await fetch(`${baseUrl}?symbol=${symbol}&limit=${limit}`);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return (await response.json()) as BinanceDepthSnapshot;
  }

  const category = market === 'spot' ? 'spot' : 'linear';
  const response = await fetch(
    `https://api.bybit.com/v5/market/orderbook?category=${category}&symbol=${symbol}&limit=1000`
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as BybitOrderbookSnapshot;

  if (data.retCode !== 0 || !data.result) {
    throw new Error('Invalid Bybit orderbook response');
  }

  return {
    lastUpdateId: data.result.u ?? 0,
    bids: data.result.b ?? [],
    asks: data.result.a ?? [],
  };
}

async function fetchRatioState(exchange: ExchangeType, symbol: TradingSymbol): Promise<Omit<RatioState, 'status'>> {
  if (exchange === 'binance') {
    const topUrl = `https://fapi.binance.com/futures/data/topLongShortPositionRatio?symbol=${symbol}&period=${RATIO_PERIOD}&limit=30`;
    const globalUrl = `https://fapi.binance.com/futures/data/globalLongShortAccountRatio?symbol=${symbol}&period=${RATIO_PERIOD}&limit=30`;
    const [topResponse, globalResponse] = await Promise.all([fetch(topUrl), fetch(globalUrl)]);

    if (!topResponse.ok || !globalResponse.ok) {
      throw new Error('Binance ratio request failed');
    }

    const topItems = (await topResponse.json()) as BinanceRatioItem[];
    const globalItems = (await globalResponse.json()) as BinanceRatioItem[];

    return {
      topPositions: mapBinanceRatio(topItems),
      global: mapBinanceRatio(globalItems),
    };
  }

  const response = await fetch(
    `https://api.bybit.com/v5/market/account-ratio?category=linear&symbol=${symbol}&period=${BYBIT_RATIO_PERIOD}&limit=30`
  );

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  const data = (await response.json()) as BybitRatioResponse;

  if (data.retCode !== 0 || !data.result?.list) {
    throw new Error('Bybit ratio request failed');
  }

  return {
    topPositions: [],
    global: data.result.list
      .map((item) => {
        const longRatio = Number(item.buyRatio);
        const shortRatio = Number(item.sellRatio);

        return {
          timestamp: Number(item.timestamp),
          longRatio,
          shortRatio,
          longShortRatio: shortRatio > 0 ? longRatio / shortRatio : 0,
        };
      })
      .filter(isFiniteRatioPoint)
      .sort((first, second) => first.timestamp - second.timestamp),
  };
}

function getStreamUrl(exchange: ExchangeType, market: MarketType, symbol: TradingSymbol): string {
  if (exchange === 'bybit') {
    return `wss://stream.bybit.com/v5/public/${market === 'spot' ? 'spot' : 'linear'}`;
  }

  if (market === 'spot') {
    return `wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth@100ms`;
  }

  return `wss://fstream.binance.com/public/stream?streams=${symbol.toLowerCase()}@depth@100ms`;
}

function normalizeBinanceDepthEvent(payload: unknown): BinanceDepthEvent | null {
  const maybeCombined = payload as { data?: unknown };
  const data = (maybeCombined.data ?? payload) as Partial<BinanceDepthEvent>;

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

function normalizeBybitDepthMessage(payload: unknown): BybitDepthMessage | null {
  const data = payload as BybitDepthMessage;

  if (
    !data.topic?.startsWith('orderbook.') ||
    (data.type !== 'snapshot' && data.type !== 'delta') ||
    !data.data
  ) {
    return null;
  }

  return data;
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

function mapBinanceRatio(items: BinanceRatioItem[]): RatioPoint[] {
  return items
    .map((item) => ({
      timestamp: Number(item.timestamp),
      longRatio: Number(item.longAccount),
      shortRatio: Number(item.shortAccount),
      longShortRatio: Number(item.longShortRatio),
    }))
    .filter(isFiniteRatioPoint)
    .sort((first, second) => first.timestamp - second.timestamp);
}

function isFiniteRatioPoint(point: RatioPoint): boolean {
  return (
    Number.isFinite(point.timestamp) &&
    Number.isFinite(point.longRatio) &&
    Number.isFinite(point.shortRatio) &&
    Number.isFinite(point.longShortRatio)
  );
}

function updateVenueValue<T>(
  current: Record<ExchangeType, Record<MarketType, T>>,
  exchange: ExchangeType,
  market: MarketType,
  value: T
): Record<ExchangeType, Record<MarketType, T>> {
  return {
    ...current,
    [exchange]: {
      ...current[exchange],
      [market]: value,
    },
  };
}

function activeStatus(view: AppView, bookStatus: ConnectionStatus, ratioStatus: ConnectionStatus) {
  return view === 'book' ? bookStatus : ratioStatus;
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

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
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
    justifyContent: 'center',
    marginTop: 6,
    minHeight: 34,
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
    borderRadius: 5,
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
  ratioContent: {
    paddingBottom: 24,
  },
  ratioSection: {
    borderBottomColor: '#2a1d3e',
    borderBottomWidth: 1,
    paddingHorizontal: 16,
    paddingVertical: 18,
  },
  ratioHeader: {
    alignItems: 'flex-start',
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  ratioTitle: {
    color: '#f4efff',
    fontSize: 18,
    fontWeight: '900',
  },
  ratioSubtitle: {
    color: '#8b7aa7',
    fontSize: 13,
    fontWeight: '700',
    marginTop: 6,
  },
  shareGlyph: {
    color: '#8b7aa7',
    fontSize: 20,
    fontWeight: '900',
  },
  chart: {
    height: 170,
    paddingLeft: 48,
    position: 'relative',
  },
  chartBars: {
    alignItems: 'flex-end',
    flexDirection: 'row',
    gap: 5,
    height: 140,
    justifyContent: 'center',
  },
  emptyChart: {
    alignItems: 'center',
    height: 140,
    justifyContent: 'center',
  },
  emptyChartText: {
    color: '#75688c',
    fontSize: 13,
    fontWeight: '800',
  },
  ratioColumn: {
    flexDirection: 'column',
    height: 140,
    justifyContent: 'flex-end',
    position: 'relative',
    width: 7,
  },
  shortRatioBar: {
    backgroundColor: '#ff3f63',
    borderTopLeftRadius: 3,
    borderTopRightRadius: 3,
    width: 7,
  },
  longRatioBar: {
    backgroundColor: '#19d184',
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    width: 7,
  },
  ratioLineDot: {
    backgroundColor: '#ffffff',
    borderRadius: 3,
    height: 5,
    left: 1,
    position: 'absolute',
    width: 5,
    zIndex: 2,
  },
  gridLineTop: {
    backgroundColor: '#2a1d3e',
    height: 1,
    left: 48,
    position: 'absolute',
    right: 0,
    top: 0,
  },
  gridLineMid: {
    backgroundColor: '#2a1d3e',
    height: 1,
    left: 48,
    position: 'absolute',
    right: 0,
    top: 70,
  },
  gridLineBottom: {
    backgroundColor: '#2a1d3e',
    height: 1,
    left: 48,
    position: 'absolute',
    right: 0,
    top: 140,
  },
  axisLabel: {
    color: '#8b7aa7',
    fontSize: 12,
    fontVariant: ['tabular-nums'],
    position: 'absolute',
    width: 42,
  },
  axisTop: {
    top: -7,
  },
  axisMiddle: {
    top: 63,
  },
  axisBottom: {
    top: 133,
  },
  legendRow: {
    flexDirection: 'row',
    gap: 20,
    justifyContent: 'center',
    marginTop: 8,
  },
  legendItem: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
  },
  legendItemCenter: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 7,
    justifyContent: 'center',
    marginTop: 12,
  },
  legendDot: {
    borderRadius: 3,
    height: 10,
    width: 10,
  },
  shortLegend: {
    backgroundColor: '#ff3f63',
  },
  longLegend: {
    backgroundColor: '#19d184',
  },
  ratioLineSample: {
    backgroundColor: '#ffffff',
    height: 2,
    width: 16,
  },
  legendText: {
    color: '#9b8db4',
    fontSize: 12,
    fontWeight: '700',
  },
  ratioSummary: {
    backgroundColor: '#1b102c',
    borderColor: '#2b1c43',
    borderRadius: 8,
    borderWidth: 1,
    flexDirection: 'row',
    justifyContent: 'space-between',
    margin: 16,
    padding: 14,
  },
  summaryLabel: {
    color: '#75688c',
    fontSize: 11,
    fontWeight: '800',
    marginBottom: 6,
  },
  summaryLong: {
    color: '#19d184',
    fontSize: 17,
    fontWeight: '900',
  },
  summaryShort: {
    color: '#ff3f63',
    fontSize: 17,
    fontWeight: '900',
  },
  summaryValue: {
    color: '#f4efff',
    fontSize: 17,
    fontWeight: '900',
  },
});
