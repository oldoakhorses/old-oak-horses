import { PERSON_ALIASES } from "./personAliases";
import { normalizeAliasKey } from "./matchHorse";

type PersonRef = { _id: string; name: string };
type MatchConfidence = "exact" | "alias" | "fuzzy" | "none";

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

export function matchPersonName(
  rawName: string,
  registeredPeople: PersonRef[],
  dynamicAliases: Record<string, string> = {}
): { matchedName: string | null; matchedId: string | null; confidence: MatchConfidence } {
  const cleaned = normalizeAliasKey(rawName);
  if (!cleaned) return { matchedName: null, matchedId: null, confidence: "none" };

  const exactMatch = registeredPeople.find((person) => normalizeAliasKey(person.name) === cleaned);
  if (exactMatch) return { matchedName: exactMatch.name, matchedId: exactMatch._id, confidence: "exact" };

  const staticAlias = PERSON_ALIASES[cleaned];
  if (staticAlias) {
    const person = registeredPeople.find((row) => row.name === staticAlias);
    if (person) return { matchedName: person.name, matchedId: person._id, confidence: "alias" };
  }

  const dynamicAlias = dynamicAliases[cleaned];
  if (dynamicAlias) {
    const person = registeredPeople.find((row) => row.name === dynamicAlias);
    if (person) return { matchedName: person.name, matchedId: person._id, confidence: "alias" };
  }

  const partialMatches = registeredPeople.filter((person) => {
    const dbName = normalizeAliasKey(person.name);
    return dbName.includes(cleaned) || cleaned.includes(dbName.split(" ")[0] ?? "");
  });
  if (partialMatches.length === 1) {
    return { matchedName: partialMatches[0].name, matchedId: partialMatches[0]._id, confidence: "alias" };
  }

  const wordMatches = registeredPeople.filter((person) => {
    const words = normalizeAliasKey(person.name).split(/\s+/);
    return words.some((word) => word === cleaned || cleaned === word);
  });
  if (wordMatches.length === 1) {
    return { matchedName: wordMatches[0].name, matchedId: wordMatches[0]._id, confidence: "alias" };
  }

  let bestMatch: PersonRef | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const person of registeredPeople) {
    const fullName = normalizeAliasKey(person.name);
    const fullDistance = levenshtein(cleaned, fullName);
    if (fullDistance < bestDistance) {
      bestDistance = fullDistance;
      bestMatch = person;
    }
    for (const word of fullName.split(/\s+/)) {
      const wordDistance = levenshtein(cleaned, word);
      if (wordDistance < bestDistance) {
        bestDistance = wordDistance;
        bestMatch = person;
      }
    }
  }

  const maxDistance = cleaned.length <= 4 ? 1 : cleaned.length <= 8 ? 2 : 3;
  if (bestMatch && bestDistance <= maxDistance) {
    return { matchedName: bestMatch.name, matchedId: bestMatch._id, confidence: "fuzzy" };
  }

  return { matchedName: null, matchedId: null, confidence: "none" };
}

