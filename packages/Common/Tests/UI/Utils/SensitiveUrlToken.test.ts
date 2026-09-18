import SensitiveUrlToken from "../../../UI/Utils/SensitiveUrlToken";
import { describe, expect, it, beforeEach } from "@jest/globals";

/*
 * The client half of the reset/verify token handoff.
 *
 * The head bootstrap normally leaves the token in sessionStorage and a clean
 * URL behind it, but it has three failure modes that all have to keep the flow
 * working: storage blocked (private mode), the bootstrap not having run at all
 * (so the token is still in the path), and a spent token that must not linger.
 */

const STORAGE_KEY: string = "oneuptime-sensitive-url-token";

function setPath(pathname: string): void {
  window.history.replaceState({}, "", pathname);
}

describe("SensitiveUrlToken.readFromPath", () => {
  it("reads the token out of a reset-password path", () => {
    expect(
      SensitiveUrlToken.readFromPath("/accounts/reset-password/abc-123"),
    ).toBe("abc-123");
  });

  it("reads the token out of a verify-email path", () => {
    expect(
      SensitiveUrlToken.readFromPath("/accounts/verify-email/abc-123"),
    ).toBe("abc-123");
  });

  it("reads the token out of a status page path, with or without a preview prefix", () => {
    expect(SensitiveUrlToken.readFromPath("/reset-password/abc-123")).toBe(
      "abc-123",
    );
    expect(
      SensitiveUrlToken.readFromPath(
        "/status-page/6392f2a1/reset-password/abc-123",
      ),
    ).toBe("abc-123");
  });

  it("returns nothing for the cleaned form of the same route", () => {
    /*
     * This is the ordinary case after the bootstrap has run. Returning
     * "reset-password" here would submit the route name as the token.
     */
    expect(SensitiveUrlToken.readFromPath("/accounts/reset-password")).toBe("");
    expect(SensitiveUrlToken.readFromPath("/reset-password")).toBe("");
  });

  it("returns nothing for unrelated routes", () => {
    expect(SensitiveUrlToken.readFromPath("/accounts/login")).toBe("");
    expect(SensitiveUrlToken.readFromPath("/accounts/forgot-password")).toBe(
      "",
    );
    expect(SensitiveUrlToken.readFromPath("/")).toBe("");
    expect(SensitiveUrlToken.readFromPath("")).toBe("");
  });

  it("tolerates a trailing slash", () => {
    expect(
      SensitiveUrlToken.readFromPath("/accounts/reset-password/abc-123/"),
    ).toBe("abc-123");
  });

  it("percent-decodes the token, and passes a malformed escape through", () => {
    expect(
      SensitiveUrlToken.readFromPath("/accounts/reset-password/a%2Bb"),
    ).toBe("a+b");
    expect(
      SensitiveUrlToken.readFromPath("/accounts/reset-password/a%zz"),
    ).toBe("a%zz");
  });
});

describe("SensitiveUrlToken.read", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    delete (window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN__;
    setPath("/accounts/reset-password");
  });

  it("prefers the stash the head bootstrap wrote", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "stashed-token");

    expect(SensitiveUrlToken.read()).toBe("stashed-token");
  });

  it("falls back to the in-memory handoff when storage is unavailable", () => {
    (window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN__ = "in-memory-token";

    expect(SensitiveUrlToken.read()).toBe("in-memory-token");
  });

  it("falls back to the path when the bootstrap did not run", () => {
    setPath("/accounts/reset-password/path-token");

    expect(SensitiveUrlToken.read()).toBe("path-token");
  });

  it("returns nothing when there is no token anywhere", () => {
    expect(SensitiveUrlToken.read()).toBe("");
  });

  it("prefers the stash over a token still in the path", () => {
    /*
     * Both can be present when storage worked but replaceState did not. The
     * stash is the value the bootstrap actually captured.
     */
    setPath("/accounts/reset-password/path-token");
    window.sessionStorage.setItem(STORAGE_KEY, "stashed-token");

    expect(SensitiveUrlToken.read()).toBe("stashed-token");
  });
});

describe("SensitiveUrlToken.clear", () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    delete (window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN__;
    setPath("/accounts/reset-password");
  });

  it("drops a spent token from both stashes", () => {
    window.sessionStorage.setItem(STORAGE_KEY, "stashed-token");
    (window as any).__ONEUPTIME_SENSITIVE_URL_TOKEN__ = "in-memory-token";

    SensitiveUrlToken.clear();

    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(SensitiveUrlToken.read()).toBe("");
  });

  it("is safe to call when nothing was stashed", () => {
    expect(() => {
      return SensitiveUrlToken.clear();
    }).not.toThrow();
  });
});
