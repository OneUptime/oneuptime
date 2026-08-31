import React, { type ReactNode } from "react";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import { ProjectProvider, useProject } from "./useProject";
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
}

const mockAuthState: MockAuthState = {
  isAuthenticated: true,
  isLoading: false,
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

function ProjectWrapper({ children }: ProjectWrapperProps): React.JSX.Element {
  return <ProjectProvider>{children}</ProjectProvider>;
}

beforeEach(() => {
  fetchProjectsMock.mockReset();
  mockAuthState.isAuthenticated = true;
  mockAuthState.isLoading = false;
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
