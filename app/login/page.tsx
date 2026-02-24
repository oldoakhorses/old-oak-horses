"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { useAuthActions } from "@convex-dev/auth/react";
import { useConvex } from "convex/react";
import { api } from "@/convex/_generated/api";
import styles from "./login.module.css";

type LoginView = "signIn" | "requestReset" | "verifyReset";

export default function LoginPage() {
  const router = useRouter();
  const convex = useConvex();
  const { signIn } = useAuthActions();

  const [view, setView] = useState<LoginView>("signIn");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [resetCode, setResetCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [infoMessage, setInfoMessage] = useState("");

  const redirectByRole = async () => {
    const user = await convex.query(api.users.currentUser, {});
    if (user?.role === "admin") {
      router.replace("/dashboard");
      return;
    }
    router.replace("/investor");
  };

  const onSignIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("flow", "signIn");
      formData.set("email", email);
      formData.set("password", password);

      await signIn("password", formData);
      await redirectByRole();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Sign in failed";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onRequestReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("flow", "reset");
      formData.set("email", email);

      await signIn("password", formData);
      setView("verifyReset");
      setInfoMessage("Reset code sent. Check your email.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to send reset code";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const onVerifyReset = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setInfoMessage("");
    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.set("flow", "reset-verification");
      formData.set("email", email);
      formData.set("code", resetCode);
      formData.set("newPassword", newPassword);

      await signIn("password", formData);
      await redirectByRole();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Password reset failed";
      setErrorMessage(message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={styles.page}>
      <div className={styles.wrap}>
        <p className={styles.brand}>old-oak-horses</p>
        <div className={styles.section}>// login</div>

        <section className={styles.card}>
          {view === "signIn" ? (
            <form className={styles.form} onSubmit={onSignIn}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="email">
                  Email
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
                  Password
                </label>
                <div className={styles.inputWrap}>
                  <input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="current-password"
                    required
                    className={styles.input}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <button type="button" className={styles.eye} onClick={() => setShowPassword((v) => !v)}>
                    {showPassword ? "hide" : "show"}
                  </button>
                </div>
              </div>

              <button className={styles.button} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "signing in..." : "sign in"}
              </button>

              <button
                className={styles.forgot}
                type="button"
                onClick={() => {
                  setView("requestReset");
                  setErrorMessage("");
                  setInfoMessage("");
                }}
              >
                forgot password?
              </button>

              {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
            </form>
          ) : null}

          {view === "requestReset" ? (
            <form className={styles.form} onSubmit={onRequestReset}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reset-email">
                  Email
                </label>
                <input
                  id="reset-email"
                  type="email"
                  autoComplete="email"
                  required
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <button className={styles.button} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "sending..." : "send reset code"}
              </button>
              <button
                type="button"
                className={styles.back}
                onClick={() => {
                  setView("signIn");
                  setErrorMessage("");
                  setInfoMessage("");
                }}
              >
                back to sign in
              </button>
              {infoMessage ? <p className={styles.info}>{infoMessage}</p> : null}
              {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
            </form>
          ) : null}

          {view === "verifyReset" ? (
            <form className={styles.form} onSubmit={onVerifyReset}>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="verify-email">
                  Email
                </label>
                <input
                  id="verify-email"
                  type="email"
                  autoComplete="email"
                  required
                  className={styles.input}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="reset-code">
                  Reset Code
                </label>
                <input
                  id="reset-code"
                  required
                  className={styles.input}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                />
              </div>
              <div className={styles.field}>
                <label className={styles.label} htmlFor="new-password">
                  New Password
                </label>
                <input
                  id="new-password"
                  type="password"
                  required
                  className={styles.input}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>
              <button className={styles.button} type="submit" disabled={isSubmitting}>
                {isSubmitting ? "resetting..." : "reset password"}
              </button>
              <button
                type="button"
                className={styles.back}
                onClick={() => {
                  setView("signIn");
                  setErrorMessage("");
                  setInfoMessage("");
                }}
              >
                back to sign in
              </button>
              {infoMessage ? <p className={styles.info}>{infoMessage}</p> : null}
              {errorMessage ? <p className={styles.error}>{errorMessage}</p> : null}
            </form>
          ) : null}
        </section>

        <div className={styles.footer}>OLD_OAK_HORSES // LOGIN</div>
      </div>
    </div>
  );
}
