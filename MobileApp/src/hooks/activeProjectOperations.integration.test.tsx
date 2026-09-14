import { act, renderHook, waitFor } from "@testing-library/react-native";
import { beforeEach, describe, expect, test } from "@jest/globals";
import apiClient from "../api/client";
import { useAllProjectIncidents } from "./useAllProjectIncidents";
import { useAllProjectAlerts } from "./useAllProjectAlerts";
import { useAllProjectIncidentEpisodes } from "./useAllProjectIncidentEpisodes";
import { useAllProjectAlertEpisodes } from "./useAllProjectAlertEpisodes";
import { useAllProjectMonitors } from "./useAllProjectMonitors";
import { useAllProjectCounts } from "./useAllProjectCounts";
import { useAllProjectIncidentStates } from "./useAllProjectIncidentStates";
import { useAllProjectAlertStates } from "./useAllProjectAlertStates";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeProject,
} from "../__tests__/testSupport";
import type { ProjectItem } from "../api/types";

const mockSelection: { project: ProjectItem | null } = { project: null };
jest.mock("./useProject", () => {
  return {
    useActiveProject: () => {
      return {
        projectList: mockSelection.project ? [mockSelection.project] : [],
        isLoadingProjects: false,
      };
    },
  };
});
jest.mock("../api/client", () => {
  return { __esModule: true, default: { post: jest.fn() } };
});

const postMock: jest.Mock = apiClient.post as unknown as jest.Mock;

interface HttpOptions {
  headers: Record<string, string>;
}

interface ServerResponse {
  data: {
    data: Array<{ _id: string; projectId: string; name: string }>;
    count: number;
    skip: number;
    limit: number;
  };
}

function responseFor(url: string, options: HttpOptions): ServerResponse {
  const projectId: string = options.headers.tenantid!;
  return {
    data: {
      data: [
        { _id: projectId + url.split("/")[2], projectId, name: projectId },
      ],
      count: projectId === "project-a" ? 3 : 7,
      skip: 0,
      limit: 100,
    },
  };
}

interface Operations {
  incidents: ReturnType<typeof useAllProjectIncidents>;
  alerts: ReturnType<typeof useAllProjectAlerts>;
  incidentEpisodes: ReturnType<typeof useAllProjectIncidentEpisodes>;
  alertEpisodes: ReturnType<typeof useAllProjectAlertEpisodes>;
  monitors: ReturnType<typeof useAllProjectMonitors>;
  counts: ReturnType<typeof useAllProjectCounts>;
  incidentStates: ReturnType<typeof useAllProjectIncidentStates>;
  alertStates: ReturnType<typeof useAllProjectAlertStates>;
}

function useOperations(): Operations {
  return {
    incidents: useAllProjectIncidents(),
    alerts: useAllProjectAlerts(),
    incidentEpisodes: useAllProjectIncidentEpisodes(),
    alertEpisodes: useAllProjectAlertEpisodes(),
    monitors: useAllProjectMonitors(),
    counts: useAllProjectCounts(),
    incidentStates: useAllProjectIncidentStates(),
    alertStates: useAllProjectAlertStates(),
  };
}

beforeEach(() => {
  postMock.mockReset();
  mockSelection.project = makeProject({ _id: "project-a", name: "Production" });
  postMock.mockImplementation(
    async (url: string, _body: unknown, options: HttpOptions) => {
      return responseFor(url, options);
    },
  );
});

describe("Project selection through queries to the HTTP request", () => {
  test("every list, response state and count sends the selected tenant without a multi-tenant header", async () => {
    const { result } = await renderHook(useOperations, {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });
    await waitFor(() => {
      expect(result.current.counts.isLoading).toBe(false);
      expect(result.current.incidentStates.statesMap.size).toBe(1);
      expect(result.current.alertStates.statesMap.size).toBe(1);
    });
    expect(postMock).toHaveBeenCalledTimes(14);
    for (const call of postMock.mock.calls) {
      expect(call[2]).toEqual({ headers: { tenantid: "project-a" } });
    }
    expect(result.current.counts.incidentCount).toBe(3);
    expect(result.current.counts.monitorCount).toBe(3);
    const unresolvedCalls: unknown[][] = postMock.mock.calls.filter(
      (call: unknown[]) => {
        return (
          String(call[0]).endsWith("limit=1") &&
          !String(call[0]).includes("/monitor/")
        );
      },
    );
    expect(unresolvedCalls).toHaveLength(4);
    for (const call of unresolvedCalls) {
      expect(
        Object.values((call[1] as { query: Record<string, unknown> }).query),
      ).toContainEqual({
        isResolvedState: false,
      });
    }
  });

  test("a late response from the previous project cannot replace the current project's rows, counts or actions", async () => {
    const pending: Array<() => void> = [];
    postMock.mockImplementation(
      (
        url: string,
        _body: unknown,
        options: HttpOptions,
      ): Promise<ServerResponse> => {
        if (options.headers.tenantid === "project-a") {
          return new Promise((resolve: (value: ServerResponse) => void) => {
            pending.push(() => {
              resolve(responseFor(url, options));
            });
          });
        }
        return Promise.resolve(responseFor(url, options));
      },
    );
    const { result, rerender } = await renderHook(useOperations, {
      wrapper: createQueryWrapper(createTestQueryClient()),
    });
    expect(result.current.incidents.isLoading).toBe(true);
    mockSelection.project = makeProject({ _id: "project-b", name: "Staging" });
    await rerender(undefined);
    await waitFor(() => {
      expect(result.current.counts.isLoading).toBe(false);
      expect(result.current.monitors.items).toHaveLength(1);
    });
    await act(async () => {
      pending.forEach((release: () => void) => {
        release();
      });
    });
    for (const list of [
      result.current.incidents,
      result.current.alerts,
      result.current.incidentEpisodes,
      result.current.alertEpisodes,
      result.current.monitors,
    ]) {
      expect(list.items).toHaveLength(1);
      expect(list.items[0]?.projectId).toBe("project-b");
      expect(list.items[0]?.projectName).toBe("Staging");
    }
    expect(result.current.counts.incidentCount).toBe(7);
    expect(result.current.counts.monitorCount).toBe(7);
    expect([...result.current.incidentStates.statesMap.keys()]).toEqual([
      "project-b",
    ]);
    expect([...result.current.alertStates.statesMap.keys()]).toEqual([
      "project-b",
    ]);
  });
});
