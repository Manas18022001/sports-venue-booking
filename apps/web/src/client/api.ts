import type { Session, User } from "./contracts";

export class ClientError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly issues: Array<{ field: string; message: string }> = [],
    readonly retryAfter = 0,
  ) {
    super(message);
    this.name = "ClientError";
  }
}

let csrfToken: string | null = null;
let user: User | null | undefined;
let refreshFlight: Promise<User | null> | undefined;
let initialFlight: Promise<User | null> | undefined;
const listeners = new Set<(value: User | null) => void>();
let channel: BroadcastChannel | undefined;

function update(session: Session | null) {
  csrfToken = session?.csrfToken ?? null;
  user = session?.user ?? null;
  for (const listener of listeners) listener(user);
  return user;
}

async function raw<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    csrf?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  if (!path.startsWith("/api/"))
    throw new Error("Only application API paths are supported.");
  const headers = new Headers();
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.csrf && csrfToken) headers.set("X-CSRF-Token", csrfToken);
  if (options.key) headers.set("Idempotency-Key", options.key);
  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers,
      ...(options.body === undefined
        ? {}
        : { body: JSON.stringify(options.body) }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError")
      throw error;
    throw new ClientError(
      0,
      "NETWORK_ERROR",
      "We couldn’t connect. Check your connection and try again.",
    );
  }
  const payload = (await response.json().catch(() => null)) as {
    data?: T;
    error?: {
      code?: string;
      message?: string;
      issues?: Array<{ field: string; message: string }>;
    };
  } | null;
  if (!response.ok)
    throw new ClientError(
      response.status,
      payload?.error?.code ?? "REQUEST_FAILED",
      payload?.error?.message ?? "Something went wrong. Please try again.",
      payload?.error?.issues ?? [],
      Number(response.headers.get("Retry-After")) || 0,
    );
  if (!payload || !("data" in payload))
    throw new ClientError(
      502,
      "INVALID_RESPONSE",
      "We couldn’t read the response. Please try again.",
    );
  return payload.data as T;
}

async function refreshSession(): Promise<User | null> {
  if (refreshFlight) return refreshFlight;
  const run = async () => {
    // Another tab may already have refreshed while this one waited for the lock.
    try {
      return update(await raw<Session>("/api/auth/me"));
    } catch (error) {
      if (!(error instanceof ClientError && error.status === 401)) throw error;
    }
    try {
      const csrf = await raw<{ csrfToken: string }>("/api/auth/csrf");
      csrfToken = csrf.csrfToken;
      return update(
        await raw<Session>("/api/auth/refresh", {
          method: "POST",
          body: {},
          csrf: true,
        }),
      );
    } catch (error) {
      if (error instanceof ClientError && error.status === 401)
        return update(null);
      throw error;
    }
  };
  const work = async () =>
    typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request("turfit-session", run)
      : await run();
  const flight = work().finally(() => {
    refreshFlight = undefined;
  });
  refreshFlight = flight;
  return flight;
}

export function loadSession(force = false): Promise<User | null> {
  if (!force && user !== undefined) return Promise.resolve(user);
  if (!initialFlight)
    initialFlight = refreshSession().finally(() => {
      initialFlight = undefined;
    });
  return initialFlight;
}

export function subscribeSession(listener: (value: User | null) => void) {
  listeners.add(listener);
  if (!channel && typeof BroadcastChannel !== "undefined") {
    channel = new BroadcastChannel("turfit-session");
    channel.onmessage = () => {
      void loadSession(true).catch(() => undefined);
    };
  }
  return () => {
    listeners.delete(listener);
  };
}

export async function api<T>(
  path: string,
  options: {
    method?: string;
    body?: unknown;
    key?: string;
    auth?: boolean;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const write = options.method !== undefined && options.method !== "GET";
  if (options.auth && !(await loadSession()))
    throw new ClientError(401, "UNAUTHORIZED", "Sign in to continue.");
  try {
    return await raw<T>(path, { ...options, csrf: write });
  } catch (error) {
    if (error instanceof ClientError && error.status === 401 && options.auth) {
      if (await refreshSession())
        return raw<T>(path, { ...options, csrf: write });
      throw new ClientError(
        401,
        "UNAUTHORIZED",
        "Your session ended. Sign in to continue.",
      );
    }
    throw error;
  }
}

export async function signIn(
  mode: "login" | "register",
  input: { email: string; password: string; name?: string },
) {
  // Finish an initial session check before accepting a new login result; an old
  // anonymous response must never overwrite the newly signed-in account.
  await initialFlight?.catch(() => undefined);
  await refreshFlight?.catch(() => undefined);
  const run = async () => {
    const session = await raw<Session>(`/api/auth/${mode}`, {
      method: "POST",
      body: input,
    });
    update(session);
    channel?.postMessage("changed");
    return session.user;
  };
  return typeof navigator !== "undefined" && navigator.locks
    ? await navigator.locks.request("turfit-session", run)
    : await run();
}
export async function signOut() {
  try {
    await api("/api/auth/logout", { method: "POST", body: {}, auth: true });
  } catch (error) {
    if (!(error instanceof ClientError && error.status === 401)) throw error;
  }
  update(null);
  channel?.postMessage("changed");
}
export function errorMessage(error: unknown, includeIssues = true) {
  if (error instanceof ClientError)
    return (
      error.message +
      (includeIssues && error.issues.length ? ` ${[...new Set(error.issues.map((issue) => issue.message))].join(" ")}` : "") +
      (error.retryAfter ? ` Try again in ${error.retryAfter} seconds.` : "")
    );
  return "Something went wrong. Please try again.";
}
