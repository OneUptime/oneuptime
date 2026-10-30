import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";
import CriteriaFilterElement, {
  FilterDropdown,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorType from "../../../Types/Monitor/MonitorType";
import { SINGLE_SELECT_WRAPPED_VALUE_LABEL_CLASS_NAME } from "../../../UI/Components/Dropdown/Dropdown";
import fs from "fs";
import path from "path";

/*
 * A monitor criteria's filter on a phone (#5281): three cards deep, a filter
 * leaves its lists about 200px, and "SNMP Walk Is Succeeding" read
 * "SNMP Walk..." beside a × that took a sixth of the list. Every list of a
 * filter shows its pick whole now, on a second line if it must
 * (FilterDropdown), and Filter Type and Filter Condition - which a filter
 * cannot be without - never offer to clear. The Create Monitor browser
 * suite measures the drawn lists at 390px.
 */

function renderFilter(criteriaFilter: CriteriaFilter): HTMLElement {
  const { container } = render(
    <CriteriaFilterElement
      monitorType={MonitorType.NetworkDevice}
      monitorStep={new MonitorStep()}
      value={criteriaFilter}
      onChange={(): void => {}}
    />,
  );

  return container;
}

// The box of the list a field's label names.
function listOf(container: HTMLElement, ariaLabel: string): HTMLElement {
  const input: HTMLElement = within(container).getByRole("combobox", {
    name: ariaLabel,
  });
  const control: HTMLElement | null = input.closest(".ou-select__control");

  expect(control).not.toBeNull();

  return control!.parentElement as HTMLElement;
}

afterEach(() => {
  cleanup();
});

describe("a criteria filter's lists, on a phone", () => {
  test("Filter Type shows a long check whole and never offers to clear it", () => {
    const container: HTMLElement = renderFilter({
      checkOn: CheckOn.SnmpWalkIsSucceeding,
      filterType: FilterType.False,
      value: undefined,
    });

    const filterType: HTMLElement = listOf(container, "Filter Type");

    expect(
      within(filterType).getByTestId("dropdown-value-label"),
    ).toHaveTextContent("SNMP Walk Is Succeeding");
    expect(
      within(filterType)
        .getByTestId("dropdown-value-label")
        .getAttribute("class"),
    ).toBe(SINGLE_SELECT_WRAPPED_VALUE_LABEL_CLASS_NAME);
    expect(filterType.querySelector(".ou-select__clear-indicator")).toBeNull();
  });

  test("Filter Condition does the same: a filter with no condition never matches", () => {
    const container: HTMLElement = renderFilter({
      checkOn: CheckOn.SnmpInterfaceUtilizationPercent,
      filterType: FilterType.GreaterThan,
      value: "90",
    });

    const condition: HTMLElement = listOf(container, "Filter Condition");

    expect(
      within(condition).getByTestId("dropdown-value-label"),
    ).toHaveTextContent("Greater Than");
    expect(
      within(condition)
        .getByTestId("dropdown-value-label")
        .getAttribute("class"),
    ).toBe(SINGLE_SELECT_WRAPPED_VALUE_LABEL_CLASS_NAME);
    expect(condition.querySelector(".ou-select__clear-indicator")).toBeNull();
  });

  test("a filter's other lists show their picks whole too", () => {
    render(
      <FilterDropdown
        options={[{ value: "a", label: "SNMP Interface Utilization (in %)" }]}
        value={{ value: "a", label: "SNMP Interface Utilization (in %)" }}
        onChange={(): void => {}}
      />,
    );

    expect(
      screen.getByTestId("dropdown-value-label").getAttribute("class"),
    ).toBe(SINGLE_SELECT_WRAPPED_VALUE_LABEL_CLASS_NAME);
    // FilterDropdown only wraps: whether a list clears is its caller's.
    expect(
      document.querySelector(".ou-select__clear-indicator"),
    ).not.toBeNull();
  });

  test("every list of a filter is a FilterDropdown", () => {
    const source: string = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/CriteriaFilter.tsx",
      ),
      "utf8",
    );
    // The opening tags of the plain list: only FilterDropdown's own one.
    const plainLists: number = source.split("<Dropdown ").length - 1;
    const plainListsOnLines: number = source.split("<Dropdown\n").length - 1;

    expect(plainLists).toBe(1);
    expect(plainListsOnLines).toBe(0);
    expect(source).toContain("<Dropdown {...props} wrapsPickedValue={true} />");
    expect(source.split("<FilterDropdown").length - 1).toBeGreaterThan(10);
  });
});
