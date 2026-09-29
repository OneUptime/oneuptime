import React from "react";
import {
  act,
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react-native";
import { Alert, Clipboard, Linking, Platform, StyleSheet } from "react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import OnCallCalendarFeedScreen from "./OnCallCalendarFeedScreen";
import {
  ANDROID_SUBSCRIBE_HINT,
  IOS_SUBSCRIBE_HINT,
} from "../oncall/calendarFeedLinks";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius } from "../theme/tokens";
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

let mockColorScheme: "light" | "dark" = "light";

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme;
    },
  };
});

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

jest.mock("../hooks/useProject", () => {
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
  test("separates subscription from link management and reserves bottom navigation space", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();
    expect(screen.getByText("Your subscription")).toBeTruthy();
    expect(screen.getByText("Manage your link")).toBeTruthy();
    expect(
      screen.getByTestId("calendar-feed-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBeGreaterThanOrEqual(124);
    expect(screen.getByTestId("calendar-project-name")).toHaveTextContent(
      "Project: Acme",
    );
    expect(screen.queryByTestId("feed-project-project-2")).toBeNull();
  });

  test("asks for the first project's feed by default", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    await waitFor(() => {
      expect(mockFeedCalls.projectIds).toContain("project-1");
    });
  });

  test("uses the globally selected project without an independent project picker", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[1]!];
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();
    expect(mockFeedCalls.projectIds).toContain("project-2");
    expect(mockFeedCalls.projectIds).not.toContain("project-1");
    expect(screen.getByTestId("calendar-project-name")).toHaveTextContent(
      "Project: Globex",
    );
  });

  test("an inaccessible selected project does not fall through to another project", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];
    mockFeed.current = feedState({
      status: null,
      isError: true,
      isSsoRequired: true,
    });
    await render(<OnCallCalendarFeedScreen />);
    expect(screen.getByTestId("feed-sso-required")).toBeTruthy();
    expect(mockFeedCalls.projectIds).not.toContain("project-2");
  });

  test("shows a skeleton while the selected project's feed is loading", async (): Promise<void> => {
    mockFeed.current = feedState({ status: null, isLoading: true });
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <OnCallCalendarFeedScreen />,
    );
    expect(screen.getByTestId("feed-loading")).toBeTruthy();
    expect(screen.queryByTestId("feed-error")).toBeNull();
    mockFeed.current = feedState();
    await rendered.rerender(<OnCallCalendarFeedScreen />);
    await waitForLinks();
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

  test("a global project change requests that project's feed", async (): Promise<void> => {
    const rendered: Awaited<ReturnType<typeof render>> = await render(
      <OnCallCalendarFeedScreen />,
    );
    mockProjects.current = [PROJECTS[1]!];
    await rendered.rerender(<OnCallCalendarFeedScreen />);
    expect(mockFeedCalls.projectIds.at(-1)).toBe("project-2");
    expect(screen.getByTestId("calendar-project-name")).toHaveTextContent(
      "Project: Globex",
    );
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

  test("keeps the private link concealed while showing fetch status and platform actions", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    await waitForLinks();
    const disclosure: () => ReturnType<typeof screen.getByTestId> = () => {
      return screen.getByTestId("toggle-private-link");
    };
    expect(disclosure().props.accessibilityState.expanded).toBe(false);

    expect(screen.queryByTestId("feed-https-url")).toBeNull();
    expect(screen.getByTestId("feed-privacy-warning")).toBeTruthy();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show private link" }),
    );
    expect(screen.getByTestId("feed-https-url").props.children).toBe(
      SERVER_HTTPS,
    );
    expect(disclosure().props.accessibilityState.expanded).toBe(true);
    await fireEvent.press(
      screen.getByRole("button", { name: "Hide private link" }),
    );
    expect(screen.queryByTestId("feed-https-url")).toBeNull();
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

    await fireEvent.press(
      screen.getByRole("button", { name: "Show private link" }),
    );
    expect(screen.getByTestId("feed-https-url").props.children).toBe(
      "https://oncall.internal:8443/api/on-call-calendar/user/tokentokentokentokentokentokentokentoken123/shifts.ics",
    );
    expect(screen.getByTestId("feed-rebuilt-note")).toBeTruthy();
    expect(screen.getByText(/oneuptime\.example\.com/)).toBeTruthy();
  });

  test("a revealed private link is hidden immediately when switching projects, including on return", async (): Promise<void> => {
    mockProjects.current = [PROJECTS[0]!];
    const view: Awaited<ReturnType<typeof render>> = await render(
      <OnCallCalendarFeedScreen />,
    );
    await waitForLinks();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show private link" }),
    );
    expect(screen.getByTestId("feed-https-url")).toBeTruthy();
    mockProjects.current = [PROJECTS[1]!];
    await view.rerender(<OnCallCalendarFeedScreen />);
    expect(screen.queryByTestId("feed-https-url")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show private link" }),
    );
    mockProjects.current = [PROJECTS[0]!];
    await view.rerender(<OnCallCalendarFeedScreen />);
    expect(screen.queryByTestId("feed-https-url")).toBeNull();
  });

  test("rotating a revealed link never reveals the replacement token automatically", async (): Promise<void> => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <OnCallCalendarFeedScreen />,
    );
    await waitForLinks();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show private link" }),
    );
    const replacement: string = SERVER_HTTPS.replace(
      "tokentokentoken",
      "replacementtoken",
    );
    mockFeed.current = feedState({
      status: status({
        urls: {
          https: replacement,
          webcal: replacement.replace("https://", "webcals://"),
          googleAdd: "",
        },
      }),
    });
    await view.rerender(<OnCallCalendarFeedScreen />);
    expect(screen.queryByTestId("feed-https-url")).toBeNull();
    await fireEvent.press(
      screen.getByRole("button", { name: "Show private link" }),
    );
    expect(screen.getByTestId("feed-https-url").props.children).toBe(
      replacement,
    );
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

describe("Refresh recovery", () => {
  test.each([false, true])(
    "keeps refresh available and visible while pending (error: %s)",
    async (isError: boolean) => {
      let finish: () => void = (): void => {};
      const refresh: jest.Mock = jest.fn(() => {
        return new Promise<void>((resolve: () => void) => {
          finish = resolve;
        });
      });
      mockProjects.current = PROJECTS;
      mockFeedByProject.current = null;
      mockFeed.current = feedState({ isError, refetch: refresh });
      await render(<OnCallCalendarFeedScreen />);

      let request: Promise<void>;
      await act(() => {
        request = screen
          .getByTestId("calendar-feed-scroll")
          .props.refreshControl.props.onRefresh();
      });
      expect(refresh).toHaveBeenCalledTimes(1);
      expect(
        screen.getByTestId("calendar-feed-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(true);
      await act(async () => {
        finish();
        await request;
      });
      expect(
        screen.getByTestId("calendar-feed-scroll").props.refreshControl.props
          .refreshing,
      ).toBe(false);
    },
  );
});

/*
 * ---------------------------------------------------------------------------
 * Structure per feed state.
 *
 * The screen used to be a column of floating helper text with "Not fetched
 * yet" hanging under a button. Each state now has a clear shape: a status
 * card that says what the link is doing, a private link card that keeps the
 * URL concealed until asked, how to subscribe, how often it refreshes, and a
 * separate place to regenerate. These tests pin which of those appear in
 * which state, so a failure can never render the link actions and a working
 * link can never lose its status.
 * ---------------------------------------------------------------------------
 */

describe("OnCallCalendarFeedScreen sections per state", () => {
  beforeEach(() => {
    mockProjects.current = PROJECTS;
    mockFeed.current = feedState();
    mockFeedByProject.current = null;
    mockFeedCalls.projectIds = [];
    mockServerUrl.current = "https://oneuptime.example.com";
    mockShare.mockReset();
    mockShare.mockResolvedValue({ action: "sharedAction" });
    setStringSpy().mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation((): void => {
      return undefined;
    });
    mockColorScheme = "light";
  });

  afterEach(() => {
    alertSpy.mockRestore();
    mockColorScheme = "light";
  });

  test("empty: a single generate card with how it works, and no link sections", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: status({
        exists: false,
        feedId: null,
        urls: null,
        tokenHint: null,
      }),
    });

    await render(<OnCallCalendarFeedScreen />);

    const card: HostElement = screen.getByTestId("feed-empty-card");
    expect(within(card).getByText("No calendar link yet")).toBeTruthy();
    expect(within(card).getByText(/for Acme/)).toBeTruthy();
    expect(within(card).getByTestId("generate-feed")).toBeTruthy();
    expectCardSurface("feed-empty-card", lightColors);

    const howItWorks: HostElement = screen.getByTestId("feed-how-it-works");
    expect(within(howItWorks).getByText("1")).toBeTruthy();
    expect(within(howItWorks).getByText("3")).toBeTruthy();

    for (const absent of [
      "feed-active",
      "feed-status-card",
      "feed-link-box",
      "feed-how-to-subscribe",
      "regenerate-feed",
    ]) {
      expect(screen.queryByTestId(absent)).toBeNull();
    }
  });

  test("active: status, private link, subscribe steps, refresh cadence and manage, in that order", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    const statusCard: HostElement = screen.getByTestId("feed-status-card");
    expect(within(statusCard).getByText("Your subscription")).toBeTruthy();
    expect(within(statusCard).getByText("Active")).toBeTruthy();
    expect(
      within(statusCard).getByTestId("feed-fetch-status"),
    ).toHaveTextContent(
      "Last fetched 2h ago by Google Calendar · 143 fetches · link ending in …k3Qx",
    );
    expect(flatStyle("feed-status-pill").backgroundColor).toBe(
      lightColors.statusSuccessBg,
    );

    const linkCard: HostElement = screen.getByTestId("feed-link-box");
    expect(within(linkCard).getByText("Your private link")).toBeTruthy();
    expect(within(linkCard).getByTestId("feed-link-concealed")).toBeTruthy();
    expect(within(linkCard).queryByTestId("feed-https-url")).toBeNull();
    expect(within(linkCard).getByTestId("feed-privacy-warning")).toBeTruthy();
    expect(within(linkCard).getByTestId("share-feed")).toBeTruthy();
    expect(within(linkCard).getByTestId("copy-feed")).toBeTruthy();
    expect(
      screen.getByTestId("feed-link-concealed").props.children,
    ).not.toContain("token");

    const howTo: HostElement = screen.getByTestId("feed-how-to-subscribe");
    expect(within(howTo).getByText("How to subscribe")).toBeTruthy();
    expect(
      within(howTo).getByTestId(
        Platform.OS === "ios" ? "ios-subscribe-hint" : "android-subscribe-hint",
      ),
    ).toBeTruthy();

    const refreshCard: HostElement = screen.getByTestId("feed-refresh-card");
    expect(within(refreshCard).getByTestId("feed-refresh-copy")).toBeTruthy();
    expect(
      within(refreshCard).getByText(/source of truth for today/),
    ).toBeTruthy();

    const manage: HostElement = screen.getByTestId("feed-manage-card");
    expect(within(manage).getByTestId("regenerate-feed")).toBeTruthy();
    expect(flatStyle("regenerate-feed").backgroundColor).toBe(
      lightColors.actionDestructive,
    );

    const order: string[] = screen
      .getAllByTestId(
        /^feed-(status-card|link-box|how-to-subscribe|refresh-card|manage-card)$/,
      )
      .map((node: HostElement) => {
        return node.props.testID as string;
      });
    expect(order).toEqual([
      "feed-status-card",
      "feed-link-box",
      "feed-how-to-subscribe",
      "feed-refresh-card",
      "feed-manage-card",
    ]);

    for (const testID of [
      "feed-status-card",
      "feed-link-box",
      "feed-how-to-subscribe",
      "feed-manage-card",
    ]) {
      expectCardSurface(testID, lightColors);
    }
  });

  test("a link nothing has fetched yet says it is waiting, inside the status card", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: status({
        lastFetchedAt: null,
        lastFetchedClient: null,
        fetchCount: 0,
        rotatedAt: new Date(NOW - 60 * 60 * 1000).toISOString(),
      }),
    });

    await render(<OnCallCalendarFeedScreen />);

    const statusCard: HostElement = screen.getByTestId("feed-status-card");
    expect(within(statusCard).getByText("Waiting for first sync")).toBeTruthy();
    expect(within(statusCard).getByText(/Not fetched yet/)).toBeTruthy();
    expect(screen.queryByTestId("feed-unreachable-hint")).toBeNull();
  });

  test("disabled: the status says switched off and the enable action sits under it", async (): Promise<void> => {
    mockFeed.current = feedState({ status: status({ isEnabled: false }) });

    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    expect(
      within(screen.getByTestId("feed-status-card")).getByText("Switched off"),
    ).toBeTruthy();
    expect(flatStyle("feed-status-pill").backgroundColor).toBe(
      lightColors.statusWarningBg,
    );
    const disabled: HostElement = screen.getByTestId("feed-disabled");
    expect(within(disabled).getByText(/switched off/)).toBeTruthy();
    expect(within(disabled).getByTestId("enable-feed")).toBeTruthy();
    expect(screen.getByTestId("feed-link-box")).toBeTruthy();
  });

  test("needs regeneration: danger status, a regenerate action, and no link to reveal or share", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: status({ needsRegeneration: true, urls: null }),
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(
      within(screen.getByTestId("feed-status-card")).getByText(
        "Needs regeneration",
      ),
    ).toBeTruthy();
    expect(flatStyle("feed-status-pill").backgroundColor).toBe(
      lightColors.statusErrorBg,
    );
    expect(screen.getByTestId("regenerate-feed-now")).toBeTruthy();
    expect(screen.queryByTestId("feed-link-box")).toBeNull();
    expect(screen.queryByTestId("toggle-private-link")).toBeNull();
    expect(screen.queryByTestId("feed-how-to-subscribe")).toBeNull();
    expect(screen.getByTestId("feed-manage-card")).toBeTruthy();
  });

  test("error: a titled failure with a retry, and none of the link sections", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: null,
      isError: true,
      error: new Error("Internal server error"),
    });

    await render(<OnCallCalendarFeedScreen />);

    const error: HostElement = screen.getByTestId("feed-error");
    expect(
      within(error).getByText("Could not load your calendar link"),
    ).toBeTruthy();
    expect(within(error).getByTestId("retry-feed")).toBeTruthy();
    for (const absent of [
      "feed-status-card",
      "feed-link-box",
      "feed-refresh-card",
      "feed-manage-card",
      "generate-feed",
    ]) {
      expect(screen.queryByTestId(absent)).toBeNull();
    }
  });

  test("unsupported: explained as unavailable, with nothing to press", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: null,
      isError: true,
      isUnsupported: true,
    });

    await render(<OnCallCalendarFeedScreen />);

    const unsupported: HostElement = screen.getByTestId("feed-unsupported");
    expect(
      within(unsupported).getByText("Not available on this server"),
    ).toBeTruthy();
    expect(flatStyle("feed-unsupported").backgroundColor).toBe(
      lightColors.statusWarningBg,
    );
    expect(screen.queryByTestId("retry-feed")).toBeNull();
    expect(screen.queryByTestId("feed-status-card")).toBeNull();
  });

  test("SSO required: says sign-in is needed rather than failing", async (): Promise<void> => {
    mockFeed.current = feedState({
      status: null,
      isError: true,
      isSsoRequired: true,
    });

    await render(<OnCallCalendarFeedScreen />);

    expect(
      within(screen.getByTestId("feed-sso-required")).getByText(
        "Sign-in required",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("Could not load your calendar link")).toBeNull();
  });

  test("no projects: an empty state card and no project chip", async (): Promise<void> => {
    mockProjects.current = [];

    await render(<OnCallCalendarFeedScreen />);

    expect(
      within(screen.getByTestId("feed-no-projects")).getByText(
        "No projects yet",
      ),
    ).toBeTruthy();
    expect(screen.queryByTestId("calendar-project-name")).toBeNull();
  });

  test("revealing the link swaps the concealed placeholder for the URL inside the link field", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    const field: () => HostElement = () => {
      return screen.getByTestId("feed-link-field");
    };
    expect(within(field()).getByTestId("feed-link-concealed")).toBeTruthy();
    expect(
      within(screen.getByTestId("toggle-private-link")).getByText("Show"),
    ).toBeTruthy();

    await fireEvent.press(screen.getByTestId("toggle-private-link"));

    expect(within(field()).queryByTestId("feed-link-concealed")).toBeNull();
    expect(within(field()).getByTestId("feed-https-url").props.children).toBe(
      SERVER_HTTPS,
    );
    expect(within(field()).getByTestId("feed-https-url").props.selectable).toBe(
      true,
    );
    expect(
      within(screen.getByTestId("toggle-private-link")).getByText("Hide"),
    ).toBeTruthy();
    expect(flatStyle("feed-link-field").backgroundColor).toBe(
      lightColors.backgroundTertiary,
    );
    expect(flatStyle("toggle-private-link").minHeight).toBeGreaterThanOrEqual(
      48,
    );

    await fireEvent.press(screen.getByTestId("toggle-private-link"));
    expect(within(field()).getByTestId("feed-link-concealed")).toBeTruthy();
    expect(screen.queryByTestId("feed-https-url")).toBeNull();
  });

  test("a copied link is confirmed with a success banner", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);
    await waitForLinks();

    await fireEvent.press(screen.getByTestId("copy-feed"));

    expect(flatStyle("feed-notice-success").backgroundColor).toBe(
      lightColors.statusSuccessBg,
    );
  });

  test("the project appears as a chip with the project name", async (): Promise<void> => {
    await render(<OnCallCalendarFeedScreen />);

    expect(screen.getByTestId("calendar-project-name")).toHaveTextContent(
      "Project: Acme",
    );
  });

  test("dark mode: every section uses the dark palette", async (): Promise<void> => {
    mockColorScheme = "dark";

    await render(
      <ThemeProvider>
        <OnCallCalendarFeedScreen />
      </ThemeProvider>,
    );
    await waitForLinks();

    expect(flatStyle("calendar-feed-scroll").backgroundColor).toBe(
      darkColors.backgroundPrimary,
    );
    for (const testID of [
      "feed-status-card",
      "feed-link-box",
      "feed-how-to-subscribe",
      "feed-manage-card",
    ]) {
      expectCardSurface(testID, darkColors);
    }
    expect(flatStyle("feed-link-field").backgroundColor).toBe(
      darkColors.backgroundTertiary,
    );
    expect(flatStyle("feed-status-pill").backgroundColor).toBe(
      darkColors.statusSuccessBg,
    );
    expect(flatStyle("regenerate-feed").backgroundColor).toBe(
      darkColors.actionDestructive,
    );
    expect(screen.getByText("Your private link")).toHaveStyle({
      color: darkColors.textPrimary,
    });
  });
});

type HostElement = ReturnType<typeof screen.getByTestId>;

function flatStyle(testID: string): Record<string, unknown> {
  return (StyleSheet.flatten(screen.getByTestId(testID).props.style) ??
    {}) as Record<string, unknown>;
}

function expectCardSurface(testID: string, palette: typeof lightColors): void {
  const style: Record<string, unknown> = flatStyle(testID);
  expect(style.backgroundColor).toBe(palette.backgroundElevated);
  expect(style.borderRadius).toBe(radius.lg);
  expect(style.borderColor).toBe(palette.borderSubtle);
}
