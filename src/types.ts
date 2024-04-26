interface Config {
  timeBetweenUpdates: number;
  tradersToLimit: string[];
  categories: entry[];
  defaultBase: number;
  defaultRandom: number;
  defaultChanceForNoStock: number;
  removeMaxBuyRestrictions: boolean;
  loyaltyMixup: boolean;
  loyaltyMixupChance2: number;
  loyaltyMixupChance3: number;
  loyaltyMixupChance4: number;
}

interface entry {
  base: number;
  random: number;
  chanceForNoStock: number;
}