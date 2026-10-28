import { ExternalLink, Lock } from "lucide-react";
import { formatMoney, type CurrencyCode } from "../lib/currencies";
import { steamImage } from "../lib/rarity";
import type { Stack } from "../lib/types";

function marketUrl(name: string) {
  return `https://steamcommunity.com/market/listings/730/${encodeURIComponent(name)}`;
}

function PriceCell({ stack, currency, field }: { stack: Stack; currency: CurrencyCode; field: "unit" | "total" }) {
  if (stack.priceStatus === "pending") return <span className="skeleton inline-block h-4 w-16 align-middle" />;
  if (stack.priceStatus === "unmarketable") return <span className="text-fg-subtle">Not marketable</span>;
  const value = field === "unit" ? stack.unitPrice : stack.total;
  if (value == null) return <span className="text-fg-subtle">No listings</span>;
  return <span className="tabular">{formatMoney(value, currency)}</span>;
}

export function ItemGrid({ stacks, currency }: { stacks: Stack[]; currency: CurrencyCode }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {stacks.map((s) => (
        <article
          key={s.key}
          className="group relative flex flex-col overflow-hidden rounded-xl border border-white/[0.06] bg-ink-900 transition hover:-translate-y-0.5 hover:border-white/15 hover:shadow-2xl hover:shadow-black/40"
        >
          <div
            className="relative aspect-[4/3] overflow-hidden"
            style={{ background: `radial-gradient(circle at 50% 60%, ${s.item.rarityColor}2e, transparent 70%)` }}
          >
            <img
              src={steamImage(s.item.icon)}
              alt=""
              loading="lazy"
              className="absolute inset-0 m-auto h-[78%] w-[78%] object-contain drop-shadow-[0_10px_18px_rgba(0,0,0,0.55)] transition duration-300 group-hover:scale-105"
            />
            {s.quantity > 1 && (
              <span className="tabular absolute top-2 left-2 rounded-md bg-black/55 px-1.5 py-0.5 text-xs font-semibold text-fg backdrop-blur">
                ×{s.quantity}
              </span>
            )}
            {s.tradable === 0 && (
              <span title="Not tradable" className="absolute top-2 right-2 rounded-md bg-black/55 p-1 text-fg-muted backdrop-blur">
                <Lock size={12} />
              </span>
            )}
            {s.item.marketable && (
              <a
                href={marketUrl(s.item.marketHashName)}
                target="_blank"
                rel="noreferrer"
                title="Open on Steam Market"
                className="absolute right-2 bottom-2 rounded-md bg-black/55 p-1 text-fg-muted opacity-0 backdrop-blur transition group-hover:opacity-100 hover:text-fg focus-visible:opacity-100"
              >
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          <div className="h-0.5" style={{ background: s.item.rarityColor }} />
          <div className="flex flex-1 flex-col gap-1 p-3">
            <h4 className="line-clamp-2 text-[13px] leading-snug font-medium text-fg" title={s.item.name}>
              {s.item.name}
            </h4>
            <p className="truncate text-[11px] text-fg-subtle">
              {[s.item.exterior, s.item.rarity].filter(Boolean).join(" · ") || s.item.category}
            </p>
            <div className="mt-auto flex items-end justify-between gap-2 pt-2">
              <span className="font-display text-sm font-semibold text-fg">
                <PriceCell stack={s} currency={currency} field="total" />
              </span>
              {s.quantity > 1 && s.unitPrice != null && (
                <span className="tabular text-[11px] text-fg-subtle">{formatMoney(s.unitPrice, currency)} ea</span>
              )}
            </div>
          </div>
        </article>
      ))}
    </div>
  );
}

export function ItemTable({ stacks, currency }: { stacks: Stack[]; currency: CurrencyCode }) {
  return (
    <div className="card overflow-x-auto">
      <table className="w-full min-w-[760px] text-sm">
        <thead>
          <tr className="border-b border-white/[0.06] text-left text-xs tracking-wider text-fg-subtle uppercase">
            <th className="px-4 py-3 font-medium">Item</th>
            <th className="px-4 py-3 font-medium">Category</th>
            <th className="px-4 py-3 font-medium">Rarity</th>
            <th className="px-4 py-3 text-right font-medium">Qty</th>
            <th className="px-4 py-3 text-right font-medium">Unit</th>
            <th className="px-4 py-3 text-right font-medium">Total</th>
            <th className="px-4 py-3 text-right font-medium">24h vol.</th>
          </tr>
        </thead>
        <tbody>
          {stacks.map((s) => (
            <tr key={s.key} className="border-b border-white/[0.04] transition last:border-0 hover:bg-white/[0.02]">
              <td className="px-4 py-2">
                <div className="flex items-center gap-3">
                  <img src={steamImage(s.item.icon, 96)} alt="" loading="lazy" className="h-9 w-12 shrink-0 object-contain" />
                  <div className="min-w-0">
                    <div className="truncate font-medium text-fg">{s.item.name}</div>
                    {s.item.exterior && <div className="text-xs text-fg-subtle">{s.item.exterior}</div>}
                  </div>
                </div>
              </td>
              <td className="px-4 py-2 text-fg-muted">{s.item.category}</td>
              <td className="px-4 py-2">
                {s.item.rarity && (
                  <span className="inline-flex items-center gap-1.5 text-fg-muted">
                    <span className="size-2 rounded-full" style={{ background: s.item.rarityColor }} />
                    {s.item.rarity}
                  </span>
                )}
              </td>
              <td className="tabular px-4 py-2 text-right text-fg-muted">{s.quantity}</td>
              <td className="px-4 py-2 text-right text-fg-muted">
                <PriceCell stack={s} currency={currency} field="unit" />
              </td>
              <td className="px-4 py-2 text-right font-medium text-fg">
                <PriceCell stack={s} currency={currency} field="total" />
              </td>
              <td className="tabular px-4 py-2 text-right text-fg-subtle">{s.volume ? s.volume.toLocaleString() : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
