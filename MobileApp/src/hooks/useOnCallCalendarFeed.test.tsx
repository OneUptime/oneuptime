import React from "react";
import { renderHook, waitFor, act } from "@testing-library/react-native";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, test, beforeEach } from "@jest/globals";
import {
  calendarFeedQueryKey,
  useOnCallCalendarFeed,
  type UseOnCallCalendarFeedResult,
} from "./useOnCallCalendarFeed";
import * as calendarApi from "../api/onCallCalendar";
import type { OnCallCalendarFeedStatus } from "../api/types";

/*
 * The hook behind the calendar feed screen. Three behaviours matter:
 *
 *   - a 404 is reported as "unsupported", not as a generic error, and it is
 *     NOT retried - a server that predates the feature will keep saying 404
 *     and every retry is a second the user stares at a spinner;
 *   - the rotate response is written straight into the cache, so the new
 *     link is on screen the moment it exists;
 *   - each project is its own cache entry, and so is each USER: the status
 *     carries the secret feed URL and the cache outlives a sign-out.
 */

const mockUserId: { current: string | null } = { current: "user-a" };

jest.mock("./useCurrentUserId", () => {
  return {
    useCurrentUserId: (): string | null => {
      return mockUserId.current;
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
    rotatePersonalCalendarFeed: jest.fn(),
    setPersonalCalendarFeedEnabled: jest.fn(),
  };
});

function fetchSpy(): jest.SpyInstance {
  return calendarApi.fetchPersonalCalendarFeed as unknown as jest.SpyInstance;
}

function rotateSpy(): jest.SpyInstance {
  return calendarApi.rotatePersonalCalendarFeed as unknown as jest.SpyInstance;
}

function enableSpy(): jest.SpyInstance {
  return calendarApi.setPersonalCalendarFeedEnabled as unknown as jest.SpyInstance;
}

function status(
  overrides: Partial<OnCallCalendarFeedStatus> = {},
): OnCallCalendarFeedStatus {
  return {
    exists: true,
    feedId: "feed-1",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: null,
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: {
      https: "https://h/api/on-call-calendar/user/t/shifts.ics",
      webcal: "webcals://h/api/on-call-calendar/user/t/shifts.ics",
      googleAdd: "",
    },
    hostWarning: null,
    protocolWarning: null,
    ...overrides,
  };
}

function axiosError(httpStatus: number): unknown {
  return {
    isAxiosError: true,
    message: "failed",
    response: { status: httpStatus },
  };
}

function createClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 }, mutations: { retry: false } },
  });
}

function createWrapperFor(
  client: QueryClient,
): ({ children }: { children: React.ReactNode }) => React.JSX.Element {
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

function createWrapper(): ({
  children,
}: {
  children: React.ReactNode;
}) => React.JSX.Element {
  return createWrapperFor(createClient());
}

describe("useOnCallCalendarFeed", () => {
  beforeEach(() => {
    mockUserId.current = "user-a";
    fetchSpy().mockReset();
    rotateSpy().mockReset();
    enableSpy().mockReset();
  });

  test("does nothing without a project", async () => {
    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed(null);
      },
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(false);
    expect(result.current.status).toBeNull();
    expect(fetchSpy()).not.toHaveBeenCalled();
  });

  test("loads the feed for the given project", async () => {
    fetchSpy().mockResolvedValue(status() as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.status?.exists).toBe(true);
    });

    expect(fetchSpy()).toHaveBeenCalledWith("project-1");
    expect(result.current.isError).toBe(false);
    expect(result.current.isUnsupported).toBe(false);
  });

  test("a 404 is 'unsupported' and is asked exactly once", async () => {
    fetchSpy().mockRejectedValue(axiosError(404) as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isUnsupported).toBe(true);
    });

    expect(result.current.isError).toBe(true);
    expect(fetchSpy()).toHaveBeenCalledTimes(1);
  });

  test("any other failure is a plain error, retried once", async () => {
    fetchSpy().mockRejectedValue(axiosError(500) as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });

    expect(result.current.isUnsupported).toBe(false);
    expect(fetchSpy()).toHaveBeenCalledTimes(2);
  });

  test("rotate puts the new status on screen immediately", async () => {
    fetchSpy().mockResolvedValue(
      status({ exists: false, urls: null }) as never,
    );
    rotateSpy().mockResolvedValue(status({ tokenHint: "NEW1" }) as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status?.exists).toBe(false);
    });

    await act(async (): Promise<void> => {
      await result.current.rotate();
    });

    expect(rotateSpy()).toHaveBeenCalledWith("project-1");

    /*
     * The cache write in onSuccess is synchronous, but TanStack Query hands
     * the observer's re-render to its notify manager, which schedules it - so
     * the hook's return value catches up a tick later. "Immediately" here
     * means "without a refetch", which the call count below pins.
     */
    await waitFor(() => {
      expect(result.current.status?.exists).toBe(true);
    });

    expect(result.current.status?.tokenHint).toBe("NEW1");

    /* No refetch was needed to get there. */
    expect(fetchSpy()).toHaveBeenCalledTimes(1);
  });

  test("a failed rotate surfaces to the caller and leaves the status alone", async () => {
    fetchSpy().mockResolvedValue(status() as never);
    rotateSpy().mockRejectedValue(new Error("Semaphore busy") as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status?.exists).toBe(true);
    });

    await expect(result.current.rotate()).rejects.toThrow("Semaphore busy");
    expect(result.current.status?.tokenHint).toBe("k3Qx");
  });

  test("setEnabled writes through the CRUD route and refreshes", async () => {
    fetchSpy().mockResolvedValue(status({ isEnabled: false }) as never);
    enableSpy().mockResolvedValue(undefined as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status?.isEnabled).toBe(false);
    });

    fetchSpy().mockResolvedValue(status({ isEnabled: true }) as never);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(enableSpy()).toHaveBeenCalledWith("project-1", "feed-1", true);

    await waitFor(() => {
      expect(result.current.status?.isEnabled).toBe(true);
    });
  });

  test("setEnabled refuses when there is no feed to update", async () => {
    fetchSpy().mockResolvedValue(
      status({ exists: false, feedId: null, urls: null }) as never,
    );

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.status).not.toBeNull();
    });

    await expect(result.current.setEnabled(true)).rejects.toThrow(
      "no calendar link",
    );
    expect(enableSpy()).not.toHaveBeenCalled();
  });

  test("a 406 is 'SSO required' and is asked exactly once", async () => {
    /*
     * The project enforces SSO and this handset has not completed it. Asking
     * again cannot change that, and the screen has a specific thing to say.
     */
    fetchSpy().mockRejectedValue(axiosError(406) as never);

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapper() },
    );

    await waitFor(() => {
      expect(result.current.isSsoRequired).toBe(true);
    });

    expect(result.current.isError).toBe(true);
    expect(result.current.isUnsupported).toBe(false);
    expect(fetchSpy()).toHaveBeenCalledTimes(1);
  });

  test("each project is its own cache entry", async () => {
    fetchSpy().mockImplementation(async (projectId: string) => {
      return status({ tokenHint: projectId });
    });

    const wrapper: ({
      children,
    }: {
      children: React.ReactNode;
    }) => React.JSX.Element = createWrapper();

    const { result, rerender } = await renderHook(
      ({ projectId }: { projectId: string }): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed(projectId);
      },
      { wrapper, initialProps: { projectId: "project-1" } },
    );

    await waitFor(() => {
      expect(result.current.status?.tokenHint).toBe("project-1");
    });

    rerender({ projectId: "project-2" });

    await waitFor(() => {
      expect(result.current.status?.tokenHint).toBe("project-2");
    });

    expect(fetchSpy()).toHaveBeenCalledTimes(2);
  });

  test("a second user on the same handset never reads the first user's cached link", async () => {
    /*
     * The regression this pins: the entry holds the feed's SECRET URL and the
     * QueryClient is a module-level singleton with a 24 hour gcTime, so a key
     * of project alone meant the next person to sign in on the same handset
     * was handed the previous user's private link out of the cache - on
     * screen, copyable, shareable - until their own request came back. Here
     * user A's entry is already warm and the fetch for user B is deliberately
     * left in flight: the only correct thing to show is nothing.
     */
    const client: QueryClient = createClient();

    client.setQueryData(
      calendarFeedQueryKey("project-1", "user-a"),
      status({
        tokenHint: "AAAA",
        urls: {
          https:
            "https://h/api/on-call-calendar/user/token-of-user-a/shifts.ics",
          webcal: "",
          googleAdd: "",
        },
      }),
    );

    let resolveFetch: (value: OnCallCalendarFeedStatus) => void = (): void => {
      return undefined;
    };

    fetchSpy().mockImplementation((): Promise<OnCallCalendarFeedStatus> => {
      return new Promise(
        (resolve: (value: OnCallCalendarFeedStatus) => void) => {
          resolveFetch = resolve;
        },
      );
    });

    mockUserId.current = "user-b";

    const { result } = await renderHook(
      (): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed("project-1");
      },
      { wrapper: createWrapperFor(client) },
    );

    expect(result.current.status).toBeNull();
    expect(result.current.isLoading).toBe(true);

    await act(async (): Promise<void> => {
      resolveFetch(status({ tokenHint: "BBBB" }));
    });

    await waitFor(() => {
      expect(result.current.status?.tokenHint).toBe("BBBB");
    });

    /* User A's entry is still its own, untouched by user B's session. */
    expect(
      (
        client.getQueryData(
          calendarFeedQueryKey("project-1", "user-a"),
        ) as OnCallCalendarFeedStatus
      ).tokenHint,
    ).toBe("AAAA");
  });

  test("each user gets their own cache entry as the signed-in user changes", async () => {
    fetchSpy().mockImplementation(
      async (): Promise<OnCallCalendarFeedStatus> => {
        return status({ tokenHint: mockUserId.current ?? "none" });
      },
    );

    const client: QueryClient = createClient();

    const { result, rerender } = await renderHook(
      ({ projectId }: { projectId: string }): UseOnCallCalendarFeedResult => {
        return useOnCallCalendarFeed(projectId);
      },
      {
        wrapper: createWrapperFor(client),
        initialProps: { projectId: "project-1" },
      },
    );

    await waitFor(() => {
      expect(result.current.status?.tokenHint).toBe("user-a");
    });

    mockUserId.current = "user-b";
    rerender({ projectId: "project-1" });

    await waitFor(() => {
      expect(result.current.status?.tokenHint).toBe("user-b");
    });

    expect(fetchSpy()).toHaveBeenCalledTimes(2);
    expect(
      (
        client.getQueryData(
          calendarFeedQueryKey("project-1", "user-a"),
        ) as OnCallCalendarFeedStatus
      ).tokenHint,
    ).toBe("user-a");
  });
});

describe("calendarFeedQueryKey", () => {
  test("two users in the same project get different keys", () => {
    expect(calendarFeedQueryKey("project-1", "user-a")).not.toEqual(
      calendarFeedQueryKey("project-1", "user-b"),
    );
  });

  test("the same user in two projects gets different keys", () => {
    expect(calendarFeedQueryKey("project-1", "user-a")).not.toEqual(
      calendarFeedQueryKey("project-2", "user-a"),
    );
  });

  test("an unknown user is its own bucket, never a shared one", () => {
    expect(calendarFeedQueryKey("project-1", null)).toEqual([
      "oncall",
      "calendar-feed",
      "anonymous",
      "project-1",
    ]);
  });
});
