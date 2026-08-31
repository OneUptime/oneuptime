import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectAlerts } from "./useAllProjectAlerts";
import { useAllProjectAlertEpisodes } from "./useAllProjectAlertEpisodes";
import { useProject } from "./useProject";
import { fetchAllAlerts } from "../api/alerts";
import { fetchAllAlertEpisodes } from "../api/alertEpisodes";
import type {
  AlertEpisodeItem,
  AlertItem,
  ListResponse,
  ProjectItem,
} from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlert,
  makeAlertEpisode,
  makeListResponse,
  makeProject,
} from "../__tests__/testSupport";

/*
 * The two hooks behind the Alerts screen. Both fan one multi-tenant request
 * out across every project the responder belongs to, and both take their
 * project list from useProject - so both inherit the same two failure modes,
 * and both are tested for them here.
 *
 * The first is the loading flag. react-query v5's `isPending` means "there is
 * no data yet", not "a request is in flight", and a query with enabled:false
 * is pending forever. These hooks are disabled until there is at least one
 * project, so a responder with no projects - a brand new account, or one whose
 * project fetch failed - used to get a skeleton that could never resolve. On
 * an on-call app that is not a cosmetic bug: the screen that should say "you
 * have nothing outstanding" instead says nothing at all, with no retry. The
 * flag has to be false there, and true while the project list is still coming.
 *
 * The second is the row mapping. `query.data.data.map(...)` runs inside a
 * useMemo, which runs during render, so a 200 whose body is not the list
 * envelope takes the whole screen down rather than showing an empty state.
 *
 * useProject is mocked so the project list can be driven directly - the real
 * provider would need an authenticated session and a projects request to reach
 * any of these states. The api modules are mocked because none of this is
 * about HTTP: what comes back out of the hook is the whole subject.
 */

jest.mock("./useProject", () => {
  return {
    useProject: jest.fn(),
  };
});

jest.mock("../api/alerts", () => {
  return {
    fetchAllAlerts: jest.fn(),
  };
});

jest.mock("../api/alertEpisodes", () => {
  return {
    fetchAllAlertEpisodes: jest.fn(),
  };
});

const useProjectMock: jest.MockedFunction<typeof useProject> =
  useProject as jest.MockedFunction<typeof useProject>;
const fetchAllAlertsMock: jest.MockedFunction<typeof fetchAllAlerts> =
  fetchAllAlerts as jest.MockedFunction<typeof fetchAllAlerts>;
const fetchAllAlertEpisodesMock: jest.MockedFunction<
  typeof fetchAllAlertEpisodes
> = fetchAllAlertEpisodes as jest.MockedFunction<typeof fetchAllAlertEpisodes>;

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
 * jest is configured with clearMocks, which forgets recorded calls but keeps
 * whatever implementation a previous test installed. Resetting fully means a
 * test that forgets to arm a mock fails loudly instead of quietly reusing its
 * neighbour's canned response - including useProject, where a missing return
 * value throws on the destructure rather than silently supplying projects.
 */
beforeEach(() => {
  useProjectMock.mockReset();
  fetchAllAlertsMock.mockReset();
  fetchAllAlertEpisodesMock.mockReset();
});

describe("useAllProjectAlerts", () => {
  test("a responder with no projects is finished loading rather than stuck in a skeleton", async () => {
    /*
     * The bug this pins down. With no projects the query is disabled, so it is
     * pending and will stay pending for the life of the screen; reporting that
     * as loading left the Alerts screen showing three skeleton cards forever.
     * Nothing is in flight and nothing ever will be, so the honest answer is
     * "not loading, no alerts" - which is what lets the empty state render.
     */
    setProjects([]);
    fetchAllAlertsMock.mockResolvedValue(makeListResponse([makeAlert()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(fetchAllAlertsMock).not.toHaveBeenCalled();
  });

  test("reports loading while the project list is still being fetched", async () => {
    /*
     * The other side of the same coin, and the reason the fix is not simply
     * "isLoading: false when there are no projects". Before the list arrives
     * the app cannot yet tell an account with no projects apart from one whose
     * projects have not loaded; answering "no alerts" then would flash an
     * all-clear at a responder who may well have something on fire.
     */
    setProjects([], true);
    fetchAllAlertsMock.mockResolvedValue(makeListResponse([makeAlert()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(fetchAllAlertsMock).not.toHaveBeenCalled();
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
    let release: (rows: ListResponse<AlertItem>) => void = (): void => {
      return undefined;
    };
    const inFlight: Promise<ListResponse<AlertItem>> = new Promise<
      ListResponse<AlertItem>
    >((resolve: (rows: ListResponse<AlertItem>) => void): void => {
      release = resolve;
    });
    fetchAllAlertsMock.mockReturnValue(inFlight);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(fetchAllAlertsMock).toHaveBeenCalled();
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);

    release(makeListResponse([makeAlert({ projectId: "project-acme" })]));

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toHaveLength(1);
  });

  test("wraps each row with the name of the project it came from", async () => {
    /*
     * The multi-tenant list is the one place in the app where two rows on one
     * screen can belong to different projects, so the name stitched on here is
     * the only thing telling a responder which system is broken.
     */
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
      makeProject({ _id: "project-globex", name: "Globex Staging" }),
    ]);
    fetchAllAlertsMock.mockResolvedValue(
      makeListResponse([
        makeAlert({ _id: "alert-1", projectId: "project-acme" }),
        makeAlert({ _id: "alert-2", projectId: "project-globex" }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.items).toHaveLength(2);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items[0].projectId).toBe("project-acme");
    expect(result.current.items[0].projectName).toBe("Acme Production");
    expect(result.current.items[0].item._id).toBe("alert-1");
    expect(result.current.items[1].projectId).toBe("project-globex");
    expect(result.current.items[1].projectName).toBe("Globex Staging");
    expect(fetchAllAlertsMock).toHaveBeenCalledWith({ skip: 0, limit: 100 });
  });

  test("a row from a project the list does not know about is still shown, without a name", async () => {
    /*
     * The lists come from two different requests, so they can disagree: a
     * project left since the list was cached, or a row whose projectId the
     * multi-tenant select did not return. Dropping such a row would hide a
     * live alert from the only screen that shows it, so it is kept and only
     * the name is blank.
     */
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
    ]);
    fetchAllAlertsMock.mockResolvedValue(
      makeListResponse([
        makeAlert({ _id: "alert-stranger", projectId: "project-unknown" }),
        makeAlert({ _id: "alert-anonymous", projectId: undefined }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
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
     * list envelope. The mapping runs inside a useMemo, so calling .map on a
     * missing array throws while React is rendering - which unmounts the
     * screen rather than showing "could not load". If the guard is removed,
     * this test does not fail an assertion: the render itself blows up.
     */
    setProjects([makeProject()]);
    const malformed: ListResponse<AlertItem> = {
      data: null,
      count: 0,
      skip: 0,
      limit: 100,
    } as unknown as ListResponse<AlertItem>;
    fetchAllAlertsMock.mockResolvedValue(malformed);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
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
     * An on-call app that renders a failed request as zero rows is telling a
     * responder that nothing is on fire.
     */
    setProjects([makeProject()]);
    fetchAllAlertsMock.mockRejectedValue(new Error("alert list unavailable"));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
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

describe("useAllProjectAlertEpisodes", () => {
  test("a responder with no projects is finished loading rather than stuck in a skeleton", async () => {
    /*
     * The episodes segment of the same screen, with the same disabled-query
     * trap. It is worth asserting separately because the two hooks are copies
     * of each other, and a copy is exactly the kind of thing a fix misses.
     */
    setProjects([]);
    fetchAllAlertEpisodesMock.mockResolvedValue(
      makeListResponse([makeAlertEpisode()]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
    expect(fetchAllAlertEpisodesMock).not.toHaveBeenCalled();
  });

  test("reports loading while the project list is still being fetched", async () => {
    setProjects([], true);
    fetchAllAlertEpisodesMock.mockResolvedValue(
      makeListResponse([makeAlertEpisode()]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(fetchAllAlertEpisodesMock).not.toHaveBeenCalled();
  });

  test("wraps each row with the name of the project it came from", async () => {
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
      makeProject({ _id: "project-globex", name: "Globex Staging" }),
    ]);
    fetchAllAlertEpisodesMock.mockResolvedValue(
      makeListResponse([
        makeAlertEpisode({
          _id: "alert-episode-1",
          projectId: "project-globex",
        }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.isLoading).toBe(false);
    expect(result.current.items[0].projectId).toBe("project-globex");
    expect(result.current.items[0].projectName).toBe("Globex Staging");
    expect(result.current.items[0].item._id).toBe("alert-episode-1");
    expect(fetchAllAlertEpisodesMock).toHaveBeenCalledWith({
      skip: 0,
      limit: 100,
    });
  });

  test("a row from a project the list does not know about is still shown, without a name", async () => {
    setProjects([
      makeProject({ _id: "project-acme", name: "Acme Production" }),
    ]);
    fetchAllAlertEpisodesMock.mockResolvedValue(
      makeListResponse([
        makeAlertEpisode({
          _id: "alert-episode-stranger",
          projectId: "project-unknown",
        }),
      ]),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
    const malformed: ListResponse<AlertEpisodeItem> = {
      count: 0,
      skip: 0,
      limit: 100,
    } as unknown as ListResponse<AlertEpisodeItem>;
    fetchAllAlertEpisodesMock.mockResolvedValue(malformed);
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
    fetchAllAlertEpisodesMock.mockRejectedValue(
      new Error("alert episode list unavailable"),
    );
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
