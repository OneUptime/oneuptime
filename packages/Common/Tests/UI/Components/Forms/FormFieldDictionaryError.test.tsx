import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
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
 * A key/value (Dictionary) field that fails validation says why.
 *
 * The key/value editor draws no error of its own, and FormField handed it
 * none, so a Dictionary field that failed - a required one left empty, or a
 * customValidation such as the OAuth 2.0 variable's reserved additional
 * parameters - stopped the form with nothing on screen to say why. Create
 * OAuth 2.0 Variable with an additional parameter named client_secret simply
 * did nothing when Create was pressed.
 */

interface TestEntity extends JSONObject {
  name?: string;
  parameters?: JSONObject;
}

const RESERVED_ERROR: string =
  '"client_secret" cannot be set as an additional parameter.';

afterEach(() => {
  cleanup();
});

function parametersField(
  overrides?: Partial<Field<TestEntity>>,
): Field<TestEntity> {
  return {
    field: { parameters: true },
    title: "Additional Parameters",
    fieldType: FormFieldSchemaType.Dictionary,
    required: false,
    customValidation: (values: FormValues<TestEntity>): string | null => {
      const parameters: JSONObject = (values["parameters"] as JSONObject) || {};

      return Object.keys(parameters).includes("client_secret")
        ? RESERVED_ERROR
        : null;
    },
    ...overrides,
  };
}

function renderField(data: { error: string; touched: boolean }): void {
  render(
    <FormField<TestEntity>
      field={parametersField()}
      fieldName="parameters"
      index={1}
      isDisabled={false}
      error={data.error}
      touched={data.touched}
      currentValues={{} as FormValues<TestEntity>}
      setFieldTouched={() => {}}
      setFieldValue={() => {}}
    />,
  );
}

describe("a Dictionary field's error", () => {
  test("shows under the key/value editor once the field is touched", () => {
    renderField({ error: RESERVED_ERROR, touched: true });

    expect(screen.getByRole("alert")).toHaveTextContent(RESERVED_ERROR);
  });

  // Like every other field: no complaint before the person has had a go.
  test("waits until the field is touched", () => {
    renderField({ error: RESERVED_ERROR, touched: false });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  test("shows nothing when there is no error", () => {
    renderField({ error: "", touched: true });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("a form with a Dictionary field", () => {
  function renderForm(field: Field<TestEntity>): MockFunction {
    const onSubmit: MockFunction = getJestMockFunction();

    render(
      <BasicForm
        id="dictionary-form"
        fields={[
          {
            field: { name: true },
            title: "Name",
            fieldType: FormFieldSchemaType.Text,
            required: false,
            placeholder: "Name",
          },
          field,
        ]}
        submitButtonText="Save"
        onSubmit={onSubmit}
        footer={<></>}
      />,
    );

    return onSubmit;
  }

  test("says why it will not submit a value its validation refuses", async () => {
    const onSubmit: MockFunction = renderForm(parametersField());
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.click(
      screen.getByRole("button", { name: "Add Additional Parameters" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "client_secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "x" },
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(RESERVED_ERROR)).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("says a required one is required", async () => {
    const onSubmit: MockFunction = renderForm(
      parametersField({ required: true, customValidation: undefined }),
    );
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Additional Parameters is required."),
    ).toBeVisible();
    expect(onSubmit).not.toHaveBeenCalled();
  });

  test("submits once the refused parameter is renamed, and the error goes", async () => {
    const onSubmit: MockFunction = renderForm(parametersField());
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup({
      delay: null,
    });

    await user.click(
      screen.getByRole("button", { name: "Add Additional Parameters" }),
    );
    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "client_secret" },
    });
    fireEvent.change(screen.getByPlaceholderText("Value"), {
      target: { value: "x" },
    });
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText(RESERVED_ERROR)).toBeVisible();

    fireEvent.change(screen.getByPlaceholderText("Key"), {
      target: { value: "audience" },
    });

    await waitFor(() => {
      expect(screen.queryByText(RESERVED_ERROR)).not.toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect((onSubmit.mock.calls[0]?.[0] as TestEntity)["parameters"]).toEqual({
      audience: "x",
    });
  });
});
