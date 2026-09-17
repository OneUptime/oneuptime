import "@testing-library/jest-dom";
import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import SessionReplayFacets, {
  getSessionReplayFacetOptions,
  getSessionReplayFacetValue,
  SESSION_REPLAY_FACETS,
  SessionReplayFacet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFacets";
import {
  buildSessionReplayListFilters,
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import { SessionReplaySummary } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayTable";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";

function renderFacets(
  filters: SessionReplayAdvancedFilters = EMPTY_ADVANCED_FILTERS,
  signal: string = "all",
): {
  filtersChanged: Array<SessionReplayAdvancedFilters>;
  signalsChanged: Array<string>;
} {
  const filtersChanged: Array<SessionReplayAdvancedFilters> = [];
  const signalsChanged: Array<string> = [];
  render(
    <SessionReplayFacets
      rows={[]}
      filters={filters}
      signal={signal}
      onFiltersChange={(value: SessionReplayAdvancedFilters): void => {
        filtersChanged.push(value);
      }}
      onSignalChange={(value: string): void => {
        signalsChanged.push(value);
      }}
    />,
  );
  return { filtersChanged, signalsChanged };
}

function openFacet(field: string): void {
  fireEvent.click(
    within(screen.getByTestId(`session-facet-${field}`)).getByRole("button"),
  );
}

describe("session replay standard facets", () => {
  it("offers all seven facets on an empty application", () => {
    renderFacets();
    for (const name of [
      "Signal",
      "Browser",
      "Operating system",
      "Device",
      "Country",
      "Capture reason",
      "Duration",
    ]) {
      expect(screen.getByRole("button", { name })).toBeInTheDocument();
    }
    expect(screen.getByTestId("session-replay-facets")).not.toHaveTextContent(
      "0 sessions",
    );
  });

  it.each([
    ["browserName", "Chrome", "browserNames", ["Chrome"]],
    ["osName", "macOS", "osNames", ["macOS"]],
    ["deviceType", "Mobile", "deviceTypes", ["mobile"]],
    ["countryCode", "United Kingdom (GB)", "countryCodes", ["GB"]],
    ["minDurationSeconds", "At least 2 minutes", "minDurationMs", 120000],
  ])(
    "%s selects a server filter and keeps the other facets",
    (
      field: string | number | Array<string>,
      label: string | number | Array<string>,
      requestField: string | number | Array<string>,
      value: string | number | Array<string>,
    ) => {
      const changes: ReturnType<typeof renderFacets> = renderFacets({
        ...EMPTY_ADVANCED_FILTERS,
        urlPrefix: "/checkout",
      });
      openFacet(field as string);
      if (field === "countryCode") {
        fireEvent.change(screen.getByPlaceholderText("Search country..."), {
          target: { value: "United Kingdom" },
        });
      }
      expect(screen.queryByRole("combobox")).toBeNull();
      fireEvent.click(screen.getByRole("option", { name: label as string }));
      expect(changes.filtersChanged).toHaveLength(1);
      const next: SessionReplayAdvancedFilters = changes
        .filtersChanged[0] as SessionReplayAdvancedFilters;
      expect(next.urlPrefix).toBe("/checkout");
      expect(buildSessionReplayListFilters("all", next)).toEqual({
        urlPrefix: "/checkout",
        [requestField as string]: value,
      });
    },
  );

  it("signals use the endpoint predicate without estimating counts", () => {
    const changes: ReturnType<typeof renderFacets> = renderFacets();
    openFacet("signal");
    fireEvent.click(screen.getByRole("option", { name: /Playable/ }));
    expect(changes.signalsChanged).toEqual(["playable"]);
    expect(
      buildSessionReplayListFilters(changes.signalsChanged[0] as string),
    ).toEqual({ isPlayable: true });
  });

  it("clears one facet without removing the other filters", () => {
    const changes: ReturnType<typeof renderFacets> = renderFacets({
      ...EMPTY_ADVANCED_FILTERS,
      browserName: "Chrome",
      deviceType: "mobile",
    });
    fireEvent.click(
      screen.getByRole("button", { name: "Clear Browser filter" }),
    );
    expect(changes.filtersChanged[0]).toEqual({
      ...EMPTY_ADVANCED_FILTERS,
      browserName: "",
      deviceType: "mobile",
    });
  });

  it("shows the effective capture reason for Slow and allows clearing it", () => {
    const changes: ReturnType<typeof renderFacets> = renderFacets(
      { ...EMPTY_ADVANCED_FILTERS, triggerReason: "error" },
      "slow",
    );
    expect(screen.getByTestId("session-facet-triggerReason")).toHaveTextContent(
      "Slow page",
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Clear Capture reason filter" }),
    );
    expect(changes.signalsChanged).toEqual(["all"]);
    expect(changes.filtersChanged[0]?.triggerReason).toBe("");
  });

  it("keeps custom selected values and row suggestions without treating the page as all results", () => {
    const facet: SessionReplayFacet =
      SESSION_REPLAY_FACETS[0] as SessionReplayFacet;
    const options: Array<FilterChipDropdownOption> =
      getSessionReplayFacetOptions(
        facet,
        [
          { browserName: "Customer browser" } as SessionReplaySummary,
          { browserName: "Customer browser" } as SessionReplaySummary,
          { browserName: "" } as SessionReplaySummary,
        ],
        "Saved browser",
      );
    expect(
      options.filter((option: FilterChipDropdownOption): boolean => {
        return option.value === "Customer browser";
      }),
    ).toHaveLength(1);
    expect(options).toContainEqual({
      value: "Saved browser",
      label: "Saved browser",
    });
    expect(options).toContainEqual({ value: "Chrome", label: "Chrome" });
    expect(
      options.every((option: FilterChipDropdownOption): boolean => {
        return !("count" in option);
      }),
    ).toBe(true);
  });

  it("normalizes country and duration like the applied request and ignores invalid duration", () => {
    const filters: SessionReplayAdvancedFilters = {
      ...EMPTY_ADVANCED_FILTERS,
      countryCode: " gb ",
      minDurationSeconds: " 120 ",
    };
    expect(getSessionReplayFacetValue("countryCode", filters, "all")).toBe(
      "GB",
    );
    expect(
      getSessionReplayFacetValue("minDurationSeconds", filters, "all"),
    ).toBe("120");
    for (const invalid of ["0", "-4", "abc", "Infinity"]) {
      expect(
        getSessionReplayFacetValue(
          "minDurationSeconds",
          { ...filters, minDurationSeconds: invalid },
          "all",
        ),
      ).toBe("");
    }
  });
});
