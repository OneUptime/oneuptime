import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A form's plain dropdown (a fixed list, no dropdownModal) shows its clear
 * button only where the field may be left empty. Dropdown's default drew it
 * on every one, required or not - a playbook step's Run This Step among them
 * - and pressing it only made the form say the field was required. A
 * required colour already had no "No color" (ColorPicker's isClearable);
 * a required pick now has no clear button either.
 *
 * And so does a picked record (dropdownModal), drawn by EntityDropdown: a
 * new incident's severity, a status page resource's monitor. It kept its
 * Clear selection after #5482 gave the plain dropdown its rule; FormField
 * now passes it isClearable={!required} too.
 */

// What an entity dropdown asks the server for: nothing more to find here.
const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import FormField from "../../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import { JSONObject } from "../../../../Types/JSON";

interface TestEntity extends JSONObject {
  severity?: string;
  regions?: Array<string>;
  incidentSeverity?: string;
}

const SEVERITY_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc1";
const OTHER_SEVERITY_ID: string = "cccccccc-cccc-4ccc-8ccc-ccccccccccc2";

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

  test("a required multi-select has no clear-all, an optional one has (the plain dropdown)", () => {
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

type RenderRecordFieldFunction = (data: {
  required: Field<TestEntity>["required"];
  setFieldValue?: MockFunction | undefined;
  disabled?: boolean | undefined;
}) => RenderResult;

// A new incident's severity: a record picked from a list the server holds.
const renderRecordField: RenderRecordFieldFunction = (data: {
  required: Field<TestEntity>["required"];
  setFieldValue?: MockFunction | undefined;
  disabled?: boolean | undefined;
}): RenderResult => {
  getListMock.mockReset();
  getListMock.mockImplementation(() => {
    return Promise.resolve({ data: [], count: 0 });
  });

  const field: Field<TestEntity> = {
    title: "Incident Severity",
    field: { incidentSeverity: true },
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: IncidentSeverity,
      labelField: "name",
      valueField: "_id",
    },
    dropdownOptions: [
      { value: SEVERITY_ID, label: "SEV-1" },
      { value: OTHER_SEVERITY_ID, label: "SEV-2" },
    ],
    required: data.required,
    ...(data.disabled === undefined ? {} : { disabled: data.disabled }),
  } as Field<TestEntity>;

  return render(
    <FormField<TestEntity>
      field={field}
      fieldName="incidentSeverity"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={
        { incidentSeverity: SEVERITY_ID } as FormValues<TestEntity>
      }
      setFieldTouched={() => {}}
      setFieldValue={data.setFieldValue || getJestMockFunction()}
    />,
  );
};

const queryClear: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByRole("button", { name: "Clear selection" });
};

// The picked record, shown as the button that opens the list.
const recordButton: () => HTMLElement = (): HTMLElement => {
  const button: HTMLElement | null = screen
    .getByText("SEV-1")
    .closest("button");

  if (!button) {
    throw new Error("The field shows no picked record");
  }

  return button;
};

describe("a form's picked record (EntityDropdown)", () => {
  test("required, it has no Clear selection, and Delete leaves it picked", () => {
    const setFieldValue: MockFunction = getJestMockFunction();
    renderRecordField({ required: true, setFieldValue });

    expect(screen.getByText("SEV-1")).toBeInTheDocument();
    expect(queryClear()).toBeNull();
    expect(screen.queryByTestId("entity-dropdown-clear-place")).toBeNull();

    fireEvent.keyDown(recordButton(), { key: "Delete" });
    fireEvent.keyDown(recordButton(), { key: "Backspace" });

    expect(setFieldValue).not.toHaveBeenCalled();
    expect(screen.getByText("SEV-1")).toBeInTheDocument();
  });

  test("required by a rule of the form's values, it has none either", () => {
    renderRecordField({
      required: (): boolean => {
        return true;
      },
    });

    expect(queryClear()).toBeNull();
  });

  test("required, another record is still picked in its place", async () => {
    const setFieldValue: MockFunction = getJestMockFunction();
    renderRecordField({ required: true, setFieldValue });

    fireEvent.click(recordButton());
    fireEvent.click(await screen.findByRole("option", { name: "SEV-2" }));

    expect(setFieldValue).toHaveBeenCalledWith(
      "incidentSeverity",
      OTHER_SEVERITY_ID,
    );
  });

  test("optional, it keeps Clear selection, which empties the field", () => {
    const setFieldValue: MockFunction = getJestMockFunction();
    renderRecordField({ required: false, setFieldValue });

    const clear: HTMLElement | null = queryClear();

    expect(clear).not.toBeNull();

    fireEvent.click(clear as HTMLElement);

    expect(setFieldValue).toHaveBeenCalledWith("incidentSeverity", null);
  });

  test("optional by a rule of the form's values, it keeps it", () => {
    renderRecordField({
      required: (): boolean => {
        return false;
      },
    });

    expect(queryClear()).not.toBeNull();
  });

  test("locked, it has none, required or not", () => {
    renderRecordField({ required: false, disabled: true });

    expect(queryClear()).toBeNull();
  });
});
