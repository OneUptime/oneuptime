import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A number field's minValue and maxValue judge a decimal as the number it
 * is. The check read the typed text with parseInt, so "100.5" was 100 and
 * passed a maximum of 100, and "-0.5" was 0 and passed a minimum of 0. The
 * field that showed it: a status page bar color rule's "When uptime % is
 * greater than or equal to" (Status Pages > Branding), 0 to 100, which takes
 * decimals such as 99.65 - and, since #4719, the decimals Terraform applies.
 */

interface RuleEntity extends JSONObject {
  uptimePercentGreaterThanOrEqualTo?: number | string | undefined;
}

const TITLE: string = "When uptime % is greater than or equal to";

const UPTIME_FIELD: Field<RuleEntity> = {
  name: "uptimePercentGreaterThanOrEqualTo",
  title: TITLE,
  field: { uptimePercentGreaterThanOrEqualTo: true },
  fieldType: FormFieldSchemaType.Number,
  required: true,
  validation: { minValue: 0, maxValue: 100 },
} as Field<RuleEntity>;

function errorFor(value: number | string): string | undefined {
  const errors: Dictionary<string> = Validation.validate<RuleEntity>({
    formFields: [UPTIME_FIELD],
    values: { uptimePercentGreaterThanOrEqualTo: value },
  });

  return errors["uptimePercentGreaterThanOrEqualTo"];
}

describe("a number field's bounds, for decimals", () => {
  test.each([["100"], ["99.65"], ["99.93055555555556"], ["0"], ["0.5"], [100]])(
    "%p is inside 0 to 100",
    (value: number | string) => {
      expect(errorFor(value)).toBeUndefined();
    },
  );

  test.each([["100.5"], ["100.0001"], [100.5]])(
    "%p is more than 100",
    (value: number | string) => {
      expect(errorFor(value)).toBe(`${TITLE} should not be more than 100.`);
    },
  );

  test.each([["-0.5"], ["-0.0001"], [-0.5]])(
    "%p is less than 0",
    (value: number | string) => {
      expect(errorFor(value)).toBe(`${TITLE} should not be less than 0.`);
    },
  );

  test("a decimal under a whole-number floor is refused, as before", () => {
    const field: Field<RuleEntity> = {
      ...UPTIME_FIELD,
      validation: { minValue: 1, maxValue: 100 },
    } as Field<RuleEntity>;

    expect(Validation.validateMaxValueAndMinValue("0.5", field)).toBe(
      `${TITLE} should not be less than 1.`,
    );
    expect(Validation.validateMaxValueAndMinValue("1.5", field)).toBeNull();
  });

  test("a decimal over a whole-number ceiling is refused", () => {
    const field: Field<RuleEntity> = {
      ...UPTIME_FIELD,
      validation: { minValue: 0, maxValue: 1 },
    } as Field<RuleEntity>;

    expect(Validation.validateMaxValueAndMinValue("1.5", field)).toBe(
      `${TITLE} should not be more than 1.`,
    );
    expect(Validation.validateMaxValueAndMinValue("0.5", field)).toBeNull();
  });
});
