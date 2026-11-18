import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import {
  chooseDropdownOption,
  clearDropdown,
  getDropdownContainer,
  getShownDropdownPlaceholder,
  getShownDropdownValue,
  hasDropdownClearControl,
  listDropdownOptions,
  openDropdown,
} from "../../DropdownPicks";
import Modal from "../../../UI/Components/Modal/Modal";
import Dropdown, {
  DROPDOWN_COMPACT_CONTROL_HEIGHT_CLASS_NAME,
} from "../../../UI/Components/Dropdown/Dropdown";
import AnalyticsQueryPicker, {
  getAnalyticsQueryPickerClassName,
} from "../../../UI/Components/TelemetryViewer/components/AnalyticsQueryPicker";
import DashboardVariableControl, {
  VariableValueChange,
} from "../../../UI/Components/Dashboard/DashboardVariableControl";
import { DashboardVariableType } from "../../../Types/Dashboard/DashboardVariable";
import { AutoRefreshInterval } from "../../../Types/Dashboard/DashboardViewConfig";
import AutoRefreshControl from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl";
import ProfileTypeSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Profiles/ProfileTypeSelector";
import InsightFilterBar from "../../../../App/FeatureSet/Dashboard/src/Components/AIInsights/InsightFilterBar";
import { FilterBar } from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineToolbar";
import {
  ALL_TEAMS,
  DEFAULT_FILTERS,
  MY_TEAMS,
  TimelineFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel";
import MerakiReadIntervalPicker from "../../../../App/FeatureSet/Dashboard/src/Components/NetworkTraffic/Meraki/MerakiReadIntervalPicker";

/*
 * The last 21 raw <select>s (#9310) are the shared Dropdown, and keep what
 * they did: their values and defaults, a clear control only where a value
 * may be empty (its empty choice is the placeholder), and a name a screen
 * reader says.
 */

afterEach(() => {
  cleanup();
});

describe("a compact picker", () => {
  test("is 28px in a bar of small controls, 44px under a finger, with the bar's small words", () => {
    render(
      <Dropdown
        ariaLabel="Rows"
        isCompact={true}
        options={[{ value: "10", label: "10", isUserContent: true }]}
        value={{ value: "10", label: "10", isUserContent: true }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Rows",
    });
    const control: Element = getDropdownContainer(combobox).querySelector(
      ".ou-select__control",
    )!;

    expect(DROPDOWN_COMPACT_CONTROL_HEIGHT_CLASS_NAME).toContain(
      "!min-h-[28px]",
    );
    expect(DROPDOWN_COMPACT_CONTROL_HEIGHT_CLASS_NAME).toContain(
      "[@media(pointer:coarse)]:!min-h-11",
    );
    for (const name of DROPDOWN_COMPACT_CONTROL_HEIGHT_CLASS_NAME.split(" ")) {
      expect(control).toHaveClass(name);
    }
    expect(control).not.toHaveClass("!min-h-[40px]");
    expect(
      getDropdownContainer(combobox).querySelector(".ou-select__single-value"),
    ).toHaveClass("text-xs");
  });

  test("a form's picker keeps its 40px", () => {
    render(<Dropdown ariaLabel="Region" options={[]} />);

    expect(
      getDropdownContainer(
        screen.getByRole("combobox", { name: "Region" }),
      ).querySelector(".ou-select__control"),
    ).toHaveClass("!min-h-[40px]");
  });
});

describe("a picker in a dialog", () => {
  const renderDialog: (onClose: () => void) => HTMLElement = (
    onClose: () => void,
  ): HTMLElement => {
    render(
      <Modal title="Pick a region" onClose={onClose} onSubmit={() => {}}>
        <Dropdown
          ariaLabel="Region"
          isClearable={false}
          options={[{ value: "eu", label: "Europe", isUserContent: true }]}
          value={{ value: "eu", label: "Europe", isUserContent: true }}
        />
      </Modal>,
    );

    return screen.getByRole("combobox", { name: "Region" });
  };

  test("Escape with its menu closed closes the dialog, as it did from a <select>", () => {
    let closed: number = 0;
    const combobox: HTMLElement = renderDialog(() => {
      closed += 1;
    });

    fireEvent.keyDown(combobox, { key: "Escape", code: "Escape" });

    expect(closed).toBe(1);
  });

  test("Escape with its menu open closes the menu, and leaves the dialog open", () => {
    let closed: number = 0;
    const combobox: HTMLElement = renderDialog(() => {
      closed += 1;
    });

    openDropdown(combobox);
    expect(screen.getAllByRole("option").length).toBeGreaterThan(0);

    fireEvent.keyDown(combobox, { key: "Escape", code: "Escape" });

    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(closed).toBe(0);
  });
});

describe("an analytics query builder's picker", () => {
  test("its empty choice is the placeholder, and clearing picks it", () => {
    const picked: Array<string> = [];

    render(
      <AnalyticsQueryPicker
        ariaLabel="Group by"
        value="service"
        labels="named"
        options={[
          { value: "", label: "None" },
          { value: "service", label: "service" },
          { value: "http.status_code", label: "http.status_code" },
        ]}
        onChange={(value: string) => {
          picked.push(value);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Group by",
    });

    expect(getShownDropdownValue(combobox)).toBe("service");
    expect(hasDropdownClearControl(combobox)).toBe(true);

    clearDropdown(combobox);
    expect(picked).toEqual([""]);
  });

  test("an empty value shows the placeholder", () => {
    render(
      <AnalyticsQueryPicker
        ariaLabel="then by"
        value=""
        labels="named"
        options={[
          { value: "", label: "None" },
          { value: "service", label: "service" },
        ]}
        onChange={() => {}}
      />,
    );

    expect(getShownDropdownPlaceholder(screen.getByRole("combobox"))).toBe(
      "None",
    );
  });

  test("a picker with no empty choice has no clear control, and a number is a pick like any other", () => {
    const picked: Array<string> = [];

    render(
      <AnalyticsQueryPicker
        ariaLabel="Limit"
        value={10}
        labels="translated"
        options={[
          { value: 10, label: "10" },
          { value: 25, label: "25" },
        ]}
        onChange={(value: string) => {
          picked.push(value);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Limit",
    });

    expect(getShownDropdownValue(combobox)).toBe("10");
    expect(hasDropdownClearControl(combobox)).toBe(false);

    chooseDropdownOption(combobox, "10");
    chooseDropdownOption(combobox, "25");
    expect(picked).toEqual(["25"]);
  });

  test("a number list is narrow, a field list wide enough for a name", () => {
    expect(
      getAnalyticsQueryPickerClassName([{ value: 10, label: "10" }]),
    ).toContain("w-20");
    expect(
      getAnalyticsQueryPickerClassName([
        { value: "service", label: "service" },
      ]),
    ).toContain("w-44");
  });
});

describe("a dashboard variable's single picker", () => {
  test('"All" is the placeholder; a pick stores its value, and clearing stores ""', () => {
    const changes: Array<VariableValueChange> = [];

    render(
      <DashboardVariableControl
        variable={{
          id: "env",
          name: "env",
          label: "Environment",
          type: DashboardVariableType.CustomList,
          customListValues: "prod, staging",
          selectedValue: "prod",
        }}
        onVariableValueChange={(_id: string, change: VariableValueChange) => {
          changes.push(change);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Environment",
    });

    expect(getShownDropdownValue(combobox)).toBe("prod");

    chooseDropdownOption(combobox, "staging");
    clearDropdown(combobox);

    expect(changes).toEqual([
      { selectedValue: "staging" },
      { selectedValue: "" },
    ]);
  });

  test('an empty selection reads "All", and never falls back to the default', () => {
    render(
      <DashboardVariableControl
        variable={{
          id: "env",
          name: "env",
          type: DashboardVariableType.CustomList,
          customListValues: "prod, staging",
          selectedValue: "",
          defaultValue: "prod",
        }}
        onVariableValueChange={() => {}}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "env",
    });

    expect(getShownDropdownValue(combobox)).toBeNull();
    expect(getShownDropdownPlaceholder(combobox)).toBe("All");
  });

  test("a project label the list no longer has is shown as unavailable", async () => {
    render(
      <DashboardVariableControl
        variable={{
          id: "team",
          name: "team",
          type: DashboardVariableType.ProjectLabel,
          selectedValue: "gone-label-id",
          labelOptions: [{ label: "Payments", value: "payments-id" }],
        }}
        onVariableValueChange={() => {}}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "team",
    });

    expect(getShownDropdownValue(combobox)).toBe("Unavailable label");
    expect(await listDropdownOptions(combobox)).toEqual([
      "Unavailable label",
      "Payments",
    ]);
  });
});

describe("the infrastructure pages' auto-refresh", () => {
  test("is named, shows the interval, offers each in words, and is never cleared", async () => {
    const picked: Array<AutoRefreshInterval> = [];

    render(
      <AutoRefreshControl
        autoRefreshInterval={AutoRefreshInterval.OFF}
        onAutoRefreshIntervalChange={(interval: AutoRefreshInterval) => {
          picked.push(interval);
        }}
        onManualRefresh={() => {}}
        isRefreshing={false}
        lastRefreshedAt={null}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Auto-refresh",
    });

    expect(getShownDropdownValue(combobox)).toBe("Off");
    expect(hasDropdownClearControl(combobox)).toBe(false);
    expect((await listDropdownOptions(combobox))[0]).toBe("Off");

    chooseDropdownOption(combobox, /30/);
    expect(picked).toEqual([AutoRefreshInterval.THIRTY_SECONDS]);
  });
});

describe("the profiles' specific type", () => {
  test("a category from a pill shows the placeholder; a pick hands over the type, clearing nothing", () => {
    const picked: Array<string | undefined> = [];

    render(
      <ProfileTypeSelector
        selectedProfileType="cpu"
        onChange={(type: string | undefined) => {
          picked.push(type);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Pick a specific profile type",
    });

    expect(getShownDropdownPlaceholder(combobox)).toBe("Specific type…");

    chooseDropdownOption(combobox, "Wall time");
    expect(picked).toEqual(["wall"]);
  });

  test("a specific type is shown, and clearing it is any type again", () => {
    const picked: Array<string | undefined> = [];

    render(
      <ProfileTypeSelector
        selectedProfileType="goroutine"
        onChange={(type: string | undefined) => {
          picked.push(type);
        }}
      />,
    );

    const combobox: HTMLElement = screen.getByRole("combobox");

    expect(getShownDropdownValue(combobox)).toBe("Goroutines");
    clearDropdown(combobox);
    expect(picked).toEqual([undefined]);
  });
});

describe("the AI insights filter bar", () => {
  const renderBar: (
    typeValue: string,
    onTypeChange: (value: string) => void,
  ) => void = (
    typeValue: string,
    onTypeChange: (value: string) => void,
  ): void => {
    render(
      <InsightFilterBar
        searchText=""
        onSearchTextChange={() => {}}
        typeOptions={[
          { label: "All types", value: "All" },
          { label: "Latency Regression", value: "LatencyRegression" },
        ]}
        typeValue={typeValue}
        onTypeChange={onTypeChange}
        severityOptions={[{ label: "Any severity", value: "All" }]}
        severityValue="All"
        onSeverityChange={() => {}}
        seenWithinOptions={[{ label: "Any time", value: "All" }]}
        seenWithinValue="All"
        onSeenWithinChange={() => {}}
        sortOptions={[
          { label: "Newest first", value: "newest" },
          { label: "Oldest first", value: "oldest" },
        ]}
        sortValue="newest"
        onSortChange={() => {}}
        unfilteredValue="All"
        hasActiveFilters={typeValue !== "All"}
        onClearFilters={() => {}}
      />,
    );
  };

  test("a filter that narrows nothing shows its placeholder; one that does, its choice and a clear control", () => {
    const picked: Array<string> = [];
    renderBar("LatencyRegression", (value: string) => {
      picked.push(value);
    });

    const type: HTMLElement = screen.getByRole("combobox", {
      name: "Filter by insight type",
    });
    const severity: HTMLElement = screen.getByRole("combobox", {
      name: "Filter by severity",
    });

    expect(getShownDropdownValue(type)).toBe("Latency Regression");
    expect(hasDropdownClearControl(type)).toBe(true);
    expect(getShownDropdownPlaceholder(severity)).toBe("Any severity");

    clearDropdown(type);
    expect(picked).toEqual(["All"]);
  });

  test("the order is always set", () => {
    renderBar("All", () => {});

    const sort: HTMLElement = screen.getByRole("combobox", {
      name: "Sort insights",
    });

    expect(getShownDropdownValue(sort)).toBe("Newest first");
    expect(hasDropdownClearControl(sort)).toBe(false);
  });
});

describe("the on-call timeline's team filter", () => {
  const renderFilterBar: (
    filters: TimelineFilters,
    onFiltersChange: (filters: TimelineFilters) => void,
  ) => void = (
    filters: TimelineFilters,
    onFiltersChange: (filters: TimelineFilters) => void,
  ): void => {
    render(
      <FilterBar
        filters={filters}
        onFiltersChange={onFiltersChange}
        teams={[
          { id: "team-a", name: "Payments", isCurrentUserMember: true },
          { id: "team-b", name: "Search", isCurrentUserMember: false },
        ]}
        isTeamLocked={false}
        groupByTeam={false}
        onGroupByTeamChange={() => {}}
        hasActiveFilters={false}
        onClearFilters={() => {}}
      />,
    );
  };

  test('"All teams" is the placeholder; "My teams" comes first, then each team by its name', async () => {
    renderFilterBar(DEFAULT_FILTERS, () => {});

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Filter by team",
    });

    expect(getShownDropdownPlaceholder(combobox)).toBe("All teams");
    expect(await listDropdownOptions(combobox)).toEqual([
      "My teams",
      "Payments",
      "Search",
    ]);
  });

  test("a pick filters by the team; clearing returns to every team", () => {
    const changes: Array<string> = [];

    renderFilterBar(
      { ...DEFAULT_FILTERS, team: MY_TEAMS },
      (filters: TimelineFilters) => {
        changes.push(filters.team);
      },
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Filter by team",
    });

    expect(getShownDropdownValue(combobox)).toBe("My teams");

    chooseDropdownOption(combobox, "Search");
    clearDropdown(combobox);

    expect(changes).toEqual(["team-b", ALL_TEAMS]);
  });
});

// A number keeps its unit on its line (a no-break space), and may be set apart for the reading direction.
const asPlainText: (text: string | null) => string | null = (
  text: string | null,
): string | null => {
  return text === null
    ? null
    : text.replace(/[\u2066-\u2069]/g, "").replace(/\u00a0/g, " ");
};

describe("Meraki's read interval", () => {
  test("is named by its label, never cleared, and a pick hands over minutes", () => {
    const picked: Array<number> = [];

    render(
      <>
        <label htmlFor="meraki-test-interval">Read uplink usage</label>
        <MerakiReadIntervalPicker
          inputId="meraki-test-interval"
          dataTestId="meraki-test-interval"
          value={5}
          onChange={(minutes: number) => {
            picked.push(minutes);
          }}
        />
      </>,
    );

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Read uplink usage",
    });

    expect(asPlainText(getShownDropdownValue(combobox))).toBe(
      "Every 5 minutes",
    );
    expect(hasDropdownClearControl(combobox)).toBe(false);

    chooseDropdownOption(combobox, "Every hour");
    expect(picked).toEqual([60]);
  });

  test("an interval the list no longer offers is still shown in its words", () => {
    render(
      <MerakiReadIntervalPicker
        inputId="meraki-test-interval"
        dataTestId="meraki-test-interval"
        value={7}
        onChange={() => {}}
      />,
    );

    expect(
      asPlainText(getShownDropdownValue(screen.getByRole("combobox"))),
    ).toBe("Every 7 minutes");
  });
});
