import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * AN EMPTY NUMBER BOX IS EMPTY, NOT "NaN" (#6875).
 *
 * A number box left empty - the Admin Dashboard's SMTP Port on a fresh
 * server, whose 587 was only the placeholder - holds NaN. The required
 * check read it as the text "NaN", found something there, and let the Port
 * check behind it answer "Invalid number: NaN": it said neither what was
 * wrong nor what to do. Now NaN is empty: a required box says "<Title> is
 * required", an optional one says nothing, and a number that is there is
 * checked as before.
 */

interface Entity extends JSONObject {
  port?: number | undefined;
  count?: number | undefined;
}

function field(data: {
  name: string;
  title: string;
  fieldType: FormFieldSchemaType;
  required: boolean;
}): Field<Entity> {
  return {
    name: data.name,
    title: data.title,
    field: { [data.name]: true },
    fieldType: data.fieldType,
    required: data.required,
  } as Field<Entity>;
}

const PORT: Field<Entity> = field({
  name: "port",
  title: "Port",
  fieldType: FormFieldSchemaType.Port,
  required: true,
});

function validate(
  fields: Array<Field<Entity>>,
  values: JSONObject,
): Dictionary<string> {
  return Validation.validate<Entity>({
    formFields: fields,
    values: values as FormValues<Entity>,
    onValidate: undefined,
  });
}

describe("a required number box left empty", () => {
  test("a Port holding NaN says Port is required - not Invalid number: NaN", () => {
    const errors: Dictionary<string> = validate([PORT], { port: NaN });

    expect(errors["port"]).toBe("Port is required.");
    expect(JSON.stringify(errors)).not.toContain("NaN");
  });

  test("a Number holding NaN says it is required too", () => {
    const errors: Dictionary<string> = validate(
      [
        field({
          name: "count",
          title: "Count",
          fieldType: FormFieldSchemaType.Number,
          required: true,
        }),
      ],
      { count: NaN },
    );

    expect(errors["count"]).toBe("Count is required.");
  });

  test("the same as a box that holds nothing at all", () => {
    expect(validate([PORT], { port: NaN })).toEqual(
      validate([PORT], { port: "" }),
    );
  });
});

describe("an optional number box left empty", () => {
  test("says nothing", () => {
    expect(
      validate(
        [
          field({
            name: "port",
            title: "Port",
            fieldType: FormFieldSchemaType.Port,
            required: false,
          }),
        ],
        { port: NaN },
      ),
    ).toEqual({});
  });
});

describe("a number that is there", () => {
  test("587 passes, and a port out of range is still refused", () => {
    expect(validate([PORT], { port: 587 })).toEqual({});
    expect(validate([PORT], { port: "587" })).toEqual({});
    expect(validate([PORT], { port: 70000 })["port"]).toBeTruthy();
  });
});
