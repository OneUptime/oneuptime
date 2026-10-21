import "@testing-library/jest-dom";
import React from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";

/*
 * Every code-typed form field - JSON, YAML, HTML, CSS, JavaScript - renders
 * the one CodeEditor, with the grammar picked off the field type, the
 * field's label naming it, the form's error in its status bar, and the
 * form's touched/value bookkeeping wired to real events.
 */

interface TestEntity extends JSONObject {
  config?: string;
}

interface RenderOptions {
  fieldType: FormFieldSchemaType;
  value?: string | undefined;
  overrides?: Partial<Field<TestEntity>> | undefined;
  error?: string | undefined;
  touched?: boolean | undefined;
  setFieldTouched?: ((name: string, value: boolean) => void) | undefined;
  setFieldValue?: ((name: string, value: unknown) => void) | undefined;
}

type RenderFieldFunction = (options: RenderOptions) => void;

const renderField: RenderFieldFunction = (options: RenderOptions): void => {
  const field: Field<TestEntity> = {
    title: "Config",
    description: "The configuration.",
    name: "config",
    field: { config: true },
    fieldType: options.fieldType,
    required: false,
    ...(options.overrides || {}),
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="config"
      index={0}
      isDisabled={false}
      error={options.error || ""}
      touched={Boolean(options.touched)}
      currentValues={{ config: options.value ?? "" } as FormValues<TestEntity>}
      setFieldTouched={options.setFieldTouched || ((): void => {})}
      setFieldValue={
        (options.setFieldValue as (name: string, value: unknown) => void) ||
        ((): void => {})
      }
    />,
  );
};

type GetInputFunction = () => HTMLTextAreaElement;

const getInput: GetInputFunction = (): HTMLTextAreaElement => {
  return screen.getByTestId("code-editor-input") as HTMLTextAreaElement;
};

type StatusTextFunction = () => string;

const statusText: StatusTextFunction = (): string => {
  return screen.getByTestId("code-editor-status").textContent || "";
};

afterEach(() => {
  cleanup();
});

describe("FormField — code fields render the code editor", () => {
  test.each([
    [FormFieldSchemaType.JSON, "json", "JSON"],
    [FormFieldSchemaType.HTML, "html", "HTML"],
    [FormFieldSchemaType.CSS, "css", "CSS"],
    [FormFieldSchemaType.JavaScript, "javascript", "JavaScript"],
    [FormFieldSchemaType.YAML, "yaml", "YAML"],
  ])(
    "a %s field is a %s code editor",
    (fieldType: FormFieldSchemaType, codeType: string, label: string) => {
      renderField({ fieldType, value: "" });

      expect(document.querySelectorAll("[data-code-type]")).toHaveLength(1);
      expect(document.querySelector("[data-code-type]")).toHaveAttribute(
        "data-code-type",
        codeType,
      );
      expect(screen.getByTestId("code-editor-language")).toHaveTextContent(
        label,
      );
    },
  );

  test("a YAML field is wrapped in the YAML editor", () => {
    renderField({ fieldType: FormFieldSchemaType.YAML, value: "a: 1" });

    expect(screen.getByTestId("yaml-editor")).toContainElement(getInput());
  });

  test.each([
    FormFieldSchemaType.JSON,
    FormFieldSchemaType.HTML,
    FormFieldSchemaType.CSS,
    FormFieldSchemaType.JavaScript,
    FormFieldSchemaType.YAML,
  ])(
    "the %s field's current value is in the editor",
    (fieldType: FormFieldSchemaType) => {
      renderField({ fieldType, value: "body { color: red; }" });

      expect(getInput().value).toBe("body { color: red; }");
    },
  );

  test.each([
    FormFieldSchemaType.JSON,
    FormFieldSchemaType.HTML,
    FormFieldSchemaType.CSS,
    FormFieldSchemaType.JavaScript,
    FormFieldSchemaType.YAML,
  ])(
    "the %s field's label names the textarea",
    (fieldType: FormFieldSchemaType) => {
      renderField({ fieldType, value: "" });

      expect(screen.getByRole("textbox", { name: /^Config/ })).toBe(getInput());
      expect(getInput()).not.toHaveAttribute("aria-label");
    },
  );

  test("the dataTestId the page sets reaches the editor", () => {
    renderField({
      fieldType: FormFieldSchemaType.JSON,
      value: "{}",
      overrides: { dataTestId: "allowed-origins" },
    });

    expect(screen.getByTestId("allowed-origins")).toContainElement(getInput());
  });

  test("the field's placeholder is drawn in the empty editor, never written into it", () => {
    renderField({
      fieldType: FormFieldSchemaType.JSON,
      value: "",
      overrides: { placeholder: '["https://app.example.com"]' },
    });

    expect(getInput().value).toBe("");
    expect(
      document.querySelector(".ou-code-editor__placeholder")?.textContent,
    ).toBe('["https://app.example.com"]');
  });
});

describe("FormField — a JSON field's status agrees with the form's own check", () => {
  test("a plain JSON field reports JSON5 syntax as an error", () => {
    renderField({ fieldType: FormFieldSchemaType.JSON, value: "{a: 1,}" });

    expect(statusText()).toBe(
      "Property names must be wrapped in double quotes (line 1, column 2)",
    );
  });

  /*
   * Some workflow arguments are read back with JSON5, and the form validates
   * them that way (field.allowJSON5); the editor must not flag what Save
   * accepts.
   */
  test("a field read with JSON5 judges the same text valid", () => {
    renderField({
      fieldType: FormFieldSchemaType.JSON,
      value: "{a: 1,}",
      overrides: { allowJSON5: true },
    });

    expect(statusText()).toBe("Valid JSON · 1 line");
  });
});

describe("FormField — errors and touched state", () => {
  test.each([
    FormFieldSchemaType.JSON,
    FormFieldSchemaType.HTML,
    FormFieldSchemaType.CSS,
    FormFieldSchemaType.JavaScript,
    FormFieldSchemaType.YAML,
  ])(
    "a touched %s field shows the form's error once and is marked invalid",
    (fieldType: FormFieldSchemaType) => {
      renderField({
        fieldType,
        value: "x",
        error: "Config is required.",
        touched: true,
      });

      expect(statusText()).toBe("Config is required.");
      expect(screen.getAllByText("Config is required.")).toHaveLength(1);
      expect(getInput()).toHaveAttribute("aria-invalid", "true");
    },
  );

  test("an untouched field keeps the form's error to itself", () => {
    renderField({
      fieldType: FormFieldSchemaType.JSON,
      value: "{}",
      error: "Config is required.",
      touched: false,
    });

    expect(statusText()).toBe("Valid JSON · 1 line");
    expect(getInput()).not.toHaveAttribute("aria-invalid");
  });

  test.each([
    FormFieldSchemaType.JSON,
    FormFieldSchemaType.HTML,
    FormFieldSchemaType.CSS,
    FormFieldSchemaType.JavaScript,
    FormFieldSchemaType.YAML,
  ])(
    "a %s field is touched on blur, not on every keystroke",
    (fieldType: FormFieldSchemaType) => {
      const setFieldTouched: jest.Mock = jest.fn();

      renderField({ fieldType, value: "", setFieldTouched });

      act(() => {
        getInput().focus();
      });
      fireEvent.change(getInput(), { target: { value: "a" } });
      fireEvent.change(getInput(), { target: { value: "ab" } });

      expect(setFieldTouched).not.toHaveBeenCalled();

      fireEvent.blur(getInput());

      expect(setFieldTouched).toHaveBeenCalledTimes(1);
      expect(setFieldTouched).toHaveBeenCalledWith("config", true);
    },
  );

  test.each([
    FormFieldSchemaType.JSON,
    FormFieldSchemaType.HTML,
    FormFieldSchemaType.CSS,
    FormFieldSchemaType.JavaScript,
    FormFieldSchemaType.YAML,
  ])("every %s edit reaches the form", (fieldType: FormFieldSchemaType) => {
    const setFieldValue: jest.Mock = jest.fn();

    renderField({ fieldType, value: "", setFieldValue });

    fireEvent.change(getInput(), { target: { value: "[" } });
    fireEvent.change(getInput(), { target: { value: "[1]" } });

    expect(setFieldValue.mock.calls).toEqual([
      ["config", "["],
      ["config", "[1]"],
    ]);
  });

  test("an edit the editor makes itself reaches the form too", () => {
    // Bracket pairing writes through the textarea, not through a keystroke.
    const setFieldValue: jest.Mock = jest.fn();

    renderField({
      fieldType: FormFieldSchemaType.JSON,
      value: "",
      setFieldValue,
    });

    act(() => {
      getInput().focus();
    });
    fireEvent.keyDown(getInput(), { key: "[" });

    expect(setFieldValue).toHaveBeenLastCalledWith("config", "[]");
  });
});
