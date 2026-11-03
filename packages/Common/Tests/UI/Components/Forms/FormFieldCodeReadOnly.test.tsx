/*
 * A code box its form locks (Field.disabled) shows its code to be read.
 *
 * Every other control FormField draws took notice of field.disabled - a list
 * to pick from, a text box, a switch - but the code editors did not: a
 * locked JSON, HTML, CSS, JavaScript or YAML field was typed in like any
 * other. Locked, it is the code editor's read-only box now: nothing in it
 * changes, no Format and no toolbar actions (a workflow step's Insert
 * value), and it is still selected and copied, its own Copy working.
 *
 * A step opened to be read on a workflow's Builder locks every setting this
 * way (Workflow/ArgumentsForm), so its code can be read and copied.
 */

import "@testing-library/jest-dom";
import React, { ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { CodeEditorActions } from "../../../../UI/Components/CodeEditor/CodeEditor";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";

interface TestEntity extends JSONObject {
  config?: string;
}

const CODE: Record<string, string> = {
  [FormFieldSchemaType.JSON]: '{"retries": 3}',
  [FormFieldSchemaType.HTML]: "<p>Deploy finished</p>",
  [FormFieldSchemaType.CSS]: "p { color: red; }",
  [FormFieldSchemaType.JavaScript]: "return { ok: true };",
  [FormFieldSchemaType.YAML]: "retries: 3",
};

const CODE_FIELD_TYPES: Array<FormFieldSchemaType> = [
  FormFieldSchemaType.JSON,
  FormFieldSchemaType.HTML,
  FormFieldSchemaType.CSS,
  FormFieldSchemaType.JavaScript,
  FormFieldSchemaType.YAML,
];

interface RenderOptions {
  fieldType: FormFieldSchemaType;
  disabled?: boolean | undefined;
  // The form's own lock, while it loads or saves - not the field's.
  isFormDisabled?: boolean | undefined;
  toolbarActions?: ((editor: CodeEditorActions) => ReactNode) | undefined;
  setFieldValue?: ((name: string, value: unknown) => void) | undefined;
}

const renderField: (options: RenderOptions) => void = (
  options: RenderOptions,
): void => {
  const field: Field<TestEntity> = {
    title: "Config",
    description: "The configuration.",
    name: "config",
    field: { config: true },
    fieldType: options.fieldType,
    required: false,
    ...(options.disabled !== undefined ? { disabled: options.disabled } : {}),
    ...(options.toolbarActions
      ? { codeEditorToolbarActions: options.toolbarActions }
      : {}),
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="config"
      index={0}
      isDisabled={Boolean(options.isFormDisabled)}
      error=""
      touched={false}
      currentValues={
        { config: CODE[options.fieldType] } as FormValues<TestEntity>
      }
      setFieldTouched={(): void => {}}
      setFieldValue={
        (options.setFieldValue as (name: string, value: unknown) => void) ||
        ((): void => {})
      }
    />,
  );
};

const getInput: () => HTMLTextAreaElement = (): HTMLTextAreaElement => {
  return screen.getByTestId("code-editor-input") as HTMLTextAreaElement;
};

let writeText: MockFunction;

beforeEach(() => {
  writeText = getJestMockFunction();
  writeText.mockImplementation((): Promise<void> => {
    return Promise.resolve();
  });

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("a code field its form locks", () => {
  test.each(CODE_FIELD_TYPES)(
    "a locked %s field shows its code to be read: read only, not disabled, said so",
    (fieldType: FormFieldSchemaType) => {
      renderField({ fieldType, disabled: true });

      const input: HTMLTextAreaElement = getInput();

      expect(input.value).toBe(CODE[fieldType]);
      expect(input).toHaveAttribute("readonly");
      // Not disabled: it is still focused, selected and scrolled.
      expect(input).toBeEnabled();
      expect(screen.getByTestId("code-editor-read-only")).toHaveTextContent(
        "Read-only",
      );
    },
  );

  test.each(CODE_FIELD_TYPES)(
    "a locked %s field's own Copy works, and copies the code",
    async (fieldType: FormFieldSchemaType) => {
      renderField({ fieldType, disabled: true });

      const copy: HTMLElement = screen.getByTestId("code-editor-copy-button");

      expect(copy).toBeEnabled();

      await act(async () => {
        fireEvent.click(copy);
      });

      expect(writeText).toHaveBeenCalledWith(CODE[fieldType]);
      expect(copy).toHaveTextContent("Copied");
    },
  );

  test("a locked JSON field offers no Format: nothing in it changes", () => {
    renderField({ fieldType: FormFieldSchemaType.JSON, disabled: true });

    expect(
      screen.queryByTestId("code-editor-format-button"),
    ).not.toBeInTheDocument();
  });

  test("a locked field draws none of its toolbar actions - a workflow step's Insert value", () => {
    renderField({
      fieldType: FormFieldSchemaType.JSON,
      disabled: true,
      toolbarActions: (): ReactNode => {
        return <button type="button">Insert value</button>;
      },
    });

    expect(
      screen.queryByRole("button", { name: "Insert value" }),
    ).not.toBeInTheDocument();
  });

  test("a key pressed in a locked field changes nothing", () => {
    const setFieldValue: MockFunction = getJestMockFunction();

    renderField({
      fieldType: FormFieldSchemaType.JSON,
      disabled: true,
      setFieldValue: setFieldValue,
    });

    const input: HTMLTextAreaElement = getInput();

    act(() => {
      input.focus();
      input.setSelectionRange(1, 1);
    });

    for (const key of ["Enter", "Tab", "{", "Backspace"]) {
      act(() => {
        fireEvent.keyDown(input, { key: key });
      });
    }

    expect(input.value).toBe(CODE[FormFieldSchemaType.JSON]);
    expect(setFieldValue).not.toHaveBeenCalled();
  });
});

describe("a code field that is not locked", () => {
  test.each(CODE_FIELD_TYPES)(
    "a %s field is typed in as it always was, with no Read-only",
    (fieldType: FormFieldSchemaType) => {
      renderField({ fieldType });

      expect(getInput()).not.toHaveAttribute("readonly");
      expect(
        screen.queryByTestId("code-editor-read-only"),
      ).not.toBeInTheDocument();
    },
  );

  test("disabled: false is not a lock", () => {
    renderField({ fieldType: FormFieldSchemaType.JSON, disabled: false });

    expect(getInput()).not.toHaveAttribute("readonly");
    expect(screen.getByTestId("code-editor-format-button")).toBeInTheDocument();
  });

  test("the form's own lock while it loads or saves leaves the code box as it was", () => {
    renderField({
      fieldType: FormFieldSchemaType.JSON,
      isFormDisabled: true,
      toolbarActions: (): ReactNode => {
        return <button type="button">Insert value</button>;
      },
    });

    expect(getInput()).not.toHaveAttribute("readonly");
    expect(
      screen.getByRole("button", { name: "Insert value" }),
    ).toBeInTheDocument();
  });
});
