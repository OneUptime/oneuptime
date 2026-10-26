import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import IconProp from "../../../../Types/Icon/IconProp";
import getJestMockFunction from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A FIELD'S HELP DESCRIBES ITS CONTROL.
 *
 * The maintainer's follow-ups: "Field descriptions are not linked to their
 * fields with aria-describedby." The line of help under a field's label
 * was text beside the control: a screen reader read it only when reading
 * the page through, never as the reader reached the field. Now FieldLabel
 * draws it with an id (FormField's fieldDescriptionId), and every control
 * FormField draws is described by it - the help first, then the field's
 * error once it has one. A switch and a checkbox draw and link their own.
 */

const HELP: string = "What this field is for, in one line.";

interface ControlCase {
  name: string;
  field: Partial<Field<FormValues<any>>>;
}

const CASES: Array<ControlCase> = [
  { name: "text box", field: { fieldType: FormFieldSchemaType.Text } },
  { name: "email box", field: { fieldType: FormFieldSchemaType.Email } },
  { name: "number box", field: { fieldType: FormFieldSchemaType.Number } },
  { name: "date box", field: { fieldType: FormFieldSchemaType.Date } },
  { name: "long text", field: { fieldType: FormFieldSchemaType.LongText } },
  {
    name: "dropdown",
    field: {
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [
        { label: "One", value: "one" },
        { label: "Two", value: "two" },
      ],
    },
  },
  { name: "time", field: { fieldType: FormFieldSchemaType.Time } },
  { name: "color", field: { fieldType: FormFieldSchemaType.Color } },
  {
    name: "radio choice",
    field: {
      fieldType: FormFieldSchemaType.RadioButton,
      radioButtonOptions: [
        { title: "Resolved", value: "resolved" },
        { title: "Acknowledged", value: "acknowledged" },
      ],
    },
  },
  {
    name: "option cards",
    field: {
      fieldType: FormFieldSchemaType.OptionChooserButton,
      radioButtonOptions: [
        { title: "Monthly", value: "monthly" },
        { title: "Yearly", value: "yearly" },
      ],
    },
  },
  {
    name: "card choice",
    field: {
      fieldType: FormFieldSchemaType.CardSelect,
      cardSelectOptions: [
        {
          value: "website",
          title: "Website",
          description: "Checks a page.",
          icon: IconProp.Globe,
        },
        {
          value: "api",
          title: "API",
          description: "Calls an endpoint.",
          icon: IconProp.Code,
        },
      ],
    },
  },
  { name: "JSON editor", field: { fieldType: FormFieldSchemaType.JSON } },
  {
    name: "markdown editor",
    field: { fieldType: FormFieldSchemaType.Markdown },
  },
  {
    name: "custom control",
    field: {
      fieldType: FormFieldSchemaType.CustomComponent,
      getCustomElement: (
        _values: FormValues<any>,
        props: CustomElementProps,
      ): React.ReactElement => {
        return (
          <input
            data-testid="custom-control"
            aria-labelledby={props.ariaLabelledby}
            aria-describedby={props.ariaDescribedby}
          />
        );
      },
    },
  },
];

function renderField(
  field: Partial<Field<FormValues<any>>>,
  extra: Partial<Field<FormValues<any>>> = {},
): void {
  const fields: Fields<FormValues<any>> = [
    {
      field: { value: true },
      title: "The Field",
      description: HELP,
      required: false,
      ...field,
      ...extra,
    } as Field<FormValues<any>>,
  ];

  render(
    <BasicForm
      id="described-by"
      fields={fields}
      initialValues={{}}
      onSubmit={getJestMockFunction()}
      submitButtonText="Save"
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe.each(CASES)("a $name", (control: ControlCase) => {
  test("is described by its field's help", async () => {
    renderField(control.field);

    // A time field's help goes on to say which time zone it is in.
    const help: HTMLElement = await screen.findByText(HELP, { exact: false });
    const helpId: string | null = help.getAttribute("id");

    expect(helpId).toBeTruthy();

    const form: HTMLElement = document.getElementById("described-by")!;
    const described: Array<Element> = Array.from(
      form.querySelectorAll("[aria-describedby]"),
    ).filter((element: Element): boolean => {
      return (element.getAttribute("aria-describedby") || "")
        .split(" ")
        .includes(helpId!);
    });

    // The control itself - something a reader reaches - not a wrapper.
    expect(described.length).toBeGreaterThan(0);
    for (const element of described) {
      const isControl: boolean =
        ["INPUT", "TEXTAREA", "BUTTON", "FIELDSET"].includes(element.tagName) ||
        element.hasAttribute("role");
      expect({ tag: element.tagName, isControl }).toEqual({
        tag: element.tagName,
        isControl: true,
      });
    }
  });
});

describe("the help and the error together", () => {
  test("a text box reads its help, then its error", async () => {
    renderField(
      { fieldType: FormFieldSchemaType.Text },
      { required: true, dataTestId: "the-field" },
    );

    const box: HTMLElement = await screen.findByTestId("the-field");
    expect(box).toHaveAccessibleDescription(HELP);

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(box).toHaveAccessibleDescription(`${HELP} The Field is required.`);
  });

  test("a long text reads its help, then its error", async () => {
    renderField(
      { fieldType: FormFieldSchemaType.LongText },
      { required: true, dataTestId: "the-field" },
    );

    const box: HTMLElement = await screen.findByTestId("the-field");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(box).toHaveAccessibleDescription(`${HELP} The Field is required.`);
  });

  test("a field that names its own describer keeps it, after the help", async () => {
    render(
      <>
        <p id="requirements">At least 15 characters.</p>
        <BasicForm
          id="described-by"
          fields={[
            {
              field: { password: true },
              title: "Password",
              description: HELP,
              fieldType: FormFieldSchemaType.Text,
              ariaDescribedby: "requirements",
              dataTestId: "password",
            },
          ]}
          initialValues={{}}
          onSubmit={getJestMockFunction()}
          submitButtonText="Save"
        />
      </>,
    );

    const box: HTMLElement = await screen.findByTestId("password");

    expect(box).toHaveAccessibleDescription(`${HELP} At least 15 characters.`);
  });
});

describe("a field with no help", () => {
  test("its control points at nothing until it has an error", async () => {
    render(
      <BasicForm
        id="no-help"
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
            dataTestId: "name",
          },
        ]}
        initialValues={{}}
        onSubmit={getJestMockFunction()}
        submitButtonText="Save"
      />,
    );

    const box: HTMLElement = await screen.findByTestId("name");
    expect(box).not.toHaveAttribute("aria-describedby");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
    });

    expect(box).toHaveAccessibleDescription("Name is required.");
  });
});

describe("a switch draws and links its own help", () => {
  test("described once, by its own line", async () => {
    render(
      <BasicForm
        id="switch-help"
        fields={[
          {
            field: { isEnabled: true },
            title: "Enabled",
            description: HELP,
            fieldType: FormFieldSchemaType.Toggle,
          },
        ]}
        initialValues={{}}
        onSubmit={getJestMockFunction()}
        submitButtonText="Save"
      />,
    );

    const toggle: HTMLElement = await screen.findByRole("switch");

    expect(toggle).toHaveAccessibleDescription(HELP);
    expect(
      within(document.getElementById("switch-help")!).getAllByText(HELP),
    ).toHaveLength(1);
  });
});
