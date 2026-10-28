import {
  AlertTriangle,
  ArrowRight,
  Coins,
  Crown,
  Download,
  LayoutGrid,
  List,
  Loader2,
  Package,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { BarList, type BarRow } from "./components/BarList";
import { ItemGrid, ItemTable } from "./components/ItemViews";
import { useInventory } from "./hooks/useInventory";
import { saveCsv } from "./lib/csv";
import { CURRENCY_CODES, formatMoney, type CurrencyCode } from "./lib/currencies";
import { rarityRank, steamImage } from "./lib/rarity";
import { saveSettings, type Settings } from "./lib/settings";
import type { PriceBasis, Stack } from "./lib/types";

type SortKey = "value" | "price" | "name" | "quantity" | "rarity";
type View = "grid" | "table";

interface Filters {
  search: string;
  categories: Set<string>;
  rarities: Set<string>;
  exterior: string;
  tradableOnly: boolean;
  marketableOnly: boolean;
}

const EMPTY_FILTERS: Filters = {
  search: "",
  categories: new Set(),
  rarities: new Set(),
  exterior: "",
  tradableOnly: false,
  marketableOnly: false,
};

const PAGE = 60;
const MAX_RECENT = 5;

function toggle(set: Set<string>, key: string) {
  const next = new Set(set);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  return next;
}

/** Applies every filter except the one named in `skip`, so a chart can still show its own dimension in full. */
function applyFilters(stacks: Stack[], f: Filters, skip?: "categories" | "rarities") {
  const q = f.search.trim().toLowerCase();
  return stacks.filter((s) => {
    if (q && !`${s.item.name} ${s.item.type} ${s.item.collection}`.toLowerCase().includes(q)) return false;
    if (skip !== "categories" && f.categories.size && !f.categories.has(s.item.category)) return false;
    if (skip !== "rarities" && f.rarities.size && !f.rarities.has(s.item.rarity)) return false;
    if (f.exterior && s.item.exterior !== f.exterior) return false;
    if (f.tradableOnly && s.tradable === 0) return false;
    if (f.marketableOnly && !s.item.marketable) return false;
    return true;
  });
}

function groupRows(stacks: Stack[], by: (s: Stack) => string, color?: (s: Stack) => string): BarRow[] {
  const map = new Map<string, BarRow>();
  for (const s of stacks) {
    const key = by(s) || "Other";
    const row = map.get(key) ?? { key, label: key, value: 0, count: 0, color: color?.(s) };
    row.value += s.total ?? 0;
    row.count += s.quantity;
    map.set(key, row);
  }
  return [...map.values()];
}

export default function App({ initialSettings }: { initialSettings: Settings }) {
  const [query, setQuery] = useState(initialSettings.recent[0] ?? "");
  const [currency, setCurrency] = useState<CurrencyCode>(initialSettings.currency);
  const [basis, setBasis] = useState<PriceBasis>(initialSettings.basis);
  const [view, setView] = useState<View>(initialSettings.view);
  const [sort, setSort] = useState<SortKey>("value");
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [limit, setLimit] = useState(PAGE);
  const [recent, setRecent] = useState<string[]>(initialSettings.recent);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState<string | null>(null);

  const { data, loading, error, stacks, progress, pausedUntil, load, refreshPrices } = useInventory(currency, basis);

  // Persist preferences through the backend whenever they change (skipping the initial render).
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    void saveSettings({ ...initialSettings, currency, basis, view, recent });
  }, [initialSettings, currency, basis, view, recent]);

  // Reopen the last appraised profile on launch.
  useEffect(() => {
    if (query) void load(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Tick for the rate-limit countdown.
  useEffect(() => {
    if (pausedUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [pausedUntil]);

  useEffect(() => setLimit(PAGE), [filters, sort]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  function submit(e?: FormEvent, id = query) {
    e?.preventDefault();
    const value = id.trim();
    if (!value) return;
    setQuery(value);
    setFilters(EMPTY_FILTERS);
    setRecent((r) => [value, ...r.filter((x) => x !== value)].slice(0, MAX_RECENT));
    void load(value);
  }

  const money = (n: number) => formatMoney(n, currency);
  const compact = (n: number) => formatMoney(n, currency, n >= 10000);

  const filtered = useMemo(() => applyFilters(stacks, filters), [stacks, filters]);

  const sorted = useMemo(() => {
    const cmp: Record<SortKey, (a: Stack, b: Stack) => number> = {
      value: (a, b) => (b.total ?? -1) - (a.total ?? -1),
      price: (a, b) => (b.unitPrice ?? -1) - (a.unitPrice ?? -1),
      name: (a, b) => a.item.name.localeCompare(b.item.name),
      quantity: (a, b) => b.quantity - a.quantity,
      rarity: (a, b) => rarityRank(b.item.rarity) - rarityRank(a.item.rarity) || (b.total ?? 0) - (a.total ?? 0),
    };
    return [...filtered].sort((a, b) => cmp[sort](a, b) || a.item.name.localeCompare(b.item.name));
  }, [filtered, sort]);

  const totals = useMemo(() => {
    let value = 0;
    let items = 0;
    let top: Stack | null = null;
    for (const s of filtered) {
      value += s.total ?? 0;
      items += s.quantity;
      if (s.unitPrice != null && (!top || s.unitPrice > (top.unitPrice ?? 0))) top = s;
    }
    return { value, items, unique: filtered.length, top };
  }, [filtered]);

  const categoryRows = useMemo(
    () => groupRows(applyFilters(stacks, filters, "categories"), (s) => s.item.category),
    [stacks, filters]
  );
  const rarityRows = useMemo(
    () =>
      groupRows(
        applyFilters(stacks, filters, "rarities").filter((s) => s.item.rarity),
        (s) => s.item.rarity,
        (s) => s.item.rarityColor
      ).map((r) => ({ ...r, icon: <span className="size-2 shrink-0 rounded-full" style={{ background: r.color }} /> })),
    [stacks, filters]
  );
  const topRows = useMemo<BarRow[]>(
    () =>
      filtered
        .filter((s) => s.total)
        .sort((a, b) => b.total! - a.total!)
        .slice(0, 8)
        .map((s) => ({
          key: s.key,
          label: s.quantity > 1 ? `${s.item.name} ×${s.quantity}` : s.item.name,
          value: s.total!,
          count: s.quantity,
          icon: <img src={steamImage(s.item.icon, 64)} alt="" className="h-5 w-7 shrink-0 object-contain" />,
        })),
    [filtered]
  );

  const allCategories = useMemo(() => [...new Set(stacks.map((s) => s.item.category))].sort(), [stacks]);
  const allRarities = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of stacks) if (s.item.rarity) m.set(s.item.rarity, s.item.rarityColor);
    return [...m.entries()].sort((a, b) => rarityRank(b[0]) - rarityRank(a[0]));
  }, [stacks]);
  const allExteriors = useMemo(() => [...new Set(stacks.map((s) => s.item.exterior).filter(Boolean))].sort(), [stacks]);

  const filtersActive = Boolean(
    filters.search ||
      filters.categories.size ||
      filters.rarities.size ||
      filters.exterior ||
      filters.tradableOnly ||
      filters.marketableOnly
  );
  const pricing = progress.done < progress.total;
  const pauseLeft = Math.max(0, Math.ceil((pausedUntil - now) / 1000));

  async function exportCsv() {
    if (!data) return;
    const who = (data.profile.persona || "inventory").replace(/[^\w-]+/g, "_");
    try {
      const path = await saveCsv(sorted, currency, `${who}_${data.profile.steamId}_${new Date().toISOString().slice(0, 10)}.csv`);
      if (path) setToast(`Saved ${sorted.length} rows to ${path}`);
    } catch (e) {
      setToast(`Export failed: ${String(e)}`);
    }
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col px-4 sm:px-6 lg:px-8">
      <header className="flex items-center justify-between gap-3 py-5">
        <div className="flex items-center gap-2.5">
          <img src="/favicon.svg" alt="" className="size-8" />
          <span className="font-display text-lg font-semibold tracking-wide">
            CS2 <span className="text-accent">Appraiser</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            aria-label="Currency"
            value={currency}
            onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
            className="input h-9 cursor-pointer px-2.5 text-xs font-medium"
          >
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <select
            aria-label="Price basis"
            value={basis}
            onChange={(e) => setBasis(e.target.value as PriceBasis)}
            className="input h-9 cursor-pointer px-2.5 text-xs font-medium"
          >
            <option value="lowest">Lowest listing</option>
            <option value="median">Median sale</option>
          </select>
        </div>
      </header>

      {/* Search */}
      <section className={data ? "py-4" : "flex flex-1 flex-col items-center justify-center pb-24 text-center"}>
        {!data && (
          <>
            <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-accent/30 bg-accent-soft px-3 py-1 text-xs font-medium text-accent-strong">
              <Coins size={13} /> Live Steam Community Market prices
            </span>
            <h1 className="font-display max-w-3xl text-4xl leading-[1.05] font-bold tracking-tight sm:text-6xl">
              What is your CS2 inventory <span className="text-accent">actually worth?</span>
            </h1>
            <p className="mt-5 max-w-xl text-base text-fg-muted">
              Paste a Steam profile link, vanity name or SteamID64. Filter, chart and export every item to CSV.
            </p>
          </>
        )}
        <form onSubmit={submit} className={`flex w-full gap-2 ${data ? "" : "mt-9 max-w-xl"}`}>
          <label className="relative flex-1">
            <Search size={16} className="pointer-events-none absolute top-1/2 left-3.5 -translate-y-1/2 text-fg-subtle" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="steamcommunity.com/id/yourname"
              title="Profile URL, trade link, SteamID (64, [U:1:…], STEAM_0:…) or custom URL name"
              aria-label="Steam profile"
              className="input w-full pl-10"
              autoFocus={!data}
              spellCheck={false}
            />
          </label>
          <button type="submit" disabled={loading || !query.trim()} className="btn-primary">
            {loading ? <Loader2 size={16} className="animate-spin" /> : <ArrowRight size={16} />}
            <span className="hidden sm:inline">Appraise</span>
          </button>
        </form>
        {!data && recent.length > 0 && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {recent.map((r) => (
              <button key={r} type="button" className="chip" onClick={() => submit(undefined, r)}>
                {r}
              </button>
            ))}
          </div>
        )}
        {error && (
          <div
            className={`mt-4 flex w-full items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-left text-sm text-red-200 ${data ? "" : "max-w-xl"}`}
          >
            <AlertTriangle size={16} className="shrink-0" /> {error}
          </div>
        )}
      </section>

      {data && (
        <main className="flex flex-col gap-5 pb-16">
          {/* Profile + actions */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              {data.profile.avatar ? (
                <img src={data.profile.avatar} alt="" className="size-12 rounded-xl ring-1 ring-white/10" />
              ) : (
                <div className="size-12 rounded-xl bg-ink-800" />
              )}
              <div>
                <h2 className="font-display text-xl font-semibold">{data.profile.persona || data.profile.steamId}</h2>
                <a
                  href={`https://steamcommunity.com/profiles/${data.profile.steamId}/inventory/#730`}
                  target="_blank"
                  rel="noreferrer"
                  className="tabular text-xs text-fg-subtle hover:text-fg-muted"
                >
                  {data.profile.steamId} · fetched {new Date(data.fetchedAt).toLocaleTimeString()}
                </a>
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn" onClick={() => void load(query)} disabled={loading}>
                <RefreshCw size={15} className={loading ? "animate-spin" : ""} /> Refresh
              </button>
              <button
                className="btn"
                onClick={() => void refreshPrices()}
                title="Discard cached prices and fetch them again from Steam"
              >
                <Coins size={15} /> Reprice
              </button>
              <button className="btn" onClick={() => void exportCsv()} disabled={!sorted.length}>
                <Download size={15} /> Export CSV
              </button>
            </div>
          </div>

          {/* Stat tiles */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="card relative overflow-hidden p-5">
              <div className="pointer-events-none absolute -top-16 -right-16 size-40 rounded-full bg-accent/15 blur-2xl" />
              <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">
                {filtersActive ? "Filtered value" : "Total value"}
              </p>
              <p className="font-display tabular mt-2 text-3xl font-bold text-fg sm:text-4xl">{money(totals.value)}</p>
              <p className="mt-1 text-xs text-fg-subtle">
                {basis === "lowest" ? "At lowest market listing" : "At median sale price"}
                {pricing && " · still pricing…"}
              </p>
            </div>
            <div className="card p-5">
              <p className="flex items-center gap-1.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
                <Package size={13} /> Items
              </p>
              <p className="font-display tabular mt-2 text-3xl font-bold">{totals.items.toLocaleString()}</p>
              <p className="mt-1 text-xs text-fg-subtle">{totals.unique.toLocaleString()} unique</p>
            </div>
            <div className="card p-5">
              <p className="flex items-center gap-1.5 text-xs font-medium tracking-wider text-fg-subtle uppercase">
                <Crown size={13} /> Most valuable
              </p>
              {totals.top ? (
                <div className="mt-2 flex items-center gap-3">
                  <img src={steamImage(totals.top.item.icon, 96)} alt="" className="h-11 w-14 shrink-0 object-contain" />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium" title={totals.top.item.name}>
                      {totals.top.item.name}
                    </p>
                    <p className="font-display tabular text-lg font-semibold text-accent">{money(totals.top.unitPrice!)}</p>
                  </div>
                </div>
              ) : pricing ? (
                <div className="skeleton mt-3 h-10 w-full" />
              ) : (
                <p className="mt-3 text-sm text-fg-subtle">Nothing priced</p>
              )}
            </div>
            <div className="card p-5">
              <p className="text-xs font-medium tracking-wider text-fg-subtle uppercase">Pricing</p>
              <p className="font-display tabular mt-2 text-3xl font-bold">
                {progress.done}
                <span className="text-lg text-fg-subtle">/{progress.total}</span>
              </p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
                <div
                  className="h-full rounded-full bg-accent transition-[width] duration-500"
                  style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 100}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-fg-subtle">
                {pauseLeft > 0
                  ? `Steam rate limit, resuming in ${pauseLeft}s`
                  : pricing
                    ? "Fetching market prices…"
                    : "All marketable items priced"}
              </p>
            </div>
          </div>

          {/* Charts */}
          <div className="grid gap-3 lg:grid-cols-3">
            <BarList
              title="Value by category"
              subtitle="Click a bar to filter"
              rows={categoryRows}
              format={compact}
              active={filters.categories}
              onSelect={(k) => setFilters((f) => ({ ...f, categories: toggle(f.categories, k) }))}
            />
            <BarList
              title="Value by rarity"
              subtitle="Click a bar to filter"
              rows={rarityRows}
              format={compact}
              active={filters.rarities}
              onSelect={(k) => setFilters((f) => ({ ...f, rarities: toggle(f.rarities, k) }))}
            />
            <BarList title="Top holdings" subtitle="By total stack value" rows={topRows} format={compact} countLabel="quantity" />
          </div>

          {/* Filters */}
          <div className="card sticky top-2 z-30 flex flex-col gap-3 bg-ink-900/95 p-3 shadow-xl shadow-black/30">
            <div className="flex flex-wrap items-center gap-2">
              <label className="relative min-w-48 flex-1">
                <Search size={15} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-fg-subtle" />
                <input
                  value={filters.search}
                  onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
                  placeholder="Search items, collections…"
                  aria-label="Search items"
                  className="input h-10 w-full pl-9"
                />
              </label>
              <select
                aria-label="Exterior"
                value={filters.exterior}
                onChange={(e) => setFilters((f) => ({ ...f, exterior: e.target.value }))}
                className="input h-10 cursor-pointer"
              >
                <option value="">Any exterior</option>
                {allExteriors.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
              <select
                aria-label="Sort"
                value={sort}
                onChange={(e) => setSort(e.target.value as SortKey)}
                className="input h-10 cursor-pointer"
              >
                <option value="value">Sort: Total value</option>
                <option value="price">Sort: Unit price</option>
                <option value="rarity">Sort: Rarity</option>
                <option value="quantity">Sort: Quantity</option>
                <option value="name">Sort: Name</option>
              </select>
              <div className="flex rounded-xl border border-white/[0.08] bg-ink-850 p-1">
                {(["grid", "table"] as const).map((v) => (
                  <button
                    key={v}
                    aria-label={`${v} view`}
                    aria-pressed={view === v}
                    onClick={() => setView(v)}
                    className={`rounded-lg p-1.5 transition ${view === v ? "bg-ink-700 text-fg" : "text-fg-subtle hover:text-fg"}`}
                  >
                    {v === "grid" ? <LayoutGrid size={16} /> : <List size={16} />}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              {allCategories.map((c) => (
                <button
                  key={c}
                  className="chip"
                  data-active={filters.categories.has(c)}
                  onClick={() => setFilters((f) => ({ ...f, categories: toggle(f.categories, c) }))}
                >
                  {c}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-white/10" />
              {allRarities.map(([r, color]) => (
                <button
                  key={r}
                  className="chip"
                  data-active={filters.rarities.has(r)}
                  onClick={() => setFilters((f) => ({ ...f, rarities: toggle(f.rarities, r) }))}
                >
                  <span className="size-2 rounded-full" style={{ background: color }} />
                  {r}
                </button>
              ))}
              <span className="mx-1 h-4 w-px bg-white/10" />
              <button
                className="chip"
                data-active={filters.tradableOnly}
                onClick={() => setFilters((f) => ({ ...f, tradableOnly: !f.tradableOnly }))}
              >
                Tradable
              </button>
              <button
                className="chip"
                data-active={filters.marketableOnly}
                onClick={() => setFilters((f) => ({ ...f, marketableOnly: !f.marketableOnly }))}
              >
                Marketable
              </button>
              {filtersActive && (
                <button className="chip border-transparent bg-transparent text-fg-subtle" onClick={() => setFilters(EMPTY_FILTERS)}>
                  <X size={12} /> Clear
                </button>
              )}
            </div>
          </div>

          {/* Items */}
          <p className="text-sm text-fg-muted">
            Showing <span className="tabular text-fg">{Math.min(limit, sorted.length)}</span> of{" "}
            <span className="tabular text-fg">{sorted.length}</span> stacks
          </p>
          {sorted.length === 0 ? (
            <div className="card flex flex-col items-center gap-2 py-16 text-center">
              <Package size={28} className="text-fg-subtle" />
              <p className="text-fg-muted">No items match these filters.</p>
              <button className="btn mt-2" onClick={() => setFilters(EMPTY_FILTERS)}>
                Clear filters
              </button>
            </div>
          ) : view === "grid" ? (
            <ItemGrid stacks={sorted.slice(0, limit)} currency={currency} />
          ) : (
            <ItemTable stacks={sorted.slice(0, limit)} currency={currency} />
          )}
          {limit < sorted.length && (
            <button className="btn mx-auto" onClick={() => setLimit((l) => l + PAGE * 2)}>
              Show more
            </button>
          )}
        </main>
      )}

      <footer className="border-t border-white/[0.05] py-6 text-center text-xs text-fg-subtle">
        Prices from the Steam Community Market in {currency}. Not affiliated with Valve.
      </footer>

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 max-w-[90vw] -translate-x-1/2 truncate rounded-xl border border-white/10 bg-ink-800 px-4 py-2.5 text-sm text-fg shadow-2xl shadow-black/50"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
