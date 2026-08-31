import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import {
  useOnCallOverrides,
  type UseOnCallOverridesResult,
} from "./useOnCallOverrides";
import * as overridesApi from "../api/onCallOverrides";
import type { OnCallOverrideItem, ProjectItem } from "../api/types";

/*
 * The split into in-effect / scheduled / ended is the whole point of the
 * overrides screen: "who is covering me right now" and "what did I book for
 * next Tuesday" are different questions, and one date-sorted list makes the
 * reader separate them in their head at the moment they are least able to.
 *
 * The fan-out also has to survive a project that fails - a responder with four
 * projects, one of them mid-outage, still needs the overrides from the other
 * three.
 */

const PROJECTS: ProjectItem[] = [
  { _id: "project-1", name: "Acme", slug: "acme" } as ProjectItem,
  { _id: "project-2", name: "Globex", slug: "globex" } as ProjectItem,
];

const mockProjects: { current: ProjectItem[] } = { current: PROJECTS };

jest.mock("./useProject", () => {
  return {
    useProject: () => {
      return {
        projectList: mockProjects.current,
        isLoadingProjects: false,
        refreshProjects: jest.fn(),
      };
    },
  };
});

jest.mock("./authorizedProjects", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "./authorizedProjects",
  ) as Record<string, unknown>;

  return {
    ...actual,
    getAuthorizedProjects: async (projects: unknown): Promise<unknown> => {
      return projects;
    },
  };
});

jest.mock("../api/onCallOverrides", () => {
  return {
    fetchOnCallOverrides: jest.fn(async () => {
      return [];
    }),
    createOnCallOverride: jest.fn(async () => {
      return undefined;
    }),
    deleteOnCallOverride: jest.fn(async () => {
      return undefined;
    }),
  };
});

const NOW: number = new Date("2026-03-03T12:00:00.000Z").getTime();

function override(
  id: string,
  startsAt: string,
  endsAt: string,
): OnCallOverrideItem {
  return {
    _id: id,
    projectId: "project-1",
    projectName: "Acme",
    overrideUser: { _id: "user-me", name: "Ada" },
    routeAlertsToUser: { _id: "user-2", name: "Priya" },
    onCallDutyPolicy: null,
    startsAt,
    endsAt,
    createdAt: "2026-03-01T00:00:00.000Z",
  };
}

function fetchSpy(): jest.SpyInstance {
  return overridesApi.fetchOnCallOverrides as unknown as jest.SpyInstance;
}

/*
 * One client per test, torn down afterwards.
 *
 * `gcTime: 0` on BOTH caches matters: a settled mutation otherwise parks a
 * five-minute garbage-collection timer, and a live timer keeps Jest's worker
 * from exiting. That surfaces as "a worker process has failed to exit
 * gracefully" - a warning rather than a failure, which is exactly why it would
 * otherwise sit in CI output forever.
 */
let queryClient: QueryClient = new QueryClient();

function wrapper({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

beforeEach(() => {
  queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
      mutations: { gcTime: 0 },
    },
  });
});

afterEach(() => {
  queryClient.clear();
});

async function renderOverrides(): Promise<{
  current: UseOnCallOverridesResult;
}> {
  const rendered: { result: { current: UseOnCallOverridesResult } } =
    (await renderHook(
      () => {
        return useOnCallOverrides(NOW);
      },
      { wrapper },
    )) as unknown as { result: { current: UseOnCallOverridesResult } };

  await waitFor(() => {
    expect(rendered.result.current.isLoading).toBe(false);
  });

  return rendered.result;
}

describe("useOnCallOverrides grouping", () => {
  beforeEach(() => {
    mockProjects.current = PROJECTS;
    fetchSpy().mockReset();
    fetchSpy().mockResolvedValue([] as never);
  });

  test("separates in-effect, scheduled and ended", async (): Promise<void> => {
    fetchSpy().mockImplementation(
      async (project: { projectId: string }): Promise<OnCallOverrideItem[]> => {
        if (project.projectId !== "project-1") {
          return [];
        }

        return [
          override(
            "active",
            "2026-03-03T09:00:00.000Z",
            "2026-03-03T18:00:00.000Z",
          ),
          override(
            "upcoming",
            "2026-03-04T09:00:00.000Z",
            "2026-03-04T18:00:00.000Z",
          ),
          override(
            "past",
            "2026-03-01T09:00:00.000Z",
            "2026-03-01T18:00:00.000Z",
          ),
        ];
      },
    );

    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    await waitFor(() => {
      expect(result.current.active).toHaveLength(1);
    });

    expect(result.current.active[0]?._id).toBe("active");
    expect(result.current.upcoming[0]?._id).toBe("upcoming");
    expect(result.current.past[0]?._id).toBe("past");
  });

  test("merges every project's overrides into the same three buckets", async (): Promise<void> => {
    fetchSpy().mockImplementation(
      async (project: {
        projectId: string;
        projectName: string;
      }): Promise<OnCallOverrideItem[]> => {
        return [
          {
            ...override(
              `active-${project.projectId}`,
              "2026-03-03T09:00:00.000Z",
              "2026-03-03T18:00:00.000Z",
            ),
            projectId: project.projectId,
            projectName: project.projectName,
          },
        ];
      },
    );

    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    await waitFor(() => {
      expect(result.current.active).toHaveLength(2);
    });
  });

  test("a project that fails does not take the others down with it", async (): Promise<void> => {
    fetchSpy().mockImplementation(
      async (project: { projectId: string }): Promise<OnCallOverrideItem[]> => {
        if (project.projectId === "project-2") {
          throw new Error("boom");
        }

        return [
          override(
            "active",
            "2026-03-03T09:00:00.000Z",
            "2026-03-03T18:00:00.000Z",
          ),
        ];
      },
    );

    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    await waitFor(() => {
      expect(result.current.active).toHaveLength(1);
    });

    expect(result.current.isError).toBe(false);
  });

  test("sorts scheduled overrides soonest first", async (): Promise<void> => {
    fetchSpy().mockImplementation(
      async (project: { projectId: string }): Promise<OnCallOverrideItem[]> => {
        if (project.projectId !== "project-1") {
          return [];
        }

        return [
          override(
            "later",
            "2026-03-10T09:00:00.000Z",
            "2026-03-10T18:00:00.000Z",
          ),
          override(
            "sooner",
            "2026-03-04T09:00:00.000Z",
            "2026-03-04T18:00:00.000Z",
          ),
        ];
      },
    );

    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    await waitFor(() => {
      expect(result.current.upcoming).toHaveLength(2);
    });

    expect(
      result.current.upcoming.map((item: OnCallOverrideItem) => {
        return item._id;
      }),
    ).toEqual(["sooner", "later"]);
  });

  test("does not query at all when the user has no projects", async (): Promise<void> => {
    mockProjects.current = [];

    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    expect(fetchSpy()).not.toHaveBeenCalled();
    expect(result.current.active).toEqual([]);
  });
});

describe("useOnCallOverrides writes", () => {
  beforeEach(() => {
    mockProjects.current = PROJECTS;
    fetchSpy().mockReset();
    fetchSpy().mockResolvedValue([] as never);
    (
      overridesApi.createOnCallOverride as unknown as jest.SpyInstance
    ).mockClear();
    (
      overridesApi.deleteOnCallOverride as unknown as jest.SpyInstance
    ).mockClear();
  });

  test("passes a create straight through to the API layer", async (): Promise<void> => {
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    const startsAt: Date = new Date(NOW);
    const endsAt: Date = new Date(NOW + 4 * 60 * 60 * 1000);

    await result.current.createOverride({
      projectId: "project-1",
      overrideUserId: "user-me",
      routeAlertsToUserId: "user-2",
      startsAt,
      endsAt,
    });

    expect(overridesApi.createOnCallOverride).toHaveBeenCalledWith({
      projectId: "project-1",
      overrideUserId: "user-me",
      routeAlertsToUserId: "user-2",
      startsAt,
      endsAt,
    });
  });

  test("cancels by the override's OWN project, not the first one", async (): Promise<void> => {
    /*
     * The list is merged across projects, so the row being cancelled may well
     * belong to a different tenant than the one at the top of the list. Using
     * anything but the row's own projectId here would send the delete to a
     * tenant that does not contain it.
     */
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    await result.current.cancelOverride({
      ...override(
        "override-9",
        "2026-03-03T09:00:00.000Z",
        "2026-03-03T18:00:00.000Z",
      ),
      projectId: "project-2",
      projectName: "Globex",
    });

    expect(overridesApi.deleteOnCallOverride).toHaveBeenCalledWith(
      "project-2",
      "override-9",
    );
  });
});
