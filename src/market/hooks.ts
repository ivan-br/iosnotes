import { useEffect, useState } from "react";
import { AppState } from "react-native";
import { fetchCatalog, ApiError } from "./api";
import type { Instrument } from "./types";

export type Catalog = {
  items: Instrument[];
  state: "loading" | "ready" | "error";
  error?: string;
};
const empty: Catalog = { items: [], state: "loading" };
export function useForeground() {
  const [active, setActive] = useState(
    AppState.currentState === "active" || AppState.currentState == null,
  );
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) =>
      setActive(state === "active"),
    );
    return () => subscription.remove();
  }, []);
  return active;
}

export function useCatalogs(active: boolean) {
  const [catalogs, setCatalogs] = useState<Record<string, Catalog>>({
    "binance:spot": empty,
    "binance:futures": empty,
    "bybit:spot": empty,
    "bybit:futures": empty,
  });
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timers = new Set<ReturnType<typeof setTimeout>>();
    for (const exchange of ["binance", "bybit"] as const) {
      for (const market of ["spot", "futures"] as const) {
        const key = `${exchange}:${market}`;
        let attempts = 0;
        async function load() {
          try {
            const items = await fetchCatalog(
              exchange,
              market,
              controller.signal,
            );
            if (controller.signal.aborted) return;
            setCatalogs((current) => ({
              ...current,
              [key]: { items, state: "ready" },
            }));
            attempts = 0;
            schedule(600000);
          } catch (error) {
            if (controller.signal.aborted) return;
            const message =
              error instanceof Error ? error.message : "Catalog unavailable";
            setCatalogs((current) => ({
              ...current,
              [key]: {
                ...current[key],
                state: current[key].items.length ? "ready" : "error",
                error: message,
              },
            }));
            schedule(
              Math.max(
                error instanceof ApiError ? error.retryAfter : 0,
                Math.min(60000, 3000 * 2 ** Math.min(attempts++, 5)),
              ),
            );
          }
        }
        function schedule(delay: number) {
          const timer = setTimeout(() => {
            timers.delete(timer);
            void load();
          }, delay);
          timers.add(timer);
        }
        void load();
      }
    }
    return () => {
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
    };
  }, [active]);
  return catalogs;
}
