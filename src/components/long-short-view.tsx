import { memo, useEffect, useState } from "react";
import {
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type DimensionValue,
} from "react-native";
import { ApiError, fetchRatio } from "../market/api";
import type { Exchange, Series, Status } from "../market/types";
import { styles } from "./styles";

function useSeries(
  exchange: Exchange,
  symbol: string,
  top: boolean,
  active: boolean,
): Series {
  const [series, setSeries] = useState<Series>({
    points: [],
    status: "connecting",
  });
  useEffect(() => {
    if (top && exchange === "bybit") {
      setSeries({ points: [], status: "offline", unsupported: true });
      return;
    }
    if (!active) {
      setSeries((previous) => ({ ...previous, status: "offline" }));
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const points = await fetchRatio(
          exchange,
          symbol,
          top,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        if (!points.length)
          throw new ApiError("No public data for this symbol");
        setSeries((previous) => {
          const unchanged =
            previous.points.length === points.length &&
            points.every((point, index) => {
              const old = previous.points[index];
              return (
                old.timestamp === point.timestamp &&
                old.long === point.long &&
                old.short === point.short &&
                old.ratio === point.ratio
              );
            });
          if (unchanged && previous.status === "live" && !previous.error)
            return previous;
          return {
            points: unchanged ? previous.points : points,
            status: "live",
          };
        });
        timer = setTimeout(load, 30000);
      } catch (error) {
        if (controller.signal.aborted) return;
        setSeries((previous) => ({
          ...previous,
          status: "offline",
          error: error instanceof Error ? error.message : "Request failed",
        }));
        timer = setTimeout(
          load,
          Math.max(30000, error instanceof ApiError ? error.retryAfter : 0),
        );
      }
    }
    setSeries((previous) => ({
      ...previous,
      status: "connecting",
      error: undefined,
    }));
    void load();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [active, exchange, symbol, top]);
  return series;
}

export const LongShortView = memo(function LongShortView({
  exchange,
  symbol,
  active,
  onStatus,
}: {
  exchange: Exchange;
  symbol: string;
  active: boolean;
  onStatus: (status: Status) => void;
}) {
  const top = useSeries(exchange, symbol, true, active),
    global = useSeries(exchange, symbol, false, active);
  const status =
    !top.unsupported && top.status !== "live" ? top.status : global.status;
  useEffect(() => {
    onStatus(status);
  }, [onStatus, status]);
  return (
    <ScrollView
      keyboardDismissMode="on-drag"
      contentContainerStyle={styles.ratioContent}
    >
      <View style={styles.metaRow}>
        <Text style={styles.metaText}>
          {exchange === "binance" ? "Binance" : "Bybit"}
        </Text>
        <Text style={styles.metaText}>{symbol}</Text>
        <Text style={styles.metaText}>Futures</Text>
      </View>
      <RatioChart
        title="Top Traders Position Ratio"
        subtitle="By Positions"
        series={top}
        metric="Position"
      />
      <RatioChart
        title="Long/Short Ratio"
        subtitle="All Accounts"
        series={global}
        metric="Account"
      />
    </ScrollView>
  );
});

const percent = (value: number) => `${(value * 100).toFixed(1)}%`;
const time = (timestamp: number) =>
  new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
function RatioChart({
  title,
  subtitle,
  series,
  metric,
}: {
  title: string;
  subtitle: string;
  series: Series;
  metric: string;
}) {
  const window = useWindowDimensions();
  const [measuredWidth, setWidth] = useState<number | null>(null);
  const width = measuredWidth ?? Math.max(1, window.width - 120);
  useEffect(() => setWidth(null), [window.width]);
  const points = series.points.slice(-30),
    latest = points.at(-1);
  const ratios = points.flatMap((point) =>
    point.ratio === null ? [] : [point.ratio],
  );
  const min = ratios.length ? Math.min(...ratios) : 0,
    max = ratios.length ? Math.max(...ratios) : 1;
  const padding = Math.max((max - min) * 0.05, 0.0001),
    lower = Math.max(0, min - padding),
    upper = max + padding;
  const y = (value: number) => 140 - ((value - lower) / (upper - lower)) * 140;
  return (
    <View style={styles.ratioSection}>
      <View style={styles.ratioHeader}>
        <View style={{ flex: 1 }}>
          <Text style={styles.ratioTitle}>{title}</Text>
          <Text style={styles.ratioSubtitle}>{subtitle}</Text>
        </View>
      </View>
      <View style={styles.chart}>
        <Text style={[styles.axisLabel, styles.axisTop]}>100%</Text>
        <Text style={[styles.axisLabel, styles.axisMiddle]}>50%</Text>
        <Text style={[styles.axisLabel, styles.axisBottom]}>0%</Text>
        {ratios.length ? (
          <>
            <Text
              style={[
                styles.axisLabel,
                styles.axisTop,
                {
                  left: "auto",
                  right: -3,
                  width: 38,
                  textAlign: "right",
                  fontSize: 10,
                },
              ]}
            >
              {upper.toFixed(3)}
            </Text>
            <Text
              style={[
                styles.axisLabel,
                styles.axisBottom,
                {
                  left: "auto",
                  right: -3,
                  width: 38,
                  textAlign: "right",
                  fontSize: 10,
                },
              ]}
            >
              {Math.max(0, lower).toFixed(3)}
            </Text>
          </>
        ) : null}
        {points.length ? (
          <View
            style={styles.chartBars}
            onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
          >
            {points.map((point) => (
              <View key={point.timestamp} style={styles.ratioColumn}>
                <View
                  style={[
                    styles.shortRatioBar,
                    { height: `${point.short * 100}%` as DimensionValue },
                  ]}
                />
                <View
                  style={[
                    styles.longRatioBar,
                    { height: `${point.long * 100}%` as DimensionValue },
                  ]}
                />
              </View>
            ))}
            <View
              pointerEvents="none"
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                right: 0,
                height: 140,
              }}
            >
              {points.slice(1).map((point, index) => {
                const previous = points[index];
                if (point.ratio === null || previous.ratio === null || !width)
                  return null;
                const x1 = ((index + 0.5) * width) / points.length,
                  x2 = ((index + 1.5) * width) / points.length;
                const y1 = y(previous.ratio),
                  y2 = y(point.ratio),
                  length = Math.hypot(x2 - x1, y2 - y1);
                return (
                  <View
                    key={point.timestamp}
                    style={{
                      position: "absolute",
                      left: (x1 + x2 - length) / 2,
                      top: (y1 + y2) / 2,
                      width: length,
                      height: 1,
                      backgroundColor: "#ffffff",
                      transform: [
                        { rotate: `${Math.atan2(y2 - y1, x2 - x1)}rad` },
                      ],
                    }}
                  />
                );
              })}
            </View>
          </View>
        ) : (
          <View style={styles.emptyChart}>
            <Text style={styles.emptyChartText}>
              {series.unsupported
                ? "Not published by Bybit"
                : series.status === "connecting"
                  ? "Loading..."
                  : "No public data"}
            </Text>
          </View>
        )}
        {points.length ? (
          <View
            style={{
              flexDirection: "row",
              justifyContent: "space-between",
              marginTop: 8,
            }}
          >
            <Text style={styles.legendText}>{time(points[0].timestamp)}</Text>
            <Text style={styles.legendText}>
              {time(points.at(-1)!.timestamp)}
            </Text>
          </View>
        ) : null}
      </View>
      <View style={styles.legendRow}>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.shortLegend]} />
          <Text style={styles.legendText}>Short {metric} %</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendDot, styles.longLegend]} />
          <Text style={styles.legendText}>Long {metric} %</Text>
        </View>
      </View>
      <View style={styles.legendItemCenter}>
        <View style={styles.ratioLineSample} />
        <Text style={styles.legendText}>Long/Short Ratio</Text>
      </View>
      {latest ? (
        <View
          style={[
            styles.ratioSummary,
            { margin: 0, marginTop: 14, flexWrap: "wrap", gap: 12 },
          ]}
        >
          <View>
            <Text style={styles.summaryLabel}>Long</Text>
            <Text style={styles.summaryLong}>{percent(latest.long)}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>Short</Text>
            <Text style={styles.summaryShort}>{percent(latest.short)}</Text>
          </View>
          <View>
            <Text style={styles.summaryLabel}>Ratio</Text>
            <Text style={styles.summaryValue}>
              {latest.ratio === null ? "N/A" : latest.ratio.toFixed(3)}
            </Text>
          </View>
        </View>
      ) : null}
      {latest ? (
        <Text style={[styles.ratioSubtitle, { fontSize: 11 }]}>
          Updated {time(latest.timestamp)}
          {series.status !== "live" ? " · Stale" : ""}
        </Text>
      ) : null}
      {series.error ? (
        <Text
          selectable
          style={{ color: "#ff737f", marginTop: 8, fontSize: 12 }}
        >
          {series.error}
        </Text>
      ) : null}
    </View>
  );
}
