import { act, renderHook, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectAlertStates } from "./useAllProjectAlertStates";
import { fetchAlertStates } from "../api/alerts";
import type { AlertState, ProjectItem } from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeAlertState,
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
jest.mock("../api/alerts", () => {
  return { fetchAlertStates: jest.fn() };
});
const fetchMock: jest.MockedFunction<typeof fetchAlertStates> =
  jest.mocked(fetchAlertStates);

beforeEach(() => {
  mockContext.projectList = [];
  mockContext.isLoadingProjects = false;
  fetchMock.mockReset();
});

describe("Selected-project alert response states", () => {
  test("project discovery stays loading without making a state request", async () => {
    mockContext.isLoadingProjects = true;
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(true);
    expect(result.current.statesMap.size).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test("no selected project settles without any states", async () => {
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
    expect(result.current.statesMap.size).toBe(0);
  });

  test("only the selected project's states are queried and made actionable", async () => {
    mockContext.projectList = [makeProject()];
    const states: AlertState[] = [
      makeAlertState(),
      makeAlertState({ _id: "resolved-a", isResolvedState: true }),
    ];
    fetchMock.mockResolvedValue(states);
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.statesMap.size).toBe(1);
    });
    expect(result.current.statesMap.get("project-1")).toEqual(states);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("project-1");
  });

  test("switching projects removes the previous response actions while new states load", async () => {
    mockContext.projectList = [makeProject()];
    fetchMock.mockResolvedValueOnce([makeAlertState({ _id: "old-action" })]);
    let release: (states: AlertState[]) => void = () => {
      return undefined;
    };
    fetchMock.mockReturnValueOnce(
      new Promise((resolve: (value: AlertState[]) => void) => {
        release = resolve;
      }),
    );
    const { result, rerender } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.statesMap.size).toBe(1);
    });
    mockContext.projectList = [
      makeProject({ _id: "project-2", name: "Staging" }),
    ];
    await rerender(undefined);
    expect(result.current.statesMap.has("project-1")).toBe(false);
    expect(result.current.isLoading).toBe(true);
    await act(async () => {
      release([makeAlertState({ _id: "new-action" })]);
    });
    await waitFor(() => {
      expect(result.current.statesMap.get("project-2")?.[0]?._id).toBe(
        "new-action",
      );
    });
    expect(fetchMock).toHaveBeenLastCalledWith("project-2");
  });

  test("a state request failure is distinguishable from a project with no states", async () => {
    mockContext.projectList = [makeProject()];
    fetchMock.mockRejectedValue(new Error("Offline"));
    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(createTestQueryClient()) },
    );
    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(result.current.statesMap.size).toBe(0);
    expect(result.current.isLoading).toBe(false);
  });
});
