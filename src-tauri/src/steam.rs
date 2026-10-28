//! Thin client for the public Steam Community endpoints we need.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Error shape returned to the frontend (mirrors the old HTTP API's status codes).
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApiError {
    pub message: String,
    pub status: u16,
    pub retry_after: u64,
}

impl ApiError {
    pub fn new(message: impl Into<String>, status: u16) -> Self {
        Self { message: message.into(), status, retry_after: 0 }
    }

    fn rate_limited(retry_after: u64) -> Self {
        Self {
            message: "Steam is rate limiting requests. Waiting before retrying.".into(),
            status: 429,
            retry_after,
        }
    }
}

impl From<reqwest::Error> for ApiError {
    fn from(e: reqwest::Error) -> Self {
        let status = e.status().map(|s| s.as_u16()).unwrap_or(0);
        Self::new(format!("Network error: {e}"), if status == 0 { 503 } else { status })
    }
}

pub type Result<T> = std::result::Result<T, ApiError>;

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Profile {
    pub steam_id: String,
    pub persona: String,
    pub avatar: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryItem {
    pub asset_id: String,
    pub name: String,
    pub market_hash_name: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub category: String,
    pub weapon: String,
    pub rarity: String,
    pub rarity_color: String,
    pub exterior: String,
    pub quality: String,
    pub collection: String,
    pub name_color: String,
    pub icon: String,
    pub tradable: bool,
    pub marketable: bool,
    pub amount: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InventoryResponse {
    pub profile: Profile,
    pub items: Vec<InventoryItem>,
    pub total: u32,
    pub fetched_at: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct RawPrice {
    pub lowest: Option<String>,
    pub median: Option<String>,
    pub volume: u64,
}

// ---- Steam wire types ----

#[derive(Deserialize)]
struct SteamAsset {
    assetid: String,
    classid: String,
    instanceid: String,
    amount: String,
}

#[derive(Deserialize)]
struct SteamTag {
    category: String,
    localized_tag_name: String,
    color: Option<String>,
}

#[derive(Deserialize)]
struct SteamDescription {
    classid: String,
    instanceid: String,
    icon_url: String,
    name: String,
    market_hash_name: String,
    name_color: Option<String>,
    #[serde(rename = "type")]
    kind: String,
    tradable: u8,
    marketable: u8,
    #[serde(default)]
    tags: Vec<SteamTag>,
}

#[derive(Deserialize)]
struct SteamInventoryPage {
    #[serde(default)]
    assets: Vec<SteamAsset>,
    #[serde(default)]
    descriptions: Vec<SteamDescription>,
    more_items: Option<u8>,
    last_assetid: Option<String>,
    total_inventory_count: Option<u32>,
    success: Option<u8>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct PriceOverview {
    lowest_price: Option<String>,
    median_price: Option<String>,
    volume: Option<String>,
}

pub struct Steam {
    http: reqwest::Client,
}

impl Steam {
    pub fn new() -> Self {
        let http = reqwest::Client::builder()
            .user_agent(concat!("cs2-inventory-desktop/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("failed to build HTTP client");
        Self { http }
    }

    async fn get(&self, url: &str) -> Result<reqwest::Response> {
        let res = self
            .http
            .get(url)
            .header("Accept-Language", "en-US,en;q=0.9")
            .send()
            .await?;
        if res.status().as_u16() == 429 {
            let retry = res
                .headers()
                .get("retry-after")
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse().ok())
                .unwrap_or(60);
            return Err(ApiError::rate_limited(retry));
        }
        Ok(res)
    }

    /// Accepts anything `parse_profile_input` understands: URLs, SteamIDs in any format, or a vanity name.
    pub async fn resolve_profile(&self, input: &str) -> Result<Profile> {
        let url = match parse_profile_input(input)? {
            ProfileRef::Id(id) => format!("https://steamcommunity.com/profiles/{id}?xml=1"),
            ProfileRef::Vanity(name) => format!("https://steamcommunity.com/id/{}?xml=1", urlencoding::encode(&name)),
        };

        let res = self.get(&url).await?;
        if !res.status().is_success() {
            return Err(ApiError::new(format!("Steam profile lookup failed ({})", res.status()), 502));
        }
        let xml = res.text().await?;
        let steam_id = xml_tag(&xml, "steamID64");
        if steam_id.is_empty() {
            return Err(ApiError::new("Steam profile not found", 404));
        }
        Ok(Profile {
            steam_id,
            persona: xml_tag(&xml, "steamID"),
            avatar: xml_tag(&xml, "avatarMedium"),
        })
    }

    pub async fn inventory(&self, steam_id: &str) -> Result<(Vec<InventoryItem>, u32)> {
        let mut items = Vec::new();
        let mut descriptions: HashMap<(String, String), SteamDescription> = HashMap::new();
        let mut start_asset: Option<String> = None;
        let mut total = 0;

        // Steam pages large inventories; follow last_assetid until more_items stops.
        for _ in 0..20 {
            let mut url = format!("https://steamcommunity.com/inventory/{steam_id}/730/2?l=english&count=1000");
            if let Some(start) = &start_asset {
                url.push_str(&format!("&start_assetid={start}"));
            }

            let res = self.get(&url).await?;
            match res.status().as_u16() {
                403 => return Err(ApiError::new("This inventory is private", 403)),
                s if !(200..300).contains(&s) => {
                    return Err(ApiError::new(format!("Steam inventory request failed ({s})"), 502))
                }
                _ => {}
            }

            let page: Option<SteamInventoryPage> = res.json().await?;
            let Some(page) = page else {
                return Err(ApiError::new("Inventory unavailable", 502));
            };
            if page.success == Some(0) {
                return Err(ApiError::new(page.error.unwrap_or_else(|| "Inventory unavailable".into()), 502));
            }

            total = page.total_inventory_count.unwrap_or(total);
            for d in page.descriptions {
                descriptions.insert((d.classid.clone(), d.instanceid.clone()), d);
            }

            for asset in &page.assets {
                let Some(d) = descriptions.get(&(asset.classid.clone(), asset.instanceid.clone())) else {
                    continue;
                };
                let tag = |category: &str| d.tags.iter().find(|t| t.category == category);
                let tag_name = |category: &str| tag(category).map(|t| t.localized_tag_name.clone()).unwrap_or_default();
                let rarity = tag("Rarity");

                items.push(InventoryItem {
                    asset_id: asset.assetid.clone(),
                    name: d.name.clone(),
                    market_hash_name: d.market_hash_name.clone(),
                    kind: d.kind.clone(),
                    category: tag("Type").map(|t| t.localized_tag_name.clone()).unwrap_or_else(|| "Other".into()),
                    weapon: tag_name("Weapon"),
                    rarity: rarity.map(|t| t.localized_tag_name.clone()).unwrap_or_default(),
                    rarity_color: rarity
                        .and_then(|t| t.color.as_ref())
                        .map(|c| format!("#{c}"))
                        .unwrap_or_else(|| "#b0c3d9".into()),
                    exterior: tag_name("Exterior"),
                    quality: tag_name("Quality"),
                    collection: tag_name("ItemSet"),
                    name_color: d.name_color.as_ref().map(|c| format!("#{c}")).unwrap_or_default(),
                    icon: d.icon_url.clone(),
                    tradable: d.tradable == 1,
                    marketable: d.marketable == 1,
                    amount: asset.amount.parse().unwrap_or(1),
                });
            }

            match (page.more_items, page.last_assetid) {
                (Some(1), Some(last)) => start_asset = Some(last),
                _ => break,
            }
        }

        let count = items.len() as u32;
        Ok((items, if total > 0 { total } else { count }))
    }

    pub async fn price(&self, name: &str, currency: u32) -> Result<RawPrice> {
        let url = format!(
            "https://steamcommunity.com/market/priceoverview/?appid=730&currency={currency}&market_hash_name={}",
            urlencoding::encode(name)
        );
        let res = self.get(&url).await?;
        // Steam answers 500 for items with no market listing at all.
        if res.status().as_u16() == 500 {
            return Ok(RawPrice { lowest: None, median: None, volume: 0 });
        }
        if !res.status().is_success() {
            return Err(ApiError::new(format!("Steam market request failed ({})", res.status()), 502));
        }
        let data: PriceOverview = res.json().await?;
        Ok(RawPrice {
            lowest: data.lowest_price,
            median: data.median_price,
            volume: data
                .volume
                .map(|v| v.chars().filter(char::is_ascii_digit).collect::<String>())
                .and_then(|v| v.parse().ok())
                .unwrap_or(0),
        })
    }
}

/// Base for converting 32-bit account ids to SteamID64.
const ID64_BASE: u64 = 76561197960265728;

#[derive(Debug, PartialEq)]
pub enum ProfileRef {
    Id(String),
    Vanity(String),
}

/// Understands:
/// - profile URLs: `steamcommunity.com/id/<name>`, `steamcommunity.com/profiles/<id64>` (any sub-path, with or without scheme)
/// - trade offer URLs: `...tradeoffer/new/?partner=<accountid>&token=...`
/// - SteamID64 `7656119...`, SteamID3 `[U:1:123]`, SteamID2 `STEAM_0:1:123`
/// - a bare vanity name (optionally prefixed with `@`)
pub fn parse_profile_input(input: &str) -> Result<ProfileRef> {
    let value = input.trim();
    let invalid = || ApiError::new("Enter a Steam profile URL, SteamID or custom URL name", 400);
    if value.is_empty() {
        return Err(invalid());
    }

    if value.to_ascii_lowercase().contains("steamcommunity.com") {
        if let Some(id) = path_segment(value, "/profiles/") {
            return if is_steam_id64(id) { Ok(ProfileRef::Id(id.into())) } else { Err(invalid()) };
        }
        if let Some(name) = path_segment(value, "/id/") {
            return Ok(ProfileRef::Vanity(name.into()));
        }
        if let Some(partner) = query_param(value, "partner").and_then(|p| p.parse::<u64>().ok()) {
            return Ok(ProfileRef::Id((ID64_BASE + partner).to_string()));
        }
        return Err(invalid());
    }

    if is_steam_id64(value) {
        return Ok(ProfileRef::Id(value.into()));
    }

    // SteamID3: [U:1:123456]
    if let Some(account) = value
        .strip_prefix("[U:1:")
        .and_then(|s| s.strip_suffix(']'))
        .and_then(|s| s.parse::<u64>().ok())
    {
        return Ok(ProfileRef::Id((ID64_BASE + account).to_string()));
    }

    // SteamID2: STEAM_X:Y:Z  ->  base + Z*2 + Y
    if let Some(rest) = value.to_ascii_uppercase().strip_prefix("STEAM_") {
        let parts: Vec<u64> = rest.split(':').filter_map(|p| p.parse().ok()).collect();
        if let [_, y @ (0 | 1), z] = parts[..] {
            return Ok(ProfileRef::Id((ID64_BASE + z * 2 + y).to_string()));
        }
        return Err(invalid());
    }

    let name = value.trim_start_matches('@');
    // Custom URL names are 2-32 chars of letters, digits, '_' and '-'.
    if (2..=32).contains(&name.len()) && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-') {
        return Ok(ProfileRef::Vanity(name.into()));
    }
    Err(invalid())
}

fn is_steam_id64(s: &str) -> bool {
    s.len() == 17 && s.starts_with("7656") && s.bytes().all(|b| b.is_ascii_digit())
}

/// `https://steamcommunity.com/id/foo/inventory` + "/id/" -> "foo"
fn path_segment<'a>(value: &'a str, marker: &str) -> Option<&'a str> {
    let rest = &value[value.find(marker)? + marker.len()..];
    let seg = rest.split(['/', '?', '#']).next()?;
    (!seg.is_empty()).then_some(seg)
}

fn query_param<'a>(value: &'a str, key: &str) -> Option<&'a str> {
    let query = value.split_once('?')?.1.split('#').next()?;
    query.split('&').find_map(|pair| {
        let (k, v) = pair.split_once('=')?;
        (k == key).then_some(v)
    })
}

/// Pulls `<tag>value</tag>` (optionally CDATA-wrapped) out of Steam's profile XML.
fn xml_tag(xml: &str, tag: &str) -> String {
    let open = format!("<{tag}>");
    let close = format!("</{tag}>");
    let Some(start) = xml.find(&open).map(|i| i + open.len()) else {
        return String::new();
    };
    let Some(len) = xml[start..].find(&close) else {
        return String::new();
    };
    let inner = xml[start..start + len].trim();
    inner
        .strip_prefix("<![CDATA[")
        .and_then(|s| s.strip_suffix("]]>"))
        .unwrap_or(inner)
        .trim()
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_profile_inputs() {
        use ProfileRef::*;
        let id = || Id("76561198312488313".into());
        let cases = [
            ("imlokesh", Vanity("imlokesh".into())),
            ("  @imlokesh ", Vanity("imlokesh".into())),
            ("https://steamcommunity.com/id/imlokesh/", Vanity("imlokesh".into())),
            ("steamcommunity.com/id/imlokesh/inventory/#730", Vanity("imlokesh".into())),
            ("HTTPS://STEAMCOMMUNITY.COM/id/imlokesh", Vanity("imlokesh".into())),
            ("76561198312488313", id()),
            ("https://steamcommunity.com/profiles/76561198312488313", id()),
            ("http://steamcommunity.com/profiles/76561198312488313/inventory?x=1", id()),
            ("https://steamcommunity.com/tradeoffer/new/?partner=352222585&token=abc", id()),
            ("[U:1:352222585]", id()),
            ("STEAM_0:1:176111292", id()),
            ("steam_1:1:176111292", id()),
        ];
        for (input, expected) in cases {
            assert_eq!(parse_profile_input(input).unwrap(), expected, "input: {input}");
        }

        for bad in ["", "   ", "a", "has space", "https://steamcommunity.com/market/", "https://steamcommunity.com/profiles/123", "STEAM_0:5:1", "https://google.com/id/x"] {
            let err = parse_profile_input(bad).unwrap_err();
            assert_eq!(err.status, 400, "input: {bad}");
        }
    }

    /// Hits the real Steam endpoints: `cargo test -- --ignored`
    #[tokio::test]
    #[ignore]
    async fn live_steam() {
        let steam = Steam::new();
        let profile = steam.resolve_profile("https://steamcommunity.com/id/imlokesh/").await.unwrap();
        assert_eq!(profile.steam_id, "76561198312488313");

        let (items, total) = steam.inventory(&profile.steam_id).await.unwrap();
        assert!(!items.is_empty() && total as usize >= items.len());
        println!("{} items, first: {:?}", items.len(), items[0]);

        let price = steam.price("Revolution Case", 24).await.unwrap();
        assert!(price.lowest.is_some());
        println!("Revolution Case: {price:?}");

        let missing = steam.resolve_profile("this-user-should-not-exist-zz9").await.unwrap_err();
        assert_eq!(missing.status, 404);
    }

    #[test]
    fn reads_xml_tags() {
        let xml = "<profile><steamID64>7656</steamID64><steamID><![CDATA[Lorem Ipsum]]></steamID></profile>";
        assert_eq!(xml_tag(xml, "steamID64"), "7656");
        assert_eq!(xml_tag(xml, "steamID"), "Lorem Ipsum");
        assert_eq!(xml_tag(xml, "missing"), "");
    }
}
