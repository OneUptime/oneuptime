import NumberUtil from "../../Utils/Number";

describe("NumberUtil", () => {
  describe("parseNumberWithDefault", () => {
    it("parses a plain integer string", () => {
      expect(
        NumberUtil.parseNumberWithDefault({ value: "42", defaultValue: 0 }),
      ).toBe(42);
    });

    it("falls back to the default for undefined, null and empty input", () => {
      expect(
        NumberUtil.parseNumberWithDefault({
          value: undefined,
          defaultValue: 7,
        }),
      ).toBe(7);
      expect(
        NumberUtil.parseNumberWithDefault({
          value: null as unknown as undefined,
          defaultValue: 7,
        }),
      ).toBe(7);
      expect(
        NumberUtil.parseNumberWithDefault({ value: "", defaultValue: 7 }),
      ).toBe(7);
    });

    it("falls back to the default for non-numeric input", () => {
      expect(
        NumberUtil.parseNumberWithDefault({
          value: "not-a-number",
          defaultValue: 5,
        }),
      ).toBe(5);
    });

    it("parses the leading integer of a mixed string, like parseInt", () => {
      expect(
        NumberUtil.parseNumberWithDefault({ value: "12px", defaultValue: 0 }),
      ).toBe(12);
    });

    it("truncates a decimal string to its integer part", () => {
      expect(
        NumberUtil.parseNumberWithDefault({ value: "3.9", defaultValue: 0 }),
      ).toBe(3);
    });

    it("returns the default when the parsed value is below min", () => {
      expect(
        NumberUtil.parseNumberWithDefault({
          value: "2",
          defaultValue: 10,
          min: 5,
        }),
      ).toBe(10);
    });

    it("returns the default when the parsed value is above max", () => {
      expect(
        NumberUtil.parseNumberWithDefault({
          value: "200",
          defaultValue: 10,
          max: 100,
        }),
      ).toBe(10);
    });

    it("accepts a value exactly on the min and max boundaries", () => {
      expect(
        NumberUtil.parseNumberWithDefault({
          value: "5",
          defaultValue: 0,
          min: 5,
          max: 5,
        }),
      ).toBe(5);
    });

    it("accepts negative values within range", () => {
      expect(
        NumberUtil.parseNumberWithDefault({
          value: "-3",
          defaultValue: 0,
          min: -10,
        }),
      ).toBe(-3);
    });
  });

  describe("getRandomNumber", () => {
    it("stays within the inclusive range across many draws", () => {
      for (let i: number = 0; i < 1000; i++) {
        const n: number = NumberUtil.getRandomNumber(3, 7);
        expect(n).toBeGreaterThanOrEqual(3);
        expect(n).toBeLessThanOrEqual(7);
        expect(Number.isInteger(n)).toBe(true);
      }
    });

    it("returns the single value when min equals max", () => {
      expect(NumberUtil.getRandomNumber(4, 4)).toBe(4);
    });
  });

  describe("convertToTwoDecimalPlaces", () => {
    it("rounds to two decimal places", () => {
      expect(NumberUtil.convertToTwoDecimalPlaces(3.14159)).toBe(3.14);
      expect(NumberUtil.convertToTwoDecimalPlaces(2.005)).toBe(2.01);
    });

    it("leaves whole numbers unchanged", () => {
      expect(NumberUtil.convertToTwoDecimalPlaces(10)).toBe(10);
    });

    it("rounds negative numbers", () => {
      expect(NumberUtil.convertToTwoDecimalPlaces(-1.239)).toBe(-1.24);
    });
  });

  describe("isNumber", () => {
    it("is true for numeric values and numeric strings", () => {
      expect(NumberUtil.isNumber(5)).toBe(true);
      expect(NumberUtil.isNumber("5")).toBe(true);
      expect(NumberUtil.isNumber(0)).toBe(true);
    });

    it("is false for non-numeric strings", () => {
      expect(NumberUtil.isNumber("abc")).toBe(false);
    });
  });

  describe("convertToNumber / canBeConvertedToNumber", () => {
    it("converts numeric strings", () => {
      expect(NumberUtil.convertToNumber("42")).toBe(42);
      expect(NumberUtil.convertToNumber("3.5")).toBe(3.5);
    });

    it("reports whether a value can be converted", () => {
      expect(NumberUtil.canBeConvertedToNumber("42")).toBe(true);
      expect(NumberUtil.canBeConvertedToNumber("nope")).toBe(false);
    });
  });

  describe("isInteger / isFloat", () => {
    it("distinguishes integers from floats", () => {
      expect(NumberUtil.isInteger(4)).toBe(true);
      expect(NumberUtil.isInteger(4.5)).toBe(false);
      expect(NumberUtil.isFloat(4.5)).toBe(true);
      expect(NumberUtil.isFloat(4)).toBe(false);
    });
  });

  describe("sign helpers", () => {
    it("classifies positive, negative and zero", () => {
      expect(NumberUtil.isPositive(1)).toBe(true);
      expect(NumberUtil.isPositive(0)).toBe(false);
      expect(NumberUtil.isNegative(-1)).toBe(true);
      expect(NumberUtil.isNegative(0)).toBe(false);
      expect(NumberUtil.isZero(0)).toBe(true);
      expect(NumberUtil.isZero(1)).toBe(false);
    });
  });

  describe("parity helpers", () => {
    it("classifies even and odd", () => {
      expect(NumberUtil.isEven(2)).toBe(true);
      expect(NumberUtil.isEven(3)).toBe(false);
      expect(NumberUtil.isOdd(3)).toBe(true);
      expect(NumberUtil.isOdd(2)).toBe(false);
    });

    it("treats zero as even", () => {
      expect(NumberUtil.isEven(0)).toBe(true);
      expect(NumberUtil.isOdd(0)).toBe(false);
    });
  });
});
