"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";
import { signOut, errorMessage } from "../client/api";
import { useAuth, useCart } from "./providers";
import { Icon } from "./icon";

export function Logo() {
  return (
    <span className="wordmark">
      <span className="logo-mark">
        <svg aria-hidden="true" viewBox="0 0 28 28" fill="none">
          <path
            d="M6 6h16v16H6zM6 14h16M14 6v16M10 10h8v8h-8z"
            stroke="currentColor"
            strokeWidth="1.5"
          />
        </svg>
      </span>
      turfit<span className="logo-dot">.</span>
    </span>
  );
}
export function SiteHeader() {
  const { user, loading } = useAuth();
  const { cart } = useCart();
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function logout() {
    setBusy(true);
    setError("");
    try {
      await signOut();
      setOpen(false);
      router.push("/");
    } catch (error) {
      setError(errorMessage(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <header className="site-header">
      <div className="container header-inner">
        <Link href="/" aria-label="Turfit home" onClick={() => setOpen(false)}>
          <Logo />
        </Link>
        <nav
          className={`navigation ${open ? "is-open" : ""}`}
          aria-label="Main navigation"
        >
          <Link
            className={
              path === "/" || path.startsWith("/venues") ? "active" : ""
            }
            href="/"
            onClick={() => setOpen(false)}
          >
            Find a venue
          </Link>
          <Link
            className={path.startsWith("/bookings") ? "active" : ""}
            href="/bookings"
            onClick={() => setOpen(false)}
          >
            My bookings
          </Link>
          {user?.role === "ADMIN" && (
            <Link
              className={path.startsWith("/admin") ? "active" : ""}
              href="/admin"
              onClick={() => setOpen(false)}
            >
              Manage venues
            </Link>
          )}
        </nav>
        <div className="header-actions">
          {cart && (
            <Link
              href="/checkout"
              className="selection-link"
              aria-label={`Review ${cart.items.length} selected slots`}
            >
              <Icon name="ticket" />
              <span>{cart.items.length}</span>
            </Link>
          )}
          {loading ? (
            <span className="auth-placeholder" />
          ) : user ? (
            <>
              <span className="account-name">
                <Icon name="user" size={17} />
                {user.name.split(" ")[0]}
              </span>
              <button
                className="icon-button"
                disabled={busy}
                aria-label="Sign out"
                title="Sign out"
                onClick={() => void logout()}
              >
                <Icon name="logout" />
              </button>
            </>
          ) : (
            <Link
              className="button button-small button-dark"
              href={`/login?next=${encodeURIComponent(path)}`}
            >
              Sign in <Icon name="arrow" size={16} />
            </Link>
          )}
          <button
            className="icon-button mobile-menu"
            aria-label={open ? "Close navigation" : "Open navigation"}
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            <Icon name={open ? "close" : "menu"} />
          </button>
        </div>
      </div>
      {error && (
        <p className="header-error" role="alert">
          {error}
        </p>
      )}
    </header>
  );
}
export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container footer-inner">
        <Link href="/" aria-label="Turfit home">
          <Logo />
        </Link>
        <p>Less planning. More playing.</p>
        <span>Find your court. Make it a game.</span>
      </div>
    </footer>
  );
}
