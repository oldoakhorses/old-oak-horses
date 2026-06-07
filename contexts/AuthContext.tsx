"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type UserRole = "admin" | "owner" | "team" | "investor";

type User = {
  id: string;
  name: string;
  email: string;
  role?: UserRole;
  ownerId?: string;
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  /** Currently-selected org for filtering. null = "All orgs" / not yet picked. */
  activeOrgId: string | null;
  setActiveOrgId: (orgId: string | null) => void;
  login: (token: string, user: User) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "session_token";
const ACTIVE_ORG_KEY = "active_org_id";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false);
  const [activeOrgId, setActiveOrgIdState] = useState<string | null>(null);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    setActiveOrgIdState(localStorage.getItem(ACTIVE_ORG_KEY));
    setHasCheckedStorage(true);
  }, []);

  const setActiveOrgId = useCallback((orgId: string | null) => {
    if (orgId) {
      localStorage.setItem(ACTIVE_ORG_KEY, orgId);
    } else {
      localStorage.removeItem(ACTIVE_ORG_KEY);
    }
    setActiveOrgIdState(orgId);
  }, []);

  const sessionUser = useQuery(
    api.auth.validateSession,
    hasCheckedStorage && token ? { token } : "skip"
  );

  const logoutMutation = useMutation(api.auth.logout);

  const isLoading = !hasCheckedStorage || (!!token && sessionUser === undefined);
  const user: User | null = sessionUser
    ? { id: sessionUser.id, name: sessionUser.name ?? "", email: sessionUser.email ?? "", role: sessionUser.role ?? undefined, ownerId: sessionUser.ownerId ?? undefined }
    : null;
  const isAuthenticated = !!user;

  useEffect(() => {
    if (hasCheckedStorage && token && sessionUser === null) {
      localStorage.removeItem(TOKEN_KEY);
      setToken(null);
    }
  }, [hasCheckedStorage, token, sessionUser]);

  const login = useCallback((newToken: string, _user: User) => {
    localStorage.setItem(TOKEN_KEY, newToken);
    setToken(newToken);
  }, []);

  const logout = useCallback(async () => {
    const t = localStorage.getItem(TOKEN_KEY);
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ACTIVE_ORG_KEY);
    setToken(null);
    setActiveOrgIdState(null);
    if (t) {
      try {
        await logoutMutation({ token: t });
      } catch {
        // ignore
      }
    }
  }, [logoutMutation]);

  const value = useMemo(
    () => ({ isAuthenticated, isLoading, user, activeOrgId, setActiveOrgId, login, logout }),
    [isAuthenticated, isLoading, user, activeOrgId, setActiveOrgId, login, logout]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used within AuthProvider");
  }
  return ctx;
}
