import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import ScrubAction, {
  SCRUB_REDACTED_TEXT,
} from "../../../Server/Utils/Telemetry/ScrubAction";
import ScrubHashToken from "../../../Server/Utils/Telemetry/ScrubHashToken";
import LogScrubAction from "../../../Types/Log/LogScrubAction";
import LogScrubPatternType from "../../../Types/Log/LogScrubPatternType";
import {
  SCRUB_MASK_MARK,
  SCRUB_REDACTED_PLACEHOLDER,
  ScrubPlaceholderKind,
  getScrubPlaceholderKind,
  isScrubPlaceholder,
  isSharedScrubPlaceholder,
} from "../../../Types/Telemetry/ScrubRule";
import { SCRUB_REDACTED_VALUE } from "../../../Utils/SecurityEvent/ScrubbedAddress";
import { maskKeepingEnds } from "../../../Utils/Telemetry/ScrubMask";

/*
 * What a scrub rule left in place of a value (#10435), read the way every
 * reader of a user id, an email or a team reads it: the exceptions list's
 * affected users, AI usage by person and team, and Security Events' users.
 *
 * Every value a rule can leave is made by the engines' own code
 * (ScrubAction, ScrubHashToken, ScrubMask), so a new mask or a new token
 * form that this check does not know fails here, before a reader takes it
 * for a person.
 */

const PROJECT_ID: string = "0192f1a0-0000-7000-8000-00000000c0a1";

// The Hash action before #10394: the first 8 hex characters of an unkeyed SHA-256.
function legacyToken(value: string): string {
  return `[HASHED:${crypto.createHash("sha256").update(value).digest("hex").substring(0, 8)}]`;
}

// What a rule of `patternType` and `action` leaves of `match`, as ingest runs it.
function left(
  match: string,
  patternType: LogScrubPatternType,
  action: LogScrubAction,
): string {
  return ScrubAction.apply({
    match,
    action,
    patternType,
    projectId: PROJECT_ID,
  });
}

// A value of each pattern type, as an app sends it.
const SAMPLES: Array<[LogScrubPatternType, string]> = [
  [LogScrubPatternType.Email, "jane.doe@example.com"],
  [LogScrubPatternType.CreditCard, "4111 1111 1111 1111"],
  [LogScrubPatternType.SSN, "123-45-6789"],
  [LogScrubPatternType.PhoneNumber, "+1 (415) 555-0100"],
  [LogScrubPatternType.IPAddress, "203.0.113.7"],
  [LogScrubPatternType.IPAddress, "2001:db8::7"],
  [LogScrubPatternType.Custom, "user-42-of-acme"],
  [LogScrubPatternType.Custom, "ab"],
  [LogScrubPatternType.Custom, "🙂 jane 🙂"],
  [LogScrubPatternType.SensitiveKeys, "s3cr3t-t0ken"],
];

describe("what Redact, Mask and Hash leave", () => {
  test.each(SAMPLES)(
    "a %s rule's Redact and Mask are shared, its Hash is one value's own",
    (patternType: LogScrubPatternType, match: string) => {
      const redacted: string = left(match, patternType, LogScrubAction.Redact);
      const masked: string = left(match, patternType, LogScrubAction.Mask);
      const hashed: string = left(match, patternType, LogScrubAction.Hash);

      expect(getScrubPlaceholderKind(redacted)).toBe(
        ScrubPlaceholderKind.Redacted,
      );
      expect(getScrubPlaceholderKind(masked)).toBe(ScrubPlaceholderKind.Masked);
      expect(getScrubPlaceholderKind(hashed)).toBe(ScrubPlaceholderKind.Hashed);

      for (const value of [redacted, masked, hashed]) {
        expect([value, isScrubPlaceholder(value)]).toEqual([value, true]);
      }

      expect(isSharedScrubPlaceholder(redacted)).toBe(true);
      expect(isSharedScrubPlaceholder(masked)).toBe(true);
      expect(isSharedScrubPlaceholder(hashed)).toBe(false);
    },
  );

  test("an action no engine knows redacts, and reads as redacted", () => {
    const value: string = left(
      "jane@example.com",
      LogScrubPatternType.Email,
      "Shred" as LogScrubAction,
    );

    expect(getScrubPlaceholderKind(value)).toBe(ScrubPlaceholderKind.Redacted);
  });

  test("a Hash rule whose project is not known redacts, and reads as redacted", () => {
    const value: string = ScrubAction.apply({
      match: "jane@example.com",
      action: LogScrubAction.Hash,
      patternType: LogScrubPatternType.Email,
      projectId: "",
    });

    expect(getScrubPlaceholderKind(value)).toBe(ScrubPlaceholderKind.Redacted);
  });

  test("a token of today's form and of the form before #10394 are both hashed", () => {
    expect(
      getScrubPlaceholderKind(
        ScrubHashToken.ofValue({ projectId: PROJECT_ID, value: "jane" }),
      ),
    ).toBe(ScrubPlaceholderKind.Hashed);
    expect(getScrubPlaceholderKind(legacyToken("jane"))).toBe(
      ScrubPlaceholderKind.Hashed,
    );
  });

  test("two people's tokens differ, so each counts as one user", () => {
    const jane: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "jane@example.com",
    });
    const john: string = ScrubHashToken.ofValue({
      projectId: PROJECT_ID,
      value: "john@example.com",
    });

    expect(jane).not.toBe(john);
    expect(isSharedScrubPlaceholder(jane)).toBe(false);
    expect(isSharedScrubPlaceholder(john)).toBe(false);
  });

  test("every mask a short or long value gets holds the mark", () => {
    for (const value of ["a", "ab", "abc", "abcd", "a".repeat(200)]) {
      expect([value, maskKeepingEnds(value).includes(SCRUB_MASK_MARK)]).toEqual(
        [value, true],
      );
    }
  });

  test("the engines, the address reader and this check spell Redact alike", () => {
    expect(SCRUB_REDACTED_PLACEHOLDER).toBe(SCRUB_REDACTED_TEXT);
    expect(SCRUB_REDACTED_PLACEHOLDER).toBe(SCRUB_REDACTED_VALUE);
  });
});

describe("a value a rule hid part of", () => {
  const token: string = ScrubHashToken.ofValue({
    projectId: PROJECT_ID,
    value: "jane@example.com",
  });

  test.each([
    ["auth0|[REDACTED]", ScrubPlaceholderKind.Redacted],
    ["user [REDACTED] of acme", ScrubPlaceholderKind.Redacted],
    ["tenant-7/j***@***.com", ScrubPlaceholderKind.Masked],
    ["card ****-****-****-1111", ScrubPlaceholderKind.Masked],
    [`auth0|${token}`, ScrubPlaceholderKind.Hashed],
    [`${token}/${legacyToken("x")}`, ScrubPlaceholderKind.Hashed],
  ])("%s is %s", (value: string, kind: ScrubPlaceholderKind) => {
    expect(getScrubPlaceholderKind(value)).toBe(kind);
  });

  test("Redact and Mask outrank a token beside them: that is no one value", () => {
    expect(getScrubPlaceholderKind(`[REDACTED]:${token}`)).toBe(
      ScrubPlaceholderKind.Redacted,
    );
    expect(getScrubPlaceholderKind(`${token} j***@***.com`)).toBe(
      ScrubPlaceholderKind.Masked,
    );
    expect(isSharedScrubPlaceholder(`[REDACTED]:${token}`)).toBe(true);
  });
});

describe("a value no rule touched", () => {
  test.each([
    "jane.doe@example.com",
    "user-42",
    "42",
    "auth0|5f7c1e",
    "Jane Doe",
    "platform-team",
    // An app's own logger, not a rule of the project's.
    "[Redacted]",
    "[redacted]",
    "REDACTED",
    // Stars, but fewer than any mask leaves.
    "**",
    "a*b*c",
    "**ops**",
    // Near misses of a token.
    "[HASHED:]",
    "[HASHED:3f9a]",
    "[HASHED:3f9a1c0e7b2d4a6]",
    "[HASHED:3F9A1C0E7B2D4A68]",
    "[HASHED:3f9a1c0e7b2d4a6g]",
    "[HASHED:3f9a1c0e7b2d4a68",
    "HASHED:3f9a1c0e7b2d4a68]",
  ])("%s is a value", (value: string) => {
    expect(getScrubPlaceholderKind(value)).toBeNull();
    expect(isScrubPlaceholder(value)).toBe(false);
    expect(isSharedScrubPlaceholder(value)).toBe(false);
  });

  test("nothing that is no text is a placeholder", () => {
    for (const value of [undefined, null, "", 0, 42, true, {}, []]) {
      expect(getScrubPlaceholderKind(value)).toBeNull();
    }
  });

  test("a long text of near misses is read through, and holds no token", () => {
    const text: string = "[HASHED:3f9a".repeat(50000);

    expect(getScrubPlaceholderKind(text)).toBeNull();
    expect(getScrubPlaceholderKind(`${text}[HASHED:3f9a1c0e]`)).toBe(
      ScrubPlaceholderKind.Hashed,
    );
  });
});
