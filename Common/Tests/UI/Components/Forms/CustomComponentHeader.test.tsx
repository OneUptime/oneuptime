import "@testing-library/jest-dom";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field, {
  CustomElementProps,
} from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";

interface TestEntity {
  target: string;
}

const customField: Field<TestEntity> = {
  field: { target: true },
  title: "Monitor Details",
  description: "Configure the monitor details.",
  fieldType: FormFieldSchemaType.CustomComponent,
  hideCustomComponentHeader: true,
  required: true,
  getCustomElement: (
    _values: FormValues<TestEntity>,
    props: CustomElementProps,
  ): ReactElement => {
    return (
      <section aria-label="What to monitor">
        <label htmlFor="custom-target">API URL</label>
        <input
          id="custom-target"
          value={props.initialValue || ""}
          onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
            props.onChange?.(event.target.value);
          }}
          onBlur={props.onBlur}
          aria-invalid={Boolean(props.error)}
          aria-describedby={props.error ? "custom-target-error" : undefined}
        />
        {props.error && (
          <p id="custom-target-error" role="alert">
            {props.error}
          </p>
        )}
      </section>
    );
  },
};

function renderField(overrides: Partial<Field<TestEntity>> = {}): {
  setFieldValue: ReturnType<typeof jest.fn>;
  setFieldTouched: ReturnType<typeof jest.fn>;
} {
  const setFieldValue: ReturnType<typeof jest.fn> = jest.fn();
  const setFieldTouched: ReturnType<typeof jest.fn> = jest.fn();
  render(
    <FormField<TestEntity>
      field={{ ...customField, ...overrides }}
      fieldName="target"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{ target: "https://example.com/health" }}
      setFieldValue={setFieldValue}
      setFieldTouched={setFieldTouched}
    />,
  );
  return { setFieldValue, setFieldTouched };
}

afterEach(cleanup);

describe("Custom editors with their own headings", () => {
  test("removes the redundant header while keeping the editor's accessible labels and initial value", () => {
    renderField();
    expect(screen.queryByText("Monitor Details")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Configure the monitor details."),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "What to monitor" }),
    ).toBeVisible();
    expect(screen.getByRole("textbox", { name: "API URL" })).toHaveValue(
      "https://example.com/health",
    );
  });

  test("keeps custom field changes and blur connected to the parent form", () => {
    const { setFieldValue, setFieldTouched } = renderField();
    const input: HTMLElement = screen.getByRole("textbox", { name: "API URL" });
    fireEvent.change(input, {
      target: { value: "https://example.com/status" },
    });
    fireEvent.blur(input);
    expect(setFieldValue).toHaveBeenCalledWith(
      "target",
      "https://example.com/status",
    );
    expect(setFieldTouched).toHaveBeenCalledWith("target", true);
  });

  test("preserves the default heading and description for other custom editors", () => {
    renderField({ hideCustomComponentHeader: undefined });
    expect(screen.getByText("Monitor Details")).toBeVisible();
    expect(screen.getByText("Configure the monitor details.")).toBeVisible();
  });

  test("cannot hide the accessible label of an ordinary field", () => {
    renderField({ fieldType: FormFieldSchemaType.Text });
    expect(
      screen.getByRole("textbox", { name: "Monitor Details" }),
    ).toHaveValue("https://example.com/health");
    expect(screen.getByText("Configure the monitor details.")).toBeVisible();
  });

  test("still blocks invalid submissions, exposes the custom error, and submits the corrected value", async () => {
    const onSubmit: ReturnType<typeof jest.fn> = jest.fn();
    render(
      <BasicForm
        id="custom-monitor-form"
        fields={[
          {
            ...customField,
            customValidation: (
              values: FormValues<TestEntity>,
            ): string | null => {
              return values.target === "https://example.com/health"
                ? null
                : "Enter the health endpoint.";
            },
          },
        ]}
        initialValues={{ target: "invalid" }}
        onSubmit={onSubmit}
        submitButtonText="Save monitor"
        footer={<></>}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Save monitor" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Enter the health endpoint.",
    );
    expect(onSubmit).not.toHaveBeenCalled();
    const input: HTMLElement = screen.getByRole("textbox", { name: "API URL" });
    expect(input).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(input, {
      target: { value: "https://example.com/health" },
    });
    fireEvent.blur(input);
    await waitFor(() => {
      expect(input).toHaveAttribute("aria-invalid", "false");
    });
    fireEvent.click(screen.getByRole("button", { name: "Save monitor" }));
    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit.mock.calls[0]?.[0]).toEqual({
        target: "https://example.com/health",
      });
    });
  });
});
