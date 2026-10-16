import assert from "node:assert/strict";
import test from "node:test";
import { browserFacingUrl, isGoogleOAuthClientId } from "../lib/google-oauth";

test("accepts Google OAuth client IDs", () => {
  assert.equal(
    isGoogleOAuthClientId(
      "123456789012-example_Client-ID.apps.googleusercontent.com",
    ),
    true,
  );
});

test("rejects an account email used as the Google OAuth client ID", () => {
  assert.equal(isGoogleOAuthClientId("person@example.com"), false);
});

test("rejects partial and lookalike Google OAuth client IDs", () => {
  assert.equal(isGoogleOAuthClientId("123456789012-example_Client-ID"), false);
  assert.equal(
    isGoogleOAuthClientId(
      "123456789012-example_Client-ID.apps.googleusercontent.com.example.com",
    ),
    false,
  );
});

test("builds OAuth URLs on the loopback origin the browser used", () => {
  assert.equal(
    browserFacingUrl(
      "/api/auth/google/callback",
      "http://localhost:3000/api/auth/google/start",
      "127.0.0.1:3000",
    ).toString(),
    "http://127.0.0.1:3000/api/auth/google/callback",
  );
  assert.equal(
    browserFacingUrl("/x", "http://localhost:3000/a", "[::1]:3001").origin,
    "http://[::1]:3001",
  );
});

test("ignores missing, foreign, and malformed Host headers", () => {
  const requestUrl = "http://localhost:3000/api/auth/google/start";
  for (const host of [null, "", "evil.example", "evil.example:3000", "127.0.0.1.evil.example", "user@127.0.0.1:3000", "127.0.0.1:3000/path", "not a host"]) {
    assert.equal(
      browserFacingUrl("/api/auth/google/callback", requestUrl, host).toString(),
      "http://localhost:3000/api/auth/google/callback",
      String(host),
    );
  }
});
