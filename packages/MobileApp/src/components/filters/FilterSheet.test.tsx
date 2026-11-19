import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { describe, expect, test } from "@jest/globals";
import FilterSheet from "./FilterSheet";
import FilterButton from "./FilterButton";
import ActiveFilterBar from "./ActiveFilterBar";
import { ThemeProvider } from "../../theme";
import {
  emptyFilters,
  type FilterFacet,
  type FilterableList,
  type RecordFilters,
} from "../../filters/recordFilters";
import {
  NO_OPTIONS,
  type FilterOption,
  type FilterOptionList,
  type FilterSheetOptions,
} from "../../filters/filterOptions";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" => {
      return "light";
    },
  };
});

/*
 * The filter sheet: what it offers for each list, that nothing applies
 * until Show results, that Clear all and a section's Clear only change the
 * draft, and that it opens on the filters in force. The button and the
 * chips under the search say how many filters are on and take one off.
 */

function list(options: Array<FilterOption>): FilterOptionList {
  return { options: options, isLoading: false, isError: false };
}

const OPTIONS: FilterSheetOptions = {
  people: list([
    { id: "u-priya", label: "Priya Shah", detail: "priya@example.test" },
  ]),
  teams: list([{ id: "t-platform", label: "Platform" }]),
  states: list([
    { id: "s-open", label: "Investigating", dotColor: "#ff8585" },
    { id: "s-done", label: "Resolved", dotColor: "#5bd6a2" },
  ]),
  severities: list([
    { id: "sev-critical", label: "Critical", dotColor: "#ff0000" },
    { id: "sev-minor", label: "Minor" },
  ]),
  labels: list([{ id: "l-payments", label: "payments" }]),
  monitors: list([{ id: "m-api", label: "Checkout API" }]),
  monitorTypes: list([{ id: "Website", label: "Website" }]),
};

async function renderSheet(
  overrides: Partial<React.ComponentProps<typeof FilterSheet>> = {},
): Promise<{ onApply: jest.Mock; onClose: jest.Mock }> {
  const onApply: jest.Mock = jest.fn();
  const onClose: jest.Mock = jest.fn();
  await render(
    <ThemeProvider>
      <FilterSheet
        visible
        list="incidents"
        noun="incidents"
        value={emptyFilters()}
        options={OPTIONS}
        canFilterByMe
        onApply={onApply}
        onClose={onClose}
        {...overrides}
      />
    </ThemeProvider>,
  );
  return { onApply: onApply, onClose: onClose };
}

function lastApplied(onApply: jest.Mock): RecordFilters {
  return onApply.mock.calls[
    onApply.mock.calls.length - 1
  ]?.[0] as RecordFilters;
}

describe("FilterSheet", () => {
  test("is titled for the list and lists its sections in the sheet's order", async () => {
    await renderSheet();
    expect(screen.getByText("Filter incidents")).toBeTruthy();
    const sections: Array<FilterFacet> = [
      "owner",
      "severity",
      "state",
      "label",
      "monitor",
    ];
    sections.forEach((facet: FilterFacet): void => {
      expect(screen.getByTestId(`filter-section-${facet}`)).toBeTruthy();
    });
    expect(screen.queryByTestId("filter-section-monitorType")).toBeNull();
  });

  test.each([
    [
      "incidentEpisodes",
      ["owner", "severity", "state", "label"],
      ["monitor", "monitorType"],
    ],
    [
      "monitors",
      ["owner", "state", "monitorType", "label"],
      ["severity", "monitor"],
    ],
  ] as Array<[FilterableList, Array<FilterFacet>, Array<FilterFacet>]>)(
    "%s offers only its own facets",
    async (
      listKind: FilterableList,
      shown: Array<FilterFacet>,
      hidden: Array<FilterFacet>,
    ) => {
      await renderSheet({ list: listKind });
      shown.forEach((facet: FilterFacet): void => {
        expect(screen.getByTestId(`filter-section-${facet}`)).toBeTruthy();
      });
      hidden.forEach((facet: FilterFacet): void => {
        expect(screen.queryByTestId(`filter-section-${facet}`)).toBeNull();
      });
    },
  );

  test("a monitor's state is called its Status", async () => {
    await renderSheet({ list: "monitors", noun: "monitors" });
    expect(screen.getByText("Status")).toBeTruthy();
    expect(screen.queryByText("State")).toBeNull();
  });

  test("nothing applies until Show results, and then the picks are handed back", async () => {
    const { onApply } = await renderSheet();
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(
      screen.getByTestId("filter-option-severity-sev-critical"),
    );
    await fireEvent.press(
      screen.getByTestId("filter-option-owner-team-t-platform"),
    );
    await fireEvent.press(screen.getByTestId("filter-option-label-l-payments"));
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(lastApplied(onApply)).toEqual({
      ...emptyFilters(),
      ownedByMe: true,
      ownerTeamIds: ["t-platform"],
      severityIds: ["sev-critical"],
      labelIds: ["l-payments"],
    });
  });

  test("a value pressed twice is off again", async () => {
    const { onApply } = await renderSheet();
    await fireEvent.press(screen.getByTestId("filter-option-state-s-open"));
    await fireEvent.press(screen.getByTestId("filter-option-state-s-open"));
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(lastApplied(onApply).stateIds).toEqual([]);
  });

  test("opens on the filters in force, picked values marked", async () => {
    await renderSheet({
      value: { ...emptyFilters(), severityIds: ["sev-minor"], ownedByMe: true },
    });
    expect(
      screen.getByTestId("filter-option-severity-sev-minor").props
        .accessibilityState,
    ).toEqual({ selected: true });
    expect(
      screen.getByTestId("filter-option-severity-sev-critical").props
        .accessibilityState,
    ).toEqual({ selected: false });
    expect(
      screen.getByTestId("filter-option-owner-me").props.accessibilityState,
    ).toEqual({ selected: true });
  });

  test("Clear all empties the draft, which Show results then applies", async () => {
    const { onApply } = await renderSheet({
      value: { ...emptyFilters(), severityIds: ["sev-minor"] },
    });
    await fireEvent.press(screen.getByTestId("filter-sheet-clear"));
    expect(onApply).not.toHaveBeenCalled();
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(lastApplied(onApply)).toEqual(emptyFilters());
  });

  test("a section's Clear takes only that section off", async () => {
    const { onApply } = await renderSheet({
      value: {
        ...emptyFilters(),
        severityIds: ["sev-minor"],
        labelIds: ["l-payments"],
      },
    });
    await fireEvent.press(screen.getByTestId("filter-section-severity-clear"));
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(lastApplied(onApply)).toEqual({
      ...emptyFilters(),
      labelIds: ["l-payments"],
    });
  });

  test("closing hands nothing back", async () => {
    const { onApply, onClose } = await renderSheet();
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(screen.getByTestId("filter-sheet-close"));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  test("You is offered only when the reader is known", async () => {
    await renderSheet({ canFilterByMe: false });
    expect(screen.queryByTestId("filter-option-owner-me")).toBeNull();
    expect(
      screen.getByTestId("filter-option-owner-team-t-platform"),
    ).toBeTruthy();
  });

  test("a section still loading says so, and one that failed offers a retry", async () => {
    const onRetry: jest.Mock = jest.fn();
    await renderSheet({
      options: {
        ...OPTIONS,
        labels: { ...NO_OPTIONS, isLoading: true },
        severities: { ...NO_OPTIONS, isError: true, onRetry: onRetry },
      },
    });
    expect(screen.getByText("Loading labels…")).toBeTruthy();
    expect(screen.getByText("Could not load severity.")).toBeTruthy();
    await fireEvent.press(screen.getByLabelText("Retry loading severity"));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  test("a project with no labels says so instead of an empty section", async () => {
    await renderSheet({
      options: {
        ...OPTIONS,
        labels: {
          ...NO_OPTIONS,
          emptyMessage: "No labels in this project yet.",
        },
      },
    });
    expect(screen.getByText("No labels in this project yet.")).toBeTruthy();
  });

  test("a long section can be searched, and keeps a picked value in sight", async () => {
    const many: Array<FilterOption> = Array.from(
      { length: 30 },
      (_: unknown, index: number) => {
        return { id: `l-${index}`, label: `label-${index}` };
      },
    );
    await renderSheet({ options: { ...OPTIONS, labels: list(many) } });
    expect(screen.getByText("14 more. Search to find one.")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("filter-option-label-l-3"));
    await fireEvent.changeText(
      screen.getByTestId("filter-search-label"),
      "label-29",
    );
    expect(screen.getByTestId("filter-option-label-l-3")).toBeTruthy();
    expect(screen.getByTestId("filter-option-label-l-29")).toBeTruthy();
    expect(screen.queryByTestId("filter-option-label-l-4")).toBeNull();
  });

  test("every value is a 48-point toggle with a name a screen reader can say", async () => {
    await renderSheet();
    const chip: ReturnType<typeof screen.getByTestId> = screen.getByTestId(
      "filter-option-severity-sev-critical",
    );
    expect(chip.props.accessibilityLabel).toBe("Severity: Critical");
    expect(chip.props.accessibilityRole).toBe("button");
  });
});

describe("FilterButton", () => {
  test("says Filter, and how many filters are on", async () => {
    const onPress: jest.Mock = jest.fn();
    const { rerender } = await render(
      <ThemeProvider>
        <FilterButton activeCount={0} noun="alerts" onPress={onPress} />
      </ThemeProvider>,
    );
    expect(screen.getByText("Filter")).toBeTruthy();
    expect(screen.getByLabelText("Filter alerts")).toBeTruthy();
    expect(screen.queryByTestId("list-filter-button-count")).toBeNull();
    await rerender(
      <ThemeProvider>
        <FilterButton activeCount={2} noun="alerts" onPress={onPress} />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Filter alerts, 2 filters on")).toBeTruthy();
    expect(screen.getByTestId("list-filter-button-count")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });
});

describe("ActiveFilterBar", () => {
  test("each filter says what it keeps, opens the sheet, and comes off on its own", async () => {
    const onOpen: jest.Mock = jest.fn();
    const onRemove: jest.Mock = jest.fn();
    await render(
      <ThemeProvider>
        <ActiveFilterBar
          items={[
            { facet: "owner", title: "Owner", summary: "You" },
            {
              facet: "severity",
              title: "Severity",
              summary: "Critical or Major",
            },
          ]}
          onOpen={onOpen}
          onRemove={onRemove}
        />
      </ThemeProvider>,
    );
    expect(screen.getByLabelText("Owner: You")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("active-filter-severity-open"));
    expect(onOpen).toHaveBeenCalledWith("severity");
    await fireEvent.press(screen.getByLabelText("Remove Owner filter"));
    expect(onRemove).toHaveBeenCalledWith("owner");
  });

  test("draws nothing while no filter is on", async () => {
    await render(
      <ThemeProvider>
        <ActiveFilterBar items={[]} onOpen={jest.fn()} onRemove={jest.fn()} />
      </ThemeProvider>,
    );
    expect(screen.queryByTestId("active-filter-bar")).toBeNull();
  });
});
