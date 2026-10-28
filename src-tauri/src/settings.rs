//! User preferences, stored as JSON in the platform config dir:
//! - Windows: %APPDATA%\com.imlokesh.cs2appraiser\settings.json
//! - macOS:   ~/Library/Application Support/com.imlokesh.cs2appraiser/settings.json
//! - Linux:   $XDG_CONFIG_HOME/com.imlokesh.cs2appraiser/settings.json (~/.config/...)

use serde::{Deserialize, Serialize};
use std::{fs, path::PathBuf, sync::Mutex};

const MAX_RECENT: usize = 8;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    /// Settings schema version, bumped when a migration is needed.
    pub version: u32,
    pub currency: String,
    /// "lowest" | "median"
    pub basis: String,
    /// "grid" | "table"
    pub view: String,
    /// Most recent profile first.
    pub recent: Vec<String>,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            version: 1,
            currency: "USD".into(),
            basis: "lowest".into(),
            view: "grid".into(),
            recent: Vec::new(),
        }
    }
}

impl Settings {
    /// Clamp values the UI could not have produced (hand-edited or corrupted file).
    fn sanitized(mut self) -> Self {
        let defaults = Settings::default();
        if self.currency.len() != 3 || !self.currency.chars().all(|c| c.is_ascii_uppercase()) {
            self.currency = defaults.currency;
        }
        if !matches!(self.basis.as_str(), "lowest" | "median") {
            self.basis = defaults.basis;
        }
        if !matches!(self.view.as_str(), "grid" | "table") {
            self.view = defaults.view;
        }
        self.recent.retain(|r| !r.trim().is_empty());
        self.recent.dedup();
        self.recent.truncate(MAX_RECENT);
        self.version = defaults.version;
        self
    }
}

pub struct SettingsStore {
    path: PathBuf,
    current: Mutex<Settings>,
}

impl SettingsStore {
    pub fn load(path: PathBuf) -> Self {
        let current = fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Settings>(&bytes).ok())
            .unwrap_or_default()
            .sanitized();
        Self { path, current: Mutex::new(current) }
    }

    pub fn get(&self) -> Settings {
        self.current.lock().unwrap().clone()
    }

    pub fn save(&self, settings: Settings) -> std::io::Result<Settings> {
        let settings = settings.sanitized();
        if let Some(dir) = self.path.parent() {
            fs::create_dir_all(dir)?;
        }
        // Write to a temp file and rename so a crash never leaves a half-written file.
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, serde_json::to_vec_pretty(&settings)?)?;
        fs::rename(&tmp, &self.path)?;
        *self.current.lock().unwrap() = settings.clone();
        Ok(settings)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitizes_bad_values_and_fills_missing_fields() {
        let s: Settings = serde_json::from_str(r#"{"currency":"usd!","view":"cards","recent":["a","a","","b"]}"#).unwrap();
        let s = s.sanitized();
        assert_eq!(s.currency, "USD");
        assert_eq!(s.basis, "lowest");
        assert_eq!(s.view, "grid");
        assert_eq!(s.recent, vec!["a", "b"]);
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = std::env::temp_dir().join(format!("cs2-settings-test-{}", std::process::id()));
        let path = dir.join("settings.json");
        let store = SettingsStore::load(path.clone());
        assert_eq!(store.get(), Settings::default());

        let saved = store
            .save(Settings { currency: "EUR".into(), recent: vec!["imlokesh".into()], ..Settings::default() })
            .unwrap();
        assert_eq!(SettingsStore::load(path).get(), saved);
        let _ = fs::remove_dir_all(dir);
    }
}
