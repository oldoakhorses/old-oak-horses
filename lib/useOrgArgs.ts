"use client";

import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Returns args you can spread onto Convex queries that accept an optional
 * `ownerId` filter. When the active org is null ("All horses" view),
 * returns an empty object so the server falls back to its unfiltered
 * behavior.
 *
 * Note: even though the dropdown is called "orgs", the underlying data
 * lives in the `owners` table. The two used to be separate; they've
 * since been consolidated.
 *
 * Usage:
 *   const orgArgs = useOrgArgs();
 *   const horses = useQuery(api.horses.getActiveHorses, orgArgs) ?? [];
 */
export function useOrgArgs(): { ownerId?: Id<"owners"> } {
  const { activeOrgId } = useAuth();
  return useMemo(
    () => (activeOrgId ? { ownerId: activeOrgId as Id<"owners"> } : {}),
    [activeOrgId],
  );
}
