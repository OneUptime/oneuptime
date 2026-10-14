import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import React, { FunctionComponent, ReactElement, useEffect } from "react";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A field's default is the value it starts with, 0 and false included.
 *
 * BasicForm filled a field in with its default only when the default was
 * truthy, so a field starting on 0 or off started empty: a required one
 * refused the form ("Repeat until acknowledged is required.") though it said
 * what it started on, and a number box drew the 0 it did not hold. ModelForm
 * hands every field of a Create form its column's default
 * (Utils/CreateFormDefaults), so this reached every column that defaults to
 * 0 or off. And a fixed list (FormField's Dropdown) drew a 0 it did hold as
 * no choice at all, so an option worth 0 ("Don't repeat", "Immediately")
 * read as the placeholder.
 *
 * Pinned on a create form (no initial values), on an edit form (the
 * record's values), and on a form one of whose fields writes as it is drawn
 * (BasicForm then fills in the defaults of the fields still empty) - for a
 * 0 default, a false default, and a field that names none.
 */

const REPEAT_OPTIONS: Array<DropdownOption> = [
  { value: 0, label: "Don't repeat" },
  { value: 5, label: "Every 5 minutes" },
  { value: 15, label: "Every 15 minutes" },
];

/*
 * What each field starts on; undefined is a field that names no default.
 * One field of every kind a falsy default reaches: a fixed list whose first
 * option is 0, a number box, a switch and a checkbox.
 */
interface Defaults {
  repeat?: number | undefined;
  retries?: number | undefined;
  enabled?: boolean | undefined;
  isPrivate?: boolean | undefined;
}

function fieldsWith(defaults: Defaults): Fields<JSONObject> {
  return [
    {
      field: { name: true },
      title: "Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      placeholder: "Rule name",
    },
    {
      field: { repeat: true },
      title: "Repeat",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: REPEAT_OPTIONS,
      required: true,
      placeholder: "Pick an interval",
      defaultValue: defaults.repeat,
    },
    {
      field: { retries: true },
      title: "Retries",
      fieldType: FormFieldSchemaType.Number,
      required: true,
      placeholder: "Retries",
      defaultValue: defaults.retries,
    },
    {
      field: { enabled: true },
      title: "Enabled",
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
      defaultValue: defaults.enabled,
    },
    {
      field: { isPrivate: true },
      title: "Private",
      fieldType: FormFieldSchemaType.Checkbox,
      required: false,
      defaultValue: defaults.isPrivate,
    },
  ];
}

const FALSY_DEFAULTS: Defaults = {
  repeat: 0,
  retries: 0,
  enabled: false,
  isPrivate: false,
};

async function renderForm(data: {
  fields: Fields<JSONObject>;
  initialValues?: JSONObject | undefined;
}): Promise<MockFunction> {
  const onSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="falsy-defaults"
      fields={data.fields}
      initialValues={data.initialValues}
      onSubmit={onSubmit}
      submitButtonText="Save"
      disableAutofocus={true}
    />,
  );

  // The form is drawn once its fields have arrived.
  await screen.findByRole("switch", { name: "Enabled" });

  return onSubmit;
}

async function clickSave(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByTestId("Save"));
  });
}

// The values the form hands onSubmit: what would be sent to the server.
async function save(onSubmit: MockFunction): Promise<JSONObject> {
  await clickSave();

  await waitFor(() => {
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  return onSubmit.mock.calls[0]![0] as JSONObject;
}

// What the fixed list shows: the option it holds, or else its placeholder.
function dropdownValue(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ou-select__single-value");
}

function dropdownPlaceholder(): HTMLElement | null {
  return document.querySelector<HTMLElement>(".ou-select__placeholder");
}

function enabledSwitch(): HTMLElement {
  return screen.getByRole("switch", { name: "Enabled" });
}

function privateCheckbox(): HTMLElement {
  return screen.getByRole("checkbox", { name: /Private/ });
}

afterEach(() => {
  cleanup();
});

describe("a create form", () => {
  test("starts every field on its 0 or false default, draws it, and sends it untouched", async () => {
    const onSubmit: MockFunction = await renderForm({
      fields: fieldsWith(FALSY_DEFAULTS),
    });

    // 0 is a choice: drawn as the option it is, not as the placeholder.
    await waitFor(() => {
      expect(dropdownValue()).toHaveTextContent("Don't repeat");
    });
    expect(dropdownPlaceholder()).toBeNull();
    expect(screen.getByPlaceholderText("Retries")).toHaveValue(0);
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
    expect(privateCheckbox()).not.toBeChecked();

    fireEvent.change(screen.getByPlaceholderText("Rule name"), {
      target: { value: "Page me" },
    });

    const values: JSONObject = await save(onSubmit);

    // Required, and answered: 0 is an answer, not an empty field.
    expect(screen.queryByText("Repeat is required.")).toBeNull();
    expect(screen.queryByText("Retries is required.")).toBeNull();

    expect(values).toEqual({
      name: "Page me",
      repeat: 0,
      retries: 0,
      enabled: false,
      isPrivate: false,
    });
  });

  test("leaves a field that names no default empty: a required one is asked for, and none is sent", async () => {
    const onSubmit: MockFunction = await renderForm({
      fields: fieldsWith({}),
    });

    expect(dropdownValue()).toBeNull();
    expect(dropdownPlaceholder()).toHaveTextContent("Pick an interval");
    expect(screen.getByPlaceholderText("Retries")).toHaveValue(null);
    expect(privateCheckbox()).not.toBeChecked();

    await clickSave();

    expect(await screen.findByText("Repeat is required.")).toBeInTheDocument();
    expect(screen.getByText("Retries is required.")).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("treats a null default as none", async () => {
    const fields: Fields<JSONObject> = fieldsWith(FALSY_DEFAULTS).map(
      (field: Field<JSONObject>): Field<JSONObject> => {
        return field.fieldType === FormFieldSchemaType.Checkbox
          ? { ...field, defaultValue: null as unknown as undefined }
          : field;
      },
    );

    const onSubmit: MockFunction = await renderForm({
      fields: fields,
      initialValues: { name: "Page me" },
    });

    const values: JSONObject = await save(onSubmit);

    // A checkbox nobody touched and with no default is not sent at all.
    expect(values).not.toHaveProperty("isPrivate");
    expect(values["repeat"]).toBe(0);
  });
});

describe("an edit form", () => {
  test("keeps the record's values over a 0 or false default", async () => {
    const record: JSONObject = {
      name: "Existing rule",
      repeat: 15,
      retries: 3,
      enabled: true,
      isPrivate: true,
    };

    const onSubmit: MockFunction = await renderForm({
      fields: fieldsWith(FALSY_DEFAULTS),
      initialValues: record,
    });

    await waitFor(() => {
      expect(dropdownValue()).toHaveTextContent("Every 15 minutes");
    });
    expect(screen.getByPlaceholderText("Retries")).toHaveValue(3);
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "true");
    expect(privateCheckbox()).toBeChecked();

    expect(await save(onSubmit)).toEqual(record);
  });

  test("keeps and draws a stored 0 and false, over a default that is not", async () => {
    const record: JSONObject = {
      name: "Existing rule",
      repeat: 0,
      retries: 0,
      enabled: false,
      isPrivate: false,
    };

    const onSubmit: MockFunction = await renderForm({
      fields: fieldsWith({
        repeat: 5,
        retries: 3,
        enabled: true,
        isPrivate: true,
      }),
      initialValues: record,
    });

    // The stored 0 is the option it is, not the placeholder.
    await waitFor(() => {
      expect(dropdownValue()).toHaveTextContent("Don't repeat");
    });
    expect(dropdownPlaceholder()).toBeNull();
    expect(screen.getByPlaceholderText("Retries")).toHaveValue(0);
    expect(enabledSwitch()).toHaveAttribute("aria-checked", "false");
    expect(privateCheckbox()).not.toBeChecked();

    expect(await save(onSubmit)).toEqual(record);
  });

  test("starts a field the record does not hold on its 0 or false default, as on any other", async () => {
    const onSubmit: MockFunction = await renderForm({
      fields: fieldsWith(FALSY_DEFAULTS),
      initialValues: { name: "Existing rule" },
    });

    await waitFor(() => {
      expect(dropdownValue()).toHaveTextContent("Don't repeat");
    });

    expect(await save(onSubmit)).toEqual({
      name: "Existing rule",
      repeat: 0,
      retries: 0,
      enabled: false,
      isPrivate: false,
    });
  });

  test("leaves a field the record does not hold, and that names no default, out", async () => {
    const onSubmit: MockFunction = await renderForm({
      fields: fieldsWith({}),
      initialValues: { name: "Existing rule", repeat: 5, retries: 2 },
    });

    await waitFor(() => {
      expect(dropdownValue()).toHaveTextContent("Every 5 minutes");
    });
    expect(privateCheckbox()).not.toBeChecked();

    const values: JSONObject = await save(onSubmit);

    expect(values).not.toHaveProperty("isPrivate");
    // As it always was: a switch nobody touched is sent off.
    expect(values["enabled"]).toBe(false);
    expect(values).toEqual({
      name: "Existing rule",
      repeat: 5,
      retries: 2,
      enabled: false,
    });
  });
});

/*
 * A field that writes as it is drawn (a conditions builder) writes before
 * BasicForm fills in its defaults, and BasicForm then fills in only the
 * fields still empty - on a path of its own (BasicFormFillsInOnShow).
 */
interface WritesOnShowProps {
  customElementProps: CustomElementProps;
}

const WritesOnShow: FunctionComponent<WritesOnShowProps> = (
  props: WritesOnShowProps,
): ReactElement => {
  useEffect(() => {
    props.customElementProps.onChange?.({ filters: [] });
  }, []);

  return <div data-testid="writes-on-show">Conditions</div>;
};

describe("a form one of whose fields writes as it is drawn", () => {
  test("still starts the fields left empty on their 0 or false defaults", async () => {
    const fields: Fields<JSONObject> = [
      {
        field: { criteria: true },
        title: "Conditions",
        fieldType: FormFieldSchemaType.CustomComponent,
        required: false,
        getCustomElement: (
          _values: FormValues<JSONObject>,
          customElementProps: CustomElementProps,
        ): ReactElement => {
          return <WritesOnShow customElementProps={customElementProps} />;
        },
      },
      ...fieldsWith(FALSY_DEFAULTS),
    ];

    const onSubmit: MockFunction = await renderForm({
      fields: fields,
      initialValues: { name: "Page me" },
    });

    await screen.findByTestId("writes-on-show");

    await waitFor(() => {
      expect(dropdownValue()).toHaveTextContent("Don't repeat");
    });

    expect(await save(onSubmit)).toEqual({
      criteria: { filters: [] },
      name: "Page me",
      repeat: 0,
      retries: 0,
      enabled: false,
      isPrivate: false,
    });
  });
});

describe("FormField: a fixed list", () => {
  const field: Field<JSONObject> = {
    field: { repeat: true },
    title: "Repeat",
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownOptions: REPEAT_OPTIONS,
    required: true,
    placeholder: "Pick an interval",
  };

  function renderField(currentValues: JSONObject): void {
    render(
      <FormField<JSONObject>
        field={field}
        fieldName="repeat"
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={currentValues as FormValues<JSONObject>}
        setFieldTouched={() => {}}
        setFieldValue={() => {}}
      />,
    );
  }

  test.each([
    [0, "Don't repeat"],
    [5, "Every 5 minutes"],
  ])("draws a held %p as its option", (value: number, label: string) => {
    renderField({ repeat: value });

    expect(dropdownValue()).toHaveTextContent(label);
    expect(dropdownPlaceholder()).toBeNull();
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty string", ""],
  ])(
    "draws %s as no choice, with the placeholder",
    (_label: string, value: unknown) => {
      renderField(value === undefined ? {} : { repeat: value as string });

      expect(dropdownValue()).toBeNull();
      expect(dropdownPlaceholder()).toHaveTextContent("Pick an interval");
    },
  );
});
