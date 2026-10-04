import {
  memo,
  useCallback,
  useMemo,
  useRef,
  useSyncExternalStore,
} from "react";
import {
  FlatList,
  Keyboard,
  Text,
  View,
  type DimensionValue,
} from "react-native";
import type { BookSession } from "../market/book-session";
import { quantity } from "../market/decimal";
import type { Level } from "../market/types";
import { styles } from "./styles";

type Row = Level | { key: "spread"; mid: string; spread: string };
const BookRow = memo(function BookRow({
  level,
  max,
  lot,
}: {
  level: Level;
  max: number;
  lot: string;
}) {
  const width =
    `${max > 0 ? Math.min(100, (level.quantity / max) * 100) : 0}%` as DimensionValue;
  return (
    <View style={styles.row}>
      <View
        pointerEvents="none"
        style={[
          styles.depthBar,
          level.side === "bid" ? styles.bidDepth : styles.askDepth,
          { width },
        ]}
      />
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={[
          styles.rowText,
          styles.priceColumn,
          level.side === "bid" ? styles.bidText : styles.askText,
        ]}
      >
        {level.price}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={styles.rowText}
      >
        {quantity(level.quantity, lot)}
      </Text>
      <Text
        maxFontSizeMultiplier={1.2}
        numberOfLines={1}
        style={[styles.rowText, styles.totalColumn]}
      >
        {quantity(level.total, lot)}
      </Text>
    </View>
  );
});

export const OrderBookView = memo(function OrderBookView({
  session,
}: {
  session: BookSession;
}) {
  const data = useSyncExternalStore(
    session.subscribeData,
    session.getProjection,
    session.getProjection,
  );
  const list = useRef<FlatList<Row>>(null),
    centered = useRef(false),
    height = useRef(200);
  const rows = useMemo<Row[]>(
    () =>
      data
        ? [
            ...data.asks.slice().reverse(),
            { key: "spread", mid: data.mid, spread: data.spread },
            ...data.bids,
          ]
        : [],
    [data],
  );
  const askCount = data?.asks.length ?? 0;
  const renderRow = useCallback(
    ({ item }: { item: Row }) =>
      item.key === "spread" ? (
        <View style={styles.spreadRow}>
          <Text
            numberOfLines={1}
            maxFontSizeMultiplier={1.2}
            style={[styles.spreadPrice, { flex: 1 }]}
          >
            {(item as Extract<Row, { key: "spread" }>).mid}
          </Text>
          <Text style={styles.spreadText}>
            Spread {(item as Extract<Row, { key: "spread" }>).spread}
          </Text>
        </View>
      ) : (
        <BookRow
          level={item as Level}
          max={data?.maxQuantity ?? 0}
          lot={session.venue.instrument.lot}
        />
      ),
    [data?.maxQuantity, session],
  );
  return (
    <View style={{ flex: 1 }}>
      <View style={styles.metaRow}>
        <Text numberOfLines={1} style={styles.metaText}>
          {session.venue.exchange === "binance" ? "Binance" : "Bybit"}
        </Text>
        <Text style={styles.metaText}>
          {session.venue.market === "spot" ? "Spot" : "Futures"}
        </Text>
        <Text numberOfLines={1} style={[styles.metaText, { flexShrink: 1 }]}>
          Step {data?.step ?? "-"}
        </Text>
        <Text numberOfLines={1} style={[styles.metaText, { flexShrink: 1 }]}>
          #{data?.updateId ?? "-"}
        </Text>
      </View>
      <View style={styles.columns}>
        <Text style={[styles.columnText, styles.priceColumn]}>Price</Text>
        <Text style={styles.columnText}>Amount</Text>
        <Text style={[styles.columnText, styles.totalColumn]}>Total</Text>
      </View>
      <FlatList
        ref={list}
        data={rows}
        renderItem={renderRow}
        keyExtractor={(item) => item.key}
        style={{ flex: 1 }}
        contentContainerStyle={styles.book}
        initialNumToRender={18}
        maxToRenderPerBatch={18}
        windowSize={5}
        keyboardDismissMode="on-drag"
        onScrollBeginDrag={Keyboard.dismiss}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        getItemLayout={(_, index) => ({
          length: index === askCount ? 52 : 28,
          offset: index * 28 + (index > askCount ? 24 : 0),
          index,
        })}
        onLayout={(event) => {
          height.current = event.nativeEvent.layout.height;
        }}
        onContentSizeChange={() => {
          if (rows.length && !centered.current) {
            centered.current = true;
            list.current?.scrollToOffset({
              offset: Math.max(0, askCount * 28 - height.current / 2),
              animated: false,
            });
          }
        }}
        ListEmptyComponent={
          <Text style={{ color: "#9b8db4", padding: 16 }}>
            Waiting for synchronized market data...
          </Text>
        }
        ListFooterComponent={
          rows.length ? (
            <Text
              style={{
                color: "#75688c",
                fontSize: 11,
                textAlign: "center",
                padding: 8,
              }}
            >
              Loaded depth only · farther levels may be incomplete
            </Text>
          ) : null
        }
      />
    </View>
  );
});
