// Weapon-skin and sticker/agent rarities share tiers; map both to one rank.
const RANK: Record<string, number> = {
  "Base Grade": 0,
  "Consumer Grade": 0,
  "Industrial Grade": 1,
  "High Grade": 2,
  "Mil-Spec Grade": 2,
  Distinguished: 2,
  Remarkable: 3,
  Restricted: 3,
  Exceptional: 3,
  Classified: 4,
  Exotic: 4,
  Superior: 4,
  Covert: 5,
  Extraordinary: 5,
  Master: 5,
  Contraband: 6,
};

export function rarityRank(rarity: string) {
  return RANK[rarity] ?? -1;
}

export function steamImage(icon: string, size = 256) {
  return `https://community.fastly.steamstatic.com/economy/image/${icon}/${size}fx${size}f`;
}
