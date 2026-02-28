"use client";

import Image from "next/image";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./page.module.css";

export default function LoginPage() {
  const router = useRouter();
  const convex = useConvex();
  const { signIn } = useAuthActions();

  const [email, setEmail] = useState("lucy@oldoakhorses.com");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showError, setShowError] = useState(false);

  const disabled = useMemo(() => submitting || !email.trim() || !password.trim(), [email, password, submitting]);

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (disabled) return;
    setSubmitting(true);
    setShowError(false);
    try {
      const formData = new FormData();
      formData.set("flow", "signIn");
      formData.set("email", email.trim());
      formData.set("password", password);
      await signIn("password", formData);
      const user = await convex.query(api.users.currentUser, {});
      router.replace(user?.role === "investor" ? "/investor" : "/dashboard");
    } catch {
      setShowError(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.imagePanel}>
        <Image src="/login-hero.jpg" alt="Show jumping" fill priority sizes="(max-width: 900px) 0px, 60vw" />
      </section>

      <section className={styles.formPanel}>
        <div className={styles.formInner}>
          <button type="button" className={styles.loginBack} onClick={() => router.push("/")}>
            ← back
          </button>

          <div className={styles.brandMark}>
            <div className={styles.brandIcon}>O</div>
            <div className={styles.brandName}>old_oak_horses</div>
          </div>

          <div className={styles.headerWrap}>
            <div className={styles.kicker}>// AUTHENTICATION</div>
            <h1 className={styles.title}>sign in</h1>
            <p className={styles.subtitle}>enter your credentials to continue</p>
          </div>

          {showError ? (
            <div className={styles.errorBanner}>
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
              className={styles.input}
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />

            <div className={styles.passwordRow}>
              <label className={styles.fieldLabel} htmlFor="password">
                PASSWORD
              </label>
              <a href="mailto:lucy@oldoakhorses.com" className={styles.forgot}>
                forgot?
              </a>
            </div>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••••••"
              className={styles.input}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
            />

            <button type="submit" className={styles.signInBtn} disabled={disabled}>
              {submitting ? "signing in..." : "sign in"}
            </button>
          </form>

          <div className={styles.divider} />

          <a href="/investor" className={styles.investorBtn}>
            investor dashboard →
          </a>

          <a className={styles.contact} href="mailto:lucy@oldoakhorses.com">
            contact us
          </a>
        </div>

        <div className={styles.footer}>OLD_OAK_HORSES // BILL MANAGEMENT</div>
      </section>
    </div>
  );
}
