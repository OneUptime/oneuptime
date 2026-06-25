import BadDataException from "../../Types/Exception/BadDataException";
import Currency from "../../Types/Currency";

describe("Currency", () => {
  describe("convertToDecimalPlaces", () => {
    test("rounds to two decimal places by default", () => {
      expect(Currency.convertToDecimalPlaces(1.236)).toBe(1.24);
      expect(Currency.convertToDecimalPlaces(1.231)).toBe(1.23);
      expect(Currency.convertToDecimalPlaces(3.14159)).toBe(3.14);
      expect(Currency.convertToDecimalPlaces(99.994)).toBe(99.99);
    });

    test("leaves values without fractional digits unchanged", () => {
      expect(Currency.convertToDecimalPlaces(0)).toBe(0);
      expect(Currency.convertToDecimalPlaces(100)).toBe(100);
    });

    test("rounds negative values", () => {
      expect(Currency.convertToDecimalPlaces(-1.236)).toBe(-1.24);
    });

    test("honours a custom number of decimal places", () => {
      expect(Currency.convertToDecimalPlaces(1.23456, 3)).toBe(1.235);
      expect(Currency.convertToDecimalPlaces(1.26, 1)).toBe(1.3);
    });

    test("ceils the value when decimalPlaces is 0", () => {
      expect(Currency.convertToDecimalPlaces(1.1, 0)).toBe(2);
      expect(Currency.convertToDecimalPlaces(5, 0)).toBe(5);
      expect(Currency.convertToDecimalPlaces(4.0001, 0)).toBe(5);
      expect(Currency.convertToDecimalPlaces(-2.5, 0)).toBe(-2);
    });

    test("throws BadDataException when decimalPlaces is negative", () => {
      expect(() => {
        Currency.convertToDecimalPlaces(1.5, -1);
      }).toThrowError(BadDataException);
    });

    test("returns a number", () => {
      expect(typeof Currency.convertToDecimalPlaces(1.236)).toBe("number");
    });
  });
});
