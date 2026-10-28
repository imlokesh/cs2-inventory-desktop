mod price_cache;
mod settings;
mod steam;

use price_cache::PriceCache;
use settings::{Settings, SettingsStore};
use std::collections::HashMap;
use steam::{ApiError, InventoryResponse, RawPrice, Result, Steam};
use tauri::{Manager, State};

#[tauri::command]
fn get_settings(store: State<'_, SettingsStore>) -> Settings {
    store.get()
}

#[tauri::command]
fn save_settings(settings: Settings, store: State<'_, SettingsStore>) -> std::result::Result<Settings, String> {
    store.save(settings).map_err(|e| e.to_string())
}

#[tauri::command]
async fn fetch_inventory(id: String, steam: State<'_, Steam>) -> Result<InventoryResponse> {
    let profile = steam.resolve_profile(&id).await?;
    let (items, total) = steam.inventory(&profile.steam_id).await?;
    Ok(InventoryResponse { profile, items, total, fetched_at: price_cache::now() * 1000 })
}

#[tauri::command]
async fn fetch_price(
    name: String,
    currency: u32,
    steam: State<'_, Steam>,
    cache: State<'_, PriceCache>,
) -> Result<RawPrice> {
    if !(1..=50).contains(&currency) {
        return Err(ApiError::new("Invalid currency", 400));
    }
    let price = steam.price(&name, currency).await?;
    cache.put(currency, &name, price.clone());
    Ok(price)
}

#[tauri::command]
fn cached_prices(names: Vec<String>, currency: u32, cache: State<'_, PriceCache>) -> HashMap<String, RawPrice> {
    cache.get_many(currency, &names)
}

#[tauri::command]
fn clear_price_cache(cache: State<'_, PriceCache>) {
    cache.clear();
}

#[tauri::command]
fn write_text_file(path: String, contents: String) -> std::result::Result<(), String> {
    std::fs::write(path, contents).map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            // Preferences go in the roaming/config dir; re-downloadable data in the cache dir.
            let paths = app.path();
            app.manage(SettingsStore::load(paths.app_config_dir()?.join("settings.json")));
            app.manage(PriceCache::load(paths.app_cache_dir()?.join("prices.json")));
            app.manage(Steam::new());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_settings,
            save_settings,
            fetch_inventory,
            fetch_price,
            cached_prices,
            clear_price_cache,
            write_text_file
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
