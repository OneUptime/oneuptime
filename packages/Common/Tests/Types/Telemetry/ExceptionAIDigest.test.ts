import { describe, expect, test } from "@jest/globals";
import {
  EXCEPTION_AI_DIGEST_VERSION,
  ExceptionAIDigest,
  ExceptionDigestKind,
  ExceptionDigestPriority,
  MAX_DIGEST_EXCEPTIONS,
  MAX_DIGEST_HEADLINE_LENGTH,
  MAX_DIGEST_ITEM_SUMMARY_LENGTH,
  readExceptionAIDigest,
} from "../../../Types/Telemetry/ExceptionAIDigest";

/*
 * The digest as the Dashboard reads it back from the server: every field
 * checked and bounded, items without an exception, a kind or a summary left
 * out, one item per exception, the most urgent first.
 */

function item(
  id: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    telemetryExceptionId: id,
    kind: ExceptionDigestKind.New,
    exceptionType: "TypeError",
    summary: `Summary of ${id}`,
    priority: ExceptionDigestPriority.Medium,
    ...overrides,
  };
}

describe("readExceptionAIDigest", () => {
  test("reads a digest, the most urgent first", () => {
    const digest: ExceptionAIDigest | null = readExceptionAIDigest({
      headline: "  Two new exceptions in checkout.  ",
      items: [
        item("a", { priority: "low" }),
        item("b", { priority: "high", kind: ExceptionDigestKind.Regressed }),
        item("c"),
      ],
    });

    expect(digest).toEqual({
      version: EXCEPTION_AI_DIGEST_VERSION,
      headline: "Two new exceptions in checkout.",
      items: [
        item("b", { priority: "high", kind: ExceptionDigestKind.Regressed }),
        item("c"),
        item("a", { priority: "low" }),
      ],
    });
  });

  test("no headline, no digest", () => {
    expect(readExceptionAIDigest({ headline: "  ", items: [item("a")] })).toBe(
      null,
    );
    expect(readExceptionAIDigest(null)).toBe(null);
    expect(readExceptionAIDigest("headline")).toBe(null);
    expect(readExceptionAIDigest([{ headline: "x" }])).toBe(null);
  });

  test("leaves out items it cannot show, and a second item about the same exception", () => {
    const digest: ExceptionAIDigest | null = readExceptionAIDigest({
      headline: "Headline",
      items: [
        item("a"),
        item("a", { summary: "Again" }),
        item("", {}),
        item("b", { kind: "brand-new" }),
        item("c", { summary: 42 }),
        { telemetryExceptionId: 7, kind: "new", summary: "x" },
        "not an item",
        item("d", { priority: "urgent" }),
      ],
    });

    expect(
      digest?.items.map((entry: { telemetryExceptionId: string }) => {
        return entry.telemetryExceptionId;
      }),
    ).toEqual(["a", "d"]);
    // A priority it does not know reads as medium.
    expect(digest?.items[1]?.priority).toBe(ExceptionDigestPriority.Medium);
  });

  test("bounds every text, and the number of items", () => {
    const digest: ExceptionAIDigest | null = readExceptionAIDigest({
      headline: "h".repeat(MAX_DIGEST_HEADLINE_LENGTH + 50),
      items: Array.from(
        { length: MAX_DIGEST_EXCEPTIONS + 5 },
        (_value: unknown, index: number) => {
          return item(`id-${index}`, {
            summary: "s".repeat(MAX_DIGEST_ITEM_SUMMARY_LENGTH + 10),
          });
        },
      ),
    });

    expect(digest?.headline.length).toBe(MAX_DIGEST_HEADLINE_LENGTH);
    expect(digest?.headline.endsWith("…")).toBe(true);
    expect(digest?.items).toHaveLength(MAX_DIGEST_EXCEPTIONS);
    expect(digest?.items[0]?.summary.length).toBe(
      MAX_DIGEST_ITEM_SUMMARY_LENGTH,
    );
  });
});
