/**
 * Is this a corporate chain?
 *
 * Nathan's preference, in his words: "fast food I don't like means corporate.
 * I don't like corporate." The dislike is of franchise brands, not of quick
 * service — and those are two very different things. Google's
 * `fast_food_restaurant` type is quick-service, and it flags 82 of his own
 * saved favourites: California Sandwiches, Johnny's Hamburgers, Banh Mi Boys,
 * La Banquise, Holy Chuck. Penalising by that type would bury exactly the
 * mom-and-pop spots he loves. So the type is not used at all.
 *
 * Corporate identity lives in the brand name, so this matches names against a
 * curated list of franchises. Seeded from the chains in Nathan's own negative
 * lists, plus the unambiguous national/international brands. Every entry is a
 * multi-location corporate brand, never an independent — the list is validated
 * against the saved places (npm run derive prints any saved place it catches),
 * and a hit there is a bug to fix by tightening the brand, not an acceptable loss.
 *
 * Matching is prefix-anchored on the normalised name, because chains lead with
 * the brand ("Popeyes Louisiana Kitchen", "Burrito Boyz Queen & Spadina"). That
 * avoids catching an independent that merely contains a brand word — "Sushi
 * California" is not "California Sandwiches".
 */

// Lowercased, punctuation-stripped brand prefixes. Order irrelevant.
const CORPORATE_BRANDS = [
  // named in Nathan's negative lists
  "tim hortons", "subway", "pizza hut", "mcdonalds", "taco bell",
  "popeyes", "mary browns", "burrito boyz", "fat bastard burrito",
  "241 pizza", "jimmy johns", "jerk king", "mad radish", "kinton ramen",
  "bourbon st grill", "bourbon street grill", "chungchun rice dog",
  "montanas", "moxies", "earls", "pickle barrel", "la carnita",
  "cafe landwer", "el furniture warehouse", "mandarin restaurant",
  "tahinis", "wilbur mexicana",
  // unambiguous majors not in his lists, so discovery generalises
  "wendys", "burger king", "kfc", "starbucks", "a w", "harveys",
  "dairy queen", "dominos", "little caesars", "five guys", "chipotle",
  "wingstop", "arbys", "jersey mikes", "beavertails", "boston pizza",
  "the keg", "milestones", "jack astors", "kelseys", "swiss chalet",
  "east side marios", "cactus club", "chatime", "gong cha", "presotea",
  "booster juice", "freshii", "panago", "pizzaiolo", "pizza nova",
  "osmows", "basha", "paramount", "lazeez", "panera", "shoeless joes",
  "the works", "big smoke burger", "made in japan", "teriyaki experience",
  "new york fries", "mucho burrito", "quesada", "extreme pita",
  "pita pit", "second cup", "country style", "coffee time",
  "hero certified burgers", "hero burgers", "copacabana", "jimmy the greek",
  "manchu wok", "thai express", "gabbys", "fionn maccools", "scaddabush",
  "the burgers priest", "burgers priest", "smoke s poutinerie",
];

function normalize(name) {
  return (name ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean)
    .join(" ");
}

/**
 * True when the name begins with a known corporate brand. Prefix-anchored and
 * token-aware: "subway" matches "Subway Queen St" but not "subwayer".
 */
export function isCorporateChain(name) {
  const n = normalize(name);
  if (!n) return false;
  return CORPORATE_BRANDS.some((b) => n === b || n.startsWith(b + " "));
}
