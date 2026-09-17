import BadDataException from "../../Types/Exception/BadDataException";
import DiskSize from "../../Types/DiskSize";

describe("DiskSize", () => {
  describe("convertToDecimalPlaces", () => {
    test("rounds to 2 decimal places by default", () => {
      expect(DiskSize.convertToDecimalPlaces(3.14159)).toBe(3.14);
    });

    test("rounds to the requested number of decimal places", () => {
      expect(DiskSize.convertToDecimalPlaces(3.14159, 3)).toBe(3.142);
    });

    test("returns the ceiling when decimalPlaces is 0", () => {
      expect(DiskSize.convertToDecimalPlaces(4.2, 0)).toBe(5);
      expect(DiskSize.convertToDecimalPlaces(4, 0)).toBe(4);
    });

    test("parses a string value before rounding", () => {
      expect(
        DiskSize.convertToDecimalPlaces("2.71828" as unknown as number),
      ).toBe(2.72);
    });

    test("throws a BadDataException when decimalPlaces is negative", () => {
      expect(() => {
        return DiskSize.convertToDecimalPlaces(1.5, -1);
      }).toThrow(BadDataException);
    });
  });

  describe("byteSizeToGB", () => {
    test("converts bytes to gigabytes", () => {
      expect(DiskSize.byteSizeToGB(1024 * 1024 * 1024)).toBe(1);
    });
  });

  describe("byteSizeToMB", () => {
    test("converts bytes to megabytes", () => {
      expect(DiskSize.byteSizeToMB(1024 * 1024)).toBe(1);
    });
  });

  describe("byteSizeToKB", () => {
    test("converts bytes to kilobytes", () => {
      expect(DiskSize.byteSizeToKB(1024)).toBe(1);
    });
  });
});
