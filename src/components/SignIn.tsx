"use client";

import { useState } from "react";
import { LogIn } from "lucide-react";
import { api } from "./api";
import styles from "./ui.module.css";

export function SignIn({ unavailable }: { unavailable: boolean }) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function start() {
    setBusy(true);
    setFailed(false);
    try {
      const origin = window.location.origin;
      const result = await api<{ url: string }>(
        "/api/auth/sign-in/social",
        "POST",
        {
          provider: "github",
          callbackURL: `${origin}/dashboard`,
          errorCallbackURL: `${origin}/sign-in`,
        },
      );
      const url = new URL(result.url);
      if (
        url.origin !== "https://github.com" ||
        url.pathname !== "/login/oauth/authorize"
      )
        throw new Error();
      window.location.assign(url.href);
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        className={styles.primary}
        disabled={busy || unavailable}
        onClick={start}
      >
        <LogIn aria-hidden="true" size={20} />{" "}
        {busy ? "Opening GitHub…" : "Continue with GitHub"}
      </button>
      {failed && (
        <p role="alert" className={styles.error}>
          GitHub sign-in could not start. Try again.
        </p>
      )}
    </>
  );
}
