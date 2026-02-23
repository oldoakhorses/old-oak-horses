"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import styles from "./login.module.css";

type AuthMode = "signIn" | "signUp";

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useAuthActions();

  const [mode, setMode] = useState<AuthMode>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("flow", mode);
      formData.set("email", email);
      formData.set("password", password);

      await signIn("password", formData);
      router.replace("/dashboard");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <section className={styles.left}>
        <div className={styles.formWrap}>
          <h1 className={styles.title}>
            Old Oak <em>Horses</em>
          </h1>

          <form className={styles.form} onSubmit={onSubmit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="email">
                EMAIL
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                className={styles.input}
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>

            <div className={styles.field}>
              <label className={styles.label} htmlFor="password">
                PASSWORD
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                className={styles.input}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <button className={styles.button} type="submit" disabled={isSubmitting}>
              {isSubmitting ? (mode === "signIn" ? "Signing in..." : "Creating account...") : mode === "signIn" ? "Sign in" : "Create account"}
            </button>

            <div className={styles.switchRow}>
              <button
                className={styles.switchButton}
                type="button"
                onClick={() => {
                  setMode("signIn");
                  setErrorMessage("");
                }}
                disabled={mode === "signIn" || isSubmitting}
              >
                Sign in
              </button>
              <span className={styles.switchDivider}>|</span>
              <button
                className={styles.switchButton}
                type="button"
                onClick={() => {
                  setMode("signUp");
                  setErrorMessage("");
                }}
                disabled={mode === "signUp" || isSubmitting}
              >
                Create account
              </button>
            </div>

            {mode === "signIn" ? (
              <a className={styles.forgot} href="#">
                Forgot password?
              </a>
            ) : null}

            {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
          </form>
        </div>
      </section>

      <section className={styles.right} />
    </div>
  );
}
