import React from "react";
import { renderHook, waitFor } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  computeMyShiftsWindow,
  useMyShifts,
  type UseMyShiftsResult,
} from "./useMyShifts";
import * as calendarApi from "../api/onCallCalendar";
import type { MyOnCallShift, ProjectItem } from "../api/types";

/*
 * `/my-shifts` is the upgrade over the roster-derived list, and the hook's
 * job is to make it a SAFE upgrade: the overview must be able to tell "the
 * server answered with nothing" from "the server could not answer", because
 * the first replaces the roster list and the second must not.
 */

const PROJECTS: ProjectItem[] = [
  { _id: "project-1", name: "Acme", slug: "acme" } as ProjectItem,
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

jest.mock("../api/onCallCalendar", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/onCallCalendar",
  ) as Record<string, unknown>;

  return {
    ...actual,
    fetchMyShifts: jest.fn(),
  };
});

function fetchSpy(): jest.SpyInstance {
  return calendarApi.fetchMyShifts as unknown as jest.SpyInstance;
}

const NOW: number = new Date("2026-03-03T12:03:40.000Z").getTime();

function shift(shiftKey: string): MyOnCallShift {
  return {
    shiftKey,
    contentHash: "h",
    projectId: "project-1",
    scheduleId: "schedule-1",
    scheduleName: "Primary",
    scheduleTimezone: null,
    userId: "user-me",
    userName: "Ada",
    start: "2026-03-04T09:00:00.000Z",
    end: "2026-03-04T17:00:00.000Z",
    coverageSeconds: 28800,
    policies: [],
    isPast: false,
    lastModifiedAt: "2026-03-01T00:00:00.000Z",
    shiftConfigVersion: 1,
  };
}

function axiosError(httpStatus: number): unknown {
  return {
    isAxiosError: true,
    message: "failed",
    response: { status: httpStatus },
  };
}

function createWrapper(): ({
  children,
}: {
  children: React.ReactNode;
}) => React.JSX.Element {
  const client: QueryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
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

describe("computeMyShiftsWindow", () => {
  test("rounds the start down to five minutes and adds the days", () => {
    const window: { from: Date; to: Date } = computeMyShiftsWindow(NOW, 14);

    expect(window.from.toISOString()).toBe("2026-03-03T12:00:00.000Z");
    expect(window.to.toISOString()).toBe("2026-03-17T12:00:00.000Z");
  });

  test("two clock ticks inside the same five minutes share a window", () => {
    /* Which is what keeps a 30-second clock from refetching every 30 seconds. */
    expect(computeMyShiftsWindow(NOW, 14).from.getTime()).toBe(
      computeMyShiftsWindow(NOW + 60 * 1000, 14).from.getTime(),
    );
  });
});

describe("useMyShifts", () => {
  beforeEach(() => {
    mockProjects.current = PROJECTS;
    fetchSpy().mockReset();
  });

  test("asks for the fortnight from now, across every project", async () => {
    fetchSpy().mockResolvedValue({
      shifts: [shift("a")],
      truncated: false,
      generatedAt: "x",
    } as never);

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    const [window, projectId]: Array<unknown> = fetchSpy().mock.calls[0]!;

    expect((window as { from: Date }).from.toISOString()).toBe(
      "2026-03-03T12:00:00.000Z",
    );
    expect((window as { to: Date }).to.toISOString()).toBe(
      "2026-03-17T12:00:00.000Z",
    );
    expect(projectId).toBeUndefined();
    expect(
      result.current.shifts.map((entry: MyOnCallShift) => {
        return entry.shiftKey;
      }),
    ).toEqual(["a"]);
    expect(result.current.isError).toBe(false);
  });

  test("honours a custom horizon", async () => {
    fetchSpy().mockResolvedValue({
      shifts: [],
      truncated: false,
      generatedAt: "",
    } as never);

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW, daysAhead: 30 });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.window.to.toISOString()).toBe(
      "2026-04-02T12:00:00.000Z",
    );
  });

  test("an empty answer is a success with no shifts - not an error", async () => {
    fetchSpy().mockResolvedValue({
      shifts: [],
      truncated: false,
      generatedAt: "",
    } as never);

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSuccess).toBe(true);
    });

    expect(result.current.shifts).toEqual([]);
    expect(result.current.isError).toBe(false);
  });

  test("passes the truncation flag through", async () => {
    fetchSpy().mockResolvedValue({
      shifts: [shift("a")],
      truncated: true,
      generatedAt: "",
    } as never);

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.truncated).toBe(true);
    });
  });

  test("a 503 (render cap) is an error the overview falls back on, retried once", async () => {
    fetchSpy().mockRejectedValue(axiosError(503) as never);

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.isSuccess).toBe(false);
    expect(result.current.isUnsupported).toBe(false);
    expect(result.current.shifts).toEqual([]);
    expect(fetchSpy()).toHaveBeenCalledTimes(2);
  });

  test("a 404 is 'unsupported' and is not retried", async () => {
    fetchSpy().mockRejectedValue(axiosError(404) as never);

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW });
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.isUnsupported).toBe(true);
    expect(fetchSpy()).toHaveBeenCalledTimes(1);
  });

  test("does not ask when there are no projects", async () => {
    mockProjects.current = [];

    const { result } = await renderHook(
      (): UseMyShiftsResult => {
        return useMyShifts({ now: NOW });
      },
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(fetchSpy()).not.toHaveBeenCalled();
  });
});
