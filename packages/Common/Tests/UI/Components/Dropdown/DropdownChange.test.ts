import { describe, expect, test } from "@jest/globals";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "../../../../UI/Components/Dropdown/Dropdown";
import {
  EMPTY_DROPDOWN_CHANGE,
  flattenDropdownOptions,
  getDropdownChange,
  getDropdownOptionsForValue,
  getPickedLabel,
} from "../../../../UI/Components/Dropdown/DropdownChange";
import ObjectID from "../../../../Types/ObjectID";

/*
 * What a pick in a dropdown changed, as the list showed it (DropdownChange).
 * A fixed list works it out from its own options with these helpers; a list
 * of records reports its own (EntityDropdown). A form field's onChange gets
 * it, so a field can fill in a name after what was picked.
 */

const HIGH: DropdownOption = { value: "high", label: "High" };
const LOW: DropdownOption = { value: "low", label: "Low" };
const ONE: DropdownOption = { value: 1, label: "One" };
const YES: DropdownOption = { value: true, label: "Yes" };

const MONITOR_ID: string = "0198c8ec-2a1d-7f0c-9e75-384194166001";
const MONITOR: DropdownOption = { value: MONITOR_ID, label: "Checkout API" };

const GROUPED: Array<DropdownOption | DropdownOptionGroup> = [
  { label: "Severities", options: [HIGH, LOW] },
  ONE,
  { label: "Answers", options: [YES] },
];

describe("flattenDropdownOptions", () => {
  test("opens up groups, in the order the list shows them", () => {
    expect(flattenDropdownOptions(GROUPED)).toEqual([HIGH, LOW, ONE, YES]);
  });

  test("is empty for a list that has no options yet", () => {
    expect(flattenDropdownOptions(undefined)).toEqual([]);
    expect(flattenDropdownOptions([])).toEqual([]);
  });
});

describe("getDropdownOptionsForValue", () => {
  test("finds a value among the options, inside groups too", () => {
    expect(getDropdownOptionsForValue({ options: GROUPED, value: "low" })).toEqual(
      [LOW],
    );
  });

  test("finds numbers and booleans as the form keeps them", () => {
    expect(getDropdownOptionsForValue({ options: GROUPED, value: 1 })).toEqual([
      ONE,
    ]);
    expect(getDropdownOptionsForValue({ options: GROUPED, value: true })).toEqual(
      [YES],
    );
  });

  test("finds a record's id whether it is held as a string or an ObjectID", () => {
    expect(
      getDropdownOptionsForValue({ options: [MONITOR], value: MONITOR_ID }),
    ).toEqual([MONITOR]);
    expect(
      getDropdownOptionsForValue({
        options: [MONITOR],
        value: new ObjectID(MONITOR_ID),
      }),
    ).toEqual([MONITOR]);
  });

  test("takes a value that is an option already as it is", () => {
    const picked: DropdownOption = { value: "elsewhere", label: "Elsewhere" };

    expect(getDropdownOptionsForValue({ options: GROUPED, value: picked })).toEqual(
      [picked],
    );
  });

  test("follows a multi-select's order", () => {
    expect(
      getDropdownOptionsForValue({ options: GROUPED, value: ["low", "high"] }),
    ).toEqual([LOW, HIGH]);
  });

  test("leaves out a value no option has, rather than inventing a label", () => {
    expect(
      getDropdownOptionsForValue({ options: GROUPED, value: ["low", "gone"] }),
    ).toEqual([LOW]);
    expect(
      getDropdownOptionsForValue({ options: GROUPED, value: "gone" }),
    ).toEqual([]);
  });

  test("is empty for nothing picked", () => {
    for (const value of [undefined, null, "", []]) {
      expect(getDropdownOptionsForValue({ options: GROUPED, value })).toEqual(
        [],
      );
    }
  });
});

describe("getDropdownChange", () => {
  test("says what is picked now and what was picked before", () => {
    expect(
      getDropdownChange({ options: GROUPED, value: "low", previousValue: "high" }),
    ).toEqual({ selectedOptions: [LOW], previousOptions: [HIGH] });
  });

  test("says a cleared pick: nothing now, and what was there", () => {
    expect(
      getDropdownChange({ options: GROUPED, value: null, previousValue: "high" }),
    ).toEqual({ selectedOptions: [], previousOptions: [HIGH] });
  });

  test("says a first pick: nothing before", () => {
    expect(
      getDropdownChange({
        options: GROUPED,
        value: ["high", "low"],
        previousValue: undefined,
      }),
    ).toEqual({ selectedOptions: [HIGH, LOW], previousOptions: [] });
  });

  test("starts from an empty change", () => {
    expect(EMPTY_DROPDOWN_CHANGE).toEqual({
      selectedOptions: [],
      previousOptions: [],
    });
  });
});

describe("getPickedLabel", () => {
  test("is the label of the one option picked", () => {
    expect(getPickedLabel([MONITOR])).toBe("Checkout API");
  });

  test("is trimmed", () => {
    expect(getPickedLabel([{ value: "x", label: "  Checkout API " }])).toBe(
      "Checkout API",
    );
  });

  test("is nothing for no pick, more than one, or a blank label", () => {
    expect(getPickedLabel(undefined)).toBeNull();
    expect(getPickedLabel([])).toBeNull();
    expect(getPickedLabel([HIGH, LOW])).toBeNull();
    expect(getPickedLabel([{ value: "x", label: "   " }])).toBeNull();
  });
});
