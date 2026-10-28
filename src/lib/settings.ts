import { invoke } from "@tauri-apps/api/core";
import type { CurrencyCode } from "./currencies";
import type { PriceBasis } from "./types";

/** Mirrors `Settings` in src-tauri/src/settings.rs. Stored in the OS config dir by the backend. */
export interface Settings {
  version: number;
  currency: CurrencyCode;
  basis: PriceBasis;
  view: "grid" | "table";
  recent: string[];
}

export const DEFAULT_SETTINGS: Settings = { version: 1, currency: "USD", basis: "lowest", view: "grid", recent: [] };

export async function loadSettings(): Promise<Settings> {
  try {
    return { ...DEFAULT_SETTINGS, ...(await invoke<Settings>("get_settings")) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: Settings) {
  return invoke<Settings>("save_settings", { settings }).catch((e) => console.error("Failed to save settings", e));
}
