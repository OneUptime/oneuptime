import {
  normalizeExceptionText,
  sanitizeExceptionMessage,
  sanitizeStackTrace,
} from "../../../Server/Utils/Telemetry/ExceptionSanitizer";
import { describe, expect, test } from "@jest/globals";

/*
 * The sanitizer feeds two very different consumers:
 *
 * - normalizeExceptionText is the FINGERPRINT normalizer (moved here from
 *   App's ExceptionUtil) — its replacement behavior must stay stable or
 *   every existing exception group re-fingerprints.
 * - sanitizeExceptionMessage / sanitizeStackTrace guard the surfaces that
 *   leave the platform: LLM prompts, PR titles/bodies, commit messages.
 */
describe("normalizeExceptionText", () => {
  test("replaces dynamic tokens with placeholders", () => {
    expect(
      normalizeExceptionText(
        'invalid input syntax for type uuid: "550e8400-e29b-41d4-a716-446655440000"',
      ),
    ).toContain("<UUID>");

    expect(
      normalizeExceptionText("failed to email john.doe@example.com"),
    ).toContain("<EMAIL>");

    expect(normalizeExceptionText("connect ETIMEDOUT 10.2.3.4:5432")).toContain(
      "<IP>",
    );
  });

  test("keeps the static structure of the message", () => {
    const normalized: string = normalizeExceptionText(
      "Domain lookup failed for id=12345678",
    );

    expect(normalized).toContain("Domain lookup failed");
    expect(normalized).not.toContain("12345678");
  });

  test("empty input stays empty", () => {
    expect(normalizeExceptionText("")).toBe("");
  });
});

describe("sanitizeExceptionMessage", () => {
  test("strips interpolated user data and secrets", () => {
    const sanitized: string = sanitizeExceptionMessage(
      "Login failed for jane@customer.com with token ghp_0123456789abcdefghijklmnopqrstuvwxyz1234",
    );

    expect(sanitized).not.toContain("jane@customer.com");
    expect(sanitized).not.toContain("ghp_0123456789");
    expect(sanitized).toContain("Login failed");
  });
});

describe("sanitizeStackTrace", () => {
  test("preserves file:line frames while stripping PII", () => {
    const sanitized: string = sanitizeStackTrace(
      "Error: boom for user jane@customer.com\n    at charge (/app/src/billing/charge.ts:12:5)",
    );

    // The code agent needs the frame intact to locate the defect.
    expect(sanitized).toContain("/app/src/billing/charge.ts:12:5");
    expect(sanitized).not.toContain("jane@customer.com");
  });
});

/*
 * Firefox and Safari indent nothing and emit no header line, so the
 * indentation heuristic above classified every one of their frames as a
 * header and ran the fingerprint normalizer over it — rewriting the bundle's
 * content hash to <HEX_ID> and `:1:98217` to `:<LINE>:<COL>)`. That is exactly
 * the file:line reference sanitizeStackTrace exists to preserve for the code
 * agent, so browser frames get a second, shape-based test.
 */
describe("sanitizeStackTrace - Firefox / Safari frames", () => {
  const BROWSER_FRAME: string =
    "handleSubmit@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:98217";

  test("the header normalizer would have destroyed a browser frame", () => {
    // Guards the premise: if this ever stops being true, the fix is dead code.
    const normalized: string = normalizeExceptionText(BROWSER_FRAME);

    expect(normalized).not.toContain("entry.a1b2c3d4.js");
    expect(normalized).not.toContain(":1:98217");
  });

  test("preserves the frame verbatim, hash and line:col included", () => {
    const sanitized: string = sanitizeStackTrace(
      [
        "TypeError: cannot read x of undefined for jane@customer.com",
        BROWSER_FRAME,
        "onClick/<@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:74102",
        "@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:2211",
      ].join("\n"),
    );

    expect(sanitized).toContain(BROWSER_FRAME);
    expect(sanitized).toContain(
      "@https://app.example.com/_nuxt/entry.a1b2c3d4.js:1:2211",
    );
    // The header above the frames is still normalized.
    expect(sanitized).not.toContain("jane@customer.com");
  });

  test("preserves Safari pseudo-frames and self-hosted frames", () => {
    const sanitized: string = sanitizeStackTrace(
      [
        "global code@https://app.example.com/build/main.js:1:1",
        "forEach@[native code]",
        "next@self-hosted:1154:9",
      ].join("\n"),
    );

    expect(sanitized).toContain(
      "global code@https://app.example.com/build/main.js:1:1",
    );
    expect(sanitized).toContain("forEach@[native code]");
    expect(sanitized).toContain("next@self-hosted:1154:9");
  });

  test("still normalizes an unindented line that is not a frame", () => {
    const sanitized: string = sanitizeStackTrace(
      [
        "failed for user jane@customer.com on host 10.2.3.4",
        "handleSubmit@https://app.example.com/assets/app.js:1:2",
      ].join("\n"),
    );

    expect(sanitized).not.toContain("jane@customer.com");
    expect(sanitized).toContain(
      "handleSubmit@https://app.example.com/assets/app.js:1:2",
    );
  });

  test("leaves V8 frames exactly as they were", () => {
    const sanitized: string = sanitizeStackTrace(
      "Error: boom\n    at charge (/app/src/billing/charge.ts:12:5)",
    );

    expect(sanitized).toContain("/app/src/billing/charge.ts:12:5");
  });
});
