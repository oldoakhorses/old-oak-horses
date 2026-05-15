"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";

type User = {
  id: string;
  name: string;
  email: string;
  role?: "admin" | "investor";
};

type AuthContextValue = {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
};

const AuthContext = createContext<AuthContextValue | null>(null);

const TOKEN_KEY = "session_token";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [hasCheckedStorage, setHasCheckedStorage] = useState(false);

  useEffect(() => {
    setToken(localStorage.getItem(TOKEN_KEY));
    setHasCheckedStorage(true);
  }, []);

  const sessionUser = useQuery(
    api.auth.validateSession,
    hasCheckedStorage && token ? { token } : "skip"
  );

  const logoutMutation = useMutation(api.auth.logout);

  const isLoading = !hasCheckedStorage || (!!token && sessionUser === undefined);
  const user: User | null = sessionUser
    ? { id: sessionUser.id, name: sessionUser.name ?? "", email: sessionUser.email ?? "", role: sessionUser.role }
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
    setToken(null);
    if (t) {
      try {
        await logoutMutation({ token: t });
      } catch {
        // ignore
      }
    }
  }, [logoutMutation]);

  const value = useMemo(
    () => ({ isAuthenticated, isLoading, user, login, logout }),
    [isAuthenticated, isLoading, user, login, logout]
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
