"use client";

import { FormEvent, useMemo, useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/convex/_generated/api";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const loginMutation = useMutation(api.auth.login);
  const { isAuthenticated, isLoading, login } = useAuth();

  const [email, setEmail] = useState("");
  const [passcode, setPasscode] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showError, setShowError] = useState(false);

  const disabled = useMemo(() => submitting || !email.trim() || !passcode.trim(), [email, passcode, submitting]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      router.replace("/dashboard");
    }
  }, [isAuthenticated, isLoading, router]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    setShowError(false);
    try {
      const result = await loginMutation({ email: email.trim(), passcode });
      if (result.success) {
        login(result.token, {
          id: result.user.id,
          name: result.user.name ?? "",
          email: result.user.email ?? "",
          role: result.user.role ?? undefined,
          ownerId: result.user.ownerId ?? undefined,
        });
        const landingPage = result.user.role === "owner" ? "/horses" : "/dashboard";
        router.replace(landingPage);
      } else {
        setShowError(true);
      }
    } catch (error) {
      console.error("Login error:", error);
      setShowError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.loginPage}>
      <div className={styles.loginForm}>
        <button type="button" className={styles.loginBack} onClick={() => router.push("/")}>
          ← back
        </button>

        <div className={styles.brand}>
          <div className={styles.brandIcon}>O</div>
          <div className={styles.brandName}>old_oak_horses</div>
        </div>

        <div className={styles.header}>
          <p className={styles.headerLabel}>// AUTHENTICATION</p>
          <h1 className={styles.headerTitle}>sign in</h1>
          <p className={styles.headerSubtitle}>enter your credentials to continue</p>
        </div>

        {showError ? (
          <div className={styles.loginError}>
            <span className={styles.errorIcon}>⚠</span>
            <span className={styles.errorText}>invalid email or passcode</span>
          </div>
        ) : null}

        <form onSubmit={onSubmit}>
          <label className={styles.fieldLabel} htmlFor="email">
            EMAIL
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@oldoakhorses.com"
            className={styles.fieldInput}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <div className={styles.passwordLabelRow}>
            <label className={styles.fieldLabel} htmlFor="passcode">
              PASSCODE
            </label>
          </div>
          <input
            id="passcode"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            className={`${styles.fieldInput} ${styles.passwordInput}`}
            value={passcode}
            onChange={(event) => setPasscode(event.target.value)}
          />

          <button type="submit" className={styles.btnSignin} disabled={disabled}>
            {submitting ? "signing in..." : "sign in"}
          </button>
        </form>

        <div className={styles.loginDivider} />

        <a href="/investor" className={styles.btnInvestor}>
          investor dashboard →
        </a>

        <a className={styles.contactLink} href="mailto:lucy@oldoakhorses.com">
          contact us
        </a>
      </div>

      <div className={styles.loginFooter}>OLD_OAK_HORSES // BILL MANAGEMENT</div>
    </div>
  );
}
