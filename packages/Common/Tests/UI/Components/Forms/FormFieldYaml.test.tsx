import "@testing-library/jest-dom";
import React from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";

/*
 * A FormFieldSchemaType member with no render branch in FormField.tsx is a
 * silent failure: the field draws its label and description above empty
 * space, and neither the compiler nor the linter says a word. (Query is in
 * the enum today and does exactly that.) These tests are the guard for YAML.
 */

interface TestEntity extends JSONObject {
  sigmaRuleYaml?: string;
}

const VALID_SIGMA_RULE: string = "title: Failed logon burst\nlevel: high\n";

type RenderFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
  values?: FormValues<TestEntity>,
) => void;

const renderField: RenderFieldFunction = (
  overrides?: Partial<Field<TestEntity>>,
  values?: FormValues<TestEntity>,
): void => {
  const field: Field<TestEntity> = {
    title: "Sigma Rule (YAML)",
    description: "The Sigma rule to evaluate, in YAML.",
    name: "sigmaRuleYaml",
    field: { sigmaRuleYaml: true },
    fieldType: FormFieldSchemaType.YAML,
    required: true,
    ...overrides,
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="sigmaRuleYaml"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={
        (values || {
          sigmaRuleYaml: VALID_SIGMA_RULE,
        }) as FormValues<TestEntity>
      }
      setFieldTouched={() => {}}
      setFieldValue={() => {}}
    />,
  );
};

afterEach(() => {
  cleanup();
});

describe("FormField — a YAML field renders a YAML editor", () => {
  test("an editor is rendered at all, not a label above empty space", () => {
    renderField();

    expect(screen.getByTestId("yaml-editor")).toBeInTheDocument();
    expect(screen.getByTestId("code-editor-input")).toBeInTheDocument();
  });

  test("the editor is a YAML code editor, not html or markdown", () => {
    renderField();

    expect(
      screen.getByTestId("yaml-editor").querySelector("[data-code-type]"),
    ).toHaveAttribute("data-code-type", "yaml");
  });

  /*
   * The bug: a Sigma rule field rendered the rich-text Markdown editor, so it
   * carried a Bold button and an H1 button.
   */
  test("no rich-text toolbar comes with it", () => {
    renderField();

    for (const label of ["Bold", "Italic", "Heading 1", "Heading 2"]) {
      expect(screen.queryByTitle(label)).toBeNull();
    }
  });

  test("the current value is shown in the editor", () => {
    renderField();

    expect(
      (screen.getByTestId("code-editor-input") as HTMLTextAreaElement).value,
    ).toBe(VALID_SIGMA_RULE);
  });

  test("an empty field renders an empty editor rather than crashing", () => {
    renderField(undefined, {} as FormValues<TestEntity>);

    expect(
      (screen.getByTestId("code-editor-input") as HTMLTextAreaElement).value,
    ).toBe("");
  });

  test("the field's label is still rendered above it", () => {
    renderField();

    expect(screen.getByText("Sigma Rule (YAML)")).toBeInTheDocument();
  });

  /*
   * The editor's textarea does not carry the generated field id, so the
   * label cannot use htmlFor without dangling (WCAG 1.3.1). It names the
   * editor through aria-labelledby instead - on the textarea itself, the
   * element that takes focus, because ARIA does not name a role=generic div.
   */
  test("the field's label names the editor's textarea", () => {
    renderField();

    const labelId: string =
      screen.getByTestId("code-editor-input").getAttribute("aria-labelledby") ||
      "";

    expect(labelId).not.toBe("");
    expect(document.getElementById(labelId)?.textContent).toContain(
      "Sigma Rule (YAML)",
    );
  });

  test("the editor is described by the hint and the status bar", () => {
    renderField();

    const describedBy: string =
      screen
        .getByTestId("code-editor-input")
        .getAttribute("aria-describedby") || "";

    expect(describedBy.split(" ").length).toBeGreaterThanOrEqual(2);

    for (const id of describedBy.split(" ")) {
      expect(document.getElementById(id)).not.toBeNull();
    }
  });

  test("no <label for> points at an element that does not exist", () => {
    renderField();

    const labels: Array<HTMLLabelElement> = Array.from(
      document.querySelectorAll("label[for]"),
    );

    for (const label of labels) {
      expect(document.getElementById(label.htmlFor)).not.toBeNull();
    }
  });

  test("the dataTestId the page sets reaches the editor", () => {
    renderField({ dataTestId: "sigma-rule-yaml" });

    expect(screen.getByTestId("sigma-rule-yaml")).toBeInTheDocument();
  });

  test("a hidden field (showIf false) renders nothing", () => {
    renderField({
      showIf: (): boolean => {
        return false;
      },
    });

    expect(screen.queryByTestId("yaml-editor")).toBeNull();
  });
});
