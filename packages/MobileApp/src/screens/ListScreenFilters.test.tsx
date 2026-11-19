import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import IncidentsScreen from "./IncidentsScreen";
import MonitorsScreen from "./MonitorsScreen";
import { ThemeProvider } from "../theme";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeIncident,
  makeMonitor,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import { emptyFilters, type RecordFilters } from "../filters/recordFilters";
import type {
  FilterOptionList,
  FilterSheetOptions,
} from "../filters/filterOptions";
import type {
  IncidentState,
  ProjectIncidentItem,
  ProjectMonitorItem,
} from "../api/types";

/*
 * The filters on the lists, from the button beside the search to the
 * request: what the sheet hands back is what the list hooks are asked for,
 * the chips under the search say what is on and take a filter off, Reset
 * and a count on Home clear them, and a state picked in the sheet puts the
 * Active / Resolved chip back to All so the two cannot contradict each other
 * into an empty list. The hooks are stand-ins that record what they are
 * asked; the requests themselves are api/recordFilters.test.ts's.
 */

const PROJECT_ID: string = "project-1";
const CREATED: string = "state-created";
const RESOLVED: string = "state-resolved";

const mockIncidentFilters: Array<RecordFilters | undefined> = [];
const mockEpisodeFilters: Array<RecordFilters | undefined> = [];
const mockMonitorFilters: Array<RecordFilters | undefined> = [];
const mockRoute: { params: Record<string, unknown> | undefined } = {
  params: undefined,
};
const mockIncidentRows: { current: Array<ProjectIncidentItem> } = {
  current: [],
};
const mockMonitorRows: { current: Array<ProjectMonitorItem> } = {
  current: [],
};

function lastOf<T>(list: Array<T>): T | undefined {
  return list[list.length - 1];
}

jest.mock("../hooks/useAllProjectIncidents", () => {
  return {
    useAllProjectIncidents: (filters?: RecordFilters) => {
      mockIncidentFilters.push(filters);
      return {
        items: mockIncidentRows.current,
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      };
    },
  };
});

jest.mock("../hooks/useAllProjectIncidentEpisodes", () => {
  return {
    useAllProjectIncidentEpisodes: (filters?: RecordFilters) => {
      mockEpisodeFilters.push(filters);
      return {
        items: [],
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      };
    },
  };
});

jest.mock("../hooks/useAllProjectIncidentStates", () => {
  const { makeIncidentState: makeState } = jest.requireActual(
    "../__tests__/testSupport",
  );
  const states: Array<IncidentState> = [
    makeState({
      _id: "state-created",
      name: "Investigating",
      isCreatedState: true,
      order: 1,
    }),
    makeState({
      _id: "state-resolved",
      name: "Resolved",
      isCreatedState: false,
      isResolvedState: true,
      order: 2,
    }),
  ];
  return {
    useAllProjectIncidentStates: () => {
      return {
        statesMap: new Map([["project-1", states]]),
        isLoading: false,
        isError: false,
      };
    },
  };
});

jest.mock("../hooks/useAllProjectMonitors", () => {
  return {
    useAllProjectMonitors: (filters?: RecordFilters) => {
      mockMonitorFilters.push(filters);
      return {
        items: mockMonitorRows.current,
        isLoading: false,
        isError: false,
        refetch: async (): Promise<void> => {
          return undefined;
        },
      };
    },
  };
});

jest.mock("../hooks/useFilterOptions", () => {
  const list: (
    options: Array<{ id: string; label: string }>,
  ) => FilterOptionList = (
    options: Array<{ id: string; label: string }>,
  ): FilterOptionList => {
    return { options: options, isLoading: false, isError: false };
  };
  return {
    useFilterOptions: (): FilterSheetOptions => {
      return {
        people: list([{ id: "user-priya", label: "Priya Shah" }]),
        teams: list([{ id: "team-platform", label: "Platform" }]),
        states: list([
          { id: "state-created", label: "Investigating" },
          { id: "state-resolved", label: "Resolved" },
        ]),
        severities: list([
          { id: "sev-critical", label: "Critical" },
          { id: "sev-minor", label: "Minor" },
        ]),
        labels: list([{ id: "label-payments", label: "payments" }]),
        monitors: list([{ id: "monitor-api", label: "Checkout API" }]),
        monitorTypes: list([
          { id: "Website", label: "Website" },
          { id: "API", label: "API" },
        ]),
      };
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 120;
    },
  };
});

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" => {
      return "light";
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useRoute: () => {
      return mockRoute;
    },
    useNavigation: () => {
      return { navigate: jest.fn(), setParams: jest.fn() };
    },
  };
});

function incident(
  id: string,
  title: string,
  stateId: string,
): ProjectIncidentItem {
  return {
    item: makeIncident({
      _id: id,
      title: title,
      currentIncidentState: makeNamedEntityWithColor({
        _id: stateId,
        name: stateId === RESOLVED ? "Resolved" : "Investigating",
      }),
    }),
    projectId: PROJECT_ID,
    projectName: "Acme Production",
  };
}

async function renderWithProviders(
  element: React.ReactElement,
): Promise<Awaited<ReturnType<typeof render>>> {
  const QueryWrapper: ReturnType<typeof createQueryWrapper> =
    createQueryWrapper(createTestQueryClient());
  return await render(<ThemeProvider>{element}</ThemeProvider>, {
    wrapper: QueryWrapper,
  });
}

beforeEach(() => {
  mockIncidentFilters.length = 0;
  mockEpisodeFilters.length = 0;
  mockMonitorFilters.length = 0;
  mockRoute.params = undefined;
  mockIncidentRows.current = [
    incident("incident-1", "Checkout is down", CREATED),
    incident("incident-2", "Search was slow", RESOLVED),
  ];
  mockMonitorRows.current = [];
});

describe("Incidents: the Filter button and its sheet", () => {
  test("starts with no filters, and the lists are asked for none", async () => {
    await renderWithProviders(<IncidentsScreen />);
    expect(screen.getByLabelText("Filter incidents")).toBeTruthy();
    expect(screen.queryByTestId("active-filter-bar")).toBeNull();
    expect(lastOf(mockIncidentFilters)).toEqual(emptyFilters());
  });

  test("what the sheet hands back is what the lists are asked for, and the chips say so", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    expect(screen.getByText("Filter incidents")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(
      screen.getByTestId("filter-option-severity-sev-critical"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));

    const asked: RecordFilters | undefined = lastOf(mockIncidentFilters);
    expect(asked?.ownedByMe).toBe(true);
    expect(asked?.severityIds).toEqual(["sev-critical"]);
    // The episodes are asked with the same filters: "You" carries over.
    expect(lastOf(mockEpisodeFilters)?.ownedByMe).toBe(true);

    expect(screen.getByLabelText("Owner: You")).toBeTruthy();
    expect(screen.getByLabelText("Severity: Critical")).toBeTruthy();
    expect(
      screen.getByLabelText("Filter incidents, 2 filters on"),
    ).toBeTruthy();
  });

  test("a chip's cross takes its filter off, and Reset takes them all", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(
      screen.getByTestId("filter-option-label-label-payments"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));

    await fireEvent.press(screen.getByLabelText("Remove Owner filter"));
    expect(lastOf(mockIncidentFilters)?.ownedByMe).toBe(false);
    expect(lastOf(mockIncidentFilters)?.labelIds).toEqual(["label-payments"]);
    expect(screen.queryByLabelText("Owner: You")).toBeNull();

    await fireEvent.press(screen.getByLabelText("Reset filters"));
    expect(lastOf(mockIncidentFilters)).toEqual(emptyFilters());
    expect(screen.queryByTestId("active-filter-bar")).toBeNull();
  });

  test("a chip opens the sheet on the filters in force", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(
      screen.getByTestId("filter-option-severity-sev-minor"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    await fireEvent.press(screen.getByTestId("active-filter-severity-open"));
    expect(
      screen.getByTestId("filter-option-severity-sev-minor").props
        .accessibilityState,
    ).toEqual({ selected: true });
  });

  test("closing the sheet leaves the list as it was", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(screen.getByTestId("filter-sheet-close"));
    expect(lastOf(mockIncidentFilters)).toEqual(emptyFilters());
    expect(screen.queryByTestId("active-filter-bar")).toBeNull();
  });

  test("picking a state in the sheet puts the Active / Resolved chip back to All", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByLabelText("Active only"));
    expect(screen.queryByText("Search was slow")).toBeNull();

    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(
      screen.getByTestId("filter-option-state-state-resolved"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));

    expect(
      screen.getByLabelText("All states").props.accessibilityState,
    ).toEqual({ selected: true });
    expect(lastOf(mockIncidentFilters)?.stateIds).toEqual(["state-resolved"]);
  });

  test("a filter that hides every row says nothing matched, and clears in one tap", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    mockIncidentRows.current = [];
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(screen.getByText("No matching incidents")).toBeTruthy();
    await fireEvent.press(screen.getByText("Clear filters"));
    expect(lastOf(mockIncidentFilters)).toEqual(emptyFilters());
  });

  test("a count on Home opens every record it counted: its params clear the filters", async () => {
    const view: Awaited<ReturnType<typeof render>> = await renderWithProviders(
      <IncidentsScreen />,
    );
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(lastOf(mockIncidentFilters)?.ownedByMe).toBe(true);

    mockRoute.params = { initialSegment: "incidents", initialFilter: "active" };
    await view.rerender(
      <ThemeProvider>
        <IncidentsScreen />
      </ThemeProvider>,
    );
    expect(lastOf(mockIncidentFilters)).toEqual(emptyFilters());
  });

  test("the episodes' sheet has no Monitors, and leaves the incidents' Monitors filter alone", async () => {
    await renderWithProviders(<IncidentsScreen />);
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(
      screen.getByTestId("filter-option-monitor-monitor-api"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(lastOf(mockIncidentFilters)?.monitorIds).toEqual(["monitor-api"]);

    await fireEvent.press(screen.getByRole("button", { name: "Episodes" }));
    // Not counted for the episodes, who are not filtered by it.
    expect(screen.getByLabelText("Filter episodes")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    expect(screen.queryByTestId("filter-section-monitor")).toBeNull();
    await fireEvent.press(screen.getByTestId("filter-option-owner-me"));
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));

    const asked: RecordFilters | undefined = lastOf(mockIncidentFilters);
    expect(asked?.ownedByMe).toBe(true);
    expect(asked?.monitorIds).toEqual(["monitor-api"]);
  });
});

describe("Monitors: the Filter button and its sheet", () => {
  test("filters by type and status, and says the 100 rows are the newest that match", async () => {
    mockMonitorRows.current = Array.from(
      { length: 100 },
      (_: unknown, index: number) => {
        return {
          item: makeMonitor({
            _id: `monitor-${index}`,
            name: `Monitor ${index}`,
          }),
          projectId: PROJECT_ID,
          projectName: "Acme Production",
        };
      },
    );
    await renderWithProviders(<MonitorsScreen />);
    expect(
      screen.getByText("Search covers the 100 most recent monitors."),
    ).toBeTruthy();
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    expect(screen.getByText("Filter monitors")).toBeTruthy();
    expect(screen.queryByTestId("filter-section-severity")).toBeNull();
    await fireEvent.press(
      screen.getByTestId("filter-option-monitorType-Website"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));

    expect(lastOf(mockMonitorFilters)?.monitorTypes).toEqual(["Website"]);
    expect(screen.getByLabelText("Type: Website")).toBeTruthy();
    expect(
      screen.getByText(
        "Showing the 100 newest monitors that match your filters.",
      ),
    ).toBeTruthy();
  });

  test("picking a status puts the health chip back to All, and Clear filters takes everything off", async () => {
    await renderWithProviders(<MonitorsScreen />);
    await fireEvent.press(screen.getByLabelText("Has issues"));
    await fireEvent.press(screen.getByTestId("list-filter-button"));
    await fireEvent.press(
      screen.getByTestId("filter-option-state-state-created"),
    );
    await fireEvent.press(screen.getByTestId("filter-sheet-apply"));
    expect(
      screen.getByLabelText("All monitors").props.accessibilityState,
    ).toEqual({ selected: true });
    expect(lastOf(mockMonitorFilters)?.stateIds).toEqual(["state-created"]);

    expect(screen.getByText("No matching monitors")).toBeTruthy();
    await fireEvent.press(screen.getByText("Clear filters"));
    expect(lastOf(mockMonitorFilters)).toEqual(emptyFilters());
  });
});
