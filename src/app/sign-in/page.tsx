import type { Metadata } from "next";
import { Disc3 } from "lucide-react";
import { SignIn } from "@/components/SignIn";
import styles from "@/components/ui.module.css";
import { getAuth } from "@/server/auth";
import { allowedIds } from "@/server/env";

export const metadata: Metadata = { title: "Sign in" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  let unavailable = error === "configuration";
  try {
    allowedIds();
    getAuth();
  } catch {
    unavailable = true;
  }
  const message = unavailable
    ? "Afterhours is missing required configuration. Contact the operator."
    : error?.toLowerCase() === "invite_required"
      ? "This GitHub account needs an invite."
      : error
        ? "GitHub sign-in could not be completed. Try again."
        : null;

  return (
    <main className={styles.signIn}>
      <section className={styles.signInCard}>
        <Disc3
          size={59}
          strokeWidth={1.2}
          aria-hidden="true"
          className={styles.signInDisc}
        />
        <h1>Afterhours</h1>
        <p>Your private listening history.</p>
        {message && (
          <p role="alert" className={styles.error}>
            {message}
          </p>
        )}
        <SignIn unavailable={unavailable} />
      </section>
    </main>
  );
}
