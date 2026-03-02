"use client";

import { FormEvent, useMemo, useState } from "react";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAction } from "convex/react";
import { useAuth } from "@/contexts/AuthContext";
import { api } from "@/convex/_generated/api";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const loginAction = useAction(api.auth.login);
  const { isAuthenticated, isLoading, login } = useAuth();

  const [email, setEmail] = useState("lucy@oldoakhorses.com");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showError, setShowError] = useState(false);

  const disabled = useMemo(() => submitting || !email.trim() || !password.trim(), [email, password, submitting]);

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
      const result = await loginAction({ email: email.trim(), password });
      if (result.success) {
        login();
        router.replace("/dashboard");
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
            <span className={styles.errorText}>invalid email or password</span>
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
            placeholder="lucy@oldoakhorses.com"
            className={styles.fieldInput}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />

          <div className={styles.passwordLabelRow}>
            <label className={styles.fieldLabel} htmlFor="password">
              PASSWORD
            </label>
            <a href="mailto:lucy@oldoakhorses.com" className={styles.forgotLink}>
              forgot?
            </a>
          </div>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••••••"
            className={`${styles.fieldInput} ${styles.passwordInput}`}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
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
