import "@testing-library/jest-dom";
import { describe, expect, it } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import SessionReplayFacets, {
  countActiveSessionReplayChips,
  getSessionReplayFacetOptions,
  getSessionReplayFacetValue,
  SESSION_REPLAY_FACETS,
  SessionReplayFacet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayFacets";
import {
  SEARCH_BOX_CHIP_FIELDS,
  SEARCH_BOX_CHIP_TOKEN_KEYS,
  parseSessionReplaySearch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchQuery";
import { FACET_FILTER_BAR_CLASS_NAME } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles";
import IconProp from "../../../Types/Icon/IconProp";
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
  clearAllCalls: Array<true>;
} {
  const filtersChanged: Array<SessionReplayAdvancedFilters> = [];
  const signalsChanged: Array<string> = [];
  const clearAllCalls: Array<true> = [];
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
      onClearAll={(): void => {
        clearAllCalls.push(true);
      }}
    />,
  );
  return { filtersChanged, signalsChanged, clearAllCalls };
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

/*
 * The chips sit in the row every list's chips sit in (FacetFilterBar): the
 * "Filter" label with how many are set, a chip per filter with its own icon,
 * and "Clear all" once one is. The row used to say "Filter by", with a
 * funnel on the Signal chip and no other icons.
 */
describe("session replay chips row", () => {
  it("is the shared Filter row, not a row of its own", () => {
    renderFacets();

    const bar: HTMLElement = screen.getByTestId("session-replay-facets");

    expect(bar).toHaveClass(...FACET_FILTER_BAR_CLASS_NAME.split(" "));
    expect(bar).toHaveAttribute("role", "group");
    expect(bar).toHaveAccessibleName("Filters");
    expect(bar).toHaveTextContent("Filter");
    expect(bar).not.toHaveTextContent("Filter by");
    expect(screen.queryByTestId("facet-filter-bar-count")).toBeNull();
    expect(screen.queryByRole("button", { name: "Clear all" })).toBeNull();
  });

  it("gives every chip its own icon, none of them the Filter label's funnel", () => {
    const icons: Array<IconProp> = SESSION_REPLAY_FACETS.map(
      (facet: SessionReplayFacet): IconProp => {
        return facet.icon;
      },
    );

    expect(icons).toEqual([
      IconProp.Window,
      IconProp.ComputerDesktop,
      IconProp.DevicePhoneMobile,
      IconProp.Flag,
      IconProp.VideoCamera,
      IconProp.Clock,
    ]);
    expect(new Set(icons).size).toBe(icons.length);
    expect(icons).not.toContain(IconProp.Filter);
  });

  it("counts the chips that are set and offers Clear all once one is", () => {
    const { clearAllCalls } = renderFacets(
      { ...EMPTY_ADVANCED_FILTERS, browserName: "Chrome", countryCode: "de" },
      "errors",
    );

    expect(screen.getByTestId("facet-filter-bar-count")).toHaveTextContent("3");

    fireEvent.click(screen.getByRole("button", { name: "Clear all" }));

    expect(clearAllCalls).toHaveLength(1);
  });

  it("counts a Slow signal on both chips that show it", () => {
    expect(countActiveSessionReplayChips(EMPTY_ADVANCED_FILTERS, "all")).toBe(
      0,
    );
    expect(
      countActiveSessionReplayChips(EMPTY_ADVANCED_FILTERS, "errors"),
    ).toBe(1);
    /*
     * Slow is the performance capture reason: the Signal chip and the
     * Capture reason chip both read it, and both are set.
     */
    expect(countActiveSessionReplayChips(EMPTY_ADVANCED_FILTERS, "slow")).toBe(
      2,
    );
    expect(
      countActiveSessionReplayChips(
        {
          ...EMPTY_ADVANCED_FILTERS,
          minDurationSeconds: "0",
          osName: "  ",
        },
        "all",
      ),
    ).toBe(0);
    expect(
      countActiveSessionReplayChips(
        {
          ...EMPTY_ADVANCED_FILTERS,
          browserName: "Chrome",
          osName: "macOS",
          deviceType: "mobile",
          countryCode: "GB",
          triggerReason: "error",
          minDurationSeconds: "60",
          search: "not a chip",
          urlPrefix: "/not-a-chip",
        },
        "all",
      ),
    ).toBe(6);
  });

  /*
   * The search box leaves the chips' fields to the chips
   * (SEARCH_BOX_CHIP_FIELDS): every chip is one of them, and each one's
   * token sets that chip and nothing else.
   */
  it("are exactly the fields the search box leaves to them", () => {
    expect(
      SESSION_REPLAY_FACETS.map((facet: SessionReplayFacet): string => {
        return facet.field;
      }),
    ).toEqual([...SEARCH_BOX_CHIP_FIELDS]);

    const values: Record<string, string> = {
      browser: "Chrome",
      os: "macOS",
      device: "mobile",
      country: "DE",
      trigger: "error",
      min: "90s",
    };

    SEARCH_BOX_CHIP_TOKEN_KEYS.forEach((key: string, index: number): void => {
      const parsed: SessionReplayAdvancedFilters = parseSessionReplaySearch(
        key + ":" + (values[key] as string),
      ).advanced;
      const setFields: Array<string> = (
        Object.keys(parsed) as Array<keyof SessionReplayAdvancedFilters>
      ).filter((field: keyof SessionReplayAdvancedFilters): boolean => {
        return parsed[field] !== "";
      });

      expect(setFields).toEqual([SEARCH_BOX_CHIP_FIELDS[index]]);
    });
  });
});
