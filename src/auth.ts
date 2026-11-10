import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { Bindings } from "./api";

type Environment = { Bindings: Bindings; Variables: { email: string } };
const COOKIE = "studio_session";
const SESSION_SECONDS = 8 * 60 * 60;
const jwks = new Map<string, ReturnType<typeof createRemoteJWKSet>>();

function sessionKey(env: Bindings): Uint8Array | null {
  // A short signing key is not a valid local authentication configuration.
  return env.STUDIO_PASSWORD &&
    env.SESSION_SECRET &&
    env.SESSION_SECRET.length >= 32
    ? new TextEncoder().encode(env.SESSION_SECRET)
    : null;
}

export async function authenticate(
  c: Context<Environment>,
): Promise<string | null> {
  const { ACCESS_TEAM_DOMAIN, ACCESS_AUD, ACCESS_EMAILS } = c.env;
  const token = c.req.header("Cf-Access-Jwt-Assertion");
  if (token && ACCESS_TEAM_DOMAIN && ACCESS_AUD && ACCESS_EMAILS) {
    try {
      const domain = ACCESS_TEAM_DOMAIN.replace(/^https:\/\//, "").replace(
        /\/$/,
        "",
      );
      if (!/^[a-z0-9-]+\.cloudflareaccess\.com$/i.test(domain)) return null;
      const issuer = `https://${domain}`;
      let keys = jwks.get(issuer);
      if (!keys) {
        keys = createRemoteJWKSet(new URL(`${issuer}/cdn-cgi/access/certs`));
        jwks.set(issuer, keys);
      }
      const { payload } = await jwtVerify(token, keys, {
        issuer,
        audience: ACCESS_AUD,
        algorithms: ["RS256"],
        requiredClaims: ["exp", "iat", "sub"],
      });
      const allowed = ACCESS_EMAILS.split(",")
        .map((email) => email.trim().toLowerCase())
        .filter(Boolean);
      return typeof payload.email === "string" &&
        allowed.includes(payload.email.toLowerCase())
        ? payload.email.toLowerCase()
        : null;
    } catch {
      return null;
    }
  }
  const key = sessionKey(c.env);
  const cookie = getCookie(c, COOKIE);
  if (!key || !cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, key, {
      issuer: "catalogue-studio",
      audience: "catalogue-studio",
      algorithms: ["HS256"],
      requiredClaims: ["exp", "iat", "sub"],
    });
    return payload.sub === "local-studio" ? "local-studio" : null;
  } catch {
    return null;
  }
}

export const sameOrigin: MiddlewareHandler<Environment> = async (c, next) => {
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    const origin = c.req.header("Origin");
    const site = c.req.header("Sec-Fetch-Site");
    if (
      (origin && origin !== new URL(c.req.url).origin) ||
      site === "cross-site"
    ) {
      return c.json({ error: "Cross-origin writes are not allowed" }, 403);
    }
  }
  await next();
};

export const requireStudio: MiddlewareHandler<Environment> = async (
  c,
  next,
) => {
  const email = await authenticate(c);
  if (!email) return c.json({ error: "Authentication required" }, 401);
  c.set("email", email);
  await next();
};

export async function login(c: Context<Environment>) {
  const key = sessionKey(c.env);
  if (!key)
    return c.json({ error: "Password authentication is not configured" }, 503);
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }
  const password =
    body && typeof body === "object" && "password" in body
      ? body.password
      : null;
  if (typeof password !== "string" || password.length > 4096) {
    return c.json({ error: "Invalid credentials" }, 401);
  }
  // Compare fixed-length digests, rather than exiting at the first differing character.
  const digest = (value: string) =>
    crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  const [expected, actual] = await Promise.all([
    digest(c.env.STUDIO_PASSWORD!),
    digest(password),
  ]);
  const a = new Uint8Array(expected);
  const b = new Uint8Array(actual);
  let difference = 0;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  if (difference) return c.json({ error: "Invalid credentials" }, 401);
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject("local-studio")
    .setIssuer("catalogue-studio")
    .setAudience("catalogue-studio")
    .setIssuedAt()
    .setExpirationTime(`${SESSION_SECONDS}s`)
    .sign(key);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/api",
    maxAge: SESSION_SECONDS,
  });
  return c.json({ authenticated: true, email: "local-studio" });
}

export function logout(c: Context<Environment>) {
  deleteCookie(c, COOKIE, {
    path: "/api",
    httpOnly: true,
    sameSite: "Strict",
    secure: new URL(c.req.url).protocol === "https:",
  });
  return c.json({ authenticated: false });
}
