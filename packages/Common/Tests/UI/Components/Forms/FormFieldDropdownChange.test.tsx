import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * A Dropdown or MultiSelectDropdown field's onChange is told what the pick
 * was, as the list showed it: its fourth argument holds the options picked
 * now and before, with their labels (Dropdown/DropdownChange). A field can
 * then fill in a name after what was picked - a status page resource's
 * display name follows its monitor - without asking the server again.
 *
 * Both kinds of dropdown a form draws: a list of records (EntityDropdown,
 * which knows the labels of what it searched for) and a fixed list (whose
 * options are all on the field).
 */

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
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import { JSONObject } from "../../../../Types/JSON";

interface TestEntity extends JSONObject {
  monitor?: string;
  severity?: string;
  tags?: Array<string>;
}

const MONITOR_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc1";
const OTHER_MONITOR_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbc2";

let setFieldValue: MockFunction;
let setFormValues: MockFunction;
let onChange: MockFunction;

type RenderFieldFunction = (data: {
  field: Field<TestEntity>;
  fieldName: string;
  currentValues: FormValues<TestEntity>;
}) => void;

const renderField: RenderFieldFunction = (data: {
  field: Field<TestEntity>;
  fieldName: string;
  currentValues: FormValues<TestEntity>;
}): void => {
  render(
    <FormField<TestEntity>
      field={data.field}
      fieldName={data.fieldName}
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={data.currentValues}
      setFieldTouched={() => {}}
      setFieldValue={setFieldValue}
      setFormValues={setFormValues}
    />,
  );
};

beforeEach(() => {
  setFieldValue = getJestMockFunction();
  setFormValues = getJestMockFunction();
  onChange = getJestMockFunction();

  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    const monitors: Array<Monitor> = [MONITOR_ID, OTHER_MONITOR_ID].map(
      (id: string, index: number): Monitor => {
        const monitor: Monitor = new Monitor();
        monitor._id = id;
        monitor.name = index === 0 ? "Developer portal" : "Payments API";
        return monitor;
      },
    );

    return { data: monitors, count: monitors.length, skip: 0, limit: 50 };
  });
});

afterEach(() => {
  cleanup();
});

describe("FormField: a list of records tells onChange what was picked", () => {
  const monitorField: Field<TestEntity> = {
    title: "Monitor",
    field: { monitor: true },
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: Monitor,
      labelField: "name",
      valueField: "_id",
    },
    // What ModelForm hands the field: the options it fetched.
    dropdownOptions: [
      { value: MONITOR_ID, label: "Developer portal" },
      { value: OTHER_MONITOR_ID, label: "Payments API" },
    ],
    required: true,
    placeholder: "Select Monitor",
  } as Field<TestEntity>;

  test("the new monitor and the one it replaced, with their names", async () => {
    const currentValues: FormValues<TestEntity> = {
      monitor: MONITOR_ID,
    } as FormValues<TestEntity>;

    renderField({
      field: { ...monitorField, onChange: onChange },
      fieldName: "monitor",
      currentValues,
    });

    // The dropdown shows its selection as a button until it is opened.
    fireEvent.click(screen.getByText("Developer portal").closest("button")!);
    fireEvent.click(await screen.findByRole("option", { name: /Payments API/ }));

    expect(onChange).toHaveBeenCalledTimes(1);

    const [value, values, setter, change] = onChange.mock.calls[0] as [
      unknown,
      unknown,
      unknown,
      { selectedOptions: Array<unknown>; previousOptions: Array<unknown> },
    ];

    expect(value).toBe(OTHER_MONITOR_ID);
    expect(values).toBe(currentValues);
    expect(typeof setter).toBe("function");
    expect(change.selectedOptions).toEqual([
      expect.objectContaining({
        value: OTHER_MONITOR_ID,
        label: "Payments API",
      }),
    ]);
    expect(change.previousOptions).toEqual([
      expect.objectContaining({
        value: MONITOR_ID,
        label: "Developer portal",
      }),
    ]);

    // And the form still stores the id, as before.
    expect(setFieldValue).toHaveBeenCalledWith("monitor", OTHER_MONITOR_ID);
  });

  test("onChange's form setter still replaces the form's values", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderField({
      field: {
        ...monitorField,
        onChange: (
          _value: unknown,
          values: FormValues<TestEntity>,
          setNewFormValues: (values: FormValues<TestEntity>) => void,
        ): void => {
          setNewFormValues({ ...values, severity: "high" });
        },
      },
      fieldName: "monitor",
      currentValues: {} as FormValues<TestEntity>,
    });

    await user.click(screen.getByRole("combobox", { name: "Monitor" }));
    await user.click(await screen.findByRole("option", { name: /Payments API/ }));

    expect(setFormValues).toHaveBeenCalledWith({ severity: "high" });
  });
});

describe("FormField: a fixed list tells onChange what was picked", () => {
  test("a single pick, and the one it replaced", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderField({
      field: {
        title: "Severity",
        field: { severity: true },
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [
          { value: "high", label: "High" },
          { value: "low", label: "Low" },
        ],
        required: true,
        onChange: onChange,
      } as Field<TestEntity>,
      fieldName: "severity",
      currentValues: { severity: "high" } as FormValues<TestEntity>,
    });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Low" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![0]).toBe("low");
    expect(onChange.mock.calls[0]![3]).toEqual({
      selectedOptions: [{ value: "low", label: "Low" }],
      previousOptions: [{ value: "high", label: "High" }],
    });
  });

  test("a multi-select: everything picked now, and what was picked before", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderField({
      field: {
        title: "Tags",
        field: { tags: true },
        fieldType: FormFieldSchemaType.MultiSelectDropdown,
        dropdownOptions: [
          {
            label: "Kinds",
            options: [
              { value: "a", label: "Alpha" },
              { value: "b", label: "Beta" },
            ],
          },
        ],
        required: false,
        onChange: onChange,
      } as Field<TestEntity>,
      fieldName: "tags",
      currentValues: { tags: ["a"] } as FormValues<TestEntity>,
    });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Beta" }));

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0]![3]).toEqual({
      selectedOptions: [
        { value: "a", label: "Alpha" },
        { value: "b", label: "Beta" },
      ],
      previousOptions: [{ value: "a", label: "Alpha" }],
    });
  });

  test("a field without an onChange still stores its pick", async () => {
    const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

    renderField({
      field: {
        title: "Severity",
        field: { severity: true },
        fieldType: FormFieldSchemaType.Dropdown,
        dropdownOptions: [
          { value: "high", label: "High" },
          { value: "low", label: "Low" },
        ],
        required: true,
      } as Field<TestEntity>,
      fieldName: "severity",
      currentValues: {} as FormValues<TestEntity>,
    });

    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "High" }));

    expect(setFieldValue).toHaveBeenCalledWith("severity", "high");
  });
});
