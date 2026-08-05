import {
  truncateLongText,
  truncateShortText,
  truncateToLength,
} from "../../../../Server/Utils/Database/TruncateColumnValue";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import { describe, expect, test } from "@jest/globals";

/*
 * The clamp that keeps a single oversized value from aborting a 500-row
 * bulk INSERT (issue #3006 follow-up). Everything here is about the
 * boundary: clip one character too eagerly and legitimate values get
 * silently corrupted; clip one too late and Postgres still raises 22001
 * and drops the whole chunk.
 */

describe("truncateToLength", () => {
  test("returns a short value untouched, by identity", () => {
    const value: string = "nginx:1.27";
    expect(truncateToLength(value, 100)).toBe(value);
  });

  test("returns a value of exactly maxLength untouched", () => {
    /*
     * The off-by-one that matters most: varchar(100) accepts exactly
     * 100 characters, so clipping at 100 would corrupt a legal value.
     */
    const value: string = "a".repeat(100);
    const result: string = truncateToLength(value, 100);
    expect(result).toBe(value);
    expect(result).toHaveLength(100);
  });

  test("clips a value one character too long down to exactly maxLength", () => {
    const value: string = "a".repeat(101);
    const result: string = truncateToLength(value, 100);
    expect(result).toHaveLength(100);
    expect(value.startsWith(result)).toBe(true);
  });

  test("clips a wildly oversized value down to exactly maxLength", () => {
    const result: string = truncateToLength("b".repeat(5000), 100);
    expect(result).toHaveLength(100);
    expect(result).toBe("b".repeat(100));
  });

  test("the clipped value is always a prefix of the original", () => {
    const value: string =
      "ghcr.io/some-really-long-organization-name/some-really-long-repository-name:v1.2.3-rc.4-with-a-long-build-suffix";
    const result: string = truncateToLength(value, 40);
    expect(value.startsWith(result)).toBe(true);
    expect(result).toHaveLength(40);
  });

  test("passes null through as null", () => {
    expect(truncateToLength(null, 100)).toBeNull();
  });

  test("normalizes undefined to null, so it binds as SQL NULL", () => {
    expect(truncateToLength(undefined, 100)).toBeNull();
  });

  test("keeps an empty string as a string, never as null", () => {
    /*
     * KubernetesContainer.podNamespaceKey is NOT NULL with a "" default
     * for cluster-scoped pods — turning "" into NULL would break the
     * insert and the unique index that covers it.
     */
    const result: string = truncateToLength("", 100);
    expect(result).toBe("");
    expect(result).not.toBeNull();
  });

  test("handles a maxLength of zero without throwing", () => {
    expect(truncateToLength("anything", 0)).toBe("");
  });

  describe("multi-byte characters", () => {
    /*
     * Postgres counts varchar(n) in characters; JS counts string length
     * in UTF-16 code units. Astral-plane characters (emoji, rare CJK)
     * are two code units each, so clipping by code units is always
     * conservative — but the cut must not land inside a surrogate pair.
     */
    test("never emits more characters than the column allows", () => {
      const value: string = "😀".repeat(200); // 400 code units, 200 chars
      const result: string = truncateToLength(value, 100);

      expect(result.length).toBeLessThanOrEqual(100);
      expect(Array.from(result).length).toBeLessThanOrEqual(100);
    });

    test("does not split a surrogate pair when the cut lands inside one", () => {
      /*
       * 99 ASCII + one 2-code-unit emoji = 101 code units; cut at 100
       * would otherwise land between the emoji's two halves.
       */
      const value: string = `${"a".repeat(99)}😀`;
      const result: string = truncateToLength(value, 100);

      expect(result).toBe("a".repeat(99));
      expect(result).not.toContain("\ud83d");
      // A lone surrogate survives a round trip through UTF-8 as U+FFFD.
      expect(Buffer.from(result, "utf8").toString("utf8")).toBe(result);
    });

    test("keeps a whole surrogate pair when it fits exactly", () => {
      const value: string = `${"a".repeat(98)}😀b`; // 101 code units
      const result: string = truncateToLength(value, 100);

      expect(result).toBe(`${"a".repeat(98)}😀`);
      expect(result).toHaveLength(100);
      expect(Buffer.from(result, "utf8").toString("utf8")).toBe(result);
    });

    test("leaves a multi-byte value that fits completely alone", () => {
      const value: string = "café-über-日本語";
      expect(truncateToLength(value, 100)).toBe(value);
    });
  });
});

describe("truncateShortText", () => {
  test("clamps at ColumnLength.ShortText", () => {
    expect(truncateShortText("a".repeat(500))).toHaveLength(
      ColumnLength.ShortText,
    );
  });

  test("ColumnLength.ShortText is still 100, the varchar width it mirrors", () => {
    expect(ColumnLength.ShortText).toBe(100);
  });

  test("agrees with truncateToLength at the same bound", () => {
    const value: string = "z".repeat(250);
    expect(truncateShortText(value)).toBe(
      truncateToLength(value, ColumnLength.ShortText),
    );
  });

  test("passes null and short values straight through", () => {
    expect(truncateShortText(null)).toBeNull();
    expect(truncateShortText("osd.3")).toBe("osd.3");
  });
});

describe("truncateLongText", () => {
  test("clamps at ColumnLength.LongText", () => {
    expect(truncateLongText("a".repeat(5000))).toHaveLength(
      ColumnLength.LongText,
    );
  });

  test("ColumnLength.LongText is still 500, the varchar width it mirrors", () => {
    expect(ColumnLength.LongText).toBe(500);
  });

  test("accepts a 253-character Kubernetes DNS-subdomain name untouched", () => {
    /*
     * The whole point of widening the name columns: the longest name
     * Kubernetes itself will ever produce has to pass through unclipped.
     */
    const podName: string = "p".repeat(253);
    expect(truncateLongText(podName)).toBe(podName);
  });

  test("is strictly more permissive than truncateShortText", () => {
    const value: string = "c".repeat(400);
    expect(truncateLongText(value)).toBe(value);
    expect(truncateShortText(value)).toHaveLength(ColumnLength.ShortText);
  });

  test("passes null and short values straight through", () => {
    expect(truncateLongText(null)).toBeNull();
    expect(truncateLongText("ghcr.io/acme/api:1.2.3")).toBe(
      "ghcr.io/acme/api:1.2.3",
    );
  });
});
