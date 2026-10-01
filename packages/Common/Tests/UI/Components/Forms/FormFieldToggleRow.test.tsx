import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A Toggle field in a form, as the maintainer met it in Create Workflow
 * Variable: "Secret (Optional)", a long paragraph, and under the paragraph a
 * small pale switch on its own. A switch field is now one row: the switch,
 * its title beside it as a real label, the help under the title - the way a
 * checkbox field already was.
 */

const SECRET_DESCRIPTION: string =
  "Keep this variable's content out of workflow run logs - every run replaces it with [REDACTED] before the log is saved. It applies to future runs only, and it cannot be turned off again once saved.";

interface TestEntity extends JSONObject {
  content?: string;
  isSecret?: boolean;
}

afterEach(() => {
  cleanup();
});

function secretField(overrides?: Partial<Field<TestEntity>>): Field<TestEntity> {
  return {
    field: { isSecret: true },
    title: "Secret",
    description: SECRET_DESCRIPTION,
    fieldType: FormFieldSchemaType.Toggle,
    required: false,
    ...overrides,
  };
}

interface RenderedField {
  setFieldValue: MockFunction;
  setFieldTouched: MockFunction;
  container: HTMLElement;
}

function renderField(data?: {
  field?: Partial<Field<TestEntity>>;
  values?: FormValues<TestEntity>;
  isDisabled?: boolean;
  error?: string;
  touched?: boolean;
}): RenderedField {
  const setFieldValue: MockFunction = getJestMockFunction();
  const setFieldTouched: MockFunction = getJestMockFunction();

  const { container } = render(
    <FormField<TestEntity>
      field={secretField(data?.field)}
      fieldName="isSecret"
      index={1}
      isDisabled={data?.isDisabled || false}
      error={data?.error || ""}
      touched={data?.touched || false}
      currentValues={(data?.values || {}) as FormValues<TestEntity>}
      setFieldTouched={(name: string, value: boolean) => {
        setFieldTouched(name, value);
      }}
      setFieldValue={(name: string, value: JSONValue) => {
        setFieldValue(name, value);
      }}
    />,
  );

  return { setFieldValue, setFieldTouched, container };
}

describe("FormField - a Toggle field is one row", () => {
  test("the switch is named by the title and described by the help", () => {
    renderField();

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    expect(toggle).toHaveAccessibleName("Secret");
    expect(toggle).toHaveAccessibleDescription(SECRET_DESCRIPTION);
  });

  test("the title is a label beside the switch, not a heading above a paragraph", () => {
    renderField();

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });
    const title: HTMLElement = screen.getByText("Secret");
    const help: HTMLElement = screen.getByText(SECRET_DESCRIPTION);

    expect(title.tagName).toBe("LABEL");
    expect(title).toHaveAttribute("for", toggle.id);
    // The switch comes first in the row, then the text.
    expect(
      toggle.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      title.compareDocumentPosition(help) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // One label for the field: no FieldLabel drawn above it as well.
    expect(screen.getAllByText("Secret")).toHaveLength(1);
    expect(screen.getAllByText(SECRET_DESCRIPTION)).toHaveLength(1);
  });

  // On or off, a switch always has an answer: there is nothing to leave out.
  test("it says nothing about being optional", () => {
    renderField();

    expect(screen.queryByText("(Optional)")).toBeNull();
    expect(screen.getByRole("switch")).toHaveAccessibleName("Secret");
  });

  test("pressing the title turns it on and writes the value", () => {
    const rendered: RenderedField = renderField();

    fireEvent.click(screen.getByText("Secret"));

    expect(rendered.setFieldValue).toHaveBeenCalledTimes(1);
    expect(rendered.setFieldValue).toHaveBeenCalledWith("isSecret", true);
    expect(screen.getByRole("switch", { name: "Secret" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("pressing the switch marks the field touched", () => {
    const rendered: RenderedField = renderField();

    fireEvent.click(screen.getByRole("switch", { name: "Secret" }));

    expect(rendered.setFieldTouched).toHaveBeenCalledWith("isSecret", true);
  });

  test("it shows the value the form holds, and the field's default otherwise", () => {
    renderField({ values: { isSecret: true } as FormValues<TestEntity> });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    cleanup();

    renderField({ field: { defaultValue: true } });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
    cleanup();

    renderField({
      field: { defaultValue: true },
      values: { isSecret: false } as FormValues<TestEntity>,
    });
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "false");
  });

  /*
   * Every other input in FormField already took the form's disabled state.
   * The switch ignored it: it could be flipped while the form was saving.
   */
  test("a disabled field cannot be flipped, from the switch or its title", () => {
    const rendered: RenderedField = renderField({ field: { disabled: true } });

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    fireEvent.click(toggle);
    fireEvent.click(screen.getByText("Secret"));

    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(rendered.setFieldValue).not.toHaveBeenCalled();
  });

  test("a form that is saving holds its switches still", () => {
    const rendered: RenderedField = renderField({ isDisabled: true });

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute("aria-disabled", "true");
    expect(rendered.setFieldValue).not.toHaveBeenCalled();
  });

  test("an enabled field says nothing about being disabled", () => {
    renderField();

    expect(screen.getByRole("switch")).not.toHaveAttribute("aria-disabled");
  });

  test("a touched field with an error says so under the row", () => {
    renderField({ touched: true, error: "Secret is required." });

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    expect(toggle).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Secret is required.");
  });

  test("an untouched field keeps its error to itself", () => {
    renderField({ touched: false, error: "Secret is required." });

    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("switch")).not.toHaveAttribute("aria-invalid");
  });

  test("a field with no help is just the switch and its title", () => {
    renderField({ field: { description: undefined } });

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });

    expect(toggle).not.toHaveAttribute("aria-describedby");
  });

  test("help written as an element is kept", () => {
    renderField({
      field: {
        description: (
          <span>
            Read the <a href="/docs">workflow docs</a> first.
          </span>
        ),
      },
    });

    expect(
      screen.getByRole("link", { name: "workflow docs" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Secret" }))
      .toHaveAccessibleDescription("Read the workflow docs first.");
  });

  test("the field's test id reaches the switch", () => {
    renderField({ field: { dataTestId: "secret-switch" } });

    expect(screen.getByTestId("secret-switch")).toBe(
      screen.getByRole("switch", { name: "Secret" }),
    );
  });

  /*
   * A label sits on top of its input, 8px above it. A switch's label is
   * beside it, so its row starts where a label would: level with the label
   * of the field next to it in a two-column form, not 8px lower.
   */
  test("the row starts where a label would, with no label-to-input gap above it", () => {
    const { container } = renderField();

    const toggle: HTMLElement = screen.getByRole("switch", { name: "Secret" });
    const fieldRoot: Element = container.firstElementChild!;

    expect(fieldRoot.querySelector(".mt-2")).toBeNull();
    expect(fieldRoot.contains(toggle)).toBe(true);
  });
});

describe("BasicForm - toggle fields among other fields", () => {
  const FIELDS: Fields<TestEntity> = [
    {
      field: { content: true },
      title: "Value",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      placeholder: "Paste the value",
    },
    secretField(),
  ];

  test("a text field still says it is optional; the switch beside it does not", async () => {
    render(
      <BasicForm
        id="variable-form"
        fields={FIELDS}
        initialValues={{}}
        onSubmit={() => {}}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await screen.findByRole("switch", { name: "Secret" });

    expect(screen.getAllByText("(Optional)")).toHaveLength(1);
    expect(
      screen.getByRole("textbox", { name: "Value (Optional)" }),
    ).toBeInTheDocument();
  });

  test("an untouched switch is submitted as off, a flipped one as on", async () => {
    const untouched: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="variable-form"
        fields={FIELDS}
        initialValues={{ content: "hunter2" }}
        onSubmit={untouched}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    await userEvent.setup({ delay: null }).click(screen.getByTestId("Save"));

    await waitFor(() => {
      expect(untouched).toHaveBeenCalledTimes(1);
    });
    expect((untouched.mock.calls[0]?.[0] as JSONObject)["isSecret"]).toBe(
      false,
    );

    cleanup();

    const flipped: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="variable-form"
        fields={FIELDS}
        initialValues={{ content: "hunter2" }}
        onSubmit={flipped}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    // By its title, the way the maintainer will reach for it.
    fireEvent.click(await screen.findByText("Secret"));

    await userEvent.setup({ delay: null }).click(screen.getByTestId("Save"));

    await waitFor(() => {
      expect(flipped).toHaveBeenCalledTimes(1);
    });
    expect((flipped.mock.calls[0]?.[0] as JSONObject)["isSecret"]).toBe(true);
  });

  test("Space on the focused switch flips the value that is submitted", async () => {
    const onSubmit: MockFunction = getJestMockFunction();
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    render(
      <BasicForm
        id="variable-form"
        fields={FIELDS}
        initialValues={{ content: "hunter2" }}
        onSubmit={onSubmit}
        submitButtonText="Save"
        disableAutofocus={true}
      />,
    );

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: "Secret",
    });

    toggle.focus();
    await user.keyboard(" ");

    expect(toggle).toHaveAttribute("aria-checked", "true");

    await user.click(screen.getByTestId("Save"));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect((onSubmit.mock.calls[0]?.[0] as JSONObject)["isSecret"]).toBe(true);
  });
});
