"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { ClientError, errorMessage, signIn } from "../client/api";
import { safeReturnPath } from "../client/format";
import { useAuth } from "./providers";
import { Icon } from "./icon";
import { Notice } from "./ui";

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const { user, loading } = useAuth();
  const register = mode === "register";
  const [next, setNext] = useState("/");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [issues, setIssues] = useState<
    Array<{ field: string; message: string }>
  >([]);
  useEffect(() => {
    setNext(
      safeReturnPath(new URLSearchParams(window.location.search).get("next")),
    );
  }, []);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setError("");
    setIssues([]);
    setBusy(true);
    try {
      await signIn(mode, {
        email: String(fields.get("email")),
        password: String(fields.get("password")),
        ...(register ? { name: String(fields.get("name")) } : {}),
      });
      router.replace(next);
      router.refresh();
    } catch (error) {
      setError(errorMessage(error));
      if (error instanceof ClientError) setIssues(error.issues);
    } finally {
      setBusy(false);
    }
  }
  const hint = (field: string) =>
    issues.find((issue) => issue.field === field)?.message;
  return (
    <main className="container auth-page">
      <section className="auth-story">
        <span className="eyebrow">MAKE ROOM FOR PLAY</span>
        <h1>
          Good games.
          <br />
          Great company.
          <br />
          <em>Your kind of place.</em>
        </h1>
        <p>
          A little less screen time.
          <br />A little more court time.
        </p>
        <div className="auth-court" aria-hidden="true">
          <Icon name="court" size={240} />
        </div>
      </section>
      <section className="auth-panel">
        <Link className="back-link" href="/">
          <Icon name="arrow" className="rotate" size={17} />
          Back to venues
        </Link>
        <span className="eyebrow">
          {register ? "JOIN THE GAME" : "WELCOME BACK"}
        </span>
        <h2>
          {register ? "Let’s get you playing." : "Your court is calling."}
        </h2>
        <p>
          {register
            ? "Create your account to book a little time for yourself."
            : "Sign in to book your next game or manage your plans."}
        </p>
        {!loading && user ? (
          <div className="stack">
            <Notice kind="success">
              You’re already signed in as {user.name}.
            </Notice>
            <Link className="button" href={next}>
              Continue <Icon name="arrow" />
            </Link>
          </div>
        ) : (
          <form onSubmit={(event) => void submit(event)} className="form-stack">
            {error && <Notice>{error}</Notice>}
            {register && (
              <label>
                Full name
                <input
                  name="name"
                  autoComplete="name"
                  required
                  maxLength={120}
                  disabled={busy}
                  aria-invalid={Boolean(hint("name"))}
                />
                {hint("name") && (
                  <span className="field-error">{hint("name")}</span>
                )}
              </label>
            )}
            <label>
              Email address
              <input
                type="email"
                name="email"
                autoComplete="email"
                required
                maxLength={254}
                disabled={busy}
                placeholder="you@example.com"
                aria-invalid={Boolean(hint("email"))}
              />
              {hint("email") && (
                <span className="field-error">{hint("email")}</span>
              )}
            </label>
            <label>
              Password
              <input
                type="password"
                name="password"
                autoComplete={register ? "new-password" : "current-password"}
                required
                minLength={register ? 15 : 1}
                maxLength={register ? 256 : 512}
                disabled={busy}
                aria-invalid={Boolean(hint("password"))}
              />
              {register && (
                <span className="field-hint">
                  Use a memorable passphrase of 15–128 characters.
                </span>
              )}
              {hint("password") && (
                <span className="field-error">{hint("password")}</span>
              )}
            </label>
            <button className="button button-full" disabled={busy}>
              {busy ? "One moment…" : register ? "Create account" : "Sign in"}
              <Icon name="arrow" size={18} />
            </button>
          </form>
        )}
        <p className="auth-switch">
          {register ? "Already part of the game?" : "New to Turfit?"}{" "}
          <Link
            href={`/${register ? "login" : "register"}?next=${encodeURIComponent(next)}`}
          >
            {register ? "Sign in" : "Create an account"}
          </Link>
        </p>
        <div className="auth-note">
          <Icon name="shield" size={17} />
          Your selection stays with you while you sign in.
        </div>
      </section>
    </main>
  );
}
