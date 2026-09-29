import { act, renderHook, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectIncidents } from "./useAllProjectIncidents";
import { useAllProjectIncidentEpisodes } from "./useAllProjectIncidentEpisodes";
import { useActiveProject } from "./useProject";
import { fetchIncidents, fetchAllIncidents } from "../api/incidents";
import {
  fetchIncidentEpisodes,
  fetchAllIncidentEpisodes,
} from "../api/incidentEpisodes";
import type {
  IncidentItem,
  IncidentEpisodeItem,
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

jest.mock("./useProject", () => {
  return { useActiveProject: jest.fn() };
});
jest.mock("../api/incidents", () => {
  return { fetchIncidents: jest.fn(), fetchAllIncidents: jest.fn() };
});
jest.mock("../api/incidentEpisodes", () => {
  return {
    fetchIncidentEpisodes: jest.fn(),
    fetchAllIncidentEpisodes: jest.fn(),
  };
});

const projectA: ProjectItem = makeProject({
  _id: "project-a",
  name: "Production",
});
const projectB: ProjectItem = makeProject({
  _id: "project-b",
  name: "Staging",
});
const useProjectMock: jest.MockedFunction<typeof useActiveProject> =
  jest.mocked(useActiveProject);

function selectProject(
  project?: ProjectItem,
  isLoadingProjects: boolean = false,
): void {
  useProjectMock.mockReturnValue({
    projectList: project ? [project] : [],
    activeProject: project ?? null,
    isLoadingProjects,
    projectLoadError: null,
    refreshProjects: jest.fn(),
    selectProject: jest.fn(),
  } as unknown as ReturnType<typeof useActiveProject>);
}

beforeEach(() => {
  jest.mocked(fetchIncidents).mockReset();
  jest.mocked(fetchIncidentEpisodes).mockReset();
  selectProject(projectA);
});

describe("useAllProjectIncidents selects one project", () => {
  const fetchMock: jest.MockedFunction<typeof fetchIncidents> =
    jest.mocked(fetchIncidents);

  test("no selected project settles without a request, including manual refresh", async () => {
    selectProject();
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("loading the project keeps the inbox in its loading state", async () => {
    selectProject(undefined, true);
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requests the selected tenant and binds rows without project metadata to it", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([makeIncident({ _id: "row-a", projectId: undefined })]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("project-a", {
      skip: 0,
      limit: 100,
    });
    expect(fetchAllIncidents).not.toHaveBeenCalled();
    expect(result.current.items[0]).toMatchObject({
      projectId: "project-a",
      projectName: "Production",
      item: { _id: "row-a" },
    });
  });

  test("a response explicitly naming a different tenant cannot leak into the selected inbox", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeIncident({ _id: "row-a", projectId: "project-a" }),
        makeIncident({ _id: "row-b", projectId: "project-b" }),
      ]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(
      result.current.items.map(
        (row: ReturnType<typeof useAllProjectIncidents>["items"][number]) => {
          return row.item._id;
        },
      ),
    ).toEqual(["row-a"]);
  });

  test("malformed list envelopes do not crash the inbox", async () => {
    fetchMock.mockResolvedValue({
      data: null,
    } as unknown as ListResponse<IncidentItem>);
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toEqual([]);
  });

  test("failed requests report an error instead of a successful empty inbox", async () => {
    fetchMock.mockRejectedValue(new Error("Offline"));
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
  });

  test("switching project immediately removes old rows while the new tenant is loading", async () => {
    fetchMock.mockResolvedValueOnce(
      makeListResponse([
        makeIncident({ _id: "row-a", projectId: "project-a" }),
      ]),
    );
    let release: (response: ListResponse<IncidentItem>) => void = () => {
      return undefined;
    };
    const pending: Promise<ListResponse<IncidentItem>> = new Promise(
      (resolve: (value: ListResponse<IncidentItem>) => void) => {
        release = resolve;
      },
    );
    fetchMock.mockReturnValueOnce(pending);
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    selectProject(projectB);
    await rerender(undefined);
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      release(
        makeListResponse([
          makeIncident({ _id: "row-b", projectId: "project-b" }),
        ]),
      );
    });
    await waitFor(() => {
      expect(result.current.items[0]?.item._id).toBe("row-b");
    });
    expect(result.current.items[0]?.projectName).toBe("Staging");
    expect(fetchMock).toHaveBeenLastCalledWith("project-b", {
      skip: 0,
      limit: 100,
    });
  });

  test("each project has its own cache entry and a refresh requests only the selected tenant", async () => {
    const client: ReturnType<typeof createTestQueryClient> =
      createTestQueryClient();
    client.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    });
    client.setQueryData(
      ["incidents", "project-a"],
      makeListResponse([
        makeIncident({ _id: "cached-a", projectId: "project-a" }),
      ]),
    );
    client.setQueryData(
      ["incidents", "project-b"],
      makeListResponse([
        makeIncident({ _id: "cached-b", projectId: "project-b" }),
      ]),
    );
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeIncident({ _id: "updated-b", projectId: "project-b" }),
      ]),
    );
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectIncidents();
      },
      { wrapper: createQueryWrapper(client) },
    );
    expect(result.current.items[0]?.item._id).toBe("cached-a");
    selectProject(projectB);
    await rerender(undefined);
    expect(result.current.items[0]?.item._id).toBe("cached-b");
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.items[0]?.item._id).toBe("updated-b");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("project-b", {
      skip: 0,
      limit: 100,
    });
    client.clear();
  });
});

describe("useAllProjectIncidentEpisodes selects one project", () => {
  const fetchMock: jest.MockedFunction<typeof fetchIncidentEpisodes> =
    jest.mocked(fetchIncidentEpisodes);

  test("no selected project settles without a request, including manual refresh", async () => {
    selectProject();
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("loading the project keeps the inbox in its loading state", async () => {
    selectProject(undefined, true);
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requests the selected tenant and binds rows without project metadata to it", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeIncidentEpisode({ _id: "row-a", projectId: undefined }),
      ]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(fetchMock).toHaveBeenCalledWith("project-a", {
      skip: 0,
      limit: 100,
    });
    expect(fetchAllIncidentEpisodes).not.toHaveBeenCalled();
    expect(result.current.items[0]).toMatchObject({
      projectId: "project-a",
      projectName: "Production",
      item: { _id: "row-a" },
    });
  });

  test("a response explicitly naming a different tenant cannot leak into the selected inbox", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeIncidentEpisode({ _id: "row-a", projectId: "project-a" }),
        makeIncidentEpisode({ _id: "row-b", projectId: "project-b" }),
      ]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(
      result.current.items.map(
        (
          row: ReturnType<
            typeof useAllProjectIncidentEpisodes
          >["items"][number],
        ) => {
          return row.item._id;
        },
      ),
    ).toEqual(["row-a"]);
  });

  test("malformed list envelopes do not crash the inbox", async () => {
    fetchMock.mockResolvedValue({
      data: null,
    } as unknown as ListResponse<IncidentEpisodeItem>);
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toEqual([]);
  });

  test("failed requests report an error instead of a successful empty inbox", async () => {
    fetchMock.mockRejectedValue(new Error("Offline"));
    const { result } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.isLoading).toBe(false);
  });

  test("switching project immediately removes old rows while the new tenant is loading", async () => {
    fetchMock.mockResolvedValueOnce(
      makeListResponse([
        makeIncidentEpisode({ _id: "row-a", projectId: "project-a" }),
      ]),
    );
    let release: (response: ListResponse<IncidentEpisodeItem>) => void = () => {
      return undefined;
    };
    const pending: Promise<ListResponse<IncidentEpisodeItem>> = new Promise(
      (resolve: (value: ListResponse<IncidentEpisodeItem>) => void) => {
        release = resolve;
      },
    );
    fetchMock.mockReturnValueOnce(pending);
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    selectProject(projectB);
    await rerender(undefined);
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      release(
        makeListResponse([
          makeIncidentEpisode({ _id: "row-b", projectId: "project-b" }),
        ]),
      );
    });
    await waitFor(() => {
      expect(result.current.items[0]?.item._id).toBe("row-b");
    });
    expect(result.current.items[0]?.projectName).toBe("Staging");
    expect(fetchMock).toHaveBeenLastCalledWith("project-b", {
      skip: 0,
      limit: 100,
    });
  });

  test("each project has its own cache entry and a refresh requests only the selected tenant", async () => {
    const client: ReturnType<typeof createTestQueryClient> =
      createTestQueryClient();
    client.setDefaultOptions({
      queries: { retry: false, gcTime: Infinity, staleTime: Infinity },
    });
    client.setQueryData(
      ["incident-episodes", "project-a"],
      makeListResponse([
        makeIncidentEpisode({ _id: "cached-a", projectId: "project-a" }),
      ]),
    );
    client.setQueryData(
      ["incident-episodes", "project-b"],
      makeListResponse([
        makeIncidentEpisode({ _id: "cached-b", projectId: "project-b" }),
      ]),
    );
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeIncidentEpisode({ _id: "updated-b", projectId: "project-b" }),
      ]),
    );
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectIncidentEpisodes();
      },
      { wrapper: createQueryWrapper(client) },
    );
    expect(result.current.items[0]?.item._id).toBe("cached-a");
    selectProject(projectB);
    await rerender(undefined);
    expect(result.current.items[0]?.item._id).toBe("cached-b");
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      await result.current.refetch();
    });
    await waitFor(() => {
      expect(result.current.items[0]?.item._id).toBe("updated-b");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("project-b", {
      skip: 0,
      limit: 100,
    });
    client.clear();
  });
});
