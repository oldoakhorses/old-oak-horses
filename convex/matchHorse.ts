import { HORSE_ALIASES } from "./horseAliases";

type HorseRef = { _id: string; name: string };

export type MatchConfidence = "exact" | "alias" | "fuzzy" | "none";

export function normalizeAliasKey(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function levenshtein(a: string, b: string): number {
  const matrix: number[][] = [];
  for (let i = 0; i <= a.length; i += 1) matrix[i] = [i];
  for (let j = 0; j <= b.length; j += 1) matrix[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      matrix[i][j] = Math.min(matrix[i - 1][j] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j - 1] + cost);
    }
  }
  return matrix[a.length][b.length];
}

export function matchHorseName(
  rawName: string,
  registeredHorses: HorseRef[],
  dynamicAliases: Record<string, string> = {}
): { matchedName: string | null; matchedId: string | null; confidence: MatchConfidence } {
  const cleaned = normalizeAliasKey(rawName);
  if (!cleaned) return { matchedName: null, matchedId: null, confidence: "none" };

  const exactMatch = registeredHorses.find((horse) => normalizeAliasKey(horse.name) === cleaned);
  if (exactMatch) return { matchedName: exactMatch.name, matchedId: exactMatch._id, confidence: "exact" };

  const staticAlias = HORSE_ALIASES[cleaned];
  if (staticAlias) {
    const horse = registeredHorses.find((row) => row.name === staticAlias);
    if (horse) return { matchedName: horse.name, matchedId: horse._id, confidence: "alias" };
  }

  const dynamicAlias = dynamicAliases[cleaned];
  if (dynamicAlias) {
    const horse = registeredHorses.find((row) => row.name === dynamicAlias);
    if (horse) return { matchedName: horse.name, matchedId: horse._id, confidence: "alias" };
  }

  const partialMatches = registeredHorses.filter((horse) => {
    const dbName = normalizeAliasKey(horse.name);
    return dbName.includes(cleaned) || cleaned.includes(dbName.split(" ")[0] ?? "");
  });
  if (partialMatches.length === 1) {
    return { matchedName: partialMatches[0].name, matchedId: partialMatches[0]._id, confidence: "alias" };
  }

  const wordMatches = registeredHorses.filter((horse) => {
    const words = normalizeAliasKey(horse.name).split(/\s+/);
    return words.some((word) => word === cleaned || cleaned === word);
  });
  if (wordMatches.length === 1) {
    return { matchedName: wordMatches[0].name, matchedId: wordMatches[0]._id, confidence: "alias" };
  }

  let bestMatch: HorseRef | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const horse of registeredHorses) {
    const fullName = normalizeAliasKey(horse.name);
    const fullDistance = levenshtein(cleaned, fullName);
    if (fullDistance < bestDistance) {
      bestDistance = fullDistance;
      bestMatch = horse;
    }
    for (const word of fullName.split(/\s+/)) {
      const wordDistance = levenshtein(cleaned, word);
      if (wordDistance < bestDistance) {
        bestDistance = wordDistance;
        bestMatch = horse;
      }
    }
  }

  const maxDistance = cleaned.length <= 4 ? 1 : cleaned.length <= 8 ? 2 : 3;
  if (bestMatch && bestDistance <= maxDistance) {
    return { matchedName: bestMatch.name, matchedId: bestMatch._id, confidence: "fuzzy" };
  }

  return { matchedName: null, matchedId: null, confidence: "none" };
}

