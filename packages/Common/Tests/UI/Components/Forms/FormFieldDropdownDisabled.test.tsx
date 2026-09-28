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
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

/*
 * Field.disabled locks a field. FormField passed it to the time, id and text
 * inputs, but not to the dropdowns: an entity dropdown (the alert's monitor on
 * the Affected Resources card, locked when that monitor raised the alert) still
 * opened, changed and cleared, and the lock only showed as a server error on
 * save.
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
}

const MONITOR_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1";
const OTHER_MONITOR_ID: string = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2";

let setFieldValue: MockFunction;

type RenderMonitorFieldFunction = (disabled: boolean | undefined) => void;

// The alert page's monitor field, holding the id ModelForm loads it as.
const renderMonitorField: RenderMonitorFieldFunction = (
  disabled: boolean | undefined,
): void => {
  const field: Field<TestEntity> = {
    title: "Monitor",
    field: { monitor: true },
    fieldType: FormFieldSchemaType.Dropdown,
    dropdownModal: {
      type: Monitor,
      labelField: "name",
      valueField: "_id",
    },
    dropdownOptions: [
      { value: MONITOR_ID, label: "Developer portal" },
      { value: OTHER_MONITOR_ID, label: "Payments API" },
    ],
    required: false,
    placeholder: "Select Monitor",
    // Left out entirely for "no disabled at all".
    ...(disabled === undefined ? {} : { disabled: disabled }),
  } as Field<TestEntity>;

  render(
    <FormField<TestEntity>
      field={field}
      fieldName="monitor"
      index={0}
      isDisabled={false}
      error=""
      touched={false}
      currentValues={{ monitor: MONITOR_ID } as FormValues<TestEntity>}
      setFieldTouched={() => {}}
      setFieldValue={setFieldValue}
    />,
  );
};

// The dropdown shows its selection as a button until it is opened.
function selectionButton(): HTMLButtonElement {
  const button: HTMLButtonElement | null = screen
    .getByText("Developer portal")
    .closest("button");

  if (!button) {
    throw new Error("The dropdown shows no selection");
  }

  return button;
}

beforeEach(() => {
  setFieldValue = getJestMockFunction();

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

describe("FormField: a disabled entity dropdown", () => {
  test("shows its value, but cannot be opened", () => {
    renderMonitorField(true);

    expect(selectionButton()).toBeDisabled();

    fireEvent.click(selectionButton());

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
    // Still the button: opening swaps it for a search box.
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("offers no way to clear it, and never changes the form's value", () => {
    renderMonitorField(true);

    expect(screen.queryByRole("button", { name: "Clear selection" })).toBe(
      null,
    );

    fireEvent.click(selectionButton());
    fireEvent.keyDown(selectionButton(), { key: "Backspace" });

    expect(setFieldValue).not.toHaveBeenCalled();
  });
});

describe("FormField: an entity dropdown that is not disabled", () => {
  test.each([
    ["disabled: false", false],
    ["no disabled at all", undefined],
  ])(
    "with %s opens and can be changed",
    async (_label: string, disabled: boolean | undefined) => {
      renderMonitorField(disabled);

      expect(selectionButton()).not.toBeDisabled();

      fireEvent.click(selectionButton());
      fireEvent.click(
        await screen.findByRole("option", { name: /Payments API/ }),
      );

      expect(setFieldValue).toHaveBeenCalledWith("monitor", OTHER_MONITOR_ID);
    },
  );

  test("can be cleared, which hands the form null", () => {
    renderMonitorField(false);

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));

    expect(setFieldValue).toHaveBeenCalledWith("monitor", null);
  });
});

describe("FormField: a disabled static dropdown", () => {
  type RenderSeverityFieldFunction = (disabled: boolean) => void;

  const renderSeverityField: RenderSeverityFieldFunction = (
    disabled: boolean,
  ): void => {
    const field: Field<TestEntity> = {
      title: "Severity",
      field: { severity: true },
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: [
        { value: "high", label: "High" },
        { value: "low", label: "Low" },
      ],
      required: false,
      disabled: disabled,
    } as Field<TestEntity>;

    render(
      <FormField<TestEntity>
        field={field}
        fieldName="severity"
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={{ severity: "high" } as FormValues<TestEntity>}
        setFieldTouched={() => {}}
        setFieldValue={setFieldValue}
      />,
    );
  };

  /*
   * hidden: true because react-select takes its input out of the
   * accessibility tree while it is disabled.
   */
  test("is disabled too", () => {
    renderSeverityField(true);

    expect(screen.getByRole("combobox", { hidden: true })).toBeDisabled();
  });

  test("is enabled when the field is not", () => {
    renderSeverityField(false);

    expect(screen.getByRole("combobox", { hidden: true })).not.toBeDisabled();
  });
});
