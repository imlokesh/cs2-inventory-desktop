import type { ReactNode } from "react";

export interface BarRow {
  key: string;
  label: string;
  value: number;
  count: number;
  color?: string;
  icon?: ReactNode;
}

interface Props {
  title: string;
  subtitle?: string;
  rows: BarRow[];
  format: (n: number) => string;
  active?: Set<string>;
  onSelect?: (key: string) => void;
  limit?: number;
  countLabel?: string;
}

/** Horizontal bar ranking. Single-series: color only carries identity when the domain gives it one (rarity). */
export function BarList({ title, subtitle, rows, format, active, onSelect, limit = 8, countLabel = "items" }: Props) {
  const sorted = rows.filter((r) => r.value > 0).sort((a, b) => b.value - a.value);
  const shown = sorted.slice(0, limit);
  const rest = sorted.slice(limit);
  if (rest.length) {
    shown.push({
      key: "__other",
      label: `${rest.length} more`,
      value: rest.reduce((s, r) => s + r.value, 0),
      count: rest.reduce((s, r) => s + r.count, 0),
      color: "#4a525e",
    });
  }
  const max = Math.max(...shown.map((r) => r.value), 0);
  const sum = sorted.reduce((s, r) => s + r.value, 0);

  return (
    <section className="card flex flex-col p-5">
      <header className="mb-4">
        <h3 className="font-display text-base font-semibold tracking-wide">{title}</h3>
        {subtitle && <p className="text-xs text-fg-subtle">{subtitle}</p>}
      </header>

      {shown.length === 0 || max === 0 ? (
        <p className="py-8 text-center text-sm text-fg-subtle">No priced items yet</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {shown.map((row) => {
            const pct = max ? (row.value / max) * 100 : 0;
            const share = sum ? (row.value / sum) * 100 : 0;
            const clickable = onSelect && row.key !== "__other";
            const isActive = active?.has(row.key);
            const dimmed = active && active.size > 0 && !isActive;
            return (
              <li key={row.key} className="group relative">
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => clickable && onSelect(row.key)}
                  className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1.5 rounded-lg px-2 py-1.5 text-left transition ${
                    clickable ? "cursor-pointer hover:bg-white/[0.03]" : "cursor-default"
                  } ${dimmed ? "opacity-45" : ""}`}
                >
                  <span className="flex min-w-0 items-center gap-2 text-sm text-fg-muted">
                    {row.icon}
                    <span className="truncate group-hover:text-fg">{row.label}</span>
                  </span>
                  <span className="tabular text-sm font-medium text-fg">{format(row.value)}</span>
                  <span className="col-span-2 h-1.5 overflow-hidden rounded-full bg-white/[0.04]">
                    <span
                      className="block h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${Math.max(pct, 1.5)}%`, background: row.color ?? "var(--color-accent)" }}
                    />
                  </span>
                </button>
                <div className="pointer-events-none absolute right-2 bottom-full z-20 mb-1 hidden min-w-44 rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-xs shadow-xl group-hover:block">
                  <div className="mb-1 font-medium text-fg">{row.label}</div>
                  <div className="flex justify-between gap-4 text-fg-muted">
                    <span>Value</span>
                    <span className="tabular text-fg">{format(row.value)}</span>
                  </div>
                  <div className="flex justify-between gap-4 text-fg-muted">
                    <span>Share</span>
                    <span className="tabular text-fg">{share.toFixed(1)}%</span>
                  </div>
                  <div className="flex justify-between gap-4 text-fg-muted">
                    <span>{countLabel[0].toUpperCase() + countLabel.slice(1)}</span>
                    <span className="tabular text-fg">{row.count}</span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
