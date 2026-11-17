import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import {
  findDropdownOption,
  getNamedDropdownOption,
  getTranslatedDropdownOption,
  readPickedDropdownValue,
} from "../../../../UI/Components/Dropdown/DropdownChoices";
import { describe, expect, test } from "@jest/globals";

/*
 * The helpers the pickers that were raw <select>s build their options with
 * (#9294): a fixed list of choices, the one a value names, and the value a
 * change carries.
 */

const options: Array<DropdownOption> = [
  getTranslatedDropdownOption("calls", "Request rate"),
  getTranslatedDropdownOption(7, "7"),
  getTranslatedDropdownOption("", "Everything"),
];

describe("getTranslatedDropdownOption", () => {
  test("words already in the reader's language are drawn as given, the page's way", () => {
    expect(getTranslatedDropdownOption("errors", "Fehlerrate")).toEqual({
      value: "errors",
      label: "Fehlerrate",
      isUserContent: true,
      isInPageDirection: true,
    });
  });
});

describe("getNamedDropdownOption", () => {
  test("a name is drawn as written, read the way its letters run", () => {
    expect(getNamedDropdownOption("unit", "Unit (UNIT)")).toEqual({
      value: "unit",
      label: "Unit (UNIT)",
      isUserContent: true,
    });
  });
});

describe("findDropdownOption", () => {
  test("finds the option that holds a value", () => {
    expect(findDropdownOption(options, "calls")?.label).toBe("Request rate");
  });

  test("compares as text: a number held as 7 and as '7' find the same option", () => {
    expect(findDropdownOption(options, 7)?.label).toBe("7");
    expect(findDropdownOption(options, "7")?.label).toBe("7");
  });

  test("no value, or one no option holds, shows the placeholder", () => {
    expect(findDropdownOption(options, null)).toBeUndefined();
    expect(findDropdownOption(options, undefined)).toBeUndefined();
    expect(findDropdownOption(options, "latency")).toBeUndefined();
  });

  test("an empty value is a value when an option holds it", () => {
    expect(findDropdownOption(options, "")?.label).toBe("Everything");
  });
});

describe("readPickedDropdownValue", () => {
  test("a pick reads as text", () => {
    expect(readPickedDropdownValue("errors")).toBe("errors");
    expect(readPickedDropdownValue(7)).toBe("7");
    expect(readPickedDropdownValue(false)).toBe("false");
  });

  test("a clear, or a multi-select's list, is no single pick", () => {
    expect(readPickedDropdownValue(null)).toBeNull();
    expect(readPickedDropdownValue(["a", "b"])).toBeNull();
  });
});
