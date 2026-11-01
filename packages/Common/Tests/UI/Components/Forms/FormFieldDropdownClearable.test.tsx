import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
} from "@testing-library/react";
import React from "react";
import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A form's plain dropdown (a fixed list, no dropdownModal) shows its clear
 * button only where the field may be left empty. Dropdown's default drew it
 * on every one, required or not - a playbook step's Run This Step among them
 * - and pressing it only made the form say the field was required. A
 * required colour already had no "No color" (ColorPicker's isClearable);
 * a required pick now has no clear button either.
 */

interface TestEntity extends JSONObject {
  severity?: string;
  regions?: Array<string>;
}

const CLEAR: string = ".ou-select__clear-indicator";

afterEach(() => {
  cleanup();
});

type RenderFieldFunction = (data: {
  required: Field<TestEntity>["required"];
  isMulti?: boolean | undefined;
  setFieldValue?: MockFunction | undefined;
}) => RenderResult;

const renderField: RenderFieldFunction = (data: {
  required: Field<TestEntity>["required"];
  isMulti?: boolean | undefined;
  setFieldValue?: MockFunction | undefined;
}): RenderResult => {
  const field: Field<TestEntity> = data.isMulti
    ? ({
        title: "Regions",
        field: { regions: true },
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownOptions: [
          { value: "eu", label: "Europe" },
          { value: "us", label: "United States" },
        ],
        required: data.required,
      } as Field<TestEntity>)
    : ({
        title: "Severity",
        field: { severity: true },
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [
          { value: "high", label: "High" },
          { value: "low", label: "Low" },
        ],
        required: data.required,
      } as Field<TestEntity>);

  return render(
    <FormField<TestEntity>
      field={field}
      fieldName={data.isMulti ? "regions" : "severity"}
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={
        (data.isMulti
          ? { regions: ["eu", "us"] }
          : { severity: "high" }) as FormValues<TestEntity>
      }
      setFieldTouched={() => {}}
      setFieldValue={data.setFieldValue || getJestMockFunction()}
    />,
  );
};

describe("a form's plain dropdown", () => {
  test("required, it has no clear button: one is always picked", () => {
    const result: RenderResult = renderField({ required: true });

    expect(result.container.textContent).toContain("High");
    expect(result.container.querySelector(CLEAR)).toBeNull();
  });

  test("required by a rule of the form's values, it has none either", () => {
    const result: RenderResult = renderField({
      required: (): boolean => {
        return true;
      },
    });

    expect(result.container.querySelector(CLEAR)).toBeNull();
  });

  test("optional, it keeps its clear button, which empties the field", () => {
    const setFieldValue: MockFunction = getJestMockFunction();
    const result: RenderResult = renderField({
      required: false,
      setFieldValue,
    });

    const clear: Element | null = result.container.querySelector(CLEAR);

    expect(clear).not.toBeNull();

    fireEvent.mouseDown(clear as Element, { button: 0 });

    expect(setFieldValue).toHaveBeenCalledWith("severity", null);
  });

  test("optional by a rule of the form's values, it keeps it", () => {
    const result: RenderResult = renderField({
      required: (): boolean => {
        return false;
      },
    });

    expect(result.container.querySelector(CLEAR)).not.toBeNull();
  });

  test("a required multi-select has no clear-all, an optional one has", () => {
    const required: RenderResult = renderField({
      required: true,
      isMulti: true,
    });

    expect(required.container.querySelector(CLEAR)).toBeNull();
    required.unmount();

    const optional: RenderResult = renderField({
      required: false,
      isMulti: true,
    });

    expect(optional.container.querySelector(CLEAR)).not.toBeNull();
  });
});
