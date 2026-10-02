/**
 * PKCE (RFC 7636) tests.
 *
 * PKCE is the only thing that ties an authorization code to the client that
 * asked for it - every MCP client is treated as public - so these pin the
 * three properties that make it worth having: S256 is computed the way the
 * RFC computes it, a verifier has to be long enough to carry real entropy,
 * and `plain` (the verifier sent as its own challenge) never verifies.
 */

import { describe, it, expect } from "@jest/globals";
import crypto from "crypto";
import Pkce, { PKCE_CODE_CHALLENGE_METHOD } from "../../OAuth/Pkce";

// RFC 7636 appendix B.
const RFC_VERIFIER: string = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE: string = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const UNRESERVED: string =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";

function verifierOfLength(length: number): string {
  return "a".repeat(length);
}

function challengeFor(verifier: string): string {
  return crypto.createHash("sha256").update(verifier).digest("base64url");
}

describe("Pkce", () => {
  it("offers S256 and nothing else", () => {
    expect(PKCE_CODE_CHALLENGE_METHOD).toBe("S256");
  });

  describe("computeChallenge", () => {
    it("reproduces the RFC 7636 appendix B test vector", () => {
      expect(Pkce.computeChallenge(RFC_VERIFIER)).toBe(RFC_CHALLENGE);
    });

    it("is base64url without padding and always 43 characters", () => {
      for (const length of [43, 64, 128]) {
        const challenge: string = Pkce.computeChallenge(
          verifierOfLength(length),
        );

        expect(challenge).toHaveLength(43);
        expect(challenge).not.toContain("=");
        expect(challenge).not.toContain("+");
        expect(challenge).not.toContain("/");
      }
    });

    it("is deterministic and differs for different verifiers", () => {
      const first: string = Pkce.computeChallenge(verifierOfLength(43));

      expect(Pkce.computeChallenge(verifierOfLength(43))).toBe(first);
      expect(Pkce.computeChallenge(`${verifierOfLength(42)}b`)).not.toBe(first);
    });
  });

  describe("isValidCodeVerifier", () => {
    it("accepts the RFC test vector", () => {
      expect(Pkce.isValidCodeVerifier(RFC_VERIFIER)).toBe(true);
    });

    it("holds the lower bound at 43 characters", () => {
      expect(Pkce.isValidCodeVerifier(verifierOfLength(42))).toBe(false);
      expect(Pkce.isValidCodeVerifier(verifierOfLength(43))).toBe(true);
    });

    it("holds the upper bound at 128 characters", () => {
      expect(Pkce.isValidCodeVerifier(verifierOfLength(128))).toBe(true);
      expect(Pkce.isValidCodeVerifier(verifierOfLength(129))).toBe(false);
    });

    it("accepts every unreserved character", () => {
      expect(UNRESERVED).toHaveLength(66);
      expect(Pkce.isValidCodeVerifier(UNRESERVED)).toBe(true);
    });

    it.each([
      ["a space", " "],
      ["a plus", "+"],
      ["a slash", "/"],
      ["an equals sign", "="],
      ["a percent sign", "%"],
      ["a newline", "\n"],
      ["a tab", "\t"],
      ["a NUL", "\x00"],
      ["a non-ASCII letter", "\xe9"],
      ["a quote", '"'],
    ])("refuses a verifier containing %s", (_name: string, bad: string) => {
      expect(Pkce.isValidCodeVerifier(`${verifierOfLength(50)}${bad}`)).toBe(
        false,
      );
    });

    it("refuses a verifier with a trailing newline", () => {
      /*
       * `$` in a JavaScript regex matches before a final newline only in
       * multiline mode; this pins that the pattern is not written that way.
       */
      expect(Pkce.isValidCodeVerifier(`${verifierOfLength(43)}\n`)).toBe(false);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 12345],
      ["an array", [verifierOfLength(43)]],
      ["an object", { verifier: verifierOfLength(43) }],
      ["an empty string", ""],
      ["a boolean", true],
    ])("refuses %s", (_name: string, value: unknown) => {
      expect(Pkce.isValidCodeVerifier(value)).toBe(false);
    });
  });

  describe("isValidCodeChallenge", () => {
    it("accepts the RFC test vector", () => {
      expect(Pkce.isValidCodeChallenge(RFC_CHALLENGE)).toBe(true);
    });

    it("requires exactly 43 characters", () => {
      expect(Pkce.isValidCodeChallenge("A".repeat(42))).toBe(false);
      expect(Pkce.isValidCodeChallenge("A".repeat(43))).toBe(true);
      expect(Pkce.isValidCodeChallenge("A".repeat(44))).toBe(false);
    });

    it.each([
      ["standard base64 plus", `${"A".repeat(42)}+`],
      ["standard base64 slash", `${"A".repeat(42)}/`],
      ["padding", `${"A".repeat(42)}=`],
      ["a dot", `${"A".repeat(42)}.`],
      ["a tilde", `${"A".repeat(42)}~`],
      ["a space", `${"A".repeat(42)} `],
      ["a trailing newline", `${"A".repeat(43)}\n`],
    ])("refuses a challenge with %s", (_name: string, value: string) => {
      expect(Pkce.isValidCodeChallenge(value)).toBe(false);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 43],
      ["an array", [RFC_CHALLENGE]],
      ["an empty string", ""],
    ])("refuses %s", (_name: string, value: unknown) => {
      expect(Pkce.isValidCodeChallenge(value)).toBe(false);
    });
  });

  describe("verify", () => {
    it("accepts the verifier the challenge was made from", () => {
      expect(
        Pkce.verify({
          codeVerifier: RFC_VERIFIER,
          codeChallenge: RFC_CHALLENGE,
        }),
      ).toBe(true);
    });

    it("accepts verifiers at both length bounds", () => {
      for (const length of [43, 128]) {
        const verifier: string = verifierOfLength(length);

        expect(
          Pkce.verify({
            codeVerifier: verifier,
            codeChallenge: challengeFor(verifier),
          }),
        ).toBe(true);
      }
    });

    it("refuses a different verifier", () => {
      expect(
        Pkce.verify({
          codeVerifier: `${RFC_VERIFIER.slice(0, -1)}l`,
          codeChallenge: RFC_CHALLENGE,
        }),
      ).toBe(false);
    });

    it("refuses a challenge that differs in one character", () => {
      expect(
        Pkce.verify({
          codeVerifier: RFC_VERIFIER,
          codeChallenge: `${RFC_CHALLENGE.slice(0, -1)}N`,
        }),
      ).toBe(false);
    });

    it("never verifies `plain`: the verifier presented as its own challenge", () => {
      /*
       * A 43-character verifier is also a well-formed challenge, so this is
       * the case a `plain` implementation would wave through.
       */
      expect(Pkce.isValidCodeChallenge(RFC_VERIFIER)).toBe(true);
      expect(
        Pkce.verify({
          codeVerifier: RFC_VERIFIER,
          codeChallenge: RFC_VERIFIER,
        }),
      ).toBe(false);
    });

    it("refuses a verifier that is too short even when its hash matches", () => {
      const verifier: string = verifierOfLength(42);

      expect(
        Pkce.verify({
          codeVerifier: verifier,
          codeChallenge: challengeFor(verifier),
        }),
      ).toBe(false);
    });

    it("refuses a verifier that is too long even when its hash matches", () => {
      const verifier: string = verifierOfLength(129);

      expect(
        Pkce.verify({
          codeVerifier: verifier,
          codeChallenge: challengeFor(verifier),
        }),
      ).toBe(false);
    });

    it("refuses a verifier with a character outside the unreserved set even when its hash matches", () => {
      const verifier: string = `${verifierOfLength(43)}+`;

      expect(
        Pkce.verify({
          codeVerifier: verifier,
          codeChallenge: challengeFor(verifier),
        }),
      ).toBe(false);
    });

    it("refuses a malformed stored challenge", () => {
      expect(
        Pkce.verify({ codeVerifier: RFC_VERIFIER, codeChallenge: "short" }),
      ).toBe(false);
      expect(
        Pkce.verify({ codeVerifier: RFC_VERIFIER, codeChallenge: "" }),
      ).toBe(false);
    });

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 1],
      ["an array", [RFC_VERIFIER]],
      ["an object", {}],
    ])(
      "is false, without throwing, when the verifier is %s",
      (_name: string, value: unknown) => {
        expect(
          Pkce.verify({ codeVerifier: value, codeChallenge: RFC_CHALLENGE }),
        ).toBe(false);
      },
    );

    it.each([
      ["undefined", undefined],
      ["null", null],
      ["a number", 1],
      ["an array", [RFC_CHALLENGE]],
      ["an object", {}],
    ])(
      "is false, without throwing, when the challenge is %s",
      (_name: string, value: unknown) => {
        expect(
          Pkce.verify({ codeVerifier: RFC_VERIFIER, codeChallenge: value }),
        ).toBe(false);
      },
    );
  });
});
