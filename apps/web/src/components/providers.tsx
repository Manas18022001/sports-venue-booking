"use client";

import {
  Fragment,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { errorMessage, loadSession, subscribeSession } from "../client/api";
import type { Slot, User, Venue } from "../client/contracts";
import { readCart } from "../client/cart";
import type { Cart } from "../client/cart";
import { EmptyState, Notice, Spinner } from "./ui";

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string;
  reload: () => void;
};
const AuthContext = createContext<AuthState>({
  user: null,
  loading: true,
  error: "",
  reload: () => undefined,
});
type CartState = {
  cart: Cart | null;
  ready: boolean;
  toggle: (venue: Venue, slot: Slot, replace?: boolean) => boolean;
  remove: (id: string) => void;
  clear: () => void;
  pending: (userId: string | null) => void;
};
const CartContext = createContext<CartState | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [cart, setCart] = useState<Cart | null>(null);
  const [ready, setReady] = useState(false);
  const reload = () => {
    setLoading(true);
    setError("");
    void loadSession(true)
      .then(setUser)
      .catch((error) => setError(errorMessage(error)))
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    const unsubscribe = subscribeSession((value) => {
      setUser(value);
      setError("");
      setLoading(false);
    });
    void loadSession()
      .then(setUser)
      .catch((error) => setError(errorMessage(error)))
      .finally(() => setLoading(false));
    try {
      setCart(readCart(sessionStorage.getItem("turfit-selection")));
    } catch {
      /* Private browsing may disable storage. */
    }
    setReady(true);
    return unsubscribe;
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      if (cart)
        sessionStorage.setItem("turfit-selection", JSON.stringify(cart));
      else sessionStorage.removeItem("turfit-selection");
    } catch {
      /* In-memory selection still works. */
    }
  }, [cart, ready]);
  const toggle: CartState["toggle"] = (venue, slot, replace = false) => {
    if (cart?.pendingUserId) return false;
    if (cart && cart.venue.id !== venue.id && !replace) return false;
    const current = cart?.venue.id === venue.id ? cart.items : [];
    const exists = current.some((item) => item.id === slot.id);
    const items = exists
      ? current.filter((item) => item.id !== slot.id)
      : [
          ...current,
          {
            id: slot.id,
            courtId: slot.courtId,
            courtName: slot.courtName,
            sport: slot.sport,
            startsAt: slot.startsAt,
            endsAt: slot.endsAt,
            priceMinor: slot.priceMinor,
            version: slot.version,
          },
        ];
    if (items.length > 500) return false;
    setCart(
      items.length
        ? {
            venue: {
              id: venue.id,
              name: venue.name,
              timezone: venue.timezone,
              currency: venue.currency,
            },
            items,
            key: crypto.randomUUID(),
            pendingUserId: null,
          }
        : null,
    );
    return true;
  };
  return (
    <AuthContext.Provider value={{ user, loading, error, reload }}>
      <CartContext.Provider
        value={{
          cart,
          ready,
          toggle,
          remove: (id) =>
            setCart((previous) => {
              if (!previous || previous.pendingUserId) return previous;
              const items = previous.items.filter((item) => item.id !== id);
              return items.length
                ? { ...previous, items, key: crypto.randomUUID() }
                : null;
            }),
          clear: () => setCart(null),
          pending: (userId) =>
            setCart((previous) =>
              previous ? { ...previous, pendingUserId: userId } : null,
            ),
        }}
      >
        {children}
      </CartContext.Provider>
    </AuthContext.Provider>
  );
}
export function useAuth() {
  return useContext(AuthContext);
}
export function useCart() {
  const context = useContext(CartContext);
  if (!context) throw new Error("Cart provider is missing.");
  return context;
}
export function AuthGate({
  children,
  admin = false,
}: {
  children: ReactNode;
  admin?: boolean;
}) {
  const auth = useAuth();
  const path = usePathname();
  if (auth.loading)
    return (
      <div className="page-loader">
        <Spinner label="Checking your session" />
      </div>
    );
  if (auth.error)
    return (
      <div className="container section">
        <Notice>{auth.error}</Notice>
        <button className="button button-secondary" onClick={auth.reload}>
          Try again
        </button>
      </div>
    );
  if (!auth.user)
    return (
      <div className="container section">
        <EmptyState
          title="Your next game is one sign-in away"
          icon="ticket"
          action={
            <Link
              className="button"
              href={`/login?next=${encodeURIComponent(path)}`}
            >
              Sign in to continue
            </Link>
          }
        >
          Sign in to manage your bookings. Your selected slots will stay here.
        </EmptyState>
      </div>
    );
  if (admin && auth.user.role !== "ADMIN")
    return (
      <div className="container section">
        <EmptyState
          title="This area is for venue admins"
          icon="shield"
          action={
            <Link className="button" href="/">
              Explore venues
            </Link>
          }
        >
          You’re signed in with a customer account. Your bookings are available
          in My bookings.
        </EmptyState>
      </div>
    );
  return <Fragment key={auth.user.id}>{children}</Fragment>;
}
