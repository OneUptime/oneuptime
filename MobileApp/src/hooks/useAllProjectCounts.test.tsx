import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectCounts } from "./useAllProjectCounts";
import { fetchAllIncidents } from "../api/incidents";
import { fetchAllAlerts } from "../api/alerts";
import { fetchAllIncidentEpisodes } from "../api/incidentEpisodes";
import { fetchAllAlertEpisodes } from "../api/alertEpisodes";
import {
  fetchMonitorCount,
  fetchDisabledMonitorCount,
  fetchInoperationalMonitorCount,
} from "../api/monitors";
import type { ListResponse, MonitorItem, ProjectItem } from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeListResponse,
  makeProject,
} from "../__tests__/testSupport";

/*
 * This is the hook behind the Home dashboard's cards, and the cards are read
 * as a verdict: a 0 next to "Inoperational monitors" means "nothing is down".
 * Everything below is about the two ways that number can be a lie.
 *
 * NOT-YET-ASKED read as ASKED-AND-ZERO. Every count falls back to 0 while its
 * query has no data, so the only thing keeping an unfetched 0 off the screen
 * is isLoading. That flag has to cover the whole fan-out - all seven requests,
 * plus the project list they are fanned out FROM. It used to cover neither
 * end: it read `isPending` on the four single queries, which in react-query v5
 * means "no data yet" and stays true FOREVER for a query with enabled:false
 * (so a responder with no projects sat under a skeleton with no way out); and
 * it omitted the disabled- and inoperational-monitor arrays entirely even
 * though it returns their counts.
 *
 * FAILED read as ZERO. A count whose request errored reaches Home as 0, and
 * before this there was nothing in the result to say otherwise - a 500 from
 * the alerts endpoint and a genuinely quiet night looked identical.
 *
 * The mocks stand in for seven endpoints because none of this is about HTTP;
 * it is about which requests the flags are computed over.
 */

jest.mock("../api/incidents", () => {
  return {
    fetchAllIncidents: jest.fn(),
  };
});

jest.mock("../api/alerts", () => {
  return {
    fetchAllAlerts: jest.fn(),
  };
});

jest.mock("../api/incidentEpisodes", () => {
  return {
    fetchAllIncidentEpisodes: jest.fn(),
  };
});

jest.mock("../api/alertEpisodes", () => {
  return {
    fetchAllAlertEpisodes: jest.fn(),
  };
});

jest.mock("../api/monitors", () => {
  return {
    fetchMonitorCount: jest.fn(),
    fetchDisabledMonitorCount: jest.fn(),
    fetchInoperationalMonitorCount: jest.fn(),
  };
});

interface MockProjectContext {
  projectList: ProjectItem[];
  isLoadingProjects: boolean;
  refreshProjects: () => Promise<void>;
}

const mockProjectContext: MockProjectContext = {
  projectList: [],
  isLoadingProjects: false,
  refreshProjects: async (): Promise<void> => {
    return undefined;
  },
};

jest.mock("./useProject", () => {
  return {
    useProject: () => {
      return mockProjectContext;
    },
  };
});

const fetchAllIncidentsMock: jest.MockedFunction<typeof fetchAllIncidents> =
  fetchAllIncidents as jest.MockedFunction<typeof fetchAllIncidents>;
const fetchAllAlertsMock: jest.MockedFunction<typeof fetchAllAlerts> =
  fetchAllAlerts as jest.MockedFunction<typeof fetchAllAlerts>;
const fetchAllIncidentEpisodesMock: jest.MockedFunction<
  typeof fetchAllIncidentEpisodes
> = fetchAllIncidentEpisodes as jest.MockedFunction<
  typeof fetchAllIncidentEpisodes
>;
const fetchAllAlertEpisodesMock: jest.MockedFunction<
  typeof fetchAllAlertEpisodes
> = fetchAllAlertEpisodes as jest.MockedFunction<typeof fetchAllAlertEpisodes>;
const fetchMonitorCountMock: jest.MockedFunction<typeof fetchMonitorCount> =
  fetchMonitorCount as jest.MockedFunction<typeof fetchMonitorCount>;
const fetchDisabledMonitorCountMock: jest.MockedFunction<
  typeof fetchDisabledMonitorCount
> = fetchDisabledMonitorCount as jest.MockedFunction<
  typeof fetchDisabledMonitorCount
>;
const fetchInoperationalMonitorCountMock: jest.MockedFunction<
  typeof fetchInoperationalMonitorCount
> = fetchInoperationalMonitorCount as jest.MockedFunction<
  typeof fetchInoperationalMonitorCount
>;

/**
 * A count envelope carrying `count` without the rows, which is exactly what
 * these endpoints answer: they ask for limit:1 purely to read the total.
 */
function countResponse(count: number): ListResponse<MonitorItem> {
  return makeListResponse([], { count, limit: 1 });
}

/**
 * A request that is genuinely still in flight.
 *
 * Several tests need to sit in the window where SOME of the seven requests
 * have landed and one has not, because that window is the whole subject: the
 * bug was a card rendering a settled-looking 0 during it. A promise that never
 * settles holds the hook there for as long as the test needs, with no timer to
 * race against.
 */
function neverResolves(): Promise<ListResponse<MonitorItem>> {
  return new Promise<ListResponse<MonitorItem>>((): void => {
    /*
     * The executor is empty on purpose - `resolve` is never called, so the
     * request stays in flight for the whole test rather than settling on a
     * timer the assertions would have to race.
     */
  });
}

/**
 * Arm the four whole-account queries so a test can concentrate on the monitor
 * fan-out without every count being undefined for unrelated reasons.
 */
function armAccountWideCounts(): void {
  fetchAllIncidentsMock.mockResolvedValue(makeListResponse([], { count: 3 }));
  fetchAllAlertsMock.mockResolvedValue(makeListResponse([], { count: 4 }));
  fetchAllIncidentEpisodesMock.mockResolvedValue(
    makeListResponse([], { count: 1 }),
  );
  fetchAllAlertEpisodesMock.mockResolvedValue(
    makeListResponse([], { count: 2 }),
  );
}

beforeEach(() => {
  fetchAllIncidentsMock.mockReset();
  fetchAllAlertsMock.mockReset();
  fetchAllIncidentEpisodesMock.mockReset();
  fetchAllAlertEpisodesMock.mockReset();
  fetchMonitorCountMock.mockReset();
  fetchDisabledMonitorCountMock.mockReset();
  fetchInoperationalMonitorCountMock.mockReset();
  mockProjectContext.projectList = [];
  mockProjectContext.isLoadingProjects = false;
});

describe("useAllProjectCounts reports loading over the whole fan-out", () => {
  test("finishes loading for a responder who belongs to no projects", async () => {
    /*
     * The four whole-account queries are disabled when there are no projects,
     * and a disabled query is `isPending` for as long as it exists. Reading
     * isPending therefore left Home under a skeleton that could never resolve
     * for a brand new account - or for an account whose project fetch failed -
     * with nothing on screen to retry.
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = false;
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetchAllIncidentsMock).not.toHaveBeenCalled();
    expect(fetchAllAlertsMock).not.toHaveBeenCalled();
  });

  test("stays loading while the project list itself is being re-fetched", async () => {
    /*
     * Pull-to-refresh calls refreshProjects, which flips isLoadingProjects
     * back on while the PREVIOUS list is still in state. Every count query has
     * settled at that moment, so without the project list in the loading flag
     * Home would present the old numbers as current while the set of projects
     * they cover is being rewritten underneath them.
     */
    mockProjectContext.projectList = [makeProject()];
    armAccountWideCounts();
    fetchMonitorCountMock.mockResolvedValue(countResponse(5));
    fetchDisabledMonitorCountMock.mockResolvedValue(countResponse(1));
    fetchInoperationalMonitorCountMock.mockResolvedValue(countResponse(2));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.inoperationalMonitorCount).toBe(2);
    });
    mockProjectContext.isLoadingProjects = true;
    const { result: refreshing } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(refreshing.current.isLoading).toBe(true);
  });

  test("keeps loading until the disabled-monitor count has landed", async () => {
    /*
     * The card this protects says "Disabled monitors". Its count was left out
     * of isLoading even though the hook returns it, so Home drew a confident 0
     * the moment the OTHER monitor request came back - a responder reading a
     * dashboard that has visibly finished loading has no reason to doubt it.
     */
    mockProjectContext.projectList = [makeProject()];
    armAccountWideCounts();
    fetchMonitorCountMock.mockResolvedValue(countResponse(5));
    fetchDisabledMonitorCountMock.mockReturnValue(neverResolves());
    fetchInoperationalMonitorCountMock.mockResolvedValue(countResponse(2));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.inoperationalMonitorCount).toBe(2);
    });
    expect(result.current.disabledMonitorCount).toBe(0);
    expect(result.current.isLoading).toBe(true);
  });

  test("keeps loading until the inoperational-monitor count has landed", async () => {
    /*
     * The same omission, and the more expensive of the two cards: an
     * inoperational count of 0 is the screen saying nothing is down.
     */
    mockProjectContext.projectList = [makeProject()];
    armAccountWideCounts();
    fetchMonitorCountMock.mockResolvedValue(countResponse(5));
    fetchDisabledMonitorCountMock.mockResolvedValue(countResponse(1));
    fetchInoperationalMonitorCountMock.mockReturnValue(neverResolves());
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.disabledMonitorCount).toBe(1);
    });
    expect(result.current.inoperationalMonitorCount).toBe(0);
    expect(result.current.isLoading).toBe(true);
  });

  test("finishes loading once all seven counts have landed", async () => {
    /*
     * The counts themselves are asserted here as well: widening isLoading must
     * not change a single number the cards display.
     */
    mockProjectContext.projectList = [
      makeProject(),
      makeProject({ _id: "project-2", name: "Acme Staging" }),
    ];
    armAccountWideCounts();
    fetchMonitorCountMock.mockResolvedValue(countResponse(5));
    fetchDisabledMonitorCountMock.mockResolvedValue(countResponse(1));
    fetchInoperationalMonitorCountMock.mockResolvedValue(countResponse(2));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.incidentCount).toBe(3);
    expect(result.current.alertCount).toBe(4);
    expect(result.current.incidentEpisodeCount).toBe(1);
    expect(result.current.alertEpisodeCount).toBe(2);
    expect(result.current.monitorCount).toBe(10);
    expect(result.current.disabledMonitorCount).toBe(2);
    expect(result.current.inoperationalMonitorCount).toBe(4);
    expect(result.current.isError).toBe(false);
  });
});

describe("useAllProjectCounts distinguishes a failed count from a real zero", () => {
  test("reports an error when a whole-account count request fails", async () => {
    /*
     * alertCount is 0 here for the worst possible reason. Without isError the
     * screen has no way to know that, and the card reads exactly like a quiet
     * night. The counts are deliberately unchanged - the fix adds a signal
     * beside them, it does not invent a sentinel inside them.
     */
    mockProjectContext.projectList = [makeProject()];
    armAccountWideCounts();
    fetchAllAlertsMock.mockRejectedValue(
      new Error("500 from /api/alert/get-list"),
    );
    fetchMonitorCountMock.mockResolvedValue(countResponse(5));
    fetchDisabledMonitorCountMock.mockResolvedValue(countResponse(1));
    fetchInoperationalMonitorCountMock.mockResolvedValue(countResponse(2));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.alertCount).toBe(0);
    expect(result.current.incidentCount).toBe(3);
  });

  test("reports an error when one project's inoperational-monitor count fails", async () => {
    /*
     * The per-project arms need the same treatment: with two projects, one
     * failing request means the summed total silently under-reports what is
     * broken, which is the direction that gets somebody paged too late.
     */
    mockProjectContext.projectList = [
      makeProject(),
      makeProject({ _id: "project-2", name: "Acme Staging" }),
    ];
    armAccountWideCounts();
    fetchMonitorCountMock.mockResolvedValue(countResponse(5));
    fetchDisabledMonitorCountMock.mockResolvedValue(countResponse(1));
    fetchInoperationalMonitorCountMock.mockImplementation(
      async (projectId: string) => {
        if (projectId === "project-2") {
          throw new Error("500 from /api/monitor/get-list");
        }
        return countResponse(2);
      },
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectCounts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.inoperationalMonitorCount).toBe(2);
  });
});
