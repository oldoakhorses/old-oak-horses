"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/contexts/AuthContext";
import type { Id } from "@/convex/_generated/dataModel";

/**
 * Returns args to spread onto Convex queries that accept an optional
 * `ownerId` filter. Returns {} when no org is active OR when the stored
 * id doesn't map to a real owner — that second case matters because the
 * org→owner consolidation invalidated any activeOrgId saved before the
 * switch. Without the validation, Convex's strict v.id("owners")
 * validator would throw client-side and crash the whole app.
 */
export function useOrgArgs(): { ownerId?: Id<"owners"> } {
  const { activeOrgId, setActiveOrgId } = useAuth();
  const owners = useQuery(api.owners.list);

  // If a stored activeOrgId doesn't exist in the loaded owner list, clear
  // it. Runs as an effect (not during render) so we don't crash.
  useEffect(() => {
    if (!activeOrgId) return;
    if (!owners || owners.length === 0) return;
    const exists = owners.some((o: any) => String(o._id) === activeOrgId);
    if (!exists) setActiveOrgId(null);
  }, [activeOrgId, owners, setActiveOrgId]);

  return useMemo(() => {
    if (!activeOrgId) return {};
    // Owners haven't loaded yet → skip the filter to avoid sending a
    // potentially-stale id. Brief unfiltered flash, then filter applies
    // on the next render once owners load.
    if (!owners) return {};
    const exists = owners.some((o: any) => String(o._id) === activeOrgId);
    if (!exists) return {};
    return { ownerId: activeOrgId as Id<"owners"> };
  }, [activeOrgId, owners]);
}
