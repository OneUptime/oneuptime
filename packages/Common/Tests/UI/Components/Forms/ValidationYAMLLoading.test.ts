import { afterAll, describe, expect, jest, test } from "@jest/globals";

/*
 * The YAML check is a file of its own: js-yaml, which every page with a form
 * used to download because a form's validation imported it (issue #5619). It
 * arrives with the YAML editor, so nothing typed goes unchecked.
 *
 * In this order (a test file keeps what it has loaded, so the order is part of
 * the test):
 *
 *   - until it has arrived the field holds only what the form opened with: it
 *     is not judged, and does not hold the form up, but a required field that
 *     is empty still is;
 *   - a check that could not be fetched fails the editor's load with it, and
 *     is tried again;
 *   - with the editor, the check is there, and the text is judged.
 */

const mockCheck: { requires: number; fail: boolean } = {
  requires: 0,
  fail: false,
};

jest.mock("../../../../Types/Code/YamlSyntax", () => {
  mockCheck.requires++;

  if (mockCheck.fail) {
    throw new Error("The check's file could not be fetched");
  }

  return jest.requireActual("../../../../Types/Code/YamlSyntax");
});

import Validation from "../../../../UI/Components/Forms/Validation";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { loadYamlEditor } from "../../../../UI/Components/CodeEditor/LazyYamlEditor";
import { getLoadedYamlSyntaxCheck } from "../../../../UI/Components/CodeEditor/YamlSyntaxLoader";
import { JSONObject } from "../../../../Types/JSON";
import Dictionary from "../../../../Types/Dictionary";

interface TestEntity extends JSONObject {
  sigmaRuleYaml?: string;
}

const NOT_YAML: string = "title: [unclosed\nlevel: high\n";

const FIELD: Field<TestEntity> = {
  title: "Sigma Rule (YAML)",
  name: "sigmaRuleYaml",
  field: { sigmaRuleYaml: true },
  fieldType: FormFieldSchemaType.YAML,
} as Field<TestEntity>;

const REQUIRED_FIELD: Field<TestEntity> = {
  ...FIELD,
  required: true,
} as Field<TestEntity>;

const validate: (
  field: Field<TestEntity>,
  values: FormValues<TestEntity>,
) => Dictionary<string> = (
  field: Field<TestEntity>,
  values: FormValues<TestEntity>,
): Dictionary<string> => {
  return Validation.validate<TestEntity>({
    formFields: [field],
    values: values,
    onValidate: undefined,
  });
};

afterAll(() => {
  jest.restoreAllMocks();
});

describe("a YAML field's check", () => {
  test("is not loaded by a form's validation being imported, or being run", () => {
    expect(
      validate(FIELD, { sigmaRuleYaml: NOT_YAML } as FormValues<TestEntity>),
    ).toEqual({});

    expect(mockCheck.requires).toBe(0);
    expect(getLoadedYamlSyntaxCheck()).toBeNull();
  });

  test("until it has arrived, the text is not judged", () => {
    expect(Validation.validateYAMLSyntax(NOT_YAML, FIELD)).toBeNull();
  });

  test("until it has arrived, an empty required field still holds the form up", () => {
    expect(validate(REQUIRED_FIELD, {} as FormValues<TestEntity>)).toEqual({
      sigmaRuleYaml: expect.stringContaining("required"),
    });

    expect(
      validate(REQUIRED_FIELD, {
        sigmaRuleYaml: "",
      } as FormValues<TestEntity>),
    ).toEqual({ sigmaRuleYaml: expect.stringContaining("required") });
  });

  test("that could not be fetched fails the editor's load: the field says so, rather than save unchecked", async () => {
    mockCheck.fail = true;

    await expect(loadYamlEditor()).rejects.toThrow(
      "The check's file could not be fetched",
    );

    expect(getLoadedYamlSyntaxCheck()).toBeNull();
  });

  test("arrives with the editor, tried again after a failed load", async () => {
    mockCheck.fail = false;

    const requiresBefore: number = mockCheck.requires;

    await loadYamlEditor();

    expect(mockCheck.requires).toBeGreaterThan(requiresBefore);
    expect(getLoadedYamlSyntaxCheck()).not.toBeNull();
  });

  test("once it has arrived, the text is judged", () => {
    expect(Validation.validateYAMLSyntax(NOT_YAML, FIELD)).toEqual(
      expect.stringContaining("Sigma Rule (YAML)"),
    );

    expect(
      validate(FIELD, { sigmaRuleYaml: NOT_YAML } as FormValues<TestEntity>),
    ).toEqual({ sigmaRuleYaml: expect.stringContaining("Sigma Rule (YAML)") });

    expect(
      Validation.validateYAMLSyntax("title: Failed logon burst\n", FIELD),
    ).toBeNull();
  });

  test("is asked of nothing but a YAML field", () => {
    expect(
      Validation.validateYAMLSyntax(NOT_YAML, {
        ...FIELD,
        fieldType: FormFieldSchemaType.Text,
      } as Field<TestEntity>),
    ).toBeNull();
  });
});
