import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import { FieldFooterProps } from "../../../../UI/Components/Forms/Types/Field";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
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
import React, { ReactElement } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A field's footer can set the field's value (FieldFooterProps.setValue):
 * what the status page suggestions under a maintenance event's status page
 * picker use to add a page with one click. It sets the value the way a pick
 * in the field would - the field's own onChange first, then the value - and
 * nothing is set until the footer calls it.
 */

interface RenderResult {
  handleSubmit: MockFunction;
  onChange: MockFunction;
  footerCalls: Array<{
    values: FormValues<JSONObject>;
    error: string | undefined;
    footer: FieldFooterProps | undefined;
  }>;
}

function renderForm(options: { withOnChange?: boolean } = {}): RenderResult {
  const handleSubmit: MockFunction = getJestMockFunction();
  const onChange: MockFunction = getJestMockFunction();
  const footerCalls: RenderResult["footerCalls"] = [];

  const fields: Fields<JSONObject> = [
    {
      field: { name: true },
      title: "Service Name",
      fieldType: FormFieldSchemaType.Text,
      required: true,
      dataTestId: "service-name",
      ...(options.withOnChange
        ? {
            onChange: (
              value: unknown,
              currentValues: FormValues<JSONObject>,
              setNewFormValues: (values: FormValues<JSONObject>) => void,
            ): void => {
              onChange(value, { ...currentValues });

              // An onChange that fills in another field from this one.
              setNewFormValues({
                ...currentValues,
                slug: String(value).toLowerCase().replace(/\s+/g, "-"),
              });
            },
          }
        : {}),
      getFooterElement: (
        values: FormValues<JSONObject>,
        error?: string,
        footer?: FieldFooterProps,
      ): ReactElement => {
        footerCalls.push({ values: { ...values }, error, footer });

        return (
          <button
            type="button"
            onClick={() => {
              footer?.setValue("Payments API");
            }}
          >
            Use the suggested name
          </button>
        );
      },
    },
    {
      field: { slug: true },
      title: "Slug",
      fieldType: FormFieldSchemaType.Text,
      required: false,
      dataTestId: "slug",
    },
  ];

  render(
    <BasicForm
      id="footer-form"
      fields={fields}
      initialValues={{ name: "" }}
      disableAutofocus={true}
      onSubmit={handleSubmit}
      submitButtonText="Save"
    />,
  );

  return { handleSubmit, onChange, footerCalls };
}

function nameInput(): HTMLInputElement {
  return screen.getByTestId("service-name") as HTMLInputElement;
}

describe("a field's footer setting the field's value", () => {
  afterEach(() => {
    cleanup();
  });

  test("the footer is handed a setter, beside the values and the error", async () => {
    const { footerCalls }: RenderResult = renderForm();

    await screen.findByRole("button", { name: "Use the suggested name" });

    const last: RenderResult["footerCalls"][number] =
      footerCalls[footerCalls.length - 1]!;

    expect(typeof last.footer?.setValue).toBe("function");
    expect(last.error).toBeUndefined();
  });

  test("nothing is set until the footer asks", async () => {
    const { handleSubmit }: RenderResult = renderForm();

    await screen.findByRole("button", { name: "Use the suggested name" });

    expect(nameInput().value).toBe("");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByText("Service Name is required.")).toBeInTheDocument();
    });
    expect(handleSubmit).not.toHaveBeenCalled();
  });

  test("setValue fills the field in, and the form saves it", async () => {
    const { handleSubmit, footerCalls }: RenderResult = renderForm();

    fireEvent.click(
      await screen.findByRole("button", { name: "Use the suggested name" }),
    );

    await waitFor(() => {
      expect(nameInput().value).toBe("Payments API");
    });

    // The footer is drawn again from the values as they are now.
    expect(footerCalls[footerCalls.length - 1]!.values["name"]).toBe(
      "Payments API",
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });
    expect((handleSubmit.mock.calls[0]![0] as JSONObject)["name"]).toBe(
      "Payments API",
    );
  });

  test("the field's own onChange runs first, as it does for a pick in the field", async () => {
    const { handleSubmit, onChange }: RenderResult = renderForm({
      withOnChange: true,
    });

    fireEvent.click(
      await screen.findByRole("button", { name: "Use the suggested name" }),
    );

    await waitFor(() => {
      expect(nameInput().value).toBe("Payments API");
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toBe("Payments API");
    // It saw the values from before the change.
    expect((onChange.mock.calls[0]![1] as JSONObject)["name"]).toBe("");

    // What it filled in is kept beside the new value.
    await waitFor(() => {
      expect((screen.getByTestId("slug") as HTMLInputElement).value).toBe(
        "payments-api",
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledTimes(1);
    });

    const submitted: JSONObject = handleSubmit.mock.calls[0]![0] as JSONObject;

    expect(submitted["name"]).toBe("Payments API");
    expect(submitted["slug"]).toBe("payments-api");
  });
});

describe("a dropdown's footer setting the dropdown's value", () => {
  afterEach(() => {
    cleanup();
  });

  /*
   * A pick in a dropdown hands the field's onChange what it changed, as the
   * options name it (DropdownChange) - a status page resource's display
   * name follows its monitor that way. A footer's pick must say the same.
   */
  test("the field's onChange is told what the pick changed, by the options' names", async () => {
    const onChange: MockFunction = getJestMockFunction();

    const fields: Fields<JSONObject> = [
      {
        field: { region: true },
        title: "Region",
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [
          { label: "Europe", value: "eu" },
          { label: "United States", value: "us" },
        ],
        required: false,
        onChange: (
          value: unknown,
          _currentValues: FormValues<JSONObject>,
          _setNewFormValues: (values: FormValues<JSONObject>) => void,
          change?: unknown,
        ): void => {
          onChange(value, change);
        },
        getFooterElement: (
          _values: FormValues<JSONObject>,
          _error?: string,
          footer?: FieldFooterProps,
        ): ReactElement => {
          return (
            <button
              type="button"
              onClick={() => {
                footer?.setValue("us");
              }}
            >
              Use the suggested region
            </button>
          );
        },
      },
    ];

    render(
      <BasicForm
        id="footer-dropdown-form"
        fields={fields}
        initialValues={{ region: "eu" }}
        disableAutofocus={true}
        onSubmit={getJestMockFunction()}
        submitButtonText="Save"
      />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Use the suggested region" }),
    );

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    expect(onChange.mock.calls[0]![0]).toBe("us");
    expect(onChange.mock.calls[0]![1]).toEqual({
      selectedOptions: [{ label: "United States", value: "us" }],
      previousOptions: [{ label: "Europe", value: "eu" }],
    });
  });
});
