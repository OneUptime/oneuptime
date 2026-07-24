import BooleanUtil from "../../Utils/Boolean";

describe("BooleanUtil", () => {
  describe("isBoolean", () => {
    test("should return true only for real booleans", () => {
      expect(BooleanUtil.isBoolean(true)).toBe(true);
      expect(BooleanUtil.isBoolean(false)).toBe(true);
    });

    test("should return false for boolean-ish values that are not booleans", () => {
      expect(BooleanUtil.isBoolean("true")).toBe(false);
      expect(BooleanUtil.isBoolean(1)).toBe(false);
      expect(BooleanUtil.isBoolean(0)).toBe(false);
      expect(BooleanUtil.isBoolean(null)).toBe(false);
      expect(BooleanUtil.isBoolean(undefined)).toBe(false);
      expect(BooleanUtil.isBoolean({})).toBe(false);
    });
  });

  describe("convertToBoolean", () => {
    test("should convert truthy values to true", () => {
      expect(BooleanUtil.convertToBoolean(true)).toBe(true);
      expect(BooleanUtil.convertToBoolean(1)).toBe(true);
      expect(BooleanUtil.convertToBoolean("true")).toBe(true);
      // Note: any non empty string is truthy, including "false".
      expect(BooleanUtil.convertToBoolean("false")).toBe(true);
      expect(BooleanUtil.convertToBoolean({})).toBe(true);
    });

    test("should convert falsy values to false", () => {
      expect(BooleanUtil.convertToBoolean(false)).toBe(false);
      expect(BooleanUtil.convertToBoolean(0)).toBe(false);
      expect(BooleanUtil.convertToBoolean("")).toBe(false);
      expect(BooleanUtil.convertToBoolean(null)).toBe(false);
      expect(BooleanUtil.convertToBoolean(undefined)).toBe(false);
    });
  });

  describe("canBeConvertedToBoolean", () => {
    test("should accept the supported boolean representations", () => {
      const supported: Array<any> = [
        "true",
        "false",
        "1",
        "0",
        1,
        0,
        true,
        false,
      ];

      for (const value of supported) {
        expect(BooleanUtil.canBeConvertedToBoolean(value)).toBe(true);
      }
    });

    test("should reject anything else", () => {
      const unsupported: Array<any> = [
        "TRUE",
        "yes",
        "no",
        2,
        -1,
        "",
        null,
        undefined,
        {},
        [],
      ];

      for (const value of unsupported) {
        expect(BooleanUtil.canBeConvertedToBoolean(value)).toBe(false);
      }
    });
  });
});
