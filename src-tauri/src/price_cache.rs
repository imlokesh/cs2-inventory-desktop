//! Disk-backed price cache so prices survive restarts and we hit Steam as little as possible.

use crate::steam::RawPrice;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, fs, path::PathBuf, sync::Mutex};

const TTL_SECS: u64 = 12 * 3600;

#[derive(Serialize, Deserialize)]
struct Entry {
    price: RawPrice,
    at: u64,
}

pub struct PriceCache {
    path: PathBuf,
    entries: Mutex<HashMap<String, Entry>>,
}

fn key(currency: u32, name: &str) -> String {
    format!("{currency}:{name}")
}

pub fn now() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

impl PriceCache {
    pub fn load(path: PathBuf) -> Self {
        let mut entries: HashMap<String, Entry> = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        let cutoff = now().saturating_sub(TTL_SECS);
        entries.retain(|_, e| e.at >= cutoff);
        Self { path, entries: Mutex::new(entries) }
    }

    pub fn get_many(&self, currency: u32, names: &[String]) -> HashMap<String, RawPrice> {
        let cutoff = now().saturating_sub(TTL_SECS);
        let entries = self.entries.lock().unwrap();
        names
            .iter()
            .filter_map(|n| {
                let e = entries.get(&key(currency, n))?;
                (e.at >= cutoff).then(|| (n.clone(), e.price.clone()))
            })
            .collect()
    }

    pub fn put(&self, currency: u32, name: &str, price: RawPrice) {
        let mut entries = self.entries.lock().unwrap();
        entries.insert(key(currency, name), Entry { price, at: now() });
        // Small file (a few hundred KB at most); rewriting it keeps the cache crash-safe enough.
        if let Some(dir) = self.path.parent() {
            let _ = fs::create_dir_all(dir);
        }
        if let Ok(json) = serde_json::to_vec(&*entries) {
            let tmp = self.path.with_extension("json.tmp");
            if fs::write(&tmp, json).is_ok() {
                let _ = fs::rename(&tmp, &self.path);
            }
        }
    }

    pub fn clear(&self) {
        self.entries.lock().unwrap().clear();
        let _ = fs::remove_file(&self.path);
    }
}
