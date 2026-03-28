import { PROVIDER_ALIASES } from "./providerAliases";

type ProviderRow = {
  _id: string;
  name: string;
  categorySlug: string;
  subcategorySlug?: string;
};

export type ProviderMatchResult = {
  matched: boolean;
  confidence: "exact" | "alias" | "fuzzy" | "none";
  providerName: string | null;
  providerId: string | null;
  category: string | null;
  subcategory: string | null;
};

export async function matchProvider(ctx: any, rawName: string, providers: ProviderRow[]): Promise<ProviderMatchResult> {
  const normalized = normalizeProviderName(rawName);
  if (!normalized) {
    return {
      matched: false,
      confidence: "none",
      providerName: null,
      providerId: null,
      category: null,
      subcategory: null,
    };
  }

  const exact = providers.find((provider) => normalizeProviderName(provider.name) === normalized);
  if (exact) {
    return toMatch("exact", exact);
  }

  const staticAlias = PROVIDER_ALIASES[normalized];
  if (staticAlias) {
    const aliasProvider = providers.find((provider) => provider.name === staticAlias);
    if (aliasProvider) {
      return toMatch("alias", aliasProvider);
    }
  }

  const dynamicAlias = await ctx.db
    .query("providerAliases")
    .withIndex("by_alias", (q: any) => q.eq("alias", normalized))
    .first();
  if (dynamicAlias) {
    return {
      matched: true,
      confidence: "alias",
      providerName: dynamicAlias.providerName,
      providerId: dynamicAlias.providerId,
      category: dynamicAlias.category,
      subcategory: null,
    };
  }

  const partial = providers.find((provider) => {
    const providerNormalized = normalizeProviderName(provider.name);
    return normalized.includes(providerNormalized) || providerNormalized.includes(normalized);
  });
  if (partial) {
    return toMatch("fuzzy", partial);
  }

  let best: ProviderRow | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const provider of providers) {
    const providerNormalized = normalizeProviderName(provider.name);
    const distance = levenshteinDistance(normalized, providerNormalized);
    const threshold = Math.max(2, Math.floor(providerNormalized.length * 0.3));
    if (distance < bestDistance && distance <= threshold) {
      bestDistance = distance;
      best = provider;
    }
  }

  if (best) {
    return toMatch("fuzzy", best);
  }

  return {
    matched: false,
    confidence: "none",
    providerName: null,
    providerId: null,
    category: null,
    subcategory: null,
  };
}

function toMatch(confidence: "exact" | "alias" | "fuzzy", provider: ProviderRow): ProviderMatchResult {
  return {
    matched: true,
    confidence,
    providerName: provider.name,
    providerId: provider._id,
    category: provider.categorySlug,
    subcategory: provider.subcategorySlug ?? null,
  };
}

export function normalizeProviderName(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s.&-]/g, "")
    .replace(/\s+/g, " ");
}

function levenshteinDistance(a: string, b: string): number {
  const matrix = Array.from({ length: a.length + 1 }, (_, i) =>
    Array.from({ length: b.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0))
  );

  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      matrix[i][j] =
        a[i - 1] === b[j - 1]
          ? matrix[i - 1][j - 1]
          : 1 + Math.min(matrix[i - 1][j], matrix[i][j - 1], matrix[i - 1][j - 1]);
    }
  }

  return matrix[a.length][b.length];
}
