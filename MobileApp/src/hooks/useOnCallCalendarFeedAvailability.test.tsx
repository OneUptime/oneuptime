import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  useOnCallCalendarFeedAvailability,
  type UseOnCallCalendarFeedAvailabilityResult,
} from "./useOnCallCalendarFeedAvailability";
import * as calendarApi from "../api/onCallCalendar";
import type { ProjectItem } from "../api/types";

/*
 * The probe that decides whether the calendar rows are shown at all.
 *
 * The rule is narrow on purpose: only a 404 - the route does not exist -
 * hides the feature. Every other outcome, including no network, keeps it
 * visible, because a feature that comes and goes with the signal is worse
 * than one that shows an error when tapped.
 */

const PROJECTS: ProjectItem[] = [
  { _id: "project-1", name: "Acme", slug: "acme" } as ProjectItem,
  { _id: "project-2", name: "Globex", slug: "globex" } as ProjectItem,
];

const mockProjects: { current: ProjectItem[] } = { current: PROJECTS };
const mockAuthorized: { current: ProjectItem[] | null } = { current: null };

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
    getAuthorizedProjects: async (
      projects: ProjectItem[],
    ): Promise<ProjectItem[]> => {
      return mockAuthorized.current ?? projects;
    },
  };
});

jest.mock("../api/onCallCalendar", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/onCallCalendar",
  ) as Record<string, unknown>;

  return {
    ...actual,
    fetchPersonalCalendarFeed: jest.fn(),
  };
});

function fetchSpy(): jest.SpyInstance {
  return calendarApi.fetchPersonalCalendarFeed as unknown as jest.SpyInstance;
}

function axiosError(httpStatus: number | null): unknown {
  return {
    isAxiosError: true,
    message: "failed",
    ...(httpStatus === null ? {} : { response: { status: httpStatus } }),
  };
}

function createWrapper(): ({
  children,
}: {
  children: React.ReactNode;
}) => React.JSX.Element {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return function Wrapper({
    children,
  }: {
    children: React.ReactNode;
  }): React.JSX.Element {
    return (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
  };
}

async function renderAvailability(): Promise<{
  result: { current: UseOnCallCalendarFeedAvailabilityResult };
}> {
  return await renderHook(
    (): UseOnCallCalendarFeedAvailabilityResult => {
      return useOnCallCalendarFeedAvailability();
    },
    { wrapper: createWrapper() },
  );
}

describe("useOnCallCalendarFeedAvailability", () => {
  beforeEach(() => {
    mockProjects.current = PROJECTS;
    mockAuthorized.current = null;
    fetchSpy().mockReset();
  });

  test("is optimistic while the probe is in flight", async () => {
    fetchSpy().mockReturnValue(new Promise(() => {}) as never);

    const { result } = await renderAvailability();

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.isChecking).toBe(true);
  });

  test("a successful probe keeps the feature visible", async () => {
    fetchSpy().mockResolvedValue({ exists: false } as never);

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
    expect(fetchSpy()).toHaveBeenCalledWith("project-1");
    expect(fetchSpy()).toHaveBeenCalledTimes(1);
  });

  test("a 404 hides the feature", async () => {
    fetchSpy().mockRejectedValue(axiosError(404) as never);

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isAvailable).toBe(false);
    });
  });

  test("a 403 keeps it visible - the route is there, access is not", async () => {
    fetchSpy().mockRejectedValue(axiosError(403) as never);

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
  });

  test("a 500 keeps it visible", async () => {
    fetchSpy().mockRejectedValue(axiosError(500) as never);

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
  });

  test("no network keeps it visible", async () => {
    fetchSpy().mockRejectedValue(axiosError(null) as never);

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
  });

  test("probes the first AUTHORIZED project, skipping SSO-locked ones", async () => {
    /*
     * Probing an SSO-enforced project without a token answers 406 and would
     * record a refusal the projects screen then shows as a problem.
     */
    mockAuthorized.current = [PROJECTS[1]!];
    fetchSpy().mockResolvedValue({ exists: false } as never);

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(fetchSpy()).toHaveBeenCalledWith("project-2");
  });

  test("with no project to probe it stays visible without a request", async () => {
    mockAuthorized.current = [];

    const { result } = await renderAvailability();

    await waitFor(() => {
      expect(result.current.isChecking).toBe(false);
    });

    expect(result.current.isAvailable).toBe(true);
    expect(fetchSpy()).not.toHaveBeenCalled();
  });

  test("with no projects at all nothing is asked", async () => {
    mockProjects.current = [];

    const { result } = await renderAvailability();

    expect(result.current.isAvailable).toBe(true);
    expect(result.current.isChecking).toBe(false);
    expect(fetchSpy()).not.toHaveBeenCalled();
  });
});
