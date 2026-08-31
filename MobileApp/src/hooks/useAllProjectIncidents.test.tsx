import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectIncidents } from "./useAllProjectIncidents";
import { useAllProjectIncidentEpisodes } from "./useAllProjectIncidentEpisodes";
import { useProject } from "./useProject";
import { fetchAllIncidents } from "../api/incidents";
import { fetchAllIncidentEpisodes } from "../api/incidentEpisodes";
import type {
  IncidentEpisodeItem,
  IncidentItem,
  ListResponse,
  ProjectItem,
} from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeIncident,
  makeIncidentEpisode,
  makeListResponse,
  makeProject,
} from "../__tests__/testSupport";

/*
 * The two hooks behind the Incidents screen, and the incident-shaped twins of
 * the pair covered in useAllProjectAlerts.test.tsx. Everything said there
 * applies here, so the reasoning is not repeated in full - the short version:
 *
 * react-query v5's `isPending` means "there is no data yet", not "a request is
 * in flight", and a query with enabled:false is pending forever. These hooks
 * stay disabled until the responder has at least one project, so reporting
 * pending as loading left an account with no projects on a skeleton that could
 * never resolve. And the row mapping runs inside a useMemo - during render -
 * so a 200 whose body is not the list envelope has to be survivable there.
 *
 * They are asserted separately from the alert hooks rather than parameterised
 * over both, because these four hooks are near-copies of one another and a
 * copy is exactly what a fix forgets.
 */

jest.mock("./useProject", () => {
  return {
    useProject: jest.fn(),
  };
});

jest.mock("../api/incidents", () => {
  return {
    fetchAllIncidents: jest.fn(),
  };
});

jest.mock("../api/incidentEpisodes", () => {
  return {
    fetchAllIncidentEpisodes: jest.fn(),
  };
});

const useProjectMock: jest.MockedFunction<typeof useProject> =
  useProject as jest.MockedFunction<typeof useProject>;
const fetchAllIncidentsMock: jest.MockedFunction<typeof fetchAllIncidents> =
  fetchAllIncidents as jest.MockedFunction<typeof fetchAllIncidents>;
const fetchAllIncidentEpisodesMock: jest.MockedFunction<
  typeof fetchAllIncidentEpisodes
> = fetchAllIncidentEpisodes as jest.MockedFunction<
  typeof fetchAllIncidentEpisodes
>;

/**
 * Stand in for the ProjectProvider: `isLoadingProjects` is the half that says
 * the list has not arrived yet, and an empty list with the flag down is the
 * settled "this account has no projects" state.
 */
function setProjects(
  projectList: ProjectItem[],
  isLoadingProjects: boolean = false,
): void {
  useProjectMock.mockReturnValue({
    projectList,
    isLoadingProjects,
    /*
     * The hooks under test never read why the project list is empty - the
     * screens do, to choose between an onboarding prompt and a retry - so the
     * fake always reports a load that went fine.
     */
    projectLoadError: null,
    refreshProjects: async (): Promise<void> => {
      return undefined;
    },
  });
}

/*
 * clearMocks forgets recorded calls but keeps whatever implementation a
 * previous test installed; a full reset means a test that forgets to arm a
 * mock fails loudly instead of reusing its neighbour's canned response.
 */
beforeEach(() => {
  useProjectMock.mockReset();
  fetchAllIncidentsMock.mockReset();
  fetchAllIncidentEpisodesMock.mockReset();
});

describe("useAllProjectIncidents", () => {
  test("a responder with no projects is finished loading rather than stuck in a skeleton", async () => {
    /*
     * The bug. Nothing is in flight and nothing ever will be while the project
     * list is empty, so the honest answer is "not loading, no incidents" -
     * which is what lets the screen render its empty state instead of three
     * skeleton cards that stay up until the app is killed.
     */
    setProjects([]);
    fetchAllIncidentsMock.mockResolvedValue(makeListResponse([makeIncident()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(fetchAllIncidentsMock).not.toHaveBeenCalled();
  });

  test("reports loading while the project list is still being fetched", async () => {
    /*
     * Why the fix is not just "false when there are no projects": until the
     * list lands, an account with no projects is indistinguishable from one
     * whose projects have not loaded, and calling that "no incidents" flashes
     * an all-clear at a responder who may have something on fire.
     */
    setProjects([], true);
    fetchAllIncidentsMock.mockResolvedValue(makeListResponse([makeIncident()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(fetchAllIncidentsMock).not.toHaveBeenCalled();
  });

  test("reports loading while its own request is genuinely in flight", async () => {
    /*
     * The third state, and the one the fix must not trade away: projects are
     * known, the request is out, and nothing has come back yet. Anything that
     * reported "not loading" here would put the empty state - "you have
     * nothing outstanding" - on screen a beat before the real rows arrive,
     * which on this app reads as an all-clear.
     */
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
    ]);
    /*
     * The response is held open on purpose: nothing settles this fetch until
     * `release` is called, so the assertions below land in the middle of the
     * request instead of racing it.
     */
    let release: (rows: ListResponse<IncidentItem>) => void = (): void => {
      return undefined;
    };
    const inFlight: Promise<ListResponse<IncidentItem>> = new Promise<
      ListResponse<IncidentItem>
    >((resolve: (rows: ListResponse<IncidentItem>) => void): void => {
      release = resolve;
    });
    fetchAllIncidentsMock.mockReturnValue(inFlight);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(fetchAllIncidentsMock).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);

    release(makeListResponse([makeIncident({ projectId: "project-acme" })]));

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toHaveLength(1);
  });

  test("wraps each row with the name of the project it came from", async () => {
    /*
     * This list is the one screen where two adjacent rows can belong to
     * different projects, so the stitched-on name is the only thing saying
     * which system is broken.
     */
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
      makeProject({ _id: "project-globex", name: "Globex Staging" }),
    ]);
    fetchAllIncidentsMock.mockResolvedValue(
      makeListResponse([
        makeIncident({ _id: "incident-1", projectId: "project-acme" }),
        makeIncident({ _id: "incident-2", projectId: "project-globex" }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.items).toHaveLength(2);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items[0].projectId).toBe("project-acme");
    expect(result.current.items[0].projectName).toBe("Acme Production");
    expect(result.current.items[0].item._id).toBe("incident-1");
    expect(result.current.items[1].projectId).toBe("project-globex");
    expect(result.current.items[1].projectName).toBe("Globex Staging");
    expect(fetchAllIncidentsMock).toHaveBeenCalledWith({ skip: 0, limit: 100 });
  });

  test("a row from a project the list does not know about is still shown, without a name", async () => {
    /*
     * The two lists come from different requests and can disagree. Dropping
     * the odd row out would hide a live incident from the only screen that
     * shows it, so it is kept and only the name is left blank.
     */
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
    ]);
    fetchAllIncidentsMock.mockResolvedValue(
      makeListResponse([
        makeIncident({
          _id: "incident-stranger",
          projectId: "project-unknown",
        }),
        makeIncident({ _id: "incident-anonymous", projectId: undefined }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.items).toHaveLength(2);
    });
    expect(result.current.items[0].projectId).toBe("project-unknown");
    expect(result.current.items[0].projectName).toBe("");
    expect(result.current.items[1].projectId).toBe("");
    expect(result.current.items[1].projectName).toBe("");
  });

  test("a 200 carrying no rows array renders as empty instead of throwing during render", async () => {
    /*
     * A gateway or an error page answering 200 with something that is not the
     * list envelope. Without the guard this test does not fail an assertion -
     * the render itself throws, which is precisely the point.
     */
    setProjects([makeProject()]);
    const malformed: ListResponse<IncidentItem> = {
      data: null,
      count: 0,
      skip: 0,
      limit: 100,
    } as unknown as ListResponse<IncidentItem>;
    fetchAllIncidentsMock.mockResolvedValue(malformed);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toEqual([]);
  });

  test("a failed fetch surfaces as an error rather than as an empty list", async () => {
    /*
     * Zero rows and "we could not ask" have to look different, or the screen
     * tells a responder that nothing is on fire on the one occasion it cannot
     * actually tell.
     */
    setProjects([makeProject()]);
    fetchAllIncidentsMock.mockRejectedValue(
      new Error("incident list unavailable"),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});

describe("useAllProjectIncidentEpisodes", () => {
  test("a responder with no projects is finished loading rather than stuck in a skeleton", async () => {
    setProjects([]);
    fetchAllIncidentEpisodesMock.mockResolvedValue(
      makeListResponse([makeIncidentEpisode()]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(fetchAllIncidentEpisodesMock).not.toHaveBeenCalled();
  });

  test("reports loading while the project list is still being fetched", async () => {
    setProjects([], true);
    fetchAllIncidentEpisodesMock.mockResolvedValue(
      makeListResponse([makeIncidentEpisode()]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(fetchAllIncidentEpisodesMock).not.toHaveBeenCalled();
  });

  test("wraps each row with the name of the project it came from", async () => {
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
      makeProject({ _id: "project-globex", name: "Globex Staging" }),
    ]);
    fetchAllIncidentEpisodesMock.mockResolvedValue(
      makeListResponse([
        makeIncidentEpisode({
          _id: "incident-episode-1",
          projectId: "project-acme",
        }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items[0].projectId).toBe("project-acme");
    expect(result.current.items[0].projectName).toBe("Acme Production");
    expect(result.current.items[0].item._id).toBe("incident-episode-1");
    expect(fetchAllIncidentEpisodesMock).toHaveBeenCalledWith({
      skip: 0,
      limit: 100,
    });
  });

  test("a row from a project the list does not know about is still shown, without a name", async () => {
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
    ]);
    fetchAllIncidentEpisodesMock.mockResolvedValue(
      makeListResponse([
        makeIncidentEpisode({
          _id: "incident-episode-stranger",
          projectId: "project-unknown",
        }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0].projectId).toBe("project-unknown");
    expect(result.current.items[0].projectName).toBe("");
  });

  test("a 200 carrying no rows array renders as empty instead of throwing during render", async () => {
    setProjects([makeProject()]);
    const malformed: ListResponse<IncidentEpisodeItem> = {
      count: 0,
      skip: 0,
      limit: 100,
    } as unknown as ListResponse<IncidentEpisodeItem>;
    fetchAllIncidentEpisodesMock.mockResolvedValue(malformed);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toEqual([]);
  });

  test("a failed fetch surfaces as an error rather than as an empty list", async () => {
    setProjects([makeProject()]);
    fetchAllIncidentEpisodesMock.mockRejectedValue(
      new Error("incident episode list unavailable"),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });
});
