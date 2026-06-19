// Central configuration for the PoE2 data layer. All PoE2 network access goes
// through this module's URLs so the transport can change in one place.
//
// Reads  -> Cloudflare Worker (cached, no auth), same Worker as the trade proxy.
// Writes -> Neon Data API (PostgREST) authenticated with a Neon Auth JWT.

const isLocalhost = (): boolean => typeof window !== 'undefined' && window.location.hostname === 'localhost';

// Worker base for PoE2 reads. In dev the Vite proxy forwards /api/poe2/* to the
// local `wrangler dev`, so a relative base works. In production we hit the
// deployed Worker via the same env var the trade API uses.
export const workerBase = (): string => {
  if (isLocalhost()) {
    return '';
  }
  return import.meta.env.VITE_PROXY_BASE_URL ?? '';
};

// Neon Data API (PostgREST) — public endpoint, not a secret. Overridable via env.
export const NEON_DATA_API_URL: string =
  import.meta.env.VITE_NEON_DATA_API_URL ??
  'https://ep-still-truth-ater3m94.apirest.c-9.us-east-1.aws.neon.tech/neondb/rest/v1';

// Neon Auth (Better Auth) base — public endpoint, not a secret. Overridable via env.
export const NEON_AUTH_URL: string =
  import.meta.env.VITE_NEON_AUTH_URL ??
  'https://ep-still-truth-ater3m94.neonauth.c-9.us-east-1.aws.neon.tech/neondb/auth';
