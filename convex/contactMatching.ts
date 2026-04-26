import { CONTACT_ALIASES } from "./contactAliasesStatic";

export type ContactRow = {
  _id: string;
  name: string;
  category?: string;
  slug?: string;
};

export type ContactAliasRow = {
  alias: string;
  contactId: string;
  contactName: string;
};

export type ContactMatchResult = {
  matched: boolean;
  confidence: "exact" | "alias" | "fuzzy" | "none";
  contactId: string | null;
  contactName: string | null;
  category: string | null;
};

/**
 * Match an extracted invoice provider/vendor name against the contacts table.
 *
 * Pure function — caller is responsible for pre-fetching the full contacts
 * list and the contactAliases rows (so it's safe to use from a node action).
 *
 * Matching priority:
 *   1. exact (normalized name equality)
 *   2. static alias (from CONTACT_ALIASES)
 *   3. dynamic alias (contactAliases rows)
 *   4. partial (one substring of the other)
 *   5. Levenshtein distance <= 30% of contact name length
 */
export function matchContact(
  rawName: string,
  contacts: ContactRow[],
  dynamicAliases: ContactAliasRow[] = []
): ContactMatchResult {
  const normalized = normalizeContactName(rawName);
  if (!normalized) {
    return { matched: false, confidence: "none", contactId: null, contactName: null, category: null };
  }

  // 1. Exact match on name
  const exact = contacts.find((c) => normalizeContactName(c.name) === normalized);
  if (exact) return toMatch("exact", exact);

  // 2. Static alias
  const staticTarget = CONTACT_ALIASES[normalized];
  if (staticTarget) {
    const aliasContact = contacts.find((c) => c.name === staticTarget);
    if (aliasContact) return toMatch("alias", aliasContact);
  }

  // 3. Dynamic alias (contactAliases rows)
  const dynamicAlias = dynamicAliases.find((a) => a.alias === normalized);
  if (dynamicAlias) {
    const aliasContact = contacts.find((c) => String(c._id) === String(dynamicAlias.contactId));
    if (aliasContact) return toMatch("alias", aliasContact);
    // Alias row exists but the contact it points at is gone — still report
    // the alias hit so parsing uses the stored name.
    return {
      matched: true,
      confidence: "alias",
      contactId: String(dynamicAlias.contactId),
      contactName: dynamicAlias.contactName,
      category: null,
    };
  }

  // 4. Partial (one name is a substring of the other)
  const partial = contacts.find((c) => {
    const n = normalizeContactName(c.name);
    return n.length > 0 && (normalized.includes(n) || n.includes(normalized));
  });
  if (partial) return toMatch("fuzzy", partial);

  // 5. Fuzzy via Levenshtein, threshold scales with name length
  let best: ContactRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const c of contacts) {
    const n = normalizeContactName(c.name);
    if (!n) continue;
    const distance = levenshteinDistance(normalized, n);
    const threshold = Math.max(2, Math.floor(n.length * 0.3));
    if (distance < bestDistance && distance <= threshold) {
      bestDistance = distance;
      best = c;
    }
  }
  if (best) return toMatch("fuzzy", best);

  return { matched: false, confidence: "none", contactId: null, contactName: null, category: null };
}

function toMatch(confidence: "exact" | "alias" | "fuzzy", contact: ContactRow): ContactMatchResult {
  return {
    matched: true,
    confidence,
    contactId: String(contact._id),
    contactName: contact.name,
    category: contact.category ?? null,
  };
}

export function normalizeContactName(raw: string | null | undefined): string {
  if (!raw) return "";
  return raw
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function levenshteinDistance(a: string, b: string): number {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  const prev = new Array<number>(n + 1);
  const curr = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    for (let j = 0; j <= n; j++) prev[j] = curr[j];
  }
  return prev[n];
}
