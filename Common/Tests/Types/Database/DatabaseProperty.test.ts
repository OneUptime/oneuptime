import DatabaseProperty from "../../../Types/Database/DatabaseProperty";
import NotImplementedException from "../../../Types/Exception/NotImplementedException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import { describe, expect, it } from "@jest/globals";
import { Equal, FindOperator, In, Not } from "typeorm";
import { ValueTransformer } from "typeorm/decorator/options/ValueTransformer";

/*
 * DatabaseProperty is the base every value-object column type extends. Its
 * TypeORM ValueTransformer carries three pieces of behavior that are easy to
 * break and expensive to break:
 *
 *   - `to(undefined)` must stay `undefined` so an omitted column falls to its
 *     SQL DEFAULT instead of being rewritten to an explicit NULL (a not-null
 *     constraint violation / HTTP 500 on every create otherwise).
 *   - a Raw query object must pass straight through untouched.
 *   - a FindOperator (Equal/In/Not/And/...) must keep its structure while its
 *     leaf value(s) are converted, so a privacy/scope clause is preserved.
 *
 * DatabasePropertyFindOperator.test.ts checks the concrete subclasses. This
 * suite pins the base-class dispatch itself, using a tiny subclass whose
 * conversion is observable (uppercasing).
 */

// A minimal concrete DatabaseProperty whose conversions are observable.
class UpperCaseProperty extends DatabaseProperty {
  public value: string;

  public constructor(value: string) {
    super();
    this.value = value;
  }

  protected static override fromDatabase(
    value: string | number | JSONObject | JSONArray,
  ): DatabaseProperty | Array<DatabaseProperty> | null {
    return new UpperCaseProperty(String(value));
  }

  protected static override toDatabase(
    value: DatabaseProperty | Array<DatabaseProperty> | any,
  ): string | number | JSONObject | JSONArray | null {
    if (value instanceof UpperCaseProperty) {
      return value.value.toUpperCase();
    }

    if (typeof value === "string") {
      return value.toUpperCase();
    }

    return null;
  }
}

describe("DatabaseProperty", () => {
  describe("getDatabaseTransformer().to", () => {
    it("passes undefined through unchanged so the SQL DEFAULT survives", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      // The whole point: undefined must NOT become null here.
      expect(transformer.to(undefined)).toBeUndefined();
    });

    it("delegates a plain value to the subclass toDatabase", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      expect(transformer.to(new UpperCaseProperty("hello"))).toBe("HELLO");
    });

    it("passes a raw query object straight through without conversion", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      const raw: JSONObject = { _type: "raw", value: "keep me as-is" };
      const result: unknown = transformer.to(raw);

      // Same object, untouched - toDatabase (which uppercases) never ran.
      expect(result).toBe(raw);
      expect((result as JSONObject)["value"]).toBe("keep me as-is");
    });

    it("preserves an Equal FindOperator and converts only its leaf", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      const operator: FindOperator<string> = Equal("abc");
      const result: unknown = transformer.to(operator);

      // Structure kept (same instance), leaf converted.
      expect(result).toBe(operator);
      expect((result as FindOperator<string>).value).toBe("ABC");
    });

    it("preserves a Not FindOperator and converts its leaf", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      const operator: FindOperator<string> = Not("nope");
      const result: unknown = transformer.to(operator);

      expect(result).toBe(operator);
      expect((result as FindOperator<string>).value).toBe("NOPE");
    });

    it("converts every leaf of a multi-value In FindOperator", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      const operator: FindOperator<Array<string>> = In(["a", "b", "c"]);
      const result: unknown = transformer.to(operator);

      expect(result).toBe(operator);
      expect((result as FindOperator<Array<string>>).value).toEqual([
        "A",
        "B",
        "C",
      ]);
    });

    it("is a fixpoint: transforming its own output again is a no-op", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      const operator: FindOperator<string> = Equal("abc");
      transformer.to(operator);
      // Second pass (BaseAPI.getList shares the query between findBy/countBy).
      transformer.to(operator);

      expect(operator.value).toBe("ABC");
    });
  });

  describe("getDatabaseTransformer().from", () => {
    it("delegates to the subclass fromDatabase", () => {
      const transformer: ValueTransformer =
        UpperCaseProperty.getDatabaseTransformer();

      const result: unknown = transformer.from("stored");

      expect(result).toBeInstanceOf(UpperCaseProperty);
      expect((result as UpperCaseProperty).value).toBe("stored");
    });
  });

  describe("base class defaults", () => {
    it("getSchema throws NotImplementedException on the base class", () => {
      expect(() => {
        return DatabaseProperty.getSchema();
      }).toThrow(NotImplementedException);
    });

    it("still short-circuits undefined even on the un-implemented base", () => {
      const transformer: ValueTransformer =
        DatabaseProperty.getDatabaseTransformer();

      // Reaches the undefined guard before the un-implemented toDatabase.
      expect(transformer.to(undefined)).toBeUndefined();
    });

    it("throws NotImplementedException when the base must actually convert", () => {
      const transformer: ValueTransformer =
        DatabaseProperty.getDatabaseTransformer();

      expect(() => {
        return transformer.to("a real value");
      }).toThrow(NotImplementedException);
    });
  });
});
