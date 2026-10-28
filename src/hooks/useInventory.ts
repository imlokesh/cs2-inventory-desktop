import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { cachedPrices, clearPriceCache, fetchInventory, runPriceQueue } from "../lib/api";
import { CURRENCIES, type CurrencyCode } from "../lib/currencies";
import { rarityRank } from "../lib/rarity";
import type { InventoryResponse, Price, PriceBasis, PriceState, Stack } from "../lib/types";

export function useInventory(currency: CurrencyCode, basis: PriceBasis) {
  const [data, setData] = useState<InventoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, PriceState>>({});
  const [pausedUntil, setPausedUntil] = useState(0);
  const [priceEpoch, setPriceEpoch] = useState(0);
  const cancelQueue = useRef<() => void>(() => {});

  const load = useCallback(async (id: string) => {
    cancelQueue.current();
    setLoading(true);
    setError(null);
    try {
      setData(await fetchInventory(id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  // (Re)price whenever the inventory or currency changes.
  useEffect(() => {
    if (!data) return;
    const currencyId = CURRENCIES[currency];

    // Price the rarest items first so the headline total converges quickly.
    const marketable = new Map<string, number>();
    for (const item of data.items) {
      if (item.marketable) marketable.set(item.marketHashName, Math.max(marketable.get(item.marketHashName) ?? -1, rarityRank(item.rarity)));
    }
    const names = [...marketable.entries()].sort((a, b) => b[1] - a[1]).map(([n]) => n);

    let cancelled = false;
    setPrices(Object.fromEntries(names.map((n) => [n, { status: "pending" }])));
    setPausedUntil(0);

    void cachedPrices(currencyId, names)
      .catch(() => ({}) as Record<string, Price>)
      .then((cached) => {
        if (cancelled) return;
        const initial: Record<string, PriceState> = {};
        const missing: string[] = [];
        for (const name of names) {
          const hit = cached[name];
          if (hit) initial[name] = { status: "done", ...hit };
          else {
            initial[name] = { status: "pending" };
            missing.push(name);
          }
        }
        setPrices(initial);
        cancelQueue.current = runPriceQueue(currencyId, missing, {
          onPrice: (name, price) => setPrices((p) => ({ ...p, [name]: { status: "done", ...price } })),
          onError: (name) => setPrices((p) => ({ ...p, [name]: { status: "error" } })),
          onPause: setPausedUntil,
        });
      });

    return () => {
      cancelled = true;
      cancelQueue.current();
    };
  }, [data, currency, priceEpoch]);

  const refreshPrices = useCallback(async () => {
    await clearPriceCache().catch(() => {});
    setPriceEpoch((n) => n + 1);
  }, []);

  const stacks = useMemo<Stack[]>(() => {
    if (!data) return [];
    const map = new Map<string, Stack>();
    for (const item of data.items) {
      const existing = map.get(item.marketHashName);
      if (existing) {
        existing.quantity += item.amount;
        existing.tradable += item.tradable ? item.amount : 0;
        continue;
      }
      map.set(item.marketHashName, {
        key: item.marketHashName,
        item,
        quantity: item.amount,
        tradable: item.tradable ? item.amount : 0,
        unitPrice: null,
        total: null,
        volume: 0,
        priceStatus: item.marketable ? "pending" : "unmarketable",
      });
    }
    for (const stack of map.values()) {
      const p = prices[stack.key];
      if (!stack.item.marketable || !p) continue;
      stack.priceStatus = p.status;
      if (p.status === "done") {
        stack.unitPrice = (basis === "median" ? p.median ?? p.lowest : p.lowest ?? p.median) ?? null;
        stack.total = stack.unitPrice != null ? stack.unitPrice * stack.quantity : null;
        stack.volume = p.volume;
      }
    }
    return [...map.values()];
  }, [data, prices, basis]);

  const progress = useMemo(() => {
    const all = Object.values(prices);
    return { total: all.length, done: all.filter((p) => p.status !== "pending").length };
  }, [prices]);

  return { data, loading, error, stacks, progress, pausedUntil, load, refreshPrices };
}
