import React from "react";
import {
  render,
  screen,
  fireEvent,
  waitFor,
} from "@testing-library/react-native";
import { Alert } from "react-native";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";
import WhoIsOnCallScreen, {
  buildTeamCalendarShareMessage,
  chooseTeamCalendarLinks,
  matchesRosterSearch,
} from "./WhoIsOnCallScreen";
import * as calendarApi from "../api/onCallCalendar";
import type {
  OnCallCalendarFeedStatus,
  ProjectOnCallScheduleItem,
} from "../api/types";
import type { FeedLinks } from "../oncall/calendarFeedLinks";

/*
 * The roster screen exists so a responder can find a HUMAN quickly - to hand
 * over, or to escalate to. Two things make or break that:
 *
 *   - a schedule with nobody on it must be impossible to miss. It is the only
 *     row here that is a problem, and alphabetical order buries it.
 *   - search has to match the person, not just the schedule name. People look
 *     for "Priya", not for "Primary - EU".
 */

const mockSchedules: {
  current: {
    schedules: ProjectOnCallScheduleItem[];
    isLoading: boolean;
    isError: boolean;
    refetch: () => Promise<void>;
  };
} = {
  current: {
    schedules: [],
    isLoading: false,
    isError: false,
    refetch: async (): Promise<void> => {
      return undefined;
    },
  },
};

const mockUserId: { current: string | null } = { current: "user-me" };

const mockCalendarFeed: {
  current: { isAvailable: boolean; isChecking: boolean };
} = { current: { isAvailable: true, isChecking: false } };

interface SharedContent {
  title?: string;
  message: string;
}

const mockShare: jest.Mock = jest.fn();

jest.mock("../hooks/useOnCallCalendarFeedAvailability", () => {
  return {
    useOnCallCalendarFeedAvailability: () => {
      return mockCalendarFeed.current;
    },
  };
});

jest.mock("../api/onCallCalendar", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../api/onCallCalendar",
  ) as Record<string, unknown>;

  return {
    ...actual,
    fetchScheduleCalendarFeed: jest.fn(),
  };
});

jest.mock("../storage/serverUrl", () => {
  return {
    getServerUrl: async (): Promise<string> => {
      return "https://oneuptime.example.com";
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

function fetchScheduleFeedSpy(): jest.SpyInstance {
  return calendarApi.fetchScheduleCalendarFeed as unknown as jest.SpyInstance;
}

const SCHEDULE_HTTPS: string =
  "https://oneuptime.example.com/api/on-call-calendar/schedule/tok/schedule.ics";

function feedStatus(
  overrides: Partial<OnCallCalendarFeedStatus> = {},
): OnCallCalendarFeedStatus {
  return {
    exists: true,
    feedId: "feed-1",
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "abcd",
    rotatedAt: null,
    previousTokenExpiresAt: null,
    lastFetchedAt: null,
    lastFetchedClient: null,
    fetchCount: 0,
    lastRenderTruncated: false,
    settings: { pastDays: 2, futureDays: 90 },
    urls: {
      https: SCHEDULE_HTTPS,
      webcal: SCHEDULE_HTTPS.replace("https://", "webcals://"),
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

jest.mock("../hooks/useOnCallSchedules", () => {
  return {
    useOnCallSchedules: () => {
      return mockSchedules.current;
    },
  };
});

jest.mock("../hooks/useCurrentUserId", () => {
  return {
    useCurrentUserId: () => {
      return mockUserId.current;
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

function entry(
  id: string,
  name: string,
  currentUser: { _id: string; name?: string; email?: string } | null,
  projectName: string = "Acme",
): ProjectOnCallScheduleItem {
  return {
    projectId: "project-1",
    projectName,
    item: {
      _id: id,
      name,
      currentUserOnRoster: currentUser,
      nextUserOnRoster: null,
      rosterStartAt: null,
      rosterHandoffAt: null,
      rosterNextStartAt: null,
      rosterNextHandoffAt: null,
    },
  };
}

describe("matchesRosterSearch", () => {
  const row: ProjectOnCallScheduleItem = entry("s1", "Primary EU", {
    _id: "user-2",
    name: "Priya Rao",
    email: "priya@example.com",
  });

  test("matches the schedule name", () => {
    expect(matchesRosterSearch(row, "primary")).toBe(true);
  });

  test("matches the project name", () => {
    expect(matchesRosterSearch(row, "acme")).toBe(true);
  });

  test("matches the person who is on call", () => {
    expect(matchesRosterSearch(row, "priya")).toBe(true);
    expect(matchesRosterSearch(row, "priya@example")).toBe(true);
  });

  test("matches the person who is next", () => {
    const withNext: ProjectOnCallScheduleItem = entry("s1", "Primary", null);
    withNext.item.nextUserOnRoster = { _id: "user-3", name: "Sam Patel" };

    expect(matchesRosterSearch(withNext, "sam")).toBe(true);
  });

  test("an empty search matches everything", () => {
    expect(matchesRosterSearch(row, "   ")).toBe(true);
  });

  test("does not match an unrelated term", () => {
    expect(matchesRosterSearch(row, "database")).toBe(false);
  });
});

describe("WhoIsOnCallScreen", () => {
  beforeEach(() => {
    mockSchedules.current = {
      schedules: [],
      isLoading: false,
      isError: false,
      refetch: async (): Promise<void> => {
        return undefined;
      },
    };
    mockUserId.current = "user-me";
  });

  test("puts uncovered schedules in their own section, ahead of the rest", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s-covered", "Primary", { _id: "user-2", name: "Priya Rao" }),
      entry("s-uncovered", "Weekend", null),
    ];

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByTestId("section-uncovered")).toBeTruthy();

    /*
     * Order, not just presence: the uncovered schedule has to come FIRST even
     * though "Primary" sorts before "Weekend" alphabetically.
     */
    expect(
      screen
        .getAllByTestId(/^roster-card-/)
        .map((node: { props: { testID?: string } }) => {
          return node.props.testID;
        }),
    ).toEqual(["roster-card-s-uncovered", "roster-card-s-covered"]);
  });

  test("does not render the warning section when everything is covered", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s-covered", "Primary", { _id: "user-2", name: "Priya Rao" }),
    ];

    await render(<WhoIsOnCallScreen />);

    expect(screen.queryByTestId("section-uncovered")).toBeNull();
    expect(screen.getByTestId("section-covered")).toBeTruthy();
  });

  test("marks the reader's own schedules", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s1", "Primary", { _id: "user-me", name: "Ada" }),
    ];

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByText("YOU")).toBeTruthy();
  });

  test("filters as the responder types", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s1", "Primary", { _id: "user-2", name: "Priya Rao" }),
      entry("s2", "Database", { _id: "user-3", name: "Sam Patel" }),
    ];

    await render(<WhoIsOnCallScreen />);

    await fireEvent.changeText(screen.getByTestId("roster-search"), "priya");

    expect(screen.getByTestId("roster-card-s1")).toBeTruthy();
    expect(screen.queryByTestId("roster-card-s2")).toBeNull();
  });

  test("says nothing matched rather than looking empty", async (): Promise<void> => {
    mockSchedules.current.schedules = [
      entry("s1", "Primary", { _id: "user-2", name: "Priya Rao" }),
    ];

    await render(<WhoIsOnCallScreen />);

    await fireEvent.changeText(screen.getByTestId("roster-search"), "zzzz");

    expect(screen.getByText("No schedules match that search.")).toBeTruthy();
  });

  test("distinguishes 'no schedules exist' from 'nothing matched'", async (): Promise<void> => {
    await render(<WhoIsOnCallScreen />);

    expect(screen.getByText("No on-call schedules")).toBeTruthy();
  });

  test("offers a retry when the roster read fails", async (): Promise<void> => {
    mockSchedules.current.isError = true;

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByText("Could not load the on-call roster")).toBeTruthy();
  });
});

/*
 * ---------------------------------------------------------------------------
 * "Share team calendar link" on a roster card.
 * ---------------------------------------------------------------------------
 */

describe("chooseTeamCalendarLinks", () => {
  test("prefers the server's canonical link for a SHARED feed", () => {
    /*
     * A colleague may not be on this phone's VPN; the server's public address
     * is the one that works for everybody.
     */
    const links: FeedLinks | null = chooseTeamCalendarLinks(
      "https://oncall.internal:8443",
      feedStatus(),
    );

    expect(links?.https).toBe(SCHEDULE_HTTPS);
    expect(links?.webcal).toBe(
      SCHEDULE_HTTPS.replace("https://", "webcals://"),
    );
    expect(links?.differsFromServer).toBe(false);
  });

  test("falls back to this phone's address when the server has no usable host", () => {
    const links: FeedLinks | null = chooseTeamCalendarLinks(
      "https://oneuptime.example.com",
      feedStatus({
        urls: {
          https:
            "http://localhost/api/on-call-calendar/schedule/tok/schedule.ics",
          webcal:
            "webcal://localhost/api/on-call-calendar/schedule/tok/schedule.ics",
          googleAdd: "",
        },
        hostWarning: "Set HOST",
      }),
    );

    expect(links?.https).toBe(
      "https://oneuptime.example.com/api/on-call-calendar/schedule/tok/schedule.ics",
    );
  });

  test("is null without links", () => {
    expect(
      chooseTeamCalendarLinks("https://x", feedStatus({ urls: null })),
    ).toBeNull();
  });
});

describe("buildTeamCalendarShareMessage", () => {
  test("names the schedule, the project and the link, and says it is private", () => {
    const message: string = buildTeamCalendarShareMessage(
      entry("s1", "Primary", null, "Acme"),
      chooseTeamCalendarLinks("https://oneuptime.example.com", feedStatus())!,
    );

    expect(message).toContain("Primary on-call calendar (Acme):");
    expect(message).toContain(SCHEDULE_HTTPS);
    expect(message).toContain("keep it inside the team");
  });
});

describe("WhoIsOnCallScreen share team calendar link", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    mockSchedules.current = {
      schedules: [entry("s1", "Primary", { _id: "user-2", name: "Priya Rao" })],
      isLoading: false,
      isError: false,
      refetch: async (): Promise<void> => {
        return undefined;
      },
    };
    mockUserId.current = "user-me";
    mockCalendarFeed.current = { isAvailable: true, isChecking: false };
    fetchScheduleFeedSpy().mockReset();
    mockShare.mockReset();
    mockShare.mockResolvedValue({ action: "sharedAction" });
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation((): void => {
      return undefined;
    });
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  test("fetches the schedule's shared feed and hands the link to the share sheet", async (): Promise<void> => {
    fetchScheduleFeedSpy().mockResolvedValue(feedStatus() as never);

    await render(<WhoIsOnCallScreen />);

    await fireEvent.press(screen.getByTestId("roster-share-s1"));

    await waitFor(() => {
      expect(mockShare).toHaveBeenCalledTimes(1);
    });

    expect(fetchScheduleFeedSpy()).toHaveBeenCalledWith("project-1", "s1");

    const shared: SharedContent = mockShare.mock.calls[0]?.[0] as SharedContent;

    expect(shared.title).toBe("Primary on-call calendar");
    expect(shared.message).toContain(SCHEDULE_HTTPS);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  test("says to ask an editor when no shared link has been published", async (): Promise<void> => {
    fetchScheduleFeedSpy().mockResolvedValue(
      feedStatus({ exists: false, feedId: null, urls: null }) as never,
    );

    await render(<WhoIsOnCallScreen />);

    await fireEvent.press(screen.getByTestId("roster-share-s1"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    expect(alertSpy.mock.calls[0]?.[0]).toBe("No shared link yet");
    expect(String(alertSpy.mock.calls[0]?.[1])).toContain(
      "Ask an editor to publish",
    );
    expect(mockShare).not.toHaveBeenCalled();
  });

  test("does not share a link that is switched off", async (): Promise<void> => {
    fetchScheduleFeedSpy().mockResolvedValue(
      feedStatus({ isEnabled: false }) as never,
    );

    await render(<WhoIsOnCallScreen />);

    await fireEvent.press(screen.getByTestId("roster-share-s1"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    expect(alertSpy.mock.calls[0]?.[0]).toBe("Shared link is switched off");
    expect(mockShare).not.toHaveBeenCalled();
  });

  test("explains a 403 as no access, not as a broken server", async (): Promise<void> => {
    fetchScheduleFeedSpy().mockRejectedValue(axiosError(403) as never);

    await render(<WhoIsOnCallScreen />);

    await fireEvent.press(screen.getByTestId("roster-share-s1"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    expect(alertSpy.mock.calls[0]?.[0]).toBe("No access");
  });

  test("explains a 404 as an older server", async (): Promise<void> => {
    fetchScheduleFeedSpy().mockRejectedValue(axiosError(404) as never);

    await render(<WhoIsOnCallScreen />);

    await fireEvent.press(screen.getByTestId("roster-share-s1"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    expect(alertSpy.mock.calls[0]?.[0]).toBe("Not available on this server");
  });

  test("shows the server's message for any other failure", async (): Promise<void> => {
    fetchScheduleFeedSpy().mockRejectedValue(
      new Error("Redis is down") as never,
    );

    await render(<WhoIsOnCallScreen />);

    await fireEvent.press(screen.getByTestId("roster-share-s1"));

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledTimes(1);
    });

    expect(alertSpy.mock.calls[0]?.[0]).toBe("Could not fetch the link");
    expect(alertSpy.mock.calls[0]?.[1]).toBe("Redis is down");
  });

  test("hides the share action when the server predates calendar feeds", async (): Promise<void> => {
    mockCalendarFeed.current = { isAvailable: false, isChecking: false };

    await render(<WhoIsOnCallScreen />);

    expect(screen.queryByTestId("roster-share-s1")).toBeNull();
    expect(screen.getByTestId("roster-card-s1")).toBeTruthy();
  });

  test("offers the action on uncovered schedules too", async (): Promise<void> => {
    mockSchedules.current.schedules = [entry("s-uncovered", "Weekend", null)];

    await render(<WhoIsOnCallScreen />);

    expect(screen.getByTestId("roster-share-s-uncovered")).toBeTruthy();
  });
});
