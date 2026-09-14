import React, { type ReactNode } from "react";
import {
  renderHook,
  act,
  waitFor,
  type RenderHookResult,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { ProjectProvider, useProject, useActiveProject } from "./useProject";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { setServerUrl } from "../storage/serverUrl";
import { clearTokens } from "../storage/keychain";
import { fetchProjects } from "../api/projects";
import type { ListResponse, ProjectItem } from "../api/types";
import { makeListResponse, makeProject } from "../__tests__/testSupport";

/*
 * The project list is the tenant every other request in the app is made
 * against, so the two ways it can be WRONG are both expensive.
 *
 * An empty list that is empty because the fetch failed looks exactly like an
 * account that has no projects, and the screens key their empty states on
 * length === 0. One of those states wants "create a project"; the other wants
 * "try again". Getting it backwards leaves a responder reading onboarding copy
 * while their incidents are one retry away.
 *
 * A list that arrives late is worse. The fetch is a network round trip and the
 * user can sign out during one; the response then lands in a provider whose
 * account has already changed, and the previous responder's projects become
 * the tenant that the next person's queries are sent with.
 */

interface MockAuthState {
  isAuthenticated: boolean;
  isLoading: boolean;
  user: { _id: string } | null;
}

const mockAuthState: MockAuthState = {
  isAuthenticated: true,
  isLoading: false,
  user: { _id: "responder-a" },
};

jest.mock("./useAuth", () => {
  return {
    useAuth: () => {
      return mockAuthState;
    },
  };
});

jest.mock("../api/projects", () => {
  return {
    fetchProjects: jest.fn(),
  };
});

const fetchProjectsMock: jest.MockedFunction<typeof fetchProjects> =
  fetchProjects as jest.MockedFunction<typeof fetchProjects>;

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

/*
 * A fetch the test decides when to finish, which is the only way to hold the
 * provider in the middle of a load while something else - a sign-out - happens
 * around it.
 */
function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {
    return undefined;
  };

  const promise: Promise<T> = new Promise<T>((settle: (value: T) => void) => {
    resolve = settle;
  });

  return { promise, resolve };
}

interface ProjectWrapperProps {
  children: ReactNode;
}

type ProjectSnapshot = {
  all: ReturnType<typeof useProject>;
  scoped: ReturnType<typeof useActiveProject>;
};
type ProjectHook = RenderHookResult<ProjectSnapshot, unknown>;
type ScopedProjectHook = RenderHookResult<
  ReturnType<typeof useActiveProject>,
  unknown
>;

function ProjectWrapper({ children }: ProjectWrapperProps): React.JSX.Element {
  return <ProjectProvider>{children}</ProjectProvider>;
}

beforeEach(async () => {
  await clearTokens();
  await AsyncStorage.clear();
  fetchProjectsMock.mockReset();
  mockAuthState.isAuthenticated = true;
  mockAuthState.isLoading = false;
  mockAuthState.user = { _id: "responder-a" };
});

describe("A single remembered project", () => {
  const first: ProjectItem = makeProject({ _id: "project-a", name: "Acme" });
  const second: ProjectItem = makeProject({ _id: "project-b", name: "Beta" });

  async function mountProjects(): Promise<ProjectHook> {
    fetchProjectsMock.mockResolvedValue(makeListResponse([first, second]));
    const hook: ProjectHook = await renderHook(
      () => {
        return { all: useProject(), scoped: useActiveProject() };
      },
      { wrapper: ProjectWrapper },
    );
    await waitFor(() => {
      return expect(hook.result.current.all.isLoadingProjects).toBe(false);
    });
    return hook;
  }

  test("defaults to one membership and changes every scoped consumer together", async () => {
    const { result } = await mountProjects();
    expect(result.current.all.projectList).toEqual([first, second]);
    expect(result.current.scoped.projectList).toEqual([first]);
    await act(() => {
      result.current.all.selectProject(second._id);
    });
    expect(result.current.all.activeProject).toEqual(second);
    expect(result.current.scoped.projectList).toEqual([second]);
    expect(result.current.all.projectList).toHaveLength(2);
  });

  test("rejects an aggregate or a project outside the account's memberships", async () => {
    const { result } = await mountProjects();
    await act(() => {
      result.current.all.selectProject("all");
      result.current.all.selectProject("another-account-project");
    });
    expect(result.current.scoped.projectList).toEqual([first]);
  });

  test("cold reopening restores the last choice before publishing any project to consumers", async () => {
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
    });
    await original.unmount();
    const seen: string[] = [];
    const reopened: ScopedProjectHook = await renderHook(
      () => {
        const scoped: ReturnType<typeof useActiveProject> = useActiveProject();
        if (scoped.activeProject) {
          seen.push(scoped.activeProject._id);
        }
        return scoped;
      },
      { wrapper: ProjectWrapper },
    );
    await waitFor(() => {
      return expect(reopened.result.current.isLoadingProjects).toBe(false);
    });
    expect(reopened.result.current.activeProject).toEqual(second);
    expect(seen.length).toBeGreaterThan(0);
    expect(
      seen.every((id: string) => {
        return id === second._id;
      }),
    ).toBe(true);
  });

  test("a real cold restore with user null waits for token identity and restores that account's choice", async () => {
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
    });
    await original.unmount();
    await clearTokens();
    mockAuthState.user = null;
    const token: string = `header.${Buffer.from(JSON.stringify({ userId: "responder-a" })).toString("base64url")}.signature`;
    const storedTokens: string = JSON.stringify({
      accessToken: token,
      refreshToken: "refresh",
      refreshTokenExpiresAt: "2099-01-01",
    });
    await AsyncStorage.setItem("com.oneuptime.oncall.tokens", storedTokens);
    const tokenRead: Deferred<string | null> = createDeferred<string | null>();
    const getItemMock: jest.MockedFunction<typeof AsyncStorage.getItem> =
      AsyncStorage.getItem as jest.MockedFunction<typeof AsyncStorage.getItem>;
    const originalGet: typeof AsyncStorage.getItem =
      getItemMock.getMockImplementation()!;
    getItemMock.mockImplementation((key: string) => {
      return key === "com.oneuptime.oncall.tokens"
        ? tokenRead.promise
        : originalGet(key);
    });
    fetchProjectsMock.mockClear();
    const seen: string[] = [];
    try {
      const restored: ScopedProjectHook = await renderHook(
        () => {
          const scoped: ReturnType<typeof useActiveProject> =
            useActiveProject();
          if (scoped.activeProject) {
            seen.push(scoped.activeProject._id);
          }
          return scoped;
        },
        { wrapper: ProjectWrapper },
      );
      expect(restored.result.current.isLoadingProjects).toBe(true);
      expect(restored.result.current.projectList).toEqual([]);
      expect(fetchProjectsMock).not.toHaveBeenCalled();
      await act(async () => {
        tokenRead.resolve(storedTokens);
      });
      await waitFor(() => {
        return expect(restored.result.current.activeProject).toEqual(second);
      });
      expect(
        seen.every((id: string) => {
          return id === second._id;
        }),
      ).toBe(true);
    } finally {
      tokenRead.resolve(storedTokens);
      getItemMock.mockImplementation(originalGet);
    }
  });

  test("a delayed earlier disk write cannot overwrite a later selection", async () => {
    const original: ProjectHook = await mountProjects();
    const delayed: Deferred<void> = createDeferred<void>();
    const setItemMock: jest.MockedFunction<typeof AsyncStorage.setItem> =
      AsyncStorage.setItem as jest.MockedFunction<typeof AsyncStorage.setItem>;
    const originalSet: typeof AsyncStorage.setItem =
      setItemMock.getMockImplementation()!;
    setItemMock.mockImplementation(async (key: string, value: string) => {
      if (key.startsWith("oneuptime_active_project:") && value === second._id) {
        await delayed.promise;
      }
      await originalSet(key, value);
    });
    try {
      await act(() => {
        original.result.current.all.selectProject(second._id);
      });
      await act(() => {
        original.result.current.all.selectProject(first._id);
      });
      expect(original.result.current.all.activeProject).toEqual(first);
      await act(async () => {
        delayed.resolve();
      });
      await original.unmount();
      const restored: ProjectHook = await mountProjects();
      expect(restored.result.current.all.activeProject).toEqual(first);
    } finally {
      delayed.resolve();
      setItemMock.mockImplementation(originalSet);
    }
  });

  test("rapid switches are stored in order and the final choice survives reopening", async () => {
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
      original.result.current.all.selectProject(first._id);
      original.result.current.all.selectProject(second._id);
    });
    await original.unmount();
    const reopened: ProjectHook = await mountProjects();
    expect(reopened.result.current.all.activeProject).toEqual(second);
  });

  test("a revoked saved project falls back to a remaining membership and persists the fallback", async () => {
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
    });
    fetchProjectsMock.mockResolvedValue(makeListResponse([first]));
    await act(async () => {
      await original.result.current.all.refreshProjects();
    });
    expect(original.result.current.scoped.projectList).toEqual([first]);
    await original.unmount();
    const reopened: ProjectHook = await mountProjects();
    expect(reopened.result.current.all.activeProject).toEqual(first);
  });

  test("a refresh never overwrites a project picked while its response was pending", async () => {
    const hook: ProjectHook = await mountProjects();
    const inFlight: Deferred<ListResponse<ProjectItem>> =
      createDeferred<ListResponse<ProjectItem>>();
    fetchProjectsMock.mockReturnValueOnce(inFlight.promise);
    let refresh: Promise<void> | undefined;
    await act(() => {
      refresh = hook.result.current.all.refreshProjects();
    });
    await act(() => {
      hook.result.current.all.selectProject(second._id);
    });
    await act(async () => {
      inFlight.resolve(makeListResponse([first, second]));
      await refresh;
    });
    expect(hook.result.current.scoped.projectList).toEqual([second]);
  });

  test("accounts with overlapping project IDs never inherit each other's preference", async () => {
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
    });
    await original.unmount();
    mockAuthState.user = { _id: "responder-b" };
    const other: ProjectHook = await mountProjects();
    expect(other.result.current.all.activeProject).toEqual(first);
    await other.unmount();
    mockAuthState.user = { _id: "responder-a" };
    const restored: ProjectHook = await mountProjects();
    expect(restored.result.current.all.activeProject).toEqual(second);
  });

  test("the same account on a different server has an independent preference", async () => {
    await setServerUrl("https://first.example.com");
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
    });
    await original.unmount();
    await setServerUrl("https://second.example.com");
    const other: ProjectHook = await mountProjects();
    expect(other.result.current.all.activeProject).toEqual(first);
    await other.unmount();
    await setServerUrl("https://first.example.com");
    const restored: ProjectHook = await mountProjects();
    expect(restored.result.current.all.activeProject).toEqual(second);
  });

  test("signing out clears visible tenant data and retains only the account-scoped preference", async () => {
    const original: ProjectHook = await mountProjects();
    await act(() => {
      original.result.current.all.selectProject(second._id);
    });
    mockAuthState.isAuthenticated = false;
    mockAuthState.user = null;
    await original.rerender(undefined);
    expect(original.result.current.scoped.projectList).toEqual([]);
    expect(original.result.current.all.activeProject).toBeNull();
    await original.unmount();
    mockAuthState.isAuthenticated = true;
    mockAuthState.user = { _id: "responder-a" };
    const reopened: ProjectHook = await mountProjects();
    expect(reopened.result.current.all.activeProject).toEqual(second);
  });

  test("an account change hides the previous tenant before the new request completes", async () => {
    const hook: ProjectHook = await mountProjects();
    const inFlight: Deferred<ListResponse<ProjectItem>> =
      createDeferred<ListResponse<ProjectItem>>();
    fetchProjectsMock.mockReturnValueOnce(inFlight.promise);
    mockAuthState.user = { _id: "responder-b" };
    await hook.rerender(undefined);
    expect(hook.result.current.scoped.projectList).toEqual([]);
    expect(hook.result.current.all.activeProject).toBeNull();
    await act(async () => {
      inFlight.resolve(makeListResponse([second]));
    });
    await waitFor(() => {
      return expect(hook.result.current.all.activeProject).toEqual(second);
    });
  });

  test("when membership becomes empty there is no active project to query", async () => {
    const hook: ProjectHook = await mountProjects();
    fetchProjectsMock.mockResolvedValue(makeListResponse([]));
    await act(async () => {
      await hook.result.current.all.refreshProjects();
    });
    expect(hook.result.current.scoped.projectList).toEqual([]);
    expect(hook.result.current.all.activeProject).toBeNull();
  });
});

describe("ProjectProvider on a successful load", () => {
  test("publishes the projects and no error", async () => {
    fetchProjectsMock.mockResolvedValue(
      makeListResponse([makeProject({ _id: "project-a", name: "Acme" })]),
    );

    const { result } = await renderHook(
      () => {
        return useProject();
      },
      { wrapper: ProjectWrapper },
    );

    await waitFor(() => {
      return expect(result.current.isLoadingProjects).toBe(false);
    });

    expect(result.current.projectList).toHaveLength(1);
    expect(result.current.projectLoadError).toBeNull();
  });
});

describe("ProjectProvider when the project fetch fails", () => {
  test("says the load failed instead of looking like an account with no projects", async () => {
    fetchProjectsMock.mockRejectedValue(new Error("Network request failed"));

    const { result } = await renderHook(
      () => {
        return useProject();
      },
      { wrapper: ProjectWrapper },
    );

    await waitFor(() => {
      return expect(result.current.isLoadingProjects).toBe(false);
    });

    expect(result.current.projectList).toEqual([]);
    expect(result.current.projectLoadError).toBeInstanceOf(Error);
    expect(result.current.projectLoadError?.message).toBe(
      "Network request failed",
    );
  });

  test("a refresh that succeeds clears the error", async () => {
    fetchProjectsMock.mockRejectedValueOnce(
      new Error("Network request failed"),
    );
    fetchProjectsMock.mockResolvedValue(
      makeListResponse([makeProject({ _id: "project-a", name: "Acme" })]),
    );

    const { result } = await renderHook(
      () => {
        return useProject();
      },
      { wrapper: ProjectWrapper },
    );

    await waitFor(() => {
      return expect(result.current.projectLoadError).toBeInstanceOf(Error);
    });

    await act(async () => {
      await result.current.refreshProjects();
    });

    expect(result.current.projectLoadError).toBeNull();
    expect(result.current.projectList).toHaveLength(1);
  });
});

describe("ProjectProvider across a sign-out", () => {
  test("a response that lands after the sign-out does not repopulate the list", async () => {
    /*
     * The load is in flight when the user signs out. Whoever is looking at the
     * phone next must not inherit the previous account's tenants - every
     * per-project query in the app is keyed off this list.
     */
    const inFlight: Deferred<ListResponse<ProjectItem>> =
      createDeferred<ListResponse<ProjectItem>>();
    fetchProjectsMock.mockReturnValue(inFlight.promise);

    const { result, rerender } = await renderHook(
      () => {
        return useProject();
      },
      { wrapper: ProjectWrapper },
    );

    expect(result.current.isLoadingProjects).toBe(true);

    mockAuthState.isAuthenticated = false;
    await rerender(undefined);

    expect(result.current.projectList).toEqual([]);

    await act(async () => {
      inFlight.resolve(
        makeListResponse([
          makeProject({
            _id: "project-of-previous-account",
            name: "Previous Employer",
          }),
        ]),
      );
      await inFlight.promise;
      await Promise.resolve();
    });

    expect(result.current.projectList).toEqual([]);
    expect(result.current.isLoadingProjects).toBe(false);
  });

  test("an error from a load that outlived the session is not shown to the next user", async () => {
    const inFlight: Deferred<ListResponse<ProjectItem>> =
      createDeferred<ListResponse<ProjectItem>>();
    const rejected: Promise<ListResponse<ProjectItem>> = inFlight.promise.then(
      () => {
        throw new Error("Network request failed");
      },
    );
    fetchProjectsMock.mockReturnValue(rejected);

    const { result, rerender } = await renderHook(
      () => {
        return useProject();
      },
      { wrapper: ProjectWrapper },
    );

    mockAuthState.isAuthenticated = false;
    await rerender(undefined);

    await act(async () => {
      inFlight.resolve(makeListResponse([]));
      await rejected.catch((): void => {
        return undefined;
      });
      await Promise.resolve();
    });

    expect(result.current.projectLoadError).toBeNull();
  });
});
