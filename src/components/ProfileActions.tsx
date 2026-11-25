"use client";

import { LogOut, Pause, Unplug } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { lastFmProfile } from "@/shared/media";
import type { Preferences } from "@/server/sync/connections";
import { api } from "./api";
import { syncNow } from "./SyncControl";
import styles from "./ui.module.css";

export function ConnectionForm({ username }: { username?: string }) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLButtonElement>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [problem, setProblem] = useState("");
  const base = useId();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setBusy(true);
    setProblem("");
    setMessage("");
    try {
      await api("/api/lastfm/connection", "POST", {
        username: String(fields.get("username") ?? "").trim(),
        confirmOwnership: fields.get("confirm") === "on",
      });
      setMessage("Connected. Starting your first import…");
      try {
        const result = await syncNow();
        setMessage(
          result.state === "pending"
            ? "Connected. Your import can continue with Sync now or the next daily sync."
            : "Last.fm connected.",
        );
      } catch (error) {
        setMessage("Last.fm connected.");
        setProblem(
          error instanceof Error
            ? error.message
            : "The first sync could not start.",
        );
      }
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Last.fm could not be connected.",
      );
    } finally {
      setBusy(false);
      router.refresh();
    }
  }

  async function remove() {
    setBusy(true);
    setProblem("");
    setMessage("");
    try {
      await api("/api/lastfm/connection", "DELETE");
      dialog.current?.close();
      setMessage("Last.fm disconnected and imported history deleted.");
      router.refresh();
    } catch (error) {
      setProblem(
        error instanceof Error
          ? error.message
          : "Could not disconnect Last.fm.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card} id="connection">
      <h2>Last.fm connection</h2>
      {username ? (
        <div className={styles.connected}>
          <div>
            <strong>Connected</strong>
            <p className={styles.muted}>@{username}</p>
            <a className={styles.textLink} href={lastFmProfile(username)}>
              View on Last.fm
            </a>
          </div>
          <button
            className={styles.danger}
            ref={opener}
            type="button"
            onClick={() => {
              setProblem("");
              dialog.current?.showModal();
            }}
          >
            <Unplug size={17} aria-hidden="true" /> Disconnect and delete
            imported history
          </button>
          <dialog
            className={styles.dialog}
            ref={dialog}
            aria-labelledby={`${base}-title`}
            aria-describedby={`${base}-description`}
            onClose={() => opener.current?.focus()}
            onCancel={(event) => {
              if (busy) event.preventDefault();
            }}
          >
            <h2 id={`${base}-title`}>Delete imported history?</h2>
            <p id={`${base}-description`}>
              Afterhours will disconnect Last.fm and delete your imported plays
              and artwork links.
            </p>
            {problem && (
              <p role="alert" className={styles.error}>
                {problem}
              </p>
            )}
            <div className={styles.actions}>
              <button
                className={styles.secondary}
                disabled={busy}
                type="button"
                onClick={() => dialog.current?.close()}
              >
                Cancel
              </button>
              <button
                className={styles.danger}
                disabled={busy}
                type="button"
                onClick={remove}
              >
                {busy ? "Deleting…" : "Disconnect and delete"}
              </button>
            </div>
          </dialog>
        </div>
      ) : (
        <form onSubmit={submit} className={styles.form}>
          <label htmlFor={`${base}-username`}>Last.fm username</label>
          <input
            id={`${base}-username`}
            name="username"
            required
            autoComplete="off"
          />
          <label className={styles.check}>
            <input type="checkbox" name="confirm" required /> I confirm this is
            my Last.fm account.
          </label>
          <button className={styles.primary} type="submit" disabled={busy}>
            {busy ? "Connecting…" : "Connect Last.fm"}
          </button>
        </form>
      )}
      {message && (
        <p role="status" className={styles.syncDetail}>
          {message}
        </p>
      )}
      {!username && problem && (
        <p role="alert" className={styles.error}>
          {problem}
        </p>
      )}
    </section>
  );
}

export function PreferenceForm({
  preferences,
  suggestZone,
}: {
  preferences: Preferences;
  suggestZone: boolean;
}) {
  const router = useRouter();
  const zone = useRef<HTMLInputElement>(null);
  const [browserZone, setBrowserZone] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ message: string; error: boolean }>();
  const list = useId();
  useEffect(() => {
    const task = window.setTimeout(
      () =>
        setBrowserZone(
          Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        ),
      0,
    );
    return () => window.clearTimeout(task);
  }, []);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setStatus(undefined);
    try {
      await api("/api/preferences", "PATCH", {
        timeZone: String(form.get("timeZone")).trim(),
        reduceMotion: form.get("motion") === "on",
      });
      setStatus({ message: "Preferences saved.", error: false });
      router.refresh();
    } catch (error) {
      setStatus({
        message:
          error instanceof Error
            ? error.message
            : "Preferences could not be saved.",
        error: true,
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={styles.card}>
      <h2>Preferences</h2>
      <form className={styles.form} onSubmit={submit}>
        <label htmlFor={`${list}-time`}>Time zone</label>
        <input
          id={`${list}-time`}
          ref={zone}
          required
          name="timeZone"
          maxLength={100}
          list={list}
          defaultValue={preferences.timeZone}
          autoComplete="off"
        />
        <datalist id={list}>
          <option value="UTC" />
          {Intl.supportedValuesOf("timeZone").map((item) => (
            <option key={item} value={item} />
          ))}
        </datalist>
        {suggestZone && browserZone && browserZone !== preferences.timeZone && (
          <button
            className={styles.secondary}
            type="button"
            onClick={() => {
              if (zone.current) zone.current.value = browserZone;
            }}
          >
            Use browser time zone ({browserZone})
          </button>
        )}
        <label className={styles.check}>
          <input
            type="checkbox"
            name="motion"
            defaultChecked={preferences.reduceMotion}
          />
          <Pause aria-hidden="true" size={17} /> Pause motion
        </label>
        <button className={styles.primary} disabled={busy} type="submit">
          {busy ? "Saving…" : "Save preferences"}
        </button>
      </form>
      {status && (
        <p
          role={status.error ? "alert" : "status"}
          className={status.error ? styles.error : styles.syncDetail}
        >
          {status.message}
        </p>
      )}
    </section>
  );
}

export function SignOut() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      await api("/api/auth/sign-out", "POST", {});
      router.replace("/sign-in");
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        className={styles.secondary}
        disabled={busy}
        type="button"
        onClick={signOut}
      >
        <LogOut size={18} aria-hidden="true" />{" "}
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && (
        <p role="alert" className={styles.error}>
          Sign-out failed. Try again.
        </p>
      )}
    </div>
  );
}
