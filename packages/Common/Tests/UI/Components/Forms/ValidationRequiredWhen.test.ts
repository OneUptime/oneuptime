import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * A field whose `required` depends on the other answers - `required` written
 * as a function - and that nobody has typed into yet.
 *
 * Validation.validate has two paths. A field whose key is in the values goes
 * through validateRequired, which calls the function. A field whose key is
 * missing altogether (never typed into, and no default) went down an `else`
 * branch that tested `field.required` for truthiness - and a function is
 * always truthy. So such a field was required whatever the function said.
 *
 * That made the Create OAuth 2.0 Variable form refuse a public client on the
 * Refresh Token grant: its client secret is required only for Client
 * Credentials, yet the form said "Client Secret is required." to anybody who
 * had not typed one.
 */

interface Entity extends JSONObject {
  grantType?: string | undefined;
  clientSecret?: string | undefined;
  refreshToken?: string | undefined;
}

function field(
  name: string,
  required: Field<Entity>["required"],
): Field<Entity> {
  return {
    name,
    title: name,
    field: { [name]: true },
    fieldType: FormFieldSchemaType.Text,
    required,
  } as Field<Entity>;
}

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

const requiredUnlessRefreshToken: (values: FormValues<Entity>) => boolean = (
  values: FormValues<Entity>,
): boolean => {
  return values["grantType"] !== "Refresh Token";
};

describe("a field required only for some answers, never typed into", () => {
  test("is not required when the function says so", () => {
    expect(
      validate([field("clientSecret", requiredUnlessRefreshToken)], {
        grantType: "Refresh Token",
      }),
    ).toEqual({});
  });

  test("is required when the function says so", () => {
    expect(
      validate([field("clientSecret", requiredUnlessRefreshToken)], {
        grantType: "Client Credentials",
      }),
    ).toEqual({ clientSecret: "clientSecret is required." });
  });

  test("is asked with the form's current answers", () => {
    const seen: Array<JSONObject> = [];

    validate(
      [
        field("clientSecret", (values: FormValues<Entity>): boolean => {
          seen.push({ ...(values as JSONObject) });
          return false;
        }),
      ],
      { grantType: "Refresh Token", refreshToken: "abc" },
    );

    expect(seen).toEqual([{ grantType: "Refresh Token", refreshToken: "abc" }]);
  });

  // The same answer whichever path the field takes.
  test("is judged the same as one cleared after typing", () => {
    for (const grantType of ["Refresh Token", "Client Credentials"]) {
      expect(
        validate([field("clientSecret", requiredUnlessRefreshToken)], {
          grantType,
        }),
      ).toEqual(
        validate([field("clientSecret", requiredUnlessRefreshToken)], {
          grantType,
          clientSecret: "",
        }),
      );
    }
  });
});

describe("a field never typed into, with a fixed required", () => {
  test("is required when required is true", () => {
    expect(validate([field("refreshToken", true)], {})).toEqual({
      refreshToken: "refreshToken is required.",
    });
  });

  test("is not required when required is false or left out", () => {
    expect(validate([field("refreshToken", false)], {})).toEqual({});
    expect(validate([field("refreshToken", undefined)], {})).toEqual({});
  });
});
