import { invoke } from "@tauri-apps/api/core";
import { save } from "@tauri-apps/plugin-dialog";
import type { Stack } from "./types";

function cell(value: unknown) {
  const s = value == null ? "" : String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Opens a native save dialog and writes the CSV. Returns the saved path, or null if cancelled. */
export async function saveCsv(stacks: Stack[], currency: string, filename: string) {
  const header = [
    "Name",
    "MarketHashName",
    "Category",
    "Weapon",
    "Rarity",
    "Exterior",
    "Quality",
    "Collection",
    "Quantity",
    "Tradable",
    "Marketable",
    `UnitPrice (${currency})`,
    `Total (${currency})`,
    "24hVolume",
  ];

  const rows = stacks.map((s) => [
    s.item.name,
    s.item.marketHashName,
    s.item.category,
    s.item.weapon,
    s.item.rarity,
    s.item.exterior,
    s.item.quality,
    s.item.collection,
    s.quantity,
    s.tradable,
    s.item.marketable ? "Yes" : "No",
    s.unitPrice ?? "",
    s.total != null ? s.total.toFixed(2) : "",
    s.volume || "",
  ]);

  const csv = [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n");

  const path = await save({ defaultPath: filename, filters: [{ name: "CSV", extensions: ["csv"] }] });
  if (!path) return null;
  // BOM so Excel opens UTF-8 (★, ™, etc.) correctly.
  await invoke("write_text_file", { path, contents: "﻿" + csv });
  return path;
}
