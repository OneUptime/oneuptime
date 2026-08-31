import React from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { Alert, Clipboard, Linking, Platform } from "react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import OnCallCalendarFeedScreen from "./OnCallCalendarFeedScreen";
import {
  ANDROID_SUBSCRIBE_HINT,
  IOS_SUBSCRIBE_HINT,
} from "../oncall/calendarFeedLinks";
import type { UseOnCallCalendarFeedResult } from "../hooks/useOnCallCalendarFeed";
import type { OnCallCalendarFeedStatus, ProjectItem } from "../api/types";

/*
 * The screen that hands a private URL to a calendar app.
 *
 * The suite runs once per platform (see jest.config.js), and that is the
 * point: iOS and Android get DIFFERENT primary actions because they can do
 * different things with a webcal link. A test that only ran as iOS would let
 * an "Open in Calendar" button ship to Android, where it opens nothing.
 *
 * The other thing pinned here is what the screen says when it cannot do its
 * job: an old server (404) gets "not supported", a broken token gets
 * "regenerate", a disabled link says so - none of them render as a blank.
 */

interface SharedContent {
  title?: string;
  message: string;
}

const PROJECTS: ProjectItem[] = [
  { _id: "project-1", name: "Acme", slug: "acme" } as ProjectItem,
  { _id: "project-2", name: "Globex", slug: "globex" } as ProjectItem,
];

const SERVER_HTTPS: string =
  "https://oneuptime.example.com/api/on-call-calendar/user/tokentokentokentokentokentokentokentoken123/shifts.ics";

const NOW: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

const mockProjects: { current: ProjectItem[] } = { current: PROJECTS };
const mockFeed: { current: UseOnCallCalendarFeedResult } = {
  current: {} as UseOnCallCalendarFeedResult,
};
const mockFeedCalls: { projectIds: Array<string | null> } = { projectIds: [] };
const mockFeedByProject: {
  current: ((projectId: string | null) => UseOnCallCalendarFeedResult) | null;
} = { current: null };
const mockServerUrl: { current: string } = {
  current: "https://oneuptime.example.com",
};
const mockShare: jest.Mock = jest.fn();

/*
 * The project the screen opens on is chosen asynchronously (the SSO filter
 * reads stored tokens), so the tests can hold that choice open and look at
 * what the screen shows while it is undecided.
 */
interface DeferredProjects {
  promise: Promise<ProjectItem[]>;
  resolve: (projects: ProjectItem[]) => void;
}

const mockAuthorized: {
  current: ProjectItem[] | null;
  deferred: DeferredProjects | null;
  calls: number;
} = { current: null, deferred: null, calls: 0 };

function deferAuthorizedProjects(): DeferredProjects {
  let resolve: (projects: ProjectItem[]) => void = (): void => {
    return undefined;
  };

  const promise: Promise<ProjectItem[]> = new Promise(
    (resolvePromise: (projects: ProjectItem[]) => void) => {
      resolve = resolvePromise;
    },
  );

  const deferred: DeferredProjects = { promise, resolve };
  mockAuthorized.deferred = deferred;

  return deferred;
}

jest.mock("../hooks/authorizedProjects", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../hooks/authorizedProjects",
  ) as Record<string, unknown>;

  return {
    ...actual,
    getAuthorizedProjects: (
      projects: ProjectItem[],
    ): Promise<ProjectItem[]> => {
      mockAuthorized.calls += 1;

      if (mockAuthorized.deferred) {
        return mockAuthorized.deferred.promise;
      }

      return Promise.resolve(mockAuthorized.current ?? projects);
    },
  };
});

jest.mock("../hooks/useProject", () => {
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

jest.mock("../hooks/useOnCallCalendarFeed", () => {
  return {
    useOnCallCalendarFeed: (projectId: string | null) => {
      mockFeedCalls.projectIds.push(projectId);

      if (mockFeedByProject.current) {
        return mockFeedByProject.current(projectId);
      }

      return mockFeed.current;
    },
  };
});

jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return new Date(2026, 2, 3, 12, 0, 0, 0).getTime();
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("../storage/serverUrl", () => {
  return {
    getServerUrl: async (): Promise<string> => {
      return mockServerUrl.current;
    },
  };
});

jest.mock("react-native/Libraries/Share/Share", () => {
  return {
    __esModule: true,
    default: {
      share: (content: SharedContent): Promise<{ action: string }> => {
        return mockShare(content);
      },
    },
  };
});

function status(
  overrides: Partial<OnCallCalendarFeedStatus> = {},
): OnCallCalendarFeedStatus {
  return {
    exists: true,
    feedId: "feed-1",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "k3Qx",
    rotatedAt: new Date(2026, 2, 1, 10, 0).toISOString(),
    previousTokenExpiresAt: null,
    lastFetchedAt: new Date(2026, 2, 3, 10, 0).toISOString(),
    lastFetchedClient: "Google Calendar",
    fetchCount: 143,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: {
      https: SERVER_HTTPS,
      webcal: SERVER_HTTPS.replace("https://", "webcals://"),
      googleAdd: "",
    },
    hostWarning: null,
    protocolWarning: null,
    ...overrides,
  };
}

function feedState(
  overrides: Partial<UseOnCallCalendarFeedResult> = {},
): UseOnCallCalendarFeedResult {
  return {
    status: status(),
    isLoading: false,
    isError: false,
    error: null,
    isUnsupported: false,
    isSsoRequired: false,
    refetch: jest.fn(async (): Promise<void> => {
      return undefined;
    }) as unknown as () => Promise<void>,
    rotate: jest.fn(async (): Promise<OnCallCalendarFeedStatus> => {
      return status({ tokenHint: "NEW1" });
    }) as unknown as () => Promise<OnCallCalendarFeedStatus>,
    isRotating: false,
    setEnabled: jest.fn(async (): Promise<void> => {
      return undefined;
    }) as unknown as (isEnabled: boolean) => Promise<void>,
    isUpdating: false,
    ...overrides,
  };
}

function openUrlSpy(): jest.SpyInstance {
  return Linking.openURL as unknown as jest.SpyInstance;
}

function setStringSpy(): jest.SpyInstance {
  return Clipboard.setString as unknown as jest.SpyInstance;
}

let alertSpy: jest.SpyInstance;

async function waitForLinks(): Promise<void> {
  /* The link box appears once getServerUrl() has resolved. */
  await waitFor(() => {
    expect(screen.getByTestId("feed-link-box")).toBeTruthy();
  });
}

describe("OnCallCalendarFeedScreen", () => {
  beforeEach(() => {
    mockProjects.current = PROJECTS;
    mockAuthorized.current = null;
    mockAuthorized.deferred = null;
    mockAuthorized.calls = 0;
    mockFeed.current = feedState();
    mockFeedByProject.current = null;
    mockFeedCalls.projectIds = [];
    mockServerUrl.current = "https://oneuptime.example.com";
    mockShare.mockReset();
    mockShare.mockResolvedValue({ action: "sharedAction" });
    openUrlSpy().mockReset();
    openUrlSpy().mockResolvedValue(undefined);
    setStringSpy().mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("asks for the first project's feed by default", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    await waitFor(() => {
      expect(mockFeedCalls.projectIds).toContain("project-1");
    });
  });

  test("opens on the first project the app is allowed to query", async (): Promise<void> => {
    /*
     * A project that enforces SSO answers 406 until this handset has
     * completed that login - and asking anyway records a denial against it.
     * The fan-out hooks all run through the same filter; so does this screen.
     */
    mockAuthorized.current = [PROJECTS[1]!];

    await render(<OnCallCalendarFeedScreen />);

    await waitFor(() => {
      expect(mockFeedCalls.projectIds).toContain("project-2");
    });

    expect(mockFeedCalls.projectIds).not.toContain("project-1");
  });

  test("falls back to the first project when none of them are authorized", async (): Promise<void> => {
    /* Better to ask and explain the refusal than to show nothing at all. */
    mockAuthorized.current = [];

    await render(<OnCallCalendarFeedScreen />);

    await waitFor(() => {
      expect(mockFeedCalls.projectIds).toContain("project-1");
    });
  });

  test("shows a skeleton, not an error, while the project is being chosen", async (): Promise<void> => {
    /*
     * The regression this pins: with no project chosen yet the hook reports
     * "not loading" (it has nothing to load), and the screen fell through to
     * "Could not load your calendar link. An unknown error occurred." before
     * it had asked the server anything.
     */
    const deferred: DeferredProjects = deferAuthorizedProjects();

    /*
     * Exactly what the hook reports with no project to ask about: it is not
     * pending (it never started), it has no status and it has no error.
     */
    mockFeedByProject.current = (
      projectId: string | null,
    ): UseOnCallCalendarFeedResult => {
      return projectId
        ? feedState()
        : feedState({ status: null, isLoading: false });
    };

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-loading")).toBeTruthy();
    expect(screen.queryByTestId("feed-error")).toBeNull();
    expect(screen.queryByText(/An unknown error occurred/)).toBeNull();
    expect(mockFeedCalls.projectIds).not.toContain("project-1");

    await act(async (): Promise<void> => {
      deferred.resolve(PROJECTS);
    });

    await waitFor(() => {
      expect(screen.getByTestId("feed-active")).toBeTruthy();
    });
  });

  test("an SSO-locked project is explained, not reported as a failed request", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: null,
      isError: true,
      isSsoRequired: true,
      error: { isAxiosError: true, response: { status: 406 } },
    });

    await render(<OnCallCalendarFeedScreen />);

    await waitFor(() => {
      expect(screen.getByTestId("feed-sso-required")).toBeTruthy();
    });

    expect(screen.queryByTestId("feed-error")).toBeNull();
    expect(screen.getByText(/Acme requires an SSO sign-in/)).toBeTruthy();
    expect(screen.getByText(/Settings → Projects/)).toBeTruthy();
    expect(screen.getByTestId("retry-feed")).toBeTruthy();
  });

  test("switching project asks for that project's feed", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    await fireEvent.press(screen.getByTestId("feed-project-project-2"));

    await waitFor(() => {
      expect(mockFeedCalls.projectIds).toContain("project-2");
    });
  });

  test("hides the project picker with a single project", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.queryByTestId("feed-project-project-1")).toBeNull();
  });

  test("says so when the server predates calendar feeds", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: null,
      isError: true,
      isUnsupported: true,
      error: { isAxiosError: true, response: { status: 404 } },
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-unsupported")).toBeTruthy();
    expect(screen.queryByTestId("generate-feed")).toBeNull();
    expect(screen.queryByTestId("feed-error")).toBeNull();
  });

  test("offers a retry on any other failure", async (): Promise<void> => {
    const refetch: jest.Mock = jest.fn(async (): Promise<void> => {
      return undefined;
    });

    mockFeed.current = feedState({
      status: null,
      isError: true,
      error: new Error("Internal server error"),
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-error")).toBeTruthy();
    expect(screen.getByText(/Internal server error/)).toBeTruthy();

    await fireEvent.press(screen.getByTestId("retry-feed"));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("with no feed yet, 'Generate' rotates without a confirmation", async (): Promise<void> => {
    /* Nothing subscribed can break, so nothing to confirm. */
    const rotate: jest.Mock = jest.fn(
      async (): Promise<OnCallCalendarFeedStatus> => {
        return status();
      },
    );

    mockFeed.current = feedState({
      status: status({
        exists: false,
        feedId: null,
        urls: null,
        tokenHint: null,
      }),
      rotate: rotate as unknown as () => Promise<OnCallCalendarFeedStatus>,
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-empty")).toBeTruthy();
    expect(screen.queryByTestId("feed-active")).toBeNull();

    await fireEvent.press(screen.getByTestId("generate-feed"));

    expect(rotate).toHaveBeenCalledTimes(1);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("shows the link, the fetch status and the platform's actions", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    await waitForLinks();

    expect(screen.getByTestId("feed-https-url").props.children).toBe(
      SERVER_HTTPS,
    );
    expect(
      screen.getByText(
        "Last fetched 2h ago by Google Calendar · 143 fetches · link ending in …k3Qx",
      ),
    ).toBeTruthy();
    expect(screen.getByTestId("share-feed")).toBeTruthy();
    expect(screen.getByTestId("copy-feed")).toBeTruthy();
    expect(screen.getByTestId("regenerate-feed")).toBeTruthy();

    if (Platform.OS === "ios") {
      expect(screen.getByTestId("open-in-calendar")).toBeTruthy();
      expect(screen.getByText(IOS_SUBSCRIBE_HINT)).toBeTruthy();
      expect(screen.queryByTestId("android-subscribe-hint")).toBeNull();
    } else {
      /*
       * Android has no "add calendar by URL" anywhere - not in the Google
       * Calendar app, not on mobile web - so the honest action is getting the
       * link onto a computer, and the screen says exactly that.
       */
      expect(screen.queryByTestId("open-in-calendar")).toBeNull();
      expect(screen.getByText(ANDROID_SUBSCRIBE_HINT)).toBeTruthy();
      expect(screen.queryByTestId("ios-subscribe-hint")).toBeNull();
    }
  });

  test("iOS: 'Open in Calendar' opens the webcals link", async (): Promise<void> => {
    if (Platform.OS !== "ios") {
      return;
    }

    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("open-in-calendar"));

    await waitFor(() => {
      expect(openUrlSpy()).toHaveBeenCalledWith(
        SERVER_HTTPS.replace("https://", "webcals://"),
      );
    });
    expect(screen.queryByTestId("feed-notice-error")).toBeNull();
  });

  test("iOS: a refused webcal link is explained, not swallowed", async (): Promise<void> => {
    if (Platform.OS !== "ios") {
      return;
    }

    openUrlSpy().mockRejectedValue(new Error("No handler") as never);

    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("open-in-calendar"));

    await waitFor(() => {
      expect(screen.getByTestId("feed-notice-error")).toBeTruthy();
    });
    expect(screen.getByText(/Could not open the Calendar app/)).toBeTruthy();
  });

  test("'Share link' hands the https link to the share sheet", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("share-feed"));

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledTimes(1);
    });

    const shared: SharedContent = mockShare.mock.calls[0]?.[0] as SharedContent;

    expect(shared.message).toContain(SERVER_HTTPS);
    expect(shared.message).toContain("Acme");
    expect(shared.message).not.toContain("webcals://");
  });

  test("'Copy https link' writes the link to the clipboard and says so", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("copy-feed"));

    expect(setStringSpy()).toHaveBeenCalledWith(SERVER_HTTPS);
    expect(screen.getByTestId("feed-notice-success")).toBeTruthy();
    expect(screen.getByText("Link copied.")).toBeTruthy();
    expect(mockShare).not.toHaveBeenCalled();
  });

  test("falls back to the share sheet when the clipboard is unavailable", async (): Promise<void> => {
    setStringSpy().mockImplementation(() => {
      throw new Error("no clipboard module");
    });

    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("copy-feed"));

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledTimes(1);
    });
  });

  test("'Regenerate' confirms first, then rotates", async (): Promise<void> => {
    const rotate: jest.Mock = jest.fn(
      async (): Promise<OnCallCalendarFeedStatus> => {
        return status({ tokenHint: "NEW1" });
      },
    );

    mockFeed.current = feedState({
      rotate: rotate as unknown as () => Promise<OnCallCalendarFeedStatus>,
    });

    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("regenerate-feed"));

    expect(rotate).not.toHaveBeenCalled();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    const [title, message, buttons]: Array<unknown> = alertSpy.mock.calls[0]!;

    expect(title).toBe("Regenerate this link?");
    expect(String(message)).toContain("30 days");

    const confirm: { text: string; onPress?: () => void } | undefined = (
      buttons as Array<{ text: string; onPress?: () => void }>
    ).find((button: { text: string }) => {
      return button.text === "Regenerate";
    });

    expect(confirm).toBeTruthy();
    confirm!.onPress!();

    await waitFor(() => {
      expect(rotate).toHaveBeenCalledTimes(1);
    });
  });

  test("a failed rotate is shown on screen", async (): Promise<void> => {
    const rotate: jest.Mock = jest.fn(
      async (): Promise<OnCallCalendarFeedStatus> => {
        throw new Error("Try again in a minute");
      },
    );

    mockFeed.current = feedState({
      status: status({ exists: false, urls: null }),
      rotate: rotate as unknown as () => Promise<OnCallCalendarFeedStatus>,
    });

    await render(<OnCallCalendarFeedScreen />);

    await fireEvent.press(screen.getByTestId("generate-feed"));

    await waitFor(() => {
      expect(screen.getByText("Try again in a minute")).toBeTruthy();
    });
  });

  test("a link the server can no longer decrypt asks to be regenerated", async (): Promise<void> => {
    const rotate: jest.Mock = jest.fn(
      async (): Promise<OnCallCalendarFeedStatus> => {
        return status();
      },
    );

    mockFeed.current = feedState({
      status: status({ needsRegeneration: true, urls: null }),
      rotate: rotate as unknown as () => Promise<OnCallCalendarFeedStatus>,
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-needs-regeneration")).toBeTruthy();

    /* No link to show, so none of the link actions either. */
    expect(screen.queryByTestId("share-feed")).toBeNull();
    expect(screen.queryByTestId("feed-link-box")).toBeNull();

    await fireEvent.press(screen.getByTestId("regenerate-feed-now"));
    expect(rotate).toHaveBeenCalledTimes(1);
  });

  test("a disabled link says so and can be switched back on", async (): Promise<void> => {
    const setEnabled: jest.Mock = jest.fn(async (): Promise<void> => {
      return undefined;
    });

    mockFeed.current = feedState({
      status: status({ isEnabled: false }),
      setEnabled: setEnabled as unknown as (
        isEnabled: boolean,
      ) => Promise<void>,
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-disabled")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("enable-feed"));

    expect(setEnabled).toHaveBeenCalledWith(true);
  });

  test("shows the server's host and protocol warnings", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: status({
        hostWarning: "Set HOST to your public hostname",
        protocolWarning: "This link travels over plain http",
      }),
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-host-warning")).toBeTruthy();
    expect(screen.getByText("Set HOST to your public hostname")).toBeTruthy();
    expect(screen.getByTestId("feed-protocol-warning")).toBeTruthy();
    expect(screen.getByText("This link travels over plain http")).toBeTruthy();
  });

  test("no warnings means no warning boxes", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    expect(screen.queryByTestId("feed-host-warning")).toBeNull();
    expect(screen.queryByTestId("feed-protocol-warning")).toBeNull();
    expect(screen.queryByTestId("feed-truncated-warning")).toBeNull();
    expect(screen.queryByTestId("feed-rebuilt-note")).toBeNull();
  });

  test("rebuilds the link around the address this app uses when it differs", async (): Promise<void> => {
    /*
     * VPN / split-DNS: the server's HOST is not what the phone resolves. The
     * link shown is the one that works from here, and the difference is
     * stated rather than hidden.
     */
    mockServerUrl.current = "https://oncall.internal:8443";

    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    expect(screen.getByTestId("feed-https-url").props.children).toBe(
      "https://oncall.internal:8443/api/on-call-calendar/user/tokentokentokentokentokentokentokentoken123/shifts.ics",
    );
    expect(screen.getByTestId("feed-rebuilt-note")).toBeTruthy();
    expect(screen.getByText(/oneuptime\.example\.com/)).toBeTruthy();
  });

  test("warns when the last render was shortened", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: status({ lastRenderTruncated: true }),
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-truncated-warning")).toBeTruthy();
  });

  test("hints at reachability when nothing has fetched a two-day-old link", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: status({
        rotatedAt: new Date(NOW - 3 * 24 * 60 * 60 * 1000).toISOString(),
        lastFetchedAt: null,
        lastFetchedClient: null,
        fetchCount: 0,
      }),
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-unreachable-hint")).toBeTruthy();
    expect(screen.getByText(/Not fetched yet/)).toBeTruthy();
  });

  test("explains that calendar apps refresh on their own schedule", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-refresh-copy")).toBeTruthy();
    expect(screen.getByText(/Google Calendar up to a day later/)).toBeTruthy();
  });

  test("with no projects there is nothing to subscribe to", async (): Promise<void> => {
    mockProjects.current = [];

    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("feed-no-projects")).toBeTruthy();
    expect(screen.queryByTestId("generate-feed")).toBeNull();
  });
});
