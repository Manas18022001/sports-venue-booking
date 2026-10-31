export const AUTH_DEFAULTS = Object.freeze({
  accessTtlSeconds: 900,
  sessionTtlSeconds: 604_800,
  refreshRetrySeconds: 5,
});

export const CLIENT_IP_HEADERS = ["none", "x-forwarded-for", "x-real-ip", "cf-connecting-ip"] as const;
