import { renderHook, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { useFilterOptions } from "./useFilterOptions";
import {
  createQueryWrapper,
  createTestQueryClient,
} from "../__tests__/testSupport";
import type { FilterSheetOptions } from "../filters/filterOptions";

/*
 * Where the filter sheet's values come from: read only while they are
 * needed, only for the facets the list asks, for the selected project, and
 * shaped as the sheet shows them - severities in the project's order with
 * their colours, the reader left out of People (You stands for them), a
 * monitor's types as the project uses them.
 */

const mockSelectedProjectId: { current: string | null } = {
  current: "project-1",
};
const mockFetchProjectUsers: jest.Mock = jest.fn();
const mockFetchTeams: jest.Mock = jest.fn();
const mockFetchIncidentStates: jest.Mock = jest.fn();
const mockFetchAlertStates: jest.Mock = jest.fn();
const mockFetchMonitorStatuses: jest.Mock = jest.fn();
const mockFetchSeverities: jest.Mock = jest.fn();
const mockFetchLabels: jest.Mock = jest.fn();
const mockFetchMonitorOptions: jest.Mock = jest.fn();

jest.mock("./useProject", () => {
  return {
    useSelectedProjectId: (): string | null => {
      return mockSelectedProjectId.current;
    },
  };
});

jest.mock("../auth/currentUser", () => {
  return {
    getCurrentUserIdSync: (): string => {
      return "user-me";
    },
  };
});

jest.mock("../api/projectUsers", () => {
  return {
    fetchProjectUsers: (...args: Array<unknown>) => {
      return mockFetchProjectUsers(...args);
    },
  };
});
jest.mock("../api/incidents", () => {
  return {
    fetchIncidentStates: (...args: Array<unknown>) => {
      return mockFetchIncidentStates(...args);
    },
  };
});
jest.mock("../api/alerts", () => {
  return {
    fetchAlertStates: (...args: Array<unknown>) => {
      return mockFetchAlertStates(...args);
    },
  };
});
jest.mock("../api/monitors", () => {
  return {
    fetchMonitorStatuses: (...args: Array<unknown>) => {
      return mockFetchMonitorStatuses(...args);
    },
  };
});
jest.mock("../api/recordFilters", () => {
  return {
    fetchTeams: (...args: Array<unknown>) => {
      return mockFetchTeams(...args);
    },
    fetchSeverities: (...args: Array<unknown>) => {
      return mockFetchSeverities(...args);
    },
    fetchLabels: (...args: Array<unknown>) => {
      return mockFetchLabels(...args);
    },
    fetchMonitorOptions: (...args: Array<unknown>) => {
      return mockFetchMonitorOptions(...args);
    },
  };
});

function wrapper(): ReturnType<typeof createQueryWrapper> {
  return createQueryWrapper(createTestQueryClient());
}

beforeEach(() => {
  mockSelectedProjectId.current = "project-1";
  mockFetchProjectUsers.mockResolvedValue([
    { userId: "user-me", name: "Alex Morgan", email: "alex@example.test" },
    { userId: "user-2", name: "", email: "sam@example.test" },
    { userId: "user-3", name: "Priya Shah", email: "priya@example.test" },
  ]);
  mockFetchTeams.mockResolvedValue([{ _id: "team-1", name: "Platform" }]);
  mockFetchIncidentStates.mockResolvedValue([
    { _id: "s1", name: "Investigating", color: { r: 255, g: 0, b: 0 } },
  ]);
  mockFetchAlertStates.mockResolvedValue([]);
  mockFetchMonitorStatuses.mockResolvedValue([
    { _id: "offline", name: "Offline", color: { r: 255, g: 0, b: 0 } },
  ]);
  mockFetchSeverities.mockResolvedValue([
    { _id: "sev-1", name: "Critical", color: "#ff0000" },
    { _id: "sev-2", name: "Minor" },
  ]);
  mockFetchLabels.mockResolvedValue([{ _id: "l1", name: "payments" }]);
  mockFetchMonitorOptions.mockResolvedValue([
    { _id: "m1", name: "Checkout API", monitorType: "Website" },
    { _id: "m2", name: "Payments worker", monitorType: "Server" },
    { _id: "m3", name: "Docs", monitorType: "Website" },
    { _id: "m4", name: "No type" },
  ]);
});

describe("useFilterOptions", () => {
  test("reads nothing until it is needed", async () => {
    const { result } = await renderHook(
      () => {
        return useFilterOptions("incidents", false);
      },
      { wrapper: wrapper() },
    );
    expect(mockFetchProjectUsers).not.toHaveBeenCalled();
    expect(mockFetchSeverities).not.toHaveBeenCalled();
    expect(mockFetchLabels).not.toHaveBeenCalled();
    expect(result.current.severities.isLoading).toBe(false);
    expect(result.current.severities.options).toEqual([]);
  });

  test("reads nothing without a selected project", async () => {
    mockSelectedProjectId.current = null;
    await renderHook(
      () => {
        return useFilterOptions("incidents", true);
      },
      { wrapper: wrapper() },
    );
    expect(mockFetchProjectUsers).not.toHaveBeenCalled();
    expect(mockFetchTeams).not.toHaveBeenCalled();
  });

  test("an incident list's values, shaped for the sheet", async () => {
    const { result } = await renderHook(
      () => {
        return useFilterOptions("incidents", true);
      },
      { wrapper: wrapper() },
    );
    await waitFor(() => {
      expect(result.current.labels.options.length).toBe(1);
      expect(result.current.monitors.options.length).toBe(4);
    });
    const options: FilterSheetOptions = result.current;
    // The reader is You, never a second time among the people.
    expect(options.people.options).toEqual([
      { id: "user-2", label: "sam@example.test", detail: undefined },
      { id: "user-3", label: "Priya Shah", detail: "priya@example.test" },
    ]);
    expect(options.teams.options).toEqual([
      { id: "team-1", label: "Platform" },
    ]);
    expect(options.severities.options).toEqual([
      { id: "sev-1", label: "Critical", dotColor: "#ff0000" },
      { id: "sev-2", label: "Minor", dotColor: undefined },
    ]);
    expect(options.states.options).toEqual([
      { id: "s1", label: "Investigating", dotColor: "#ff0000" },
    ]);
    expect(mockFetchSeverities).toHaveBeenCalledWith("project-1", "incident");
    expect(mockFetchIncidentStates).toHaveBeenCalledWith("project-1");
    // Incidents have no Type facet.
    expect(options.monitorTypes.options).toEqual([]);
  });

  test("an alert list reads the alert severities and states", async () => {
    const { result } = await renderHook(
      () => {
        return useFilterOptions("alertEpisodes", true);
      },
      { wrapper: wrapper() },
    );
    await waitFor(() => {
      expect(result.current.severities.options.length).toBe(2);
    });
    expect(mockFetchSeverities).toHaveBeenCalledWith("project-1", "alert");
    expect(mockFetchAlertStates).toHaveBeenCalledWith("project-1");
    // Alert episodes have no Monitors facet: the monitors are not read.
    expect(mockFetchMonitorOptions).not.toHaveBeenCalled();
  });

  test("monitors: their statuses, and the types the project uses, each once, by name", async () => {
    const { result } = await renderHook(
      () => {
        return useFilterOptions("monitors", true);
      },
      { wrapper: wrapper() },
    );
    await waitFor(() => {
      expect(result.current.monitorTypes.options.length).toBe(2);
    });
    expect(result.current.monitorTypes.options).toEqual([
      { id: "Server", label: "Server" },
      { id: "Website", label: "Website" },
    ]);
    expect(result.current.states.options).toEqual([
      { id: "offline", label: "Offline", dotColor: "#ff0000" },
    ]);
    // A monitor has no severity.
    expect(mockFetchSeverities).not.toHaveBeenCalled();
    expect(result.current.monitors.options).toEqual([]);
  });

  test("a read that failed says so, and can be tried again", async () => {
    mockFetchLabels.mockRejectedValueOnce(new Error("offline"));
    const { result } = await renderHook(
      () => {
        return useFilterOptions("alerts", true);
      },
      { wrapper: wrapper() },
    );
    await waitFor(() => {
      expect(result.current.labels.isError).toBe(true);
    });
    mockFetchLabels.mockResolvedValueOnce([{ _id: "l9", name: "database" }]);
    result.current.labels.onRetry?.();
    await waitFor(() => {
      expect(result.current.labels.options).toEqual([
        { id: "l9", label: "database", dotColor: undefined },
      ]);
    });
  });
});
