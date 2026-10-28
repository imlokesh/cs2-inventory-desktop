import { invoke } from "@tauri-apps/api/core";
import { parseSteamPrice } from "./currencies";
import type { InventoryResponse, Price } from "./types";

export class ApiError extends Error {
  status: number;
  retryAfter: number;

  constructor(message: string, status: number, retryAfter = 0) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

interface RawPrice {
  lowest: string | null;
  median: string | null;
  volume: number;
}

/** Calls a Rust command, turning its `ApiError` payload into a real Error. */
async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(command, args);
  } catch (e) {
    if (e && typeof e === "object" && "message" in e) {
      const err = e as { message: string; status?: number; retryAfter?: number };
      throw new ApiError(err.message, err.status ?? 500, err.retryAfter ?? 0);
    }
    throw new ApiError(String(e), 500);
  }
}

function toPrice(raw: RawPrice): Price {
  return { lowest: parseSteamPrice(raw.lowest), median: parseSteamPrice(raw.median), volume: raw.volume };
}

export function fetchInventory(id: string) {
  return call<InventoryResponse>("fetch_inventory", { id });
}

export async function fetchPrice(currency: number, name: string): Promise<Price> {
  return toPrice(await call<RawPrice>("fetch_price", { name, currency }));
}

/** Prices the backend already has on disk (fresh within 12h). */
export async function cachedPrices(currency: number, names: string[]): Promise<Record<string, Price>> {
  const raw = await call<Record<string, RawPrice>>("cached_prices", { names, currency });
  return Object.fromEntries(Object.entries(raw).map(([name, p]) => [name, toPrice(p)]));
}

export function clearPriceCache() {
  return call<void>("clear_price_cache", {});
}

// ---- price queue ----

export interface QueueEvents {
  onPrice: (name: string, price: Price) => void;
  onError: (name: string) => void;
  onPause: (until: number) => void;
}

/**
 * Fetches prices with low concurrency and backs off when Steam rate limits us.
 * Returns a cancel function.
 */
export function runPriceQueue(currency: number, names: string[], events: QueueEvents, concurrency = 2) {
  const queue = [...names];
  const attempts = new Map<string, number>();
  let cancelled = false;
  let pausedUntil = 0;
  let backoff = 0;

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  async function worker() {
    while (!cancelled && queue.length) {
      const wait = pausedUntil - Date.now();
      if (wait > 0) {
        await sleep(wait);
        continue;
      }

      const name = queue.shift()!;
      try {
        const price = await fetchPrice(currency, name);
        backoff = 0;
        if (!cancelled) events.onPrice(name, price);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 429) {
          // Rate limits aren't the item's fault: requeue it and back off 30s, 60s, 120s... (max 5 min).
          queue.unshift(name);
          if (pausedUntil < Date.now()) {
            backoff = Math.min(backoff ? backoff * 2 : e.retryAfter || 30, 300);
            pausedUntil = Date.now() + backoff * 1000;
            events.onPause(pausedUntil);
          }
          continue;
        }
        const n = (attempts.get(name) ?? 0) + 1;
        attempts.set(name, n);
        if (n < 3) queue.push(name);
        else events.onError(name);
      }
      await sleep(350);
    }
  }

  for (let i = 0; i < concurrency; i++) void worker();
  return () => {
    cancelled = true;
  };
}
