import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";
import {
  chooseDropdownOption,
  clearDropdown,
  getShownDropdownPlaceholder,
  getShownDropdownValue,
  hasDropdownClearControl,
  listDropdownOptions,
} from "../../DropdownPicks";
import LanguagePicker, {
  getLanguagePickerOptions,
} from "../../../UI/Components/LanguagePicker/LanguagePicker";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import FilterChipOperatorPicker from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipOperatorPicker";
import { FilterOperator } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import TelemetryAttributeVariableDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/TelemetryAttributeVariableDropdown";
import ProjectLabelVariableDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ProjectLabelVariableDropdown";
import { getDefaultLabelOptions } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal";
import { TOPOLOGY_LINE_LABEL_DROPDOWN_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyToolbarPicker";
import { USER_FLOW_PICKER_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/UserFlows";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

/*
 * Pickers that were raw <select>s, each with its own size, border, focus
 * ring and dark look (#9294), are the shared Dropdown now, and keep what
 * they did: their values, their defaults, a clear control only where a
 * value may be empty, and a name a screen reader says.
 */

afterEach(() => {
  cleanup();
});

describe("the footer's language picker", () => {
  const languages: Array<{ code: string; nativeName: string }> = [
    { code: "en", nativeName: "English" },
    { code: "de", nativeName: "Deutsch" },
    { code: "ar", nativeName: "العربية" },
  ];

  test("is named by its hidden label, shows the language in use, and has no clear control", () => {
    render(
      <LanguagePicker
        inputId="test-language-switcher"
        label="Switch language"
        languages={languages}
        value="de"
        onChange={() => {}}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Switch language",
    });

    expect(combobox).toHaveAttribute("id", "test-language-switcher");
    expect(getShownDropdownValue(combobox)).toBe("Deutsch");
    expect(hasDropdownClearControl(combobox)).toBe(false);
  });

  test("names each language in its own words, never looked up", async () => {
    render(
      <LanguagePicker
        inputId="test-language-switcher"
        label="Switch language"
        languages={languages}
        value="en"
        onChange={() => {}}
      />,
    );

    expect(await listDropdownOptions(screen.getByRole("combobox"))).toEqual([
      "English",
      "Deutsch",
      "العربية",
    ]);
    expect(
      getLanguagePickerOptions(languages).every(
        (option: { isUserContent?: boolean | undefined }): boolean => {
          return option.isUserContent === true;
        },
      ),
    ).toBe(true);
  });

  test("a pick hands over the language's code; the language in use again, nothing", () => {
    const picked: Array<string> = [];

    render(
      <LanguagePicker
        inputId="test-language-switcher"
        label="Switch language"
        languages={languages}
        value="en"
        onChange={(code: string) => {
          picked.push(code);
        }}
      />,
    );

    chooseDropdownOption(screen.getByRole("combobox"), "English");
    chooseDropdownOption(screen.getByRole("combobox"), "Deutsch");

    expect(picked).toEqual(["de"]);
  });
});

describe("a filter chip's operator", () => {
  test("is the shared Dropdown, named after its facet, with no clear control", async () => {
    const picked: Array<FilterOperator> = [];

    render(
      <FilterChipOperatorPicker
        label="Owner"
        operator="is"
        operators={["is", "is_not", "is_empty", "is_not_empty"]}
        onChange={(operator: FilterOperator) => {
          picked.push(operator);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Owner operator",
    });

    expect(getShownDropdownValue(combobox)).toBe("is");
    expect(hasDropdownClearControl(combobox)).toBe(false);
    expect(await listDropdownOptions(combobox)).toEqual([
      "is",
      "is not",
      "is empty",
      "is not empty",
    ]);

    chooseDropdownOption(combobox, "is");
    chooseDropdownOption(combobox, "is not empty");

    // The operator already set is no change.
    expect(picked).toEqual(["is_not_empty"]);
  });
});

function variable(overrides: Partial<DashboardVariable>): DashboardVariable {
  return {
    id: "slo",
    name: "slo",
    label: "SLO",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "slo.id",
    ...overrides,
  };
}

describe("a widget's variable binding", () => {
  test("Follow Variable starts on None, lists Telemetry Attribute variables, and clears back to None", () => {
    const changes: Array<string> = [];

    render(
      <TelemetryAttributeVariableDropdown
        variables={[
          variable({}),
          variable({
            id: "labels",
            name: "labels",
            type: DashboardVariableType.ProjectLabel,
          }),
        ]}
        onChange={(value: string) => {
          changes.push(value);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Follow Variable",
    });

    expect(getShownDropdownValue(combobox)).toBeNull();
    expect(getShownDropdownPlaceholder(combobox)).toBe("None");

    chooseDropdownOption(combobox, "SLO (slo.id)");
    expect(changes).toEqual(["slo"]);
    expect(screen.queryByRole("option", { name: /labels/ })).toBeNull();
  });

  test("a bound variable can be cleared: the binding is empty again", () => {
    const changes: Array<string> = [];

    render(
      <TelemetryAttributeVariableDropdown
        variables={[variable({})]}
        value="slo"
        onChange={(value: string) => {
          changes.push(value);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Follow Variable",
    });

    expect(getShownDropdownValue(combobox)).toBe("SLO (slo.id)");
    clearDropdown(combobox);
    expect(changes).toEqual([""]);
  });

  test("a Monitor List's Label Variable starts on None too", () => {
    render(
      <ProjectLabelVariableDropdown
        variables={[
          variable({
            id: "unit",
            name: "UNIT",
            label: "Unit",
            type: DashboardVariableType.ProjectLabel,
          }),
        ]}
        onChange={() => {}}
      />,
    );

    expect(
      getShownDropdownPlaceholder(
        screen.getByRole("combobox", { name: "Label Variable" }),
      ),
    ).toBe("None");
  });
});

describe("a Project Labels variable's default", () => {
  const translator: Translator = createTranslator(undefined, "en");

  test("its allowed labels, drawn as named, read the way their letters run", () => {
    expect(
      getDefaultLabelOptions(
        variable({
          type: DashboardVariableType.ProjectLabel,
          labelOptions: [{ label: "0660", value: "a" }],
          defaultValue: "a",
        }),
        translator,
      ),
    ).toEqual([
      {
        value: "a",
        label: "0660",
        isUserContent: true,
      },
    ]);
  });

  test("a default no longer allowed stays, named Unavailable label, first", () => {
    expect(
      getDefaultLabelOptions(
        variable({
          type: DashboardVariableType.ProjectLabel,
          labelOptions: [{ label: "0660", value: "a" }],
          defaultValue: "gone",
        }),
        translator,
      ).map((option: { value: unknown; label: string }) => {
        return [option.value, option.label];
      }),
    ).toEqual([
      ["gone", "Unavailable label"],
      ["a", "0660"],
    ]);
  });
});

describe("the toolbars' picker boxes", () => {
  test("hold the Dropdown's own frame, never wider than their row", () => {
    for (const className of [
      TOPOLOGY_LINE_LABEL_DROPDOWN_CLASS_NAME,
      USER_FLOW_PICKER_CLASS_NAME,
    ]) {
      expect(className.split(" ")).toEqual(
        expect.arrayContaining(["relative", "max-w-full", "overflow-visible"]),
      );
      // No border, ring or background of their own: the Dropdown draws them.
      expect(className).not.toMatch(/\b(border|ring|bg-|rounded)/);
    }
  });
});
