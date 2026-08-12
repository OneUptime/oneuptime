import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

interface TestEntity extends JSONObject {
  config?: JSONValue;
  name?: JSONValue;
}

type MakeFieldFunction = (overrides?: Partial<Field<TestEntity>>) => Field<TestEntity>;

const makeJSONField: MakeFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
): Field<TestEntity> => {
  return {
    title: "Config",
    name: "config",
    field: { config: true },
    fieldType: FormFieldSchemaType.JSON,
    ...overrides,
  } as Field<TestEntity>;
};

type ValidateValueFunction = (
  value: unknown,
  field?: Field<TestEntity> | undefined,
) => string | null;

const validateValue: ValidateValueFunction = (
  value: unknown,
  field?: Field<TestEntity> | undefined,
): string | null => {
  return Validation.validateJSONSyntax(
    value as never,
    field || makeJSONField(),
  );
};

describe("Validation.validateJSONSyntax — only acts on JSON fields", () => {
  test("ignores every other field type", () => {
    const textField: Field<TestEntity> = makeJSONField({
      fieldType: FormFieldSchemaType.Text,
    });

    expect(validateValue("definitely not json", textField)).toBeNull();
  });

  test("names the field in the message", () => {
    const message: string | null = validateValue('{"a":1,}');

    expect(message).toMatch(/^Config is not valid JSON\./);
  });
});

describe("Validation.validateJSONSyntax — catches the real mistakes", () => {
  test("a trailing comma", () => {
    expect(validateValue('{"a": 1,}')).toBeTruthy();
  });

  test("an unclosed brace", () => {
    expect(validateValue('{"a": 1')).toBeTruthy();
  });

  test("unquoted keys and single quotes", () => {
    expect(validateValue("{a: 1}")).toBeTruthy();
    expect(validateValue("{'a': 1}")).toBeTruthy();
  });

  test("plain text in a JSON box", () => {
    expect(validateValue("hello")).toBeTruthy();
  });
});

describe("Validation.validateJSONSyntax — never fires on a working value", () => {
  test("well-formed JSON", () => {
    expect(validateValue('{"a": 1}')).toBeNull();
    expect(validateValue("[1,2,3]")).toBeNull();
    expect(validateValue('"a string"')).toBeNull();
  });

  /*
   * The values that made a naive JSON.parse check unshippable. Each is a real
   * thing a workflow author writes.
   */
  test("a whole-field template", () => {
    expect(
      validateValue("{{local.components.api-get-1.returnValues.response-body}}"),
    ).toBeNull();
  });

  test("a template standing in for a bare value", () => {
    expect(validateValue('{"retries": {{local.variables.count}}}')).toBeNull();
  });

  test("a template inside a string", () => {
    expect(
      validateValue('{"auth": "Bearer {{local.variables.token}}"}'),
    ).toBeNull();
  });

  test("a loop, whose shape is only known at run time", () => {
    expect(
      validateValue(
        '[{{#each local.components.a.returnValues.items}}{"id":"{{this}}"},{{/each}}]',
      ),
    ).toBeNull();
  });

  /*
   * The seven model-backed forms elsewhere in the product bind real arrays and
   * objects to a JSON field. Those must never be judged as text — this is the
   * regression the raw-value plumbing exists to prevent.
   */
  test("an already-parsed object", () => {
    expect(validateValue({ a: 1 })).toBeNull();
  });

  test("an already-parsed array", () => {
    expect(validateValue(["https://a.example.com"])).toBeNull();
  });

  test("empty, so the required-field message stands instead", () => {
    expect(validateValue("")).toBeNull();
    expect(validateValue("   ")).toBeNull();
    expect(validateValue(undefined)).toBeNull();
    expect(validateValue(null)).toBeNull();
  });
});

describe("Validation.validateJSONSyntax — allowJSON5", () => {
  /*
   * Some workflow argument types are read back with JSONFunctions.parse, which
   * is JSON5. Judging those by JSON's rules would report a mistake in a
   * workflow that runs perfectly well.
   */
  const looseField: Field<TestEntity> = makeJSONField({ allowJSON5: true });

  test("accepts unquoted keys, single quotes and a trailing comma", () => {
    expect(validateValue("{a: 1}", looseField)).toBeNull();
    expect(validateValue("{'a': 1}", looseField)).toBeNull();
    expect(validateValue('{"a": 1,}', looseField)).toBeNull();
  });

  test("still rejects text that is not parseable at all", () => {
    expect(validateValue("{oops", looseField)).toBeTruthy();
    expect(validateValue("hello", looseField)).toBeTruthy();
  });

  test("is off by default, so JSON fields stay strict", () => {
    expect(validateValue('{"a": 1,}')).toBeTruthy();
  });
});

describe("Validation.validate — end to end through the form validator", () => {
  type RunValidateFunction = (
    values: FormValues<TestEntity>,
    fields: Array<Field<TestEntity>>,
  ) => Dictionary<string>;

  const runValidate: RunValidateFunction = (
    values: FormValues<TestEntity>,
    fields: Array<Field<TestEntity>>,
  ): Dictionary<string> => {
    return Validation.validate<TestEntity>({
      formFields: fields,
      values: values,
      onValidate: undefined,
    });
  };

  test("surfaces a JSON error against the field name", () => {
    const errors: Dictionary<string> = runValidate(
      { config: '{"a":1,}' } as FormValues<TestEntity>,
      [makeJSONField()],
    );

    expect(errors["config"]).toMatch(/not valid JSON/);
  });

  test("says required, not malformed, when the box is empty", () => {
    const errors: Dictionary<string> = runValidate(
      { config: "" } as FormValues<TestEntity>,
      [makeJSONField({ required: true })],
    );

    expect(errors["config"]).toMatch(/required/i);
    expect(errors["config"]).not.toMatch(/not valid JSON/);
  });

  test("does not flag an object bound to a JSON field", () => {
    const errors: Dictionary<string> = runValidate(
      { config: { nested: { deep: true } } } as FormValues<TestEntity>,
      [makeJSONField()],
    );

    expect(errors["config"]).toBeUndefined();
  });

  test("does not flag an array bound to a JSON field", () => {
    const errors: Dictionary<string> = runValidate(
      {
        config: ["https://a.example.com", "https://b.example.com"],
      } as FormValues<TestEntity>,
      [makeJSONField()],
    );

    expect(errors["config"]).toBeUndefined();
  });

  test("leaves a hidden field alone", () => {
    const errors: Dictionary<string> = runValidate(
      { config: "{oops" } as FormValues<TestEntity>,
      [
        makeJSONField({
          showIf: (): boolean => {
            return false;
          },
        }),
      ],
    );

    expect(errors["config"]).toBeUndefined();
  });

  test("reports nothing for a valid form", () => {
    const errors: Dictionary<string> = runValidate(
      { config: '{"a": 1}' } as FormValues<TestEntity>,
      [makeJSONField()],
    );

    expect(Object.keys(errors)).toHaveLength(0);
  });
});
