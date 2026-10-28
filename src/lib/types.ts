export interface InventoryItem {
  assetId: string;
  name: string;
  marketHashName: string;
  type: string;
  category: string;
  weapon: string;
  rarity: string;
  rarityColor: string;
  exterior: string;
  quality: string;
  collection: string;
  nameColor: string;
  icon: string;
  tradable: boolean;
  marketable: boolean;
  amount: number;
}

export interface Profile {
  steamId: string;
  persona: string;
  avatar: string;
}

export interface InventoryResponse {
  profile: Profile;
  items: InventoryItem[];
  total: number;
  fetchedAt: number;
}

export interface Price {
  lowest: number | null;
  median: number | null;
  volume: number;
}

export type PriceState = { status: "pending" } | { status: "error" } | ({ status: "done" } & Price);

/** Identical items (same market hash name) collapsed into one row. */
export interface Stack {
  key: string;
  item: InventoryItem;
  quantity: number;
  tradable: number;
  unitPrice: number | null;
  total: number | null;
  volume: number;
  priceStatus: PriceState["status"] | "unmarketable";
}

export type PriceBasis = "lowest" | "median";
