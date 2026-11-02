import "@testing-library/jest-dom";
import { describe, expect, jest, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { EXCLUDED_FILTER_CHIP_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import { buildSearchTokenValue } from "../../../Types/Telemetry/TelemetrySearchQuery";

/*
 * The logs explorer's chip row, for a value the reader LEFT OUT.
 *
 * "Severity: debug" reads as the opposite of a filter that leaves debug
 * out - the one mistake a filter chip must never make. So a chip keyed `!`
 * says it excludes in words ("Severity is not"), in the red the sidebar
 * draws an excluded value in, as the other explorers' chip row
 * (TelemetryActiveFilterChips) always has. Its x takes off exactly that
 * chip.
 */

function chip(overrides: Partial<ActiveFilter>): ActiveFilter {
  return {
    facetKey: "severityText",
    value: "Debug",
    displayKey: "Severity",
    displayValue: "Debug",
    ...overrides,
  };
}

describe("the logs chip row: a value left out", () => {
  test("reads 'Severity is not', in red, and its x removes exactly that chip", () => {
    const onRemove: ReturnType<typeof jest.fn> = jest.fn();

    render(
      <ActiveFilterChips
        filters={[
          chip({ facetKey: "!severityText" }),
          chip({ value: "Error", displayValue: "Error" }),
        ]}
        onRemove={onRemove}
        onClearAll={() => {}}
      />,
    );

    const excluded: HTMLElement = screen.getByTestId(
      EXCLUDED_FILTER_CHIP_TEST_ID,
    );

    expect(excluded).toHaveTextContent(/^Severity is not:Debug$/);
    expect(excluded).toHaveClass("border-red-200", "bg-red-50", "text-red-700");

    const remove: HTMLElement = within(excluded).getByRole("button");
    expect(remove).toHaveAttribute("title", "Remove Severity is not: Debug");

    // The chip that keeps a value stays as it always was.
    const kept: HTMLElement = screen
      .getByText("Error")
      .closest("span.inline-flex") as HTMLElement;
    expect(kept).toHaveTextContent(/^Severity:Error$/);
    expect(kept).toHaveClass("bg-indigo-50");
    expect(kept).not.toHaveAttribute("data-testid");

    fireEvent.click(remove);

    expect(onRemove.mock.calls).toEqual([["!severityText", "Debug"]]);
  });

  test("a resource left out reads as its facet, named", () => {
    render(
      <ActiveFilterChips
        filters={[
          chip({
            facetKey: "!hostId",
            value: "5f4e3d2c-1b0a-4998-8776-655443322110",
            displayKey: "Host",
            displayValue: "web-01",
          }),
        ]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(screen.getByTestId(EXCLUDED_FILTER_CHIP_TEST_ID)).toHaveTextContent(
      /^Host is not:web-01$/,
    );
  });

  test("an attribute chip whose value leaves its value out reads 'is not' too", () => {
    render(
      <ActiveFilterChips
        filters={[
          chip({
            facetKey: "attributes.http.method",
            value: `!${buildSearchTokenValue("GET")}`,
            displayKey: "http.method",
            displayValue: "GET",
          }),
        ]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(screen.getByTestId(EXCLUDED_FILTER_CHIP_TEST_ID)).toHaveTextContent(
      /^http\.method is not:GET$/,
    );
  });

  test("a chip that keeps its value is never drawn as an exclusion", () => {
    render(
      <ActiveFilterChips
        filters={[chip({})]}
        onRemove={() => {}}
        onClearAll={() => {}}
      />,
    );

    expect(screen.queryByTestId(EXCLUDED_FILTER_CHIP_TEST_ID)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Remove Severity: Debug" }),
    ).toBeInTheDocument();
  });
});
