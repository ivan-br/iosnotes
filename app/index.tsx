import {
  memo,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Keyboard, Pressable, Text, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { BookSession } from "../src/market/book-session";
import { useCatalogs, useForeground } from "../src/market/hooks";
import type { Exchange, Market, Status } from "../src/market/types";
import { SymbolPicker } from "../src/components/symbol-picker";
import { PriceStepInput } from "../src/components/price-step-input";
import { OrderBookView } from "../src/components/order-book-view";
import { LongShortView } from "../src/components/long-short-view";
import { styles } from "../src/components/styles";

type AppView = "book" | "ratio";
const exchanges: Exchange[] = ["binance", "bybit"];
const markets: Market[] = ["spot", "futures"];
const views: AppView[] = ["book", "ratio"];
const exchangeLabels = { binance: "Binance", bybit: "Bybit" };
const marketLabels = { spot: "Spot", futures: "Futures" };
const viewLabels = { book: "Book", ratio: "Long/Short" };
const noSubscribe = () => () => {};
const connecting = () => "connecting" as Status;

const Connection = memo(function Connection({
  session,
  ratioStatus,
  view,
  missingStatus,
}: {
  session: BookSession | null;
  ratioStatus: Status;
  view: AppView;
  missingStatus: Status;
}) {
  const bookStatus = useSyncExternalStore(
    session?.subscribeStatus ?? noSubscribe,
    session?.getStatus ?? connecting,
    session?.getStatus ?? connecting,
  );
  const status =
    view === "ratio" ? ratioStatus : session ? bookStatus : missingStatus;
  return (
    <View
      accessibilityLiveRegion="polite"
      style={[
        styles.statusPill,
        status === "live" ? styles.statusLive : styles.statusOff,
      ]}
    >
      <Text style={styles.statusText}>
        {status === "live"
          ? "LIVE"
          : status === "offline"
            ? "OFFLINE"
            : status === "reconnecting"
              ? "RECONNECT"
              : "CONNECTING"}
      </Text>
    </View>
  );
});

const FeedNotice = memo(function FeedNotice({
  session,
}: {
  session: BookSession;
}) {
  const notice = useSyncExternalStore(
    session.subscribeStatus,
    session.getNotice,
    session.getNotice,
  );
  return notice ? (
    <View style={styles.notice}>
      <Text selectable style={styles.noticeText}>
        {notice} · retrying
      </Text>
    </View>
  ) : null;
});

function Tabs<T extends string>({
  items,
  labels,
  selected,
  onSelect,
}: {
  items: T[];
  labels: Record<T, string>;
  selected: T;
  onSelect: (item: T) => void;
}) {
  return (
    <View style={styles.marketTabs}>
      {items.map((item) => (
        <Pressable
          key={item}
          accessibilityRole="button"
          accessibilityState={{ selected: selected === item }}
          style={[
            styles.marketTab,
            selected === item && styles.marketTabActive,
          ]}
          onPress={() => {
            Keyboard.dismiss();
            onSelect(item);
          }}
        >
          <Text
            style={[
              styles.marketText,
              selected === item && styles.marketTextActive,
            ]}
          >
            {labels[item]}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function OrderBookScreen() {
  const [exchange, setExchange] = useState<Exchange>("binance");
  const [market, setMarket] = useState<Market>("spot");
  const [view, setView] = useState<AppView>("book");
  const [symbol, setSymbol] = useState("BTCUSDT");
  const active = useForeground();
  const catalogs = useCatalogs(active);
  const bookCatalog = catalogs[exchange + ":" + market];
  const visibleMarket = view === "ratio" ? "futures" : market;
  const catalog = catalogs[exchange + ":" + visibleMarket];
  const instrument = bookCatalog.items.find((item) => item.symbol === symbol);
  const key = exchange + ":" + market + ":" + symbol;
  const ratioKey = exchange + ":" + symbol;
  const [ratioState, setRatioState] = useState<{ key: string; status: Status }>(
    { key: "", status: "connecting" },
  );
  const onRatioStatus = useMemo(
    () => (status: Status) => setRatioState({ key: ratioKey, status }),
    [ratioKey],
  );
  const session = useMemo(
    () =>
      instrument ? new BookSession({ exchange, market, instrument }) : null,
    [
      exchange,
      market,
      symbol,
      instrument?.tick,
      instrument?.lot,
      instrument?.base,
      instrument?.quote,
    ],
  );
  useEffect(() => {
    if (!session || !active) return;
    session.start();
    return () => session.stop();
  }, [session, active]);
  useEffect(() => {
    if (!active) Keyboard.dismiss();
  }, [active]);
  const available = catalog.items.some((item) => item.symbol === symbol);
  const notice =
    catalog.state === "error"
      ? "Market data unavailable. Retrying..."
      : catalog.state === "loading"
        ? "Loading symbols..."
        : !available
          ? symbol + " Not found"
          : catalog.error
            ? "Symbol catalog refresh failed. Retrying..."
            : null;

  return (
    <SafeAreaView style={styles.screen} onTouchStart={Keyboard.dismiss}>
      <View style={styles.header}>
        <View>
          <Text style={styles.appName}>OrderBook</Text>
          <Text style={styles.subtitle}>
            {exchangeLabels[exchange]} market data
          </Text>
        </View>
        <Connection
          session={session}
          view={view}
          missingStatus={catalog.state === "loading" ? "connecting" : "offline"}
          ratioStatus={
            ratioState.key === ratioKey && available
              ? ratioState.status
              : catalog.state === "loading" || available
                ? "connecting"
                : "offline"
          }
        />
      </View>
      <View style={styles.controls}>
        <Tabs
          items={exchanges}
          labels={exchangeLabels}
          selected={exchange}
          onSelect={setExchange}
        />
        <Tabs
          items={views}
          labels={viewLabels}
          selected={view}
          onSelect={setView}
        />
        <View style={styles.marketTabs}>
          {markets.map((item) => {
            const candidate = catalogs[exchange + ":" + item];
            const disabled =
              candidate.state === "ready" && !candidate.items.length;
            return (
              <Pressable
                key={item}
                accessibilityRole="button"
                accessibilityState={{
                  selected: visibleMarket === item,
                  disabled,
                }}
                disabled={disabled}
                style={[
                  styles.marketTab,
                  visibleMarket === item && styles.marketTabActive,
                  disabled && styles.marketTabDisabled,
                ]}
                onPress={() => {
                  Keyboard.dismiss();
                  setMarket(item);
                  if (view === "ratio" && item === "spot") setView("book");
                }}
              >
                <Text
                  style={[
                    styles.marketText,
                    visibleMarket === item && styles.marketTextActive,
                    disabled && styles.marketTextDisabled,
                  ]}
                >
                  {marketLabels[item]}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <View style={styles.selectorRow}>
          <SymbolPicker
            items={catalog.items}
            symbol={symbol}
            onSelect={setSymbol}
            active={active}
            closeKey={
              exchange + ":" + visibleMarket + ":" + view + ":" + symbol
            }
          />
          {view === "book" && session ? (
            <PriceStepInput key={key} session={session} />
          ) : null}
        </View>
      </View>
      {notice ? (
        <View style={styles.notice}>
          <Text
            selectable
            accessibilityLiveRegion="polite"
            style={styles.noticeText}
          >
            {notice}
          </Text>
        </View>
      ) : null}
      {view === "book" && session ? (
        <>
          <FeedNotice session={session} />
          <OrderBookView key={key} session={session} />
        </>
      ) : view === "ratio" && available ? (
        <LongShortView
          key={ratioKey}
          exchange={exchange}
          symbol={symbol}
          active={active}
          onStatus={onRatioStatus}
        />
      ) : (
        <View style={{ flex: 1 }} />
      )}
    </SafeAreaView>
  );
}
