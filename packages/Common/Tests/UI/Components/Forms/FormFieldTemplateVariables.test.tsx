import "@testing-library/jest-dom";
import React, { ReactElement, ReactNode } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import type { CodeEditorActions } from "../../../../UI/Components/CodeEditor/CodeEditor";
import { JSONObject } from "../../../../Types/JSON";
import { TemplateVariableGroups } from "../../../../Types/Template/TemplateVariable";

/*
 * A form field whose value is a template says so with templateVariables, and
 * the form does the rest: the variables collapsed under its input, "{{"
 * opening them under the cursor, and an Insert variable button in the
 * toolbar of a Markdown or code editor. Whatever goes in reaches the form's
 * value like typing.
 */

interface TestEntity extends JSONObject {
  body?: string;
  eventType?: string;
}

const GROUPS: TemplateVariableGroups = [
  {
    title: "Incident",
    variables: [
      { name: "incident.title", description: "Title" },
      { name: "incident.severity", description: "Incident Severity" },
    ],
  },
];

type SetFieldValueMock = jest.Mock<(name: string, value: unknown) => void>;

interface RenderOptions {
  fieldType: FormFieldSchemaType;
  value?: string | undefined;
  values?: Partial<TestEntity> | undefined;
  overrides?: Partial<Field<TestEntity>> | undefined;
  setFieldValue?: SetFieldValueMock | undefined;
}

function renderField(options: RenderOptions): void {
  const field: Field<TestEntity> = {
    title: "Body",
    name: "body",
    field: { body: true },
    fieldType: options.fieldType,
    required: false,
    templateVariables: GROUPS,
    templateVariablesDescription: "Filled in when it is sent.",
    ...(options.overrides || {}),
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="body"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={
        {
          body: options.value ?? "",
          ...(options.values || {}),
        } as FormValues<TestEntity>
      }
      setFieldTouched={(): void => {}}
      setFieldValue={
        (options.setFieldValue as (name: string, value: unknown) => void) ||
        ((): void => {})
      }
      disableAutofocus={true}
    />,
  );
}

function listOf(): HTMLElement {
  return screen.getByTestId(/template-variables$/);
}

function cardFor(name: string): HTMLElement {
  return within(listOf())
    .getAllByTestId("template-variable-insert")
    .find((element: HTMLElement): boolean => {
      return element.dataset["variableName"] === name;
    })!;
}

function lastValue(setFieldValue: SetFieldValueMock): unknown {
  const calls: Array<Array<unknown>> = setFieldValue.mock.calls;
  return calls[calls.length - 1]?.[1];
}

afterEach(() => {
  cleanup();
});

describe("a template field offers its variables", () => {
  test("a Markdown field: the editor's toolbar button, and the list under it", () => {
    renderField({ fieldType: FormFieldSchemaType.Markdown });

    expect(
      screen.getByTestId("markdown-editor-insert-variable"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("markdown-editor-template-variables"),
    ).toHaveTextContent("Filled in when it is sent.");
  });

  test("a Markdown field: a card goes into the note and into the form's value", () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField({
      fieldType: FormFieldSchemaType.Markdown,
      setFieldValue: setFieldValue,
    });

    fireEvent.click(cardFor("incident.title"));

    expect(setFieldValue).toHaveBeenLastCalledWith("body", "{{incident.title}}");
  });

  test("a text field: the list under the input, whose cards go in at the cursor", () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField({
      fieldType: FormFieldSchemaType.Text,
      value: "Episode on ",
      setFieldValue: setFieldValue,
    });

    const input: HTMLInputElement = screen.getByRole("textbox", {
      name: /Body/,
    }) as HTMLInputElement;

    act(() => {
      input.focus();
    });
    input.setSelectionRange(11, 11);

    fireEvent.click(cardFor("incident.severity"));

    expect(input.value).toBe("Episode on {{incident.severity}}");
    expect(lastValue(setFieldValue)).toBe("Episode on {{incident.severity}}");
  });

  test("a long text field: {{ opens the variables, and Enter puts one in", () => {
    const setFieldValue: SetFieldValueMock =
      jest.fn<(name: string, value: unknown) => void>();

    renderField({
      fieldType: FormFieldSchemaType.LongText,
      setFieldValue: setFieldValue,
    });

    const textarea: HTMLTextAreaElement = screen.getByRole("textbox", {
      name: /Body/,
    }) as HTMLTextAreaElement;

    act(() => {
      textarea.focus();
    });
    fireEvent.input(textarea, { target: { value: "Severity: {{sev" } });

    expect(
      screen.getByTestId("template-variable-suggestions"),
    ).toBeInTheDocument();

    fireEvent.keyDown(textarea, { key: "Enter" });

    expect(lastValue(setFieldValue)).toBe("Severity: {{incident.severity}}");
  });

  test.each([
    [FormFieldSchemaType.HTML],
    [FormFieldSchemaType.JSON],
  ])(
    "a %s code field: Insert variable in the editor's toolbar puts the pick at the cursor",
    (fieldType: FormFieldSchemaType) => {
      const setFieldValue: SetFieldValueMock =
        jest.fn<(name: string, value: unknown) => void>();

      renderField({
        fieldType: fieldType,
        value: "<p></p>",
        setFieldValue: setFieldValue,
      });

      const input: HTMLTextAreaElement = screen.getByTestId(
        "code-editor-input",
      ) as HTMLTextAreaElement;

      act(() => {
        input.focus();
      });
      input.setSelectionRange(3, 3);

      const button: HTMLElement = screen.getByTestId(
        "code-editor-insert-variable",
      );

      fireEvent.mouseDown(button);
      fireEvent.click(button);
      fireEvent.click(screen.getAllByRole("option")[0]!);

      expect(lastValue(setFieldValue)).toBe("<p>{{incident.title}}</p>");
      // And the list is under the editor too, collapsed.
      expect(listOf()).not.toHaveAttribute("open");
      expect(within(listOf()).getByText("{{incident.title}}")).not.toBeVisible();
    },
  );

  test("a code field keeps its own toolbar buttons, after Insert variable", () => {
    renderField({
      fieldType: FormFieldSchemaType.HTML,
      overrides: {
        codeEditorToolbarActions: (_editor: CodeEditorActions): ReactNode => {
          return (
            <button type="button" data-testid="own-action">
              Own
            </button>
          );
        },
      },
    });

    const insert: HTMLElement = screen.getByTestId(
      "code-editor-insert-variable",
    );
    const own: HTMLElement = screen.getByTestId("own-action");

    expect(
      insert.compareDocumentPosition(own) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("variables that depend on the form are worked out from its values", () => {
    const seen: Array<unknown> = [];

    renderField({
      fieldType: FormFieldSchemaType.LongText,
      values: { eventType: "Incident Created" },
      overrides: {
        templateVariables: (
          values: FormValues<TestEntity>,
        ): TemplateVariableGroups => {
          seen.push(values.eventType);
          return [
            {
              title: "For the event",
              variables: [
                { name: "incidentTitle", description: "Title of the incident" },
              ],
            },
          ];
        },
      },
    });

    expect(seen).toContain("Incident Created");
    expect(within(listOf()).getByText("{{incidentTitle}}")).toBeInTheDocument();
  });

  test("the list ends with what the field adds of its own, given the form's values", () => {
    renderField({
      fieldType: FormFieldSchemaType.LongText,
      values: { eventType: "Incident Created" },
      overrides: {
        getTemplateVariablesFooter: (
          values: FormValues<TestEntity>,
        ): ReactElement => {
          return <p data-testid="footer">For {String(values.eventType)}</p>;
        },
      },
    });

    expect(within(listOf()).getByTestId("footer")).toHaveTextContent(
      "For Incident Created",
    );
  });

  test("a Markdown field's list ends with it too", () => {
    renderField({
      fieldType: FormFieldSchemaType.Markdown,
      overrides: {
        getTemplateVariablesFooter: (): ReactElement => {
          return <p data-testid="footer">More</p>;
        },
      },
    });

    expect(
      within(
        screen.getByTestId("markdown-editor-template-variables"),
      ).getByTestId("footer"),
    ).toBeInTheDocument();
  });
});

describe("a field that is not a template", () => {
  test.each([
    [FormFieldSchemaType.Markdown],
    [FormFieldSchemaType.Text],
    [FormFieldSchemaType.LongText],
    [FormFieldSchemaType.HTML],
    [FormFieldSchemaType.JSON],
  ])("a %s field shows no variables and no Insert variable", (fieldType: FormFieldSchemaType) => {
    renderField({
      fieldType: fieldType,
      overrides: {
        templateVariables: undefined,
        templateVariablesDescription: undefined,
      },
    });

    expect(screen.queryByTestId(/template-variables$/)).toBeNull();
    expect(screen.queryByTestId(/insert-variable$/)).toBeNull();
    expect(screen.queryByText("Insert variable")).toBeNull();
  });

  test("an empty list of variables is no variables", () => {
    renderField({
      fieldType: FormFieldSchemaType.LongText,
      overrides: { templateVariables: [] },
    });

    expect(screen.queryByTestId(/template-variables$/)).toBeNull();
  });
});
