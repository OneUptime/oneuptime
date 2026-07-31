import { describe, expect, it } from "@jest/globals";
import SessionReplayGateCache, {
  SessionReplayGatePolicy,
} from "../../../../Server/Utils/SessionReplay/SessionReplayGateCache";

/*
 * Origin allowlist semantics.
 *
 * An empty allowlist means "any origin". That is a deliberate default-on
 * choice, and it gives something up: TelemetryIngestionKey has no expiry, no
 * scope and no origin binding, and the install snippet puts it in plain sight
 * in the customer's browser JavaScript. With the allowlist empty, anyone who
 * scrapes that key can write forged recordings into the project.
 *
 * These tests exist so that trade-off stays explicit rather than becoming an
 * accident, and so the strict path keeps working once a customer does fill the
 * allowlist in.
 */

function buildPolicy(allowedOrigins: Array<string>): SessionReplayGatePolicy {
  return {
    allowedOrigins: allowedOrigins,
  } as unknown as SessionReplayGatePolicy;
}

describe("SessionReplayGateCache.isOriginAllowed", () => {
  describe("empty allowlist", () => {
    it("allows any origin", () => {
      expect(
        SessionReplayGateCache.isOriginAllowed(
          buildPolicy([]),
          "https://anything.example.com",
        ),
      ).toBe(true);
    });

    it("allows a request with no Origin header at all", () => {
      /*
       * Server-to-server posts and some privacy modes send no Origin. With no
       * allowlist configured there is nothing to check them against.
       */
      expect(
        SessionReplayGateCache.isOriginAllowed(buildPolicy([]), undefined),
      ).toBe(true);
    });
  });

  describe("configured allowlist", () => {
    const policy: SessionReplayGatePolicy = buildPolicy([
      "https://app.example.com",
      "https://www.example.com",
    ]);

    it("allows a listed origin", () => {
      expect(
        SessionReplayGateCache.isOriginAllowed(
          policy,
          "https://app.example.com",
        ),
      ).toBe(true);
    });

    it("is case and whitespace insensitive", () => {
      expect(
        SessionReplayGateCache.isOriginAllowed(
          policy,
          "  HTTPS://APP.EXAMPLE.COM  ",
        ),
      ).toBe(true);
    });

    it("refuses an origin that is not listed", () => {
      expect(
        SessionReplayGateCache.isOriginAllowed(
          policy,
          "https://evil.example.com",
        ),
      ).toBe(false);
    });

    it("refuses a missing Origin once the customer has configured an allowlist", () => {
      /*
       * The permissive branch above applies ONLY to the unconfigured case.
       * Once origins are named, a request that presents none is refused
       * rather than waved through - otherwise the allowlist would be trivially
       * bypassed by omitting a header.
       */
      expect(SessionReplayGateCache.isOriginAllowed(policy, undefined)).toBe(
        false,
      );
      expect(SessionReplayGateCache.isOriginAllowed(policy, "")).toBe(false);
      expect(SessionReplayGateCache.isOriginAllowed(policy, "   ")).toBe(false);
    });

    it("does not allow a subdomain of a listed origin", () => {
      /*
       * Exact-match only. A wildcard would let anyone who can host content on
       * a customer subdomain forge sessions.
       */
      expect(
        SessionReplayGateCache.isOriginAllowed(
          policy,
          "https://evil.app.example.com",
        ),
      ).toBe(false);
    });
  });
});
