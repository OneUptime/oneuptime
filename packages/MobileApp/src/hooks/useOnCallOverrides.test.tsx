import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import {
  findOverlapConflict,
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
    useActiveProject: () => {
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
    updateOnCallOverride: jest.fn(async () => {
      return undefined;
    }),
    endOnCallOverrideNow: jest.fn(async () => {
      return undefined;
    }),
    fetchOverlappingOverrides: jest.fn(async () => {
      return [];
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

  test("cancels the override in the selected project", async (): Promise<void> => {
    /*
     * The list is merged across projects, so the row being cancelled may well
     * belong to a different tenant than the one at the top of the list. Using
     * anything but the row's own projectId here would send the delete to a
     * tenant that does not contain it.
     */
    mockProjects.current = [PROJECTS[1]!];
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

  test("refuses a stale override from another project before sending a delete", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();
    await expect(
      result.current.cancelOverride({
        ...override(
          "stale",
          "2026-03-03T09:00:00.000Z",
          "2026-03-03T18:00:00.000Z",
        ),
        projectId: "project-2",
      }),
    ).rejects.toThrow("The selected project changed");
    expect(overridesApi.deleteOnCallOverride).not.toHaveBeenCalled();
  });

  test("refuses a stale coverage draft from another project before creating it", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();
    await expect(
      result.current.createOverride({
        projectId: "project-2",
        overrideUserId: "me",
        routeAlertsToUserId: "priya",
        startsAt: new Date(NOW),
        endsAt: new Date(NOW + 3600000),
      }),
    ).rejects.toThrow("The selected project changed");
    expect(overridesApi.createOnCallOverride).not.toHaveBeenCalled();
  });

  /*
   * #7897: an edit and End now are writes in the override's own project,
   * refused - before anything is sent - for one of a project no longer
   * selected, as a cancel is.
   */
  test("edits the override in its project, with only what changes", async (): Promise<void> => {
    const update: jest.SpyInstance =
      overridesApi.updateOnCallOverride as unknown as jest.SpyInstance;
    update.mockClear();
    mockProjects.current = [PROJECTS[0]!];
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();
    const endsAt: Date = new Date(NOW + 2 * 60 * 60 * 1000);

    await result.current.updateOverride(
      override(
        "override-1",
        "2026-03-03T09:00:00.000Z",
        "2026-03-03T18:00:00.000Z",
      ),
      { routeAlertsToUserId: null, endsAt },
    );

    expect(update).toHaveBeenCalledWith("project-1", "override-1", {
      routeAlertsToUserId: null,
      endsAt,
    });
  });

  test("ends the override now in its project, with the phone's end for an older server", async (): Promise<void> => {
    const endNow: jest.SpyInstance =
      overridesApi.endOnCallOverrideNow as unknown as jest.SpyInstance;
    endNow.mockClear();
    const nowSpy: jest.SpyInstance = jest
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-03-03T12:00:30.000Z").getTime());
    mockProjects.current = [PROJECTS[0]!];
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();

    await result.current.endOverrideNow(
      override(
        "override-1",
        "2026-03-03T09:00:00.000Z",
        "2026-03-03T18:00:00.000Z",
      ),
    );

    expect(endNow).toHaveBeenCalledWith(
      "project-1",
      "override-1",
      new Date("2026-03-03T12:00:00.000Z"),
    );
    nowSpy.mockRestore();
  });

  test("refuses an edit or End now of an override from another project before sending either", async (): Promise<void> => {
    const update: jest.SpyInstance =
      overridesApi.updateOnCallOverride as unknown as jest.SpyInstance;
    const endNow: jest.SpyInstance =
      overridesApi.endOnCallOverrideNow as unknown as jest.SpyInstance;
    update.mockClear();
    endNow.mockClear();
    mockProjects.current = [PROJECTS[0]!];
    const result: { current: UseOnCallOverridesResult } =
      await renderOverrides();
    const stale: OnCallOverrideItem = {
      ...override(
        "stale",
        "2026-03-03T09:00:00.000Z",
        "2026-03-03T18:00:00.000Z",
      ),
      projectId: "project-2",
    };

    await expect(
      result.current.updateOverride(stale, { routeAlertsToUserId: null }),
    ).rejects.toThrow("The selected project changed");
    await expect(result.current.endOverrideNow(stale)).rejects.toThrow(
      "The selected project changed",
    );
    expect(update).not.toHaveBeenCalled();
    expect(endNow).not.toHaveBeenCalled();
  });
});

/*
 * The override a refusal for an overlap is about (#7897): read again for
 * the person and the times sent, and picked as the server picks it - the
 * same scope, not the override itself.
 */
describe("findOverlapConflict", () => {
  const fetchOverlaps: () => jest.SpyInstance = (): jest.SpyInstance => {
    return overridesApi.fetchOverlappingOverrides as unknown as jest.SpyInstance;
  };

  test("names the overlapping override of the same scope, never the one edited", async (): Promise<void> => {
    fetchOverlaps().mockResolvedValueOnce([
      override("this", "2026-03-03T09:00:00.000Z", "2026-03-03T18:00:00.000Z"),
      {
        ...override(
          "on-a-policy",
          "2026-03-03T10:00:00.000Z",
          "2026-03-03T11:00:00.000Z",
        ),
        onCallDutyPolicyId: "policy-7",
      },
      override(
        "global",
        "2026-03-03T13:00:00.000Z",
        "2026-03-03T14:00:00.000Z",
      ),
    ] as never);

    const found: OnCallOverrideItem | null = await findOverlapConflict({
      project: { projectId: "project-1", projectName: "Acme" },
      candidate: {
        id: "this",
        overrideUserId: "user-me",
        routeAlertsToUserId: "user-2",
        onCallDutyPolicyId: null,
        startsAt: new Date("2026-03-03T09:00:00.000Z"),
        endsAt: new Date("2026-03-03T18:00:00.000Z"),
      },
    });

    expect(found?._id).toBe("global");
    expect(fetchOverlaps()).toHaveBeenCalledWith(
      { projectId: "project-1", projectName: "Acme" },
      {
        overrideUserId: "user-me",
        startsAt: new Date("2026-03-03T09:00:00.000Z"),
        endsAt: new Date("2026-03-03T18:00:00.000Z"),
      },
    );
  });

  test("none when the read fails: the refusal is said alone", async (): Promise<void> => {
    fetchOverlaps().mockRejectedValueOnce(new Error("offline") as never);

    await expect(
      findOverlapConflict({
        project: { projectId: "project-1", projectName: "Acme" },
        candidate: {
          overrideUserId: "user-me",
          startsAt: new Date("2026-03-03T09:00:00.000Z"),
          endsAt: new Date("2026-03-03T18:00:00.000Z"),
        },
      }),
    ).resolves.toBeNull();
  });
});
