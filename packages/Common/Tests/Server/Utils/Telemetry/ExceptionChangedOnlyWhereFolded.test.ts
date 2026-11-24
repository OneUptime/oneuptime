import { describe, expect, test } from "@jest/globals";
import {
  FOLDED_VALUE_PLACEHOLDERS,
  collapseLongDigitRuns,
  isChangedOnlyWhereFolded,
} from "../../../../Server/Utils/Telemetry/ExceptionGrouping";
import { normalizeExceptionText } from "../../../../Server/Utils/Telemetry/ExceptionSanitizer";

/*
 * ---------------------------------------------------------------------------
 * WHETHER A SCRUB RULE HID ANYTHING A FINGERPRINT HASHES (#10619).
 *
 * An exception made before a rule hid part of it keeps the unkeyed
 * fingerprint it was made under, and is moved to a private one on its next
 * occurrence when that fingerprint hashes what the rule hid. A value the
 * normalizer folds never reaches a fingerprint - the text holds <EMAIL>,
 * whatever the address was - so an exception grouped with one keeps its
 * fingerprint. isChangedOnlyWhereFolded tells the two apart from the text a
 * fingerprint hashes, made from the exception as it arrived and from what
 * the rules left of it.
 * ---------------------------------------------------------------------------
 */

// The text a fingerprint hashes of a message, as grouping normalizes it.
function textOf(message: string): string {
  return normalizeExceptionText(message);
}

describe("a rule that hid only values the normalizer folds", () => {
  test("an email address: the fingerprint never held it", () => {
    expect(
      isChangedOnlyWhereFolded(
        textOf("No cart for ada@example.com"),
        textOf("No cart for [REDACTED]"),
      ),
    ).toBe(true);
  });

  test("whatever the rule left in its place: Redact, Mask or Hash", () => {
    for (const left of [
      "[REDACTED]",
      "a***@***.com",
      "[HASHED:9f86d081884c7d659a2feaa0c55ad015]",
    ]) {
      expect(
        isChangedOnlyWhereFolded(
          textOf("No cart for ada@example.com, try again"),
          textOf(`No cart for ${left}, try again`),
        ),
      ).toBe(true);
    }
  });

  test("several of them, an address, an IP address and a long number", () => {
    expect(
      isChangedOnlyWhereFolded(
        textOf("user ada@example.com from 10.1.2.3 order 123456789 failed"),
        textOf("user [REDACTED] from [REDACTED] order [REDACTED] failed"),
      ),
    ).toBe(true);
  });

  test("the same text, nothing hidden", () => {
    expect(isChangedOnlyWhereFolded("same", "same")).toBe(true);
    expect(isChangedOnlyWhereFolded("", "")).toBe(true);
  });

  test("a frame's long digit run, which grouping v2 folds", () => {
    expect(
      isChangedOnlyWhereFolded(
        collapseLongDigitRuns("/srv/releases/20261030/app/cart.ts|checkout"),
        "/srv/releases/[REDACTED]/app/cart.ts|checkout",
      ),
    ).toBe(true);
  });
});

describe("a rule that hid what a fingerprint hashes", () => {
  test("a card number written in groups, a Social Security number, a phone number: the normalizer keeps their digits", () => {
    for (const [arrived, stored] of [
      ["card 4111-1111-1111-4821 declined", "card [REDACTED] declined"],
      ["Invalid SSN 123-45-6789 on file", "Invalid SSN [REDACTED] on file"],
      ["call 555-123-4567 failed", "call [REDACTED] failed"],
      // A Mask rule leaves the last digits, and the rest is still hashed.
      ["Invalid SSN 123-45-6789 on file", "Invalid SSN ***-**-6789 on file"],
    ] as Array<[string, string]>) {
      expect(isChangedOnlyWhereFolded(textOf(arrived), textOf(stored))).toBe(
        false,
      );
    }
  });

  test("a name or a custom pattern's match", () => {
    expect(
      isChangedOnlyWhereFolded(
        textOf("No account for Ada Lovelace"),
        textOf("No account for [REDACTED]"),
      ),
    ).toBe(false);
  });

  test("one folded value and one that is not: the one that is not counts", () => {
    expect(
      isChangedOnlyWhereFolded(
        textOf("ada@example.com has SSN 123-45-6789"),
        textOf("[REDACTED] has SSN [REDACTED]"),
      ),
    ).toBe(false);
  });

  test("a hidden value right beside a placeholder", () => {
    expect(
      isChangedOnlyWhereFolded(
        textOf("ada@example.com/123-45-6789"),
        textOf("[REDACTED]/[REDACTED]"),
      ),
    ).toBe(false);
  });

  test("something that only looks like a placeholder is not one", () => {
    expect(
      isChangedOnlyWhereFolded(
        "user <Bob> not found",
        "user <[REDACTED]> not found",
      ),
    ).toBe(false);
  });

  test("the pieces around a placeholder are found in their order only", () => {
    expect(isChangedOnlyWhereFolded("a <EMAIL> b <EMAIL> c", "a x c y b")).toBe(
      false,
    );
    expect(isChangedOnlyWhereFolded("a <EMAIL> b", "ab")).toBe(false);
    expect(isChangedOnlyWhereFolded("a <EMAIL> a", "a")).toBe(false);
  });

  test("a text with more placeholders than are read is taken to give something away", () => {
    const many: string = Array.from({ length: 300 }, (): string => {
      return "<EMAIL>";
    }).join(" ");

    expect(isChangedOnlyWhereFolded(many, many.replace(/<EMAIL>/g, "x"))).toBe(
      false,
    );
  });
});

describe("the placeholders read as folded values", () => {
  test("are every placeholder the normalizer writes for a value", () => {
    const sample: string = [
      "550e8400-e29b-41d4-a716-446655440000",
      "507f1f77bcf86cd799439011",
      "cus_A1b2C3d4E5f6G7h8",
      "abc_12345678xy",
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.c2lnbmF0dXJl",
      "QUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9w",
      "10.0.0.1",
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "ada@example.com",
      "/api/orders/9f86d081884c",
      "2026-11-24T10:00:00Z",
      "1700000000",
      "2026-11-24",
      "10:00:00",
      "0xdeadbeef",
      "session_id=abc",
      "request_id=abc",
      "correlation_id=abc",
      "transaction_id=abc",
      "deadbeefcafe",
      "'abcdefghijklmnopqrst'",
      "host:8080 ",
      "PID 42",
      "TID 7",
      "id=42",
      "12345678",
    ].join(" ");
    const written: Set<string> = new Set<string>(
      normalizeExceptionText(`${sample}\n    at x (/app/cart.ts:10:5)`).match(
        /<[A-Za-z_]+>/g,
      ) || [],
    );

    expect(written.size).toBeGreaterThan(20);

    for (const placeholder of written) {
      expect(FOLDED_VALUE_PLACEHOLDERS).toContain(placeholder);
    }

    expect(FOLDED_VALUE_PLACEHOLDERS).toContain(
      collapseLongDigitRuns("lambda$1234").replace("lambda$", ""),
    );
  });
});
