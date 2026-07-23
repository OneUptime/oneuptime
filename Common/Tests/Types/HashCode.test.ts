import HashCode from "../../Types/HashCode";

describe("HashCode", () => {
  describe("fromString", () => {
    test("returns 0 for an empty string", () => {
      expect(HashCode.fromString("")).toBe(0);
    });

    test("is deterministic for the same input", () => {
      expect(HashCode.fromString("oneuptime")).toBe(
        HashCode.fromString("oneuptime"),
      );
    });

    test("produces different hashes for different inputs", () => {
      expect(HashCode.fromString("abc")).not.toBe(HashCode.fromString("abd"));
    });

    test("is order-sensitive", () => {
      expect(HashCode.fromString("ab")).not.toBe(HashCode.fromString("ba"));
    });

    test("returns a 32-bit signed integer", () => {
      const hash: number = HashCode.fromString(
        "a fairly long string to exercise the shift/overflow path",
      );
      expect(Number.isInteger(hash)).toBe(true);
      expect(hash).toBeGreaterThanOrEqual(-(2 ** 31));
      expect(hash).toBeLessThanOrEqual(2 ** 31 - 1);
    });

    test("matches the known Java-style hashCode value", () => {
      // "hello".hashCode() in Java is 99162322.
      expect(HashCode.fromString("hello")).toBe(99162322);
    });

    test("single character equals its char code", () => {
      expect(HashCode.fromString("A")).toBe("A".charCodeAt(0));
    });
  });
});
