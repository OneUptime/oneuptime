import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * The YAML twin of ValidationJSON.test.ts. Its job is the same: block Save on
 * a document the parser will refuse, and never block on one it will accept.
 *
 * The field this exists for is the Detection Rules page's "Sigma Rule (YAML)",
 * which used to render the Markdown editor. The server compiles the rule on
 * save either way, so everything here is about hearing the error before the
 * round trip rather than after it.
 */

interface TestEntity extends JSONObject {
  sigmaRuleYaml?: JSONValue;
  name?: JSONValue;
}

const VALID_SIGMA_RULE: string = `title: Failed logon burst
logsource:
  category: authentication
detection:
  selection:
    className: Authentication
    statusName: Failure
  condition: selection
level: high
`;

type MakeFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
) => Field<TestEntity>;

const makeYAMLField: MakeFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
): Field<TestEntity> => {
  return {
    title: "Sigma Rule (YAML)",
    name: "sigmaRuleYaml",
    field: { sigmaRuleYaml: true },
    fieldType: FormFieldSchemaType.YAML,
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
  return Validation.validateYAMLSyntax(
    value as never,
    field || makeYAMLField(),
  );
};

describe("Validation.validateYAMLSyntax — only acts on YAML fields", () => {
  test("ignores every other field type", () => {
    for (const fieldType of [
      FormFieldSchemaType.Text,
      FormFieldSchemaType.LongText,
      FormFieldSchemaType.Markdown,
      FormFieldSchemaType.JSON,
      FormFieldSchemaType.JavaScript,
    ]) {
      const otherField: Field<TestEntity> = makeYAMLField({ fieldType });

      expect(
        validateValue("title: [definitely not yaml", otherField),
      ).toBeNull();
    }
  });

  test("names the field in the message", () => {
    const message: string | null = validateValue("title: [unclosed");

    expect(message).toMatch(/^Sigma Rule \(YAML\) is not valid YAML\./);
  });

  test("falls back to the field name when it has no title", () => {
    const untitled: Field<TestEntity> = makeYAMLField();
    delete (untitled as { title?: string }).title;

    const message: string | null = validateValue("title: [unclosed", untitled);

    expect(message).toMatch(/^sigmaRuleYaml is not valid YAML\./);
  });

  test("the message carries the parser's reason and position", () => {
    const message: string | null = validateValue(
      "detection:\n  selection: 1\n   condition: selection\n",
    );

    expect(message).toContain("line ");
    expect(message).toContain("column ");
  });

  test("the message is one line — it is rendered under a form field", () => {
    expect(validateValue("title: [unclosed")).not.toContain("\n");
  });
});

describe("Validation.validateYAMLSyntax — catches the real mistakes", () => {
  test("an unclosed flow sequence", () => {
    expect(validateValue("title: [unclosed")).toBeTruthy();
  });

  test("a tab used for indentation", () => {
    expect(validateValue("detection:\n\tselection: 1\n")).toBeTruthy();
  });

  test("indentation that does not line up", () => {
    expect(
      validateValue("detection:\n  selection: 1\n   condition: selection\n"),
    ).toBeTruthy();
  });

  test("a duplicated key", () => {
    expect(validateValue("title: one\ntitle: two\n")).toBeTruthy();
  });
});

describe("Validation.validateYAMLSyntax — never fires on a working value", () => {
  test("a real Sigma rule", () => {
    expect(validateValue(VALID_SIGMA_RULE)).toBeNull();
  });

  test("a rule carrying comments", () => {
    expect(
      validateValue(`# catches password spraying\n${VALID_SIGMA_RULE}`),
    ).toBeNull();
  });

  test("flow style, which is also legal JSON", () => {
    expect(validateValue('{"title": "x"}')).toBeNull();
  });

  /*
   * The raw value is handed in rather than the stringified `content` for the
   * same reason the JSON validator takes it: String(anObject) is
   * "[object Object]", which is not the document the user typed.
   */
  test("an already-parsed object is not judged as text", () => {
    expect(validateValue({ title: "x" })).toBeNull();
    expect(validateValue(["a", "b"])).toBeNull();
  });

  test("empty, so the required-field message stands instead", () => {
    expect(validateValue("")).toBeNull();
    expect(validateValue("   ")).toBeNull();
    expect(validateValue(undefined)).toBeNull();
    expect(validateValue(null)).toBeNull();
  });

  test("handlebars templates, which resolve at run time", () => {
    expect(validateValue("threshold: {{local.variables.count}}")).toBeNull();
    expect(
      validateValue(
        "items:\n{{#each local.variables.hosts}}\n  - {{this}}\n{{/each}}\n",
      ),
    ).toBeNull();
  });
});

describe("Validation.validate — a YAML field inside a whole form", () => {
  type ValidateFormFunction = (
    values: FormValues<TestEntity>,
    fields?: Array<Field<TestEntity>> | undefined,
  ) => Dictionary<string>;

  const validateForm: ValidateFormFunction = (
    values: FormValues<TestEntity>,
    fields?: Array<Field<TestEntity>> | undefined,
  ): Dictionary<string> => {
    return Validation.validate<TestEntity>({
      formFields: fields || [makeYAMLField({ required: true })],
      values,
      onValidate: undefined,
    });
  };

  test("a malformed rule stops the form", () => {
    const errors: Dictionary<string> = validateForm({
      sigmaRuleYaml: "title: [unclosed",
    } as FormValues<TestEntity>);

    expect(errors["sigmaRuleYaml"]).toMatch(/is not valid YAML/);
  });

  test("a well-formed rule leaves the form clean", () => {
    const errors: Dictionary<string> = validateForm({
      sigmaRuleYaml: VALID_SIGMA_RULE,
    } as FormValues<TestEntity>);

    expect(errors["sigmaRuleYaml"]).toBeUndefined();
  });

  /*
   * An empty box must read as "required", not as a parse failure — the syntax
   * check skips empty precisely so this message is the one that survives.
   */
  test("an empty required field reports required, not invalid YAML", () => {
    const errors: Dictionary<string> = validateForm({
      sigmaRuleYaml: "",
    } as FormValues<TestEntity>);

    expect(errors["sigmaRuleYaml"]).toBeDefined();
    expect(errors["sigmaRuleYaml"]).not.toMatch(/is not valid YAML/);
  });

  test("a hidden field (showIf false) is not validated", () => {
    const errors: Dictionary<string> = validateForm(
      { sigmaRuleYaml: "title: [unclosed" } as FormValues<TestEntity>,
      [
        makeYAMLField({
          showIf: (): boolean => {
            return false;
          },
        }),
      ],
    );

    expect(errors["sigmaRuleYaml"]).toBeUndefined();
  });
});
