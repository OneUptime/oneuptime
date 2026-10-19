import SecretKeyComparison from "../../../Server/Utils/SecretKeyComparison";
import { describe, expect, test } from "@jest/globals";

/*
 * SecretKeyComparison.timingSafeEqual compares two secret strings in constant
 * time by hashing each to a fixed-width digest first, so a caller cannot
 * recover the expected value from how long a mismatch takes (the leak a plain
 * === has). It is true only for an exact match.
 */
describe("SecretKeyComparison.timingSafeEqual", () => {
  test("is true for equal strings", () => {
    expect(SecretKeyComparison.timingSafeEqual("abc123", "abc123")).toBe(true);
    const long: string = "x".repeat(4096);
    expect(SecretKeyComparison.timingSafeEqual(long, long)).toBe(true);
  });

  test("is false for different strings, including a shared prefix", () => {
    expect(SecretKeyComparison.timingSafeEqual("abc123", "abc124")).toBe(false);
    expect(SecretKeyComparison.timingSafeEqual("abc", "abcd")).toBe(false);
    expect(SecretKeyComparison.timingSafeEqual("", "a")).toBe(false);
  });

  test("is true for two empty strings and false against a non-empty one", () => {
    expect(SecretKeyComparison.timingSafeEqual("", "")).toBe(true);
    expect(SecretKeyComparison.timingSafeEqual("a", "")).toBe(false);
  });

  test("is false when either value is not a string", () => {
    expect(
      SecretKeyComparison.timingSafeEqual(undefined as unknown as string, "a"),
    ).toBe(false);
    expect(
      SecretKeyComparison.timingSafeEqual("a", null as unknown as string),
    ).toBe(false);
  });

  test("distinguishes strings of different lengths without throwing", () => {
    /*
     * timingSafeEqual on raw buffers throws on a length mismatch; hashing
     * first makes every comparison equal-length, so this is a plain false.
     */
    expect(SecretKeyComparison.timingSafeEqual("short", "x".repeat(9999))).toBe(
      false,
    );
  });
});
