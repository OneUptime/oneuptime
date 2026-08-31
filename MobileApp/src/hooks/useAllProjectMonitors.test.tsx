import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { useAllProjectMonitors } from "./useAllProjectMonitors";
import { fetchMonitors } from "../api/monitors";
import type { ProjectItem } from "../api/types";
import {
  createQueryWrapper,
  createTestQueryClient,
  makeListResponse,
  makeMonitor,
  makeProject,
} from "../__tests__/testSupport";

/*
 * This hook fans one request out per project, which makes its loading flag a
 * statement about TWO things: the project list, and the per-project requests
 * built from it. The second is obvious and was already handled; the first is
 * the one that bites.
 *
 * useQueries with an empty project list produces an empty array of queries,
 * and `some()` over an empty array is false. So on the very first render -
 * before the project list has come back at all - the hook reported itself
 * fully loaded with zero monitors, and the Monitors tab drew its "no monitors"
 * empty state at a responder who has plenty. The tests below pin both halves:
 * loading while the list is on its way, settled once the list is genuinely
 * empty. Asserting only the first would be satisfied by a hook that never
 * finishes loading.
 *
 * useProject is mocked rather than wrapped in a real ProjectProvider because
 * the provider would drag in auth and the projects endpoint; the only thing
 * this hook reads from it is the list and its loading flag, and driving those
 * two directly is what lets a test sit in the window that used to be wrong.
 */

jest.mock("../api/monitors", () => {
  return {
    fetchMonitors: jest.fn(),
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

const fetchMonitorsMock: jest.MockedFunction<typeof fetchMonitors> =
  fetchMonitors as jest.MockedFunction<typeof fetchMonitors>;

/*
 * jest is configured with clearMocks, which forgets recorded calls but keeps
 * whatever implementation a previous test installed. Resetting fully means a
 * test that forgets to arm the mock fails loudly instead of quietly reusing
 * its neighbour's canned response.
 */
beforeEach(() => {
  fetchMonitorsMock.mockReset();
  mockProjectContext.projectList = [];
  mockProjectContext.isLoadingProjects = false;
});

describe("useAllProjectMonitors reports loading honestly", () => {
  test("stays loading while the project list is still being fetched", async () => {
    /*
     * The window this hook used to get wrong: the responder is signed in, the
     * project list request is in flight, and there is consequently nothing to
     * fan out to yet. `items` being empty here is correct - claiming to be
     * DONE while it is empty is what turned into "no monitors" on screen.
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = true;
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.items).toEqual([]);
    expect(fetchMonitorsMock).not.toHaveBeenCalled();
  });

  test("settles once the project list has come back empty", async () => {
    /*
     * The other half, and the reason the fix cannot simply be "always report
     * loading when there are no queries": a responder who really does belong
     * to no projects has to reach the empty state, not a skeleton that spins
     * forever with no way out.
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = false;
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.items).toEqual([]);
  });

  test("stops loading once every project's monitors have landed", async () => {
    mockProjectContext.projectList = [
      makeProject(),
      makeProject({ _id: "project-2", name: "Acme Staging" }),
    ];
    fetchMonitorsMock.mockResolvedValue(makeListResponse([makeMonitor()]));
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectMonitors();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isLoading).toBe(false);
    });
    expect(result.current.items).toHaveLength(2);
    expect(result.current.items[0]?.projectName).toBe("Acme Production");
    expect(result.current.items[1]?.projectName).toBe("Acme Staging");
  });
});
