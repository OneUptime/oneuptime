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
