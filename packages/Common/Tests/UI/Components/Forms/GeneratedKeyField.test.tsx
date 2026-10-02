import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import GeneratedKeyField, {
  GeneratedKeyFieldText,
  getGeneratedKeyFormField,
} from "../../../../UI/Components/Forms/Fields/GeneratedKeyField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import {
  MEASUREMENT_KEY_INVALID_MESSAGE,
  getMeasurementKeyError,
  getMeasurementKeyFromName,
} from "../../../../Types/Measurement/MeasurementKey";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The maintainer, on the measurement forms that asked for a Key: "it should
 * be automatically generated based on the name. If a human wants to edit
 * it, they can edit it as well, but please don't require an input from a
 * human. What we need is to make this UI very simple to understand and
 * use."
 *
 * GeneratedKeyField in a real BasicForm, as getGeneratedKeyFormField puts it
 * on a form: one line under the Name field that follows the name, an Edit
 * button for someone who wants a different key, and a form value that only
 * ever holds a key somebody typed - so a key made from the name is left out
 * of the request, for the server to make (and number on a clash).
 */

const KEY_DESCRIPTION: string =
  "Part of the metric name, so it can't be changed once it is created.";

const KEY_FIELD: Field<JSONObject> = getGeneratedKeyFormField<JSONObject>({
  field: { key: true },
  nameField: "name",
  title: "Key",
  makeKey: getMeasurementKeyFromName,
  validateKey: getMeasurementKeyError,
  placeholder: "time-to-detect",
  description: KEY_DESCRIPTION,
});

const FIELDS: Fields<JSONObject> = [
  {
    field: { name: true },
    title: "Name",
    fieldType: FormFieldSchemaType.Text,
    required: true,
    dataTestId: "name",
  },
  KEY_FIELD,
  {
    field: { description: true },
    title: "Description",
    fieldType: FormFieldSchemaType.LongText,
    required: false,
  },
];

interface RenderFormResult {
  handleSubmit: MockFunction;
  user: UserEvent;
}

function renderForm(
  initialValues: FormValues<JSONObject> = {},
  fields: Fields<JSONObject> = FIELDS,
): RenderFormResult {
  const handleSubmit: MockFunction = getJestMockFunction();

  render(
    <BasicForm
      id="generated-key-form"
      fields={fields}
      initialValues={initialValues}
      disableAutofocus={true}
      onSubmit={handleSubmit}
      submitButtonText="Create Measurement"
    />,
  );

  return { handleSubmit, user: userEvent.setup({ delay: null }) };
}

async function nameInput(): Promise<HTMLElement> {
  return screen.findByRole("textbox", { name: "Name" });
}

function keyLineValue(): HTMLElement {
  return screen.getByTestId("generated-key-field-value");
}

function editButton(): HTMLElement {
  return screen.getByRole("button", { name: "Edit Key" });
}

function keyBox(): HTMLInputElement {
  return screen.getByRole("textbox", { name: "Key" }) as HTMLInputElement;
}

async function submit(user: UserEvent): Promise<void> {
  await user.click(screen.getByRole("button", { name: "Create Measurement" }));
}

function submittedValues(handleSubmit: MockFunction): JSONObject {
  expect(handleSubmit).toHaveBeenCalledTimes(1);
  return handleSubmit.mock.calls[0]![0] as JSONObject;
}

afterEach(() => {
  cleanup();
});

describe("a key made from the name, on a form", () => {
  test("is one line under the name: the key, and Edit - no text box to fill in", async () => {
    const { user }: RenderFormResult = renderForm();

    await user.type(await nameInput(), "Time to Detect");

    expect(keyLineValue()).toHaveTextContent("time-to-detect");
    expect(editButton()).toBeVisible();
    expect(screen.queryByRole("textbox", { name: "Key" })).toBeNull();
    // Its explanation waits for someone who opens it.
    expect(screen.queryByText(KEY_DESCRIPTION)).toBeNull();
    // Nothing to fill in, so nothing to call optional either.
    expect(
      within(screen.getByTestId("generated-key-field")).queryByText(/Optional/),
    ).toBeNull();
  });

  test("says the key is made from the name until a name is typed", async () => {
    renderForm();

    await nameInput();

    expect(screen.getByTestId("generated-key-field-pending")).toHaveTextContent(
      GeneratedKeyFieldText.pendingName,
    );
    expect(screen.queryByTestId("generated-key-field-value")).toBeNull();
  });

  test("follows the name as it is typed and changed", async () => {
    const { user }: RenderFormResult = renderForm();
    const name: HTMLElement = await nameInput();

    await user.type(name, "Time");
    expect(keyLineValue()).toHaveTextContent("time");

    await user.type(name, " to Resolve (P1)");
    expect(keyLineValue()).toHaveTextContent("time-to-resolve-p1");

    await user.clear(name);
    await user.type(name, "Größe");
    expect(keyLineValue()).toHaveTextContent("grosse");
  });

  test("is never asked for: the form submits, and the key is left out for the server to make", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();

    await user.type(await nameInput(), "Time to Detect");
    await submit(user);

    const values: JSONObject = submittedValues(handleSubmit);

    expect(values["name"]).toBe("Time to Detect");
    expect(values["key"] || undefined).toBeUndefined();
  });

  test("Edit opens a text box holding the key, with the focus in it and its explanation", async () => {
    const { user }: RenderFormResult = renderForm();

    await user.type(await nameInput(), "Time to Detect");
    await user.click(editButton());

    const box: HTMLInputElement = keyBox();

    expect(box).toHaveValue("time-to-detect");
    await waitFor(() => {
      expect(box).toHaveFocus();
    });
    expect(screen.getByText(KEY_DESCRIPTION)).toBeVisible();
    // Nothing typed yet: no way back to offer.
    expect(
      screen.queryByTestId("generated-key-field-make-from-name"),
    ).toBeNull();
  });

  test("a key someone types is the form's value, and stays when the name changes", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();
    const name: HTMLElement = await nameInput();

    await user.type(name, "Time to Detect");
    await user.click(editButton());
    await user.clear(keyBox());
    await user.type(keyBox(), "ttd");

    await user.type(name, " (P1)");

    expect(keyBox()).toHaveValue("ttd");

    await submit(user);

    expect(submittedValues(handleSubmit)["key"]).toBe("ttd");
  });

  test("an open box keeps following the name until a key is typed into it", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();
    const name: HTMLElement = await nameInput();

    await user.type(name, "Time to Detect");
    await user.click(editButton());

    await user.type(name, " in prod");

    // The shared Input follows a new value in an effect of its own.
    await waitFor(() => {
      expect(keyBox()).toHaveValue("time-to-detect-in-prod");
    });

    await submit(user);

    // Still the name's key: still left out.
    expect(submittedValues(handleSubmit)["key"] || undefined).toBeUndefined();
  });

  test("typing the name's own key back is no override", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();

    await user.type(await nameInput(), "Time to Detect");
    await user.click(editButton());
    await user.type(keyBox(), "-x");
    expect(
      screen.getByTestId("generated-key-field-make-from-name"),
    ).toBeVisible();

    await user.type(keyBox(), "{Backspace}{Backspace}");
    expect(keyBox()).toHaveValue("time-to-detect");

    await submit(user);

    expect(submittedValues(handleSubmit)["key"] || undefined).toBeUndefined();
  });

  test("an emptied box goes back to the key the name makes, which it shows as its placeholder", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();

    await user.type(await nameInput(), "Time to Detect");
    await user.click(editButton());
    await user.clear(keyBox());

    expect(keyBox()).toHaveValue("");
    expect(keyBox()).toHaveAttribute("placeholder", "time-to-detect");

    await submit(user);

    expect(submittedValues(handleSubmit)["key"] || undefined).toBeUndefined();
  });

  test("Make it from the name closes the box and goes back to the name's key", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();
    const name: HTMLElement = await nameInput();

    await user.type(name, "Time to Detect");
    await user.click(editButton());
    await user.clear(keyBox());
    await user.type(keyBox(), "ttd");

    await user.click(
      screen.getByRole("button", {
        name: GeneratedKeyFieldText.makeFromName,
      }),
    );

    expect(screen.queryByRole("textbox", { name: "Key" })).toBeNull();
    expect(keyLineValue()).toHaveTextContent("time-to-detect");

    // And it follows the name again.
    await user.type(name, "!");
    await user.type(name, " v2");
    expect(keyLineValue()).toHaveTextContent("time-to-detect-v2");

    await submit(user);

    expect(submittedValues(handleSubmit)["key"] || undefined).toBeUndefined();
  });

  test("a typed key the server would refuse says why, and the form is not sent", async () => {
    const { user, handleSubmit }: RenderFormResult = renderForm();

    await user.type(await nameInput(), "Time to Detect");
    await user.click(editButton());
    await user.clear(keyBox());
    await user.type(keyBox(), "Time To Detect");
    await submit(user);

    expect(handleSubmit).not.toHaveBeenCalled();
    expect(
      await screen.findByText(MEASUREMENT_KEY_INVALID_MESSAGE),
    ).toBeVisible();
    expect(keyBox()).toHaveAttribute("aria-invalid", "true");

    await user.clear(keyBox());
    await user.type(keyBox(), "ttd");
    await submit(user);

    expect(submittedValues(handleSubmit)["key"]).toBe("ttd");
  });

  test("a form that already holds a typed key opens with it in the box, and leaves the focus alone", async () => {
    renderForm({ name: "Time to Detect", key: "ttd" });

    const box: HTMLInputElement = await screen.findByRole("textbox", {
      name: "Key",
    });

    expect(box).toHaveValue("ttd");
    expect(box).not.toHaveFocus();
    expect(
      screen.getByRole("button", { name: GeneratedKeyFieldText.makeFromName }),
    ).toBeVisible();
  });
});

describe("getGeneratedKeyFormField", () => {
  test("is a field of the Create form only, never required, that draws its own label", () => {
    expect(KEY_FIELD.field).toEqual({ key: true });
    expect(KEY_FIELD.title).toBe("Key");
    expect(KEY_FIELD.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(KEY_FIELD.customElementDrawsOwnLabel).toBe(true);
    expect(KEY_FIELD.required).toBe(false);
    expect(KEY_FIELD.hideOptionalLabel).toBe(true);
    expect(KEY_FIELD.doNotShowWhenEditing).toBe(true);
    expect(KEY_FIELD.doNotShowWhenCreating).toBeUndefined();
  });

  test("carries a step, description, placeholder and test id only when given", () => {
    const bare: Field<JSONObject> = getGeneratedKeyFormField<JSONObject>({
      field: { key: true },
      nameField: "name",
      title: "Key",
      makeKey: getMeasurementKeyFromName,
    });

    for (const property of [
      "stepId",
      "description",
      "placeholder",
      "dataTestId",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(bare, property)).toBe(false);
    }

    const full: Field<JSONObject> = getGeneratedKeyFormField<JSONObject>({
      field: { key: true },
      nameField: "name",
      title: "Key",
      makeKey: getMeasurementKeyFromName,
      stepId: "basics",
      description: KEY_DESCRIPTION,
      placeholder: "time-to-detect",
      dataTestId: "measurement-key",
    });

    expect(full.stepId).toBe("basics");
    expect(full.description).toBe(KEY_DESCRIPTION);
    expect(full.placeholder).toBe("time-to-detect");
    expect(full.dataTestId).toBe("measurement-key");
  });

  test("asks validateKey only about a key someone typed", () => {
    const validate: (values: FormValues<JSONObject>) => string | null =
      KEY_FIELD.customValidation!;

    expect(validate({ name: "Time to Detect" })).toBeNull();
    expect(validate({ name: "Time to Detect", key: "" })).toBeNull();
    expect(validate({ name: "Time to Detect", key: "ttd" })).toBeNull();
    expect(validate({ name: "Time to Detect", key: "Not A Key" })).toBe(
      MEASUREMENT_KEY_INVALID_MESSAGE,
    );
  });

  test("without validateKey, takes any typed key", () => {
    const field: Field<JSONObject> = getGeneratedKeyFormField<JSONObject>({
      field: { outputMetricName: true },
      nameField: "name",
      title: "Output Metric Name",
      makeKey: getMeasurementKeyFromName,
    });

    expect(
      field.customValidation!({ outputMetricName: "http.server.error_rate" }),
    ).toBeNull();
  });

  test("reads the key from its own column, whatever the column is called", async () => {
    const handleSubmit: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });

    render(
      <BasicForm
        id="output-name-form"
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: true,
          },
          getGeneratedKeyFormField<JSONObject>({
            field: { outputMetricName: true },
            nameField: "name",
            title: "Output Metric Name",
            makeKey: (name: string): string => {
              return name.toLowerCase().replace(/\s+/g, "_");
            },
          }),
        ]}
        initialValues={{}}
        disableAutofocus={true}
        onSubmit={handleSubmit}
        submitButtonText="Create Rule"
      />,
    );

    await user.type(await nameInput(), "HTTP Error Rate");

    expect(screen.getByTestId("generated-key-field-value")).toHaveTextContent(
      "http_error_rate",
    );

    await user.click(
      screen.getByRole("button", { name: "Edit Output Metric Name" }),
    );
    const box: HTMLElement = screen.getByRole("textbox", {
      name: "Output Metric Name",
    });
    await user.clear(box);
    await user.type(box, "http.server.error_rate");
    await user.click(screen.getByRole("button", { name: "Create Rule" }));

    expect(
      (handleSubmit.mock.calls[0]![0] as JSONObject)["outputMetricName"],
    ).toBe("http.server.error_rate");
  });
});

describe("GeneratedKeyField on its own", () => {
  // A parent that holds the value, as a form does.
  const Harness: (props: {
    initialValue?: string;
    generatedValue: string;
    onChange?: (value: string) => void;
    error?: string;
  }) => ReactElement = (props: {
    initialValue?: string;
    generatedValue: string;
    onChange?: (value: string) => void;
    error?: string;
  }): ReactElement => {
    const [value, setValue] = useState<string>(props.initialValue || "");

    return (
      <GeneratedKeyField
        title="Key"
        value={value}
        generatedValue={props.generatedValue}
        error={props.error}
        onChange={(next: string) => {
          setValue(next);
          props.onChange?.(next);
        }}
      />
    );
  };

  test("names its Edit button after the field, for screen readers", () => {
    render(<Harness generatedValue="time-to-detect" />);

    expect(screen.getByRole("button", { name: "Edit Key" })).toBeVisible();
  });

  test("shows a key someone typed in place of the name's", () => {
    render(<Harness generatedValue="time-to-detect" initialValue="ttd" />);

    expect(screen.getByRole("textbox", { name: "Key" })).toHaveValue("ttd");
  });

  test("shows an error under the line while closed", () => {
    render(
      <Harness generatedValue="time-to-detect" error="That key is taken." />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent("That key is taken.");
  });

  test("hands back an empty value, not the name's key, when the box is opened and left alone", async () => {
    const onChange: MockFunction = getJestMockFunction();
    const user: UserEvent = userEvent.setup({ delay: null });

    render(<Harness generatedValue="time-to-detect" onChange={onChange} />);

    await user.click(screen.getByRole("button", { name: "Edit Key" }));

    expect(onChange).not.toHaveBeenCalled();

    await act(async (): Promise<void> => {});

    expect(screen.getByRole("textbox", { name: "Key" })).toHaveValue(
      "time-to-detect",
    );
  });
});
