import { JSONObject, ObjectType } from "../../Types/JSON";
import BadDataException from "../../Types/Exception/BadDataException";
import Decimal from "../../Types/Decimal";

describe("Decimal", () => {
  describe("constructor", () => {
    test("stores a numeric value", () => {
      expect(new Decimal(3.14).value).toBe(3.14);
    });

    test("parses a string value into a number", () => {
      expect(new Decimal("2.5").value).toBe(2.5);
    });

    test("unwraps the value when given another Decimal", () => {
      const original: Decimal = new Decimal(7);
      expect(new Decimal(original).value).toBe(7);
    });
  });

  describe("value setter", () => {
    test("updates the stored value", () => {
      const decimal: Decimal = new Decimal(1);
      decimal.value = 9.99;
      expect(decimal.value).toBe(9.99);
    });
  });

  describe("equals", () => {
    test("returns true for two Decimals with the same value", () => {
      expect(new Decimal(5).equals(new Decimal(5))).toBe(true);
    });

    test("returns false for two Decimals with different values", () => {
      expect(new Decimal(5).equals(new Decimal(6))).toBe(false);
    });
  });

  describe("toString", () => {
    test("returns the string representation of the value", () => {
      expect(new Decimal(42).toString()).toBe("42");
      expect(new Decimal(3.5).toString()).toBe("3.5");
    });
  });

  describe("toJSON", () => {
    test("serializes to a Decimal object type", () => {
      expect(new Decimal(1.25).toJSON()).toEqual({
        _type: ObjectType.Decimal,
        value: "1.25",
      });
    });
  });

  describe("fromJSON", () => {
    test("deserializes a valid Decimal JSON object", () => {
      const json: JSONObject = {
        _type: ObjectType.Decimal,
        value: "8.5",
      };
      const decimal: Decimal = Decimal.fromJSON(json);
      expect(decimal).toBeInstanceOf(Decimal);
      expect(decimal.value).toBe(8.5);
    });

    test("throws a BadDataException for an invalid _type", () => {
      const json: JSONObject = {
        _type: "NotADecimal",
        value: "1",
      };
      expect(() => {
        return Decimal.fromJSON(json);
      }).toThrow(BadDataException);
    });
  });

  describe("fromString", () => {
    test("creates a Decimal from a string", () => {
      const decimal: Decimal = Decimal.fromString("12.34");
      expect(decimal).toBeInstanceOf(Decimal);
      expect(decimal.value).toBe(12.34);
    });
  });

  describe("toJSON / fromJSON round trip", () => {
    test("preserves the value across serialization", () => {
      const original: Decimal = new Decimal(99.01);
      const restored: Decimal = Decimal.fromJSON(original.toJSON());
      expect(restored.equals(original)).toBe(true);
    });
  });

  /*
   * A decimal column is declared `TableColumnType.Number`, so whatever
   * reaches the transformer may be a Decimal, a string, or a plain number
   * depending on how far the request body got through deserialization.
   */
  describe("getDatabaseTransformer().to", () => {
    const transformer: ReturnType<typeof Decimal.getDatabaseTransformer> =
      Decimal.getDatabaseTransformer();

    test("stores a Decimal instance as its string form", () => {
      expect(transformer.to(new Decimal(125.5))).toBe("125.5");
    });

    test("stores a raw string", () => {
      expect(transformer.to("125.5")).toBe("125.5");
    });

    test("stores a raw number", () => {
      expect(transformer.to(125.5)).toBe("125.5");
    });

    /*
     * `0` is a perfectly good decimal, and both of its columns are NOT NULL.
     * A truthiness check used to send it to null, which the column rejects.
     */
    test("stores zero rather than turning it into null", () => {
      expect(transformer.to(0)).toBe("0");
      expect(transformer.to("0")).toBe("0");
      expect(transformer.to(new Decimal(0))).toBe("0");
    });

    test("keeps undefined distinct from null so a column DEFAULT applies", () => {
      expect(transformer.to(undefined)).toBeUndefined();
      expect(transformer.to(null)).toBeNull();
    });
  });
});
