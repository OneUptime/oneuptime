import { act, renderHook, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectAlerts } from "./useAllProjectAlerts";
import { useAllProjectAlertEpisodes } from "./useAllProjectAlertEpisodes";
import { useActiveProject } from "./useProject";
import { fetchAlerts, fetchAllAlerts } from "../api/alerts";
import {
  fetchAlertEpisodes,
  fetchAllAlertEpisodes,
} from "../api/alertEpisodes";
import type {
  AlertItem,
  AlertEpisodeItem,
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

jest.mock("./useProject", () => {
  return { useActiveProject: jest.fn() };
});
jest.mock("../api/alerts", () => {
  return { fetchAlerts: jest.fn(), fetchAllAlerts: jest.fn() };
});
jest.mock("../api/alertEpisodes", () => {
  return { fetchAlertEpisodes: jest.fn(), fetchAllAlertEpisodes: jest.fn() };
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
  jest.mocked(fetchAlerts).mockReset();
  jest.mocked(fetchAlertEpisodes).mockReset();
  selectProject(projectA);
});

describe("useAllProjectAlerts selects one project", () => {
  const fetchMock: jest.MockedFunction<typeof fetchAlerts> =
    jest.mocked(fetchAlerts);

  test("no selected project settles without a request, including manual refresh", async () => {
    selectProject();
    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
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
        return useAllProjectAlerts();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requests the selected tenant and binds rows without project metadata to it", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([makeAlert({ _id: "row-a", projectId: undefined })]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
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
    expect(fetchAllAlerts).not.toHaveBeenCalled();
    expect(result.current.items[0]).toMatchObject({
      projectId: "project-a",
      projectName: "Production",
      item: { _id: "row-a" },
    });
  });

  test("a response explicitly naming a different tenant cannot leak into the selected inbox", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeAlert({ _id: "row-a", projectId: "project-a" }),
        makeAlert({ _id: "row-b", projectId: "project-b" }),
      ]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(
      result.current.items.map(
        (row: ReturnType<typeof useAllProjectAlerts>["items"][number]) => {
          return row.item._id;
        },
      ),
    ).toEqual(["row-a"]);
  });

  test("malformed list envelopes do not crash the inbox", async () => {
    fetchMock.mockResolvedValue({
      data: null,
    } as unknown as ListResponse<AlertItem>);
    const { result } = await renderHook(
      () => {
        return useAllProjectAlerts();
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
        return useAllProjectAlerts();
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
      makeListResponse([makeAlert({ _id: "row-a", projectId: "project-a" })]),
    );
    let release: (response: ListResponse<AlertItem>) => void = () => {
      return undefined;
    };
    const pending: Promise<ListResponse<AlertItem>> = new Promise(
      (resolve: (value: ListResponse<AlertItem>) => void) => {
        release = resolve;
      },
    );
    fetchMock.mockReturnValueOnce(pending);
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectAlerts();
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
        makeListResponse([makeAlert({ _id: "row-b", projectId: "project-b" })]),
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
      ["alerts", "project-a"],
      makeListResponse([
        makeAlert({ _id: "cached-a", projectId: "project-a" }),
      ]),
    );
    client.setQueryData(
      ["alerts", "project-b"],
      makeListResponse([
        makeAlert({ _id: "cached-b", projectId: "project-b" }),
      ]),
    );
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeAlert({ _id: "updated-b", projectId: "project-b" }),
      ]),
    );
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectAlerts();
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

describe("useAllProjectAlertEpisodes selects one project", () => {
  const fetchMock: jest.MockedFunction<typeof fetchAlertEpisodes> =
    jest.mocked(fetchAlertEpisodes);

  test("no selected project settles without a request, including manual refresh", async () => {
    selectProject();
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
        return useAllProjectAlertEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("requests the selected tenant and binds rows without project metadata to it", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeAlertEpisode({ _id: "row-a", projectId: undefined }),
      ]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
    expect(fetchAllAlertEpisodes).not.toHaveBeenCalled();
    expect(result.current.items[0]).toMatchObject({
      projectId: "project-a",
      projectName: "Production",
      item: { _id: "row-a" },
    });
  });

  test("a response explicitly naming a different tenant cannot leak into the selected inbox", async () => {
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeAlertEpisode({ _id: "row-a", projectId: "project-a" }),
        makeAlertEpisode({ _id: "row-b", projectId: "project-b" }),
      ]),
    );
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(
      result.current.items.map(
        (
          row: ReturnType<typeof useAllProjectAlertEpisodes>["items"][number],
        ) => {
          return row.item._id;
        },
      ),
    ).toEqual(["row-a"]);
  });

  test("malformed list envelopes do not crash the inbox", async () => {
    fetchMock.mockResolvedValue({
      data: null,
    } as unknown as ListResponse<AlertEpisodeItem>);
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
        return useAllProjectAlertEpisodes();
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
        makeAlertEpisode({ _id: "row-a", projectId: "project-a" }),
      ]),
    );
    let release: (response: ListResponse<AlertEpisodeItem>) => void = () => {
      return undefined;
    };
    const pending: Promise<ListResponse<AlertEpisodeItem>> = new Promise(
      (resolve: (value: ListResponse<AlertEpisodeItem>) => void) => {
        release = resolve;
      },
    );
    fetchMock.mockReturnValueOnce(pending);
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
          makeAlertEpisode({ _id: "row-b", projectId: "project-b" }),
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
      ["alert-episodes", "project-a"],
      makeListResponse([
        makeAlertEpisode({ _id: "cached-a", projectId: "project-a" }),
      ]),
    );
    client.setQueryData(
      ["alert-episodes", "project-b"],
      makeListResponse([
        makeAlertEpisode({ _id: "cached-b", projectId: "project-b" }),
      ]),
    );
    fetchMock.mockResolvedValue(
      makeListResponse([
        makeAlertEpisode({ _id: "updated-b", projectId: "project-b" }),
      ]),
    );
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectAlertEpisodes();
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
