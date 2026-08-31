import { renderHook, waitFor } from "@testing-library/react-native";
import type { QueryClient } from "@tanstack/react-query";
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

/*
 * statesMap is not decoration. The Alerts screen reads it to decide which
 * state an Acknowledge or Resolve button should move an alert INTO, and to
 * decide whether a row belongs under Active or under Resolved. A project
 * missing from the map is a project whose alerts cannot be acted on.
 *
 * Two ways that map used to be wrong for a reason the screen could not see:
 *
 *   - Before the project list arrives there are no per-project queries at all,
 *     and `some()` over an empty array is false. The hook therefore announced
 *     itself loaded, with an empty map, on its first render.
 *   - A project whose state request FAILED is absent from the map in exactly
 *     the same way as a project that genuinely has no states. Nothing in the
 *     result told the two apart, so a failure quietly rendered as "there is
 *     nothing to act on here".
 *
 * The successful rows are deliberately asserted too: the fix is allowed to add
 * a failure signal, not to reshape what the screen already reads.
 */

jest.mock("../api/alerts", () => {
  return {
    fetchAlertStates: jest.fn(),
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

const fetchAlertStatesMock: jest.MockedFunction<typeof fetchAlertStates> =
  fetchAlertStates as jest.MockedFunction<typeof fetchAlertStates>;

beforeEach(() => {
  fetchAlertStatesMock.mockReset();
  mockProjectContext.projectList = [];
  mockProjectContext.isLoadingProjects = false;
});

describe("useAllProjectAlertStates", () => {
  test("stays loading while the project list is still being fetched", async () => {
    /*
     * An empty map reported as settled is what the acknowledge/resolve buttons
     * read as "this alert has nowhere to go". While the project list is in
     * flight the honest answer is "not yet", not "nothing".
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = true;
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(true);
    expect(result.current.statesMap.size).toBe(0);
    expect(fetchAlertStatesMock).not.toHaveBeenCalled();
  });

  test("settles once the project list has come back empty", async () => {
    /*
     * The complementary half: a responder in no projects must not be left
     * under a skeleton forever. Without this, "wait on the project list" could
     * be satisfied by never finishing.
     */
    mockProjectContext.projectList = [];
    mockProjectContext.isLoadingProjects = false;
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(client) },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  test("keys each project's states under that project's id", async () => {
    const productionStates: AlertState[] = [
      makeAlertState(),
      makeAlertState({
        _id: "alert-state-2",
        name: "Resolved",
        isResolvedState: true,
        isCreatedState: false,
        order: 3,
      }),
    ];
    const stagingStates: AlertState[] = [
      makeAlertState({ _id: "alert-state-9", name: "Acknowledged" }),
    ];
    mockProjectContext.projectList = [
      makeProject(),
      makeProject({ _id: "project-2", name: "Acme Staging" }),
    ];
    fetchAlertStatesMock.mockImplementation(async (projectId: string) => {
      return projectId === "project-1" ? productionStates : stagingStates;
    });
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.statesMap.size).toBe(2);
    });
    expect(result.current.statesMap.get("project-1")).toEqual(productionStates);
    expect(result.current.statesMap.get("project-2")).toEqual(stagingStates);
    expect(result.current.isLoading).toBe(false);
    expect(result.current.isError).toBe(false);
  });

  test("reports a failed project as an error rather than as a project with no states", async () => {
    /*
     * project-2 is absent from the map either way - that part is unchanged,
     * because the screen already copes with a project it has no states for.
     * What changes is that the absence is now attributable: isError is the
     * only thing separating "we could not ask" from "there is nothing here",
     * and the buttons that page a human are drawn off that distinction.
     */
    const productionStates: AlertState[] = [makeAlertState()];
    mockProjectContext.projectList = [
      makeProject(),
      makeProject({ _id: "project-2", name: "Acme Staging" }),
    ];
    fetchAlertStatesMock.mockImplementation(async (projectId: string) => {
      if (projectId === "project-2") {
        throw new Error("500 from /api/alert-state/get-list");
      }
      return productionStates;
    });
    const client: QueryClient = createTestQueryClient();

    const { result } = await renderHook(
      () => {
        return useAllProjectAlertStates();
      },
      { wrapper: createQueryWrapper(client) },
    );

    await waitFor(() => {
      return expect(result.current.isError).toBe(true);
    });
    expect(result.current.statesMap.get("project-1")).toEqual(productionStates);
    expect(result.current.statesMap.has("project-2")).toBe(false);
  });
});
