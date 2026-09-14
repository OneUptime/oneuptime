import { act, renderHook, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectMonitors } from "./useAllProjectMonitors";
import { fetchMonitors } from "../api/monitors";
import type { ProjectItem, MonitorItem, ListResponse } from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeListResponse,
  makeMonitor,
  makeProject,
} from "../__tests__/testSupport";

const mockContext: { projectList: ProjectItem[]; isLoadingProjects: boolean } =
  { projectList: [], isLoadingProjects: false };
jest.mock("./useProject", () => {
  return {
    useActiveProject: () => {
      return mockContext;
    },
  };
});
jest.mock("../api/monitors", () => {
  return { fetchMonitors: jest.fn() };
});
const fetchMock: jest.MockedFunction<typeof fetchMonitors> =
  jest.mocked(fetchMonitors);

beforeEach(() => {
  mockContext.projectList = [];
  mockContext.isLoadingProjects = false;
  fetchMock.mockReset();
});

describe("Selected-project monitors", () => {
  test("waits for project discovery before claiming there are no monitors", async () => {
    mockContext.isLoadingProjects = true;
    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("no project settles, and refresh cannot issue a tenantless request", async () => {
    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(false);
    await act(async () => {
      await result.current.refetch();
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("only the selected project's monitors appear with its project context", async () => {
    mockContext.projectList = [makeProject()];
    fetchMock.mockResolvedValue(makeListResponse([makeMonitor()]));
    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    expect(result.current.items[0]).toMatchObject({
      projectId: "project-1",
      projectName: "Acme Production",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("project-1", {
      skip: 0,
      limit: 100,
    });
  });

  test("switching project hides old monitors until the new tenant answers", async () => {
    mockContext.projectList = [makeProject()];
    fetchMock.mockResolvedValueOnce(
      makeListResponse([makeMonitor({ _id: "monitor-a" })]),
    );
    let release: (response: ListResponse<MonitorItem>) => void = () => {
      return undefined;
    };
    fetchMock.mockReturnValueOnce(
      new Promise((resolve: (value: ListResponse<MonitorItem>) => void) => {
        release = resolve;
      }),
    );
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.items).toHaveLength(1);
    });
    mockContext.projectList = [
      makeProject({ _id: "project-2", name: "Staging" }),
    ];
    await rerender(undefined);
    expect(result.current.items).toEqual([]);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      release(
        makeListResponse([
          makeMonitor({ _id: "monitor-b", projectId: "project-2" }),
        ]),
      );
    });
    await waitFor(() => {
      expect(result.current.items[0]?.item._id).toBe("monitor-b");
    });
  });

  test("a malformed response does not crash the monitor screen", async () => {
    mockContext.projectList = [makeProject()];
    fetchMock.mockResolvedValue({
      data: null,
    } as unknown as ListResponse<MonitorItem>);
    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toEqual([]);
  });

  test("failed monitor requests are not presented as successful empty results", async () => {
    mockContext.projectList = [makeProject()];
    fetchMock.mockRejectedValue(new Error("Offline"));
    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.items).toEqual([]);
  });
});
