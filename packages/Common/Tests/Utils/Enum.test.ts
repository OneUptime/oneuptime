import EnumUtil from "../../Utils/Enum";

enum StringEnum {
  First = "First",
  Second = "second-value",
}

enum NumericEnum {
  Zero,
  One,
}

describe("EnumUtil", () => {
  describe("getValues", () => {
    test("should return the values of a string enum", () => {
      expect(EnumUtil.getValues(StringEnum)).toEqual(["First", "second-value"]);
    });

    test("should return an empty array for an empty object", () => {
      expect(EnumUtil.getValues({})).toEqual([]);
    });

    test("should include reverse mapped keys for numeric enums", () => {
      /*
       * TypeScript numeric enums are bidirectional, so Object.values() contains
       * both the names and the numbers.
       */
      const values: Array<string> = EnumUtil.getValues(NumericEnum);

      expect(values).toContain("Zero");
      expect(values).toContain("One");
      expect(values).toContain(0 as unknown as string);
      expect(values).toContain(1 as unknown as string);
    });
  });

  describe("isValidEnumValue", () => {
    test("should return true for a value in the enum", () => {
      expect(EnumUtil.isValidEnumValue(StringEnum, "First")).toBe(true);
      expect(EnumUtil.isValidEnumValue(StringEnum, "second-value")).toBe(true);
    });

    test("should return false for the enum key when it differs from the value", () => {
      expect(EnumUtil.isValidEnumValue(StringEnum, "Second")).toBe(false);
    });

    test("should return false for values not in the enum", () => {
      expect(EnumUtil.isValidEnumValue(StringEnum, "Third")).toBe(false);
      expect(EnumUtil.isValidEnumValue(StringEnum, null)).toBe(false);
      expect(EnumUtil.isValidEnumValue(StringEnum, undefined)).toBe(false);
      expect(EnumUtil.isValidEnumValue(StringEnum, 0)).toBe(false);
    });
  });
});
