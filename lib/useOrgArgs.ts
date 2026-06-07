"use client";

import { useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Returns args you can spread onto Convex queries that accept an optional
 * `organizationId` filter. When the active org is null ("All horses"
 * view), returns an empty object so the server falls back to its
 * unfiltered behavior.
 *
 * Usage:
 *   const orgArgs = useOrgArgs();
 *   const horses = useQuery(api.horses.getActiveHorses, orgArgs) ?? [];
 */
export function useOrgArgs(): { organizationId?: Id<"organizations"> } {
  const { activeOrgId } = useAuth();
  return useMemo(
    () => (activeOrgId ? { organizationId: activeOrgId as Id<"organizations"> } : {}),
    [activeOrgId],
  );
}
