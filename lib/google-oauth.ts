export const GOOGLE_OAUTH_CLIENT_ID_ERROR =
  "Google OAuth client ID must be the value ending in .apps.googleusercontent.com, not a Gmail address.";

const googleOAuthClientIdPattern =
  /^[A-Za-z0-9_-]+\.apps\.googleusercontent\.com$/;

export function isGoogleOAuthClientId(value: string) {
  const clientId = value.trim();
  return clientId.length <= 300 && googleOAuthClientIdPattern.test(clientId);
}

const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Resolves a path against the origin the browser actually used. The server can
 * report `localhost` in `request.url` while the browser is on `127.0.0.1`; an
 * OAuth redirect URI and its state cookie must both use the browser's origin.
 * Only a loopback Host header is trusted; anything else keeps `requestUrl`.
 */
export function browserFacingUrl(
  path: string,
  requestUrl: string,
  hostHeader: string | null,
) {
  const url = new URL(path, requestUrl);
  if (!hostHeader) return url;
  try {
    const candidate = new URL(`${url.protocol}//${hostHeader}`);
    if (
      loopbackHostnames.has(candidate.hostname.toLowerCase()) &&
      !candidate.username &&
      !candidate.password &&
      candidate.pathname === "/"
    )
      url.host = candidate.host;
  } catch {
    // Malformed Host header: keep the server-reported origin.
  }
  return url;
}
