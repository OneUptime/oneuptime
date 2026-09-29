import React from "react";
import { StyleSheet, type ViewStyle, type TextStyle } from "react-native";
import {
  render,
  screen,
  waitFor,
  fireEvent,
  within,
} from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import HomeScreen from "./HomeScreen";
import { useAllProjectCounts } from "../hooks/useAllProjectCounts";
import { useOnCallDuty } from "../hooks/useOnCallDuty";
import { makeProject } from "../__tests__/testSupport";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius, spacing } from "../theme/tokens";
import type { ProjectItem } from "../api/types";
import type { OnCallDutySummary } from "../oncall/duty";

/*
 * Home is a verdict screen. A responder glances at it, reads the digits, and
 * decides whether anything needs them. That makes a "0" the most consequential
 * thing this file renders, and there are three completely different states
 * that used to arrive at the same 0:
 *
 *   - the request is still in flight,
 *   - the request failed,
 *   - the request came back and there is genuinely nothing outstanding.
 *
 * Only the third one has earned the number. Every count out of
 * useAllProjectCounts falls back to 0 when its query has no data, so without
 * consulting isLoading AND isError the screen tells a responder "nothing is
 * down" on the strength of a request that never landed - which on an on-call
 * app is not a cosmetic bug.
 *
 * The same applies, harder, to the on-call card. "You're not on call" is a
 * sentence that makes people put the phone down, and useOnCallDuty reports the
 * same `isOnCall: false` whether every project answered and none of them put
 * this responder on duty or nothing answered at all.
 *
 * The hooks themselves are covered by their own suites. Here they are stand-ins
 * whose state each test sets directly, because the question under test is
 * purely which claim this screen is willing to make from a given hook state.
 * The `mock` prefix is what lets jest.mock's hoisted factories reach them.
 */

type CountsState = ReturnType<typeof useAllProjectCounts>;
type OnCallState = ReturnType<typeof useOnCallDuty>;

/* Pinned so the countdowns below are arithmetic rather than a race. */
const mockNowMs: number = new Date(2026, 2, 3, 12, 0, 0, 0).getTime();

const mockCounts: { current: CountsState } = {
  current: {} as CountsState,
};

const mockOnCall: { current: OnCallState } = {
  current: {} as OnCallState,
};

const mockProjects: { current: ProjectItem[] } = { current: [] };
const mockNavigate: jest.Mock = jest.fn();

const mockProjectLoadError: { current: Error | null } = { current: null };
const mockRefreshProjects: jest.Mock = jest.fn(async () => {
  return undefined;
});
const mockLightImpact: jest.Mock = jest.fn();

/*
 * The device appearance. ThemeProvider reads it through useColorScheme, which
 * react-native exposes through a getter that cannot be spied on, so the
 * module behind it is replaced. Screens rendered without a provider fall back
 * to the light palette regardless.
 */
const mockColorScheme: { current: "light" | "dark" } = { current: "light" };

jest.mock("react-native/Libraries/Utilities/useColorScheme", () => {
  return {
    __esModule: true,
    default: (): "light" | "dark" => {
      return mockColorScheme.current;
    },
  };
});

jest.mock("../hooks/useAllProjectCounts", () => {
  return {
    useAllProjectCounts: () => {
      return mockCounts.current;
    },
  };
});

jest.mock("../hooks/useOnCallDuty", () => {
  return {
    useOnCallDuty: () => {
      return mockOnCall.current;
    },
  };
});

jest.mock("../hooks/useNow", () => {
  return {
    useNow: () => {
      return mockNowMs;
    },
  };
});

jest.mock("../hooks/useProject", () => {
  return {
    useActiveProject: () => {
      return {
        projectList: mockProjects.current,
        isLoadingProjects: false,
        projectLoadError: mockProjectLoadError.current,
        refreshProjects: mockRefreshProjects,
      };
    },
  };
});

jest.mock("../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: mockLightImpact,
        mediumImpact: jest.fn(),
        selectionFeedback: jest.fn(),
      };
    },
  };
});

jest.mock("@react-navigation/native", () => {
  return {
    useNavigation: () => {
      return { navigate: mockNavigate };
    },
    useFocusEffect: () => {
      return undefined;
    },
  };
});

/*
 * The SSO banner is not what these tests are about, and it is driven by
 * storage rather than by a hook. A responder with nothing pending keeps it off
 * the screen entirely.
 */
jest.mock("../storage/ssoTokens", () => {
  return {
    getSsoTokens: async () => {
      return {};
    },
    getGlobalSsoToken: async () => {
      return null;
    },
  };
});

jest.mock("../sso/ssoDenials", () => {
  return {
    isProjectSsoDenied: () => {
      return false;
    },
  };
});

function countsWith(overrides: Partial<CountsState> = {}): CountsState {
  return {
    incidentCount: 0,
    alertCount: 0,
    incidentEpisodeCount: 0,
    alertEpisodeCount: 0,
    monitorCount: 0,
    disabledMonitorCount: 0,
    inoperationalMonitorCount: 0,
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

function dutySummary(
  overrides: Partial<OnCallDutySummary> = {},
): OnCallDutySummary {
  return {
    isOnCall: false,
    activeShifts: [],
    upcomingShifts: [],
    nextHandoffAt: null,
    nextShiftStartsAt: null,
    standingAssignmentCount: 0,
    scheduleAssignmentCount: 0,
    ...overrides,
  };
}

function onCallWith(overrides: Partial<OnCallState> = {}): OnCallState {
  return {
    summary: dutySummary(),
    assignmentsByProject: [],
    schedules: [],
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => {
      return undefined;
    }) as unknown as () => Promise<void>,
    ...overrides,
  };
}

/*
 * A settled, unambiguous on-call state for the tests that are about the count
 * cards: on duty, and by a standing assignment rather than a shift, so the
 * card draws neither a placeholder nor a countdown of its own. Any "--" or "0"
 * those tests find on the screen can then only have come from a stat card.
 */
function onCallOnDuty(): OnCallState {
  return onCallWith({
    summary: dutySummary({ isOnCall: true, standingAssignmentCount: 2 }),
  });
}

describe("Home shortcuts open the view their labels promise", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallOnDuty();
  });

  test.each([
    [
      "Active Incidents",
      "Inbox",
      "InboxList",
      {
        initialView: "incidents",
        initialSegment: "incidents",
        initialFilter: "active",
      },
    ],
    [
      "Active Alerts",
      "Inbox",
      "InboxList",
      {
        initialView: "alerts",
        initialSegment: "alerts",
        initialFilter: "active",
      },
    ],
    [
      "Incident Episodes",
      "Inbox",
      "InboxList",
      {
        initialView: "incidents",
        initialSegment: "episodes",
        initialFilter: "active",
      },
    ],
    [
      "Alert Episodes",
      "Inbox",
      "InboxList",
      {
        initialView: "alerts",
        initialSegment: "episodes",
        initialFilter: "active",
      },
    ],
    ["Monitor issues", "Monitors", "MonitorsList", { initialFilter: "issues" }],
    [
      "Disabled monitors",
      "Monitors",
      "MonitorsList",
      { initialFilter: "disabled" },
    ],
    ["All monitors", "Monitors", "MonitorsList", { initialFilter: "all" }],
  ])(
    "%s opens its matching segment and filter",
    async (
      label: string,
      tab: string,
      destination: string,
      params: Record<string, string>,
    ) => {
      await render(<HomeScreen />);
      await fireEvent.press(
        screen.getByRole("button", { name: `0 ${label}. Tap to view.` }),
      );
      expect(mockNavigate).toHaveBeenCalledWith(tab, {
        screen: destination,
        params,
      });
    },
  );

  test("the final card has a full tab bar and breathing room below it", async () => {
    await render(<HomeScreen />);
    expect(
      screen.getByTestId("home-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBeGreaterThanOrEqual(124);
  });

  test("SSO recovery preserves Settings as the back destination", async () => {
    mockProjects.current = [makeProject({ requireSsoForLogin: true })];
    await render(<HomeScreen />);
    const recovery: ReturnType<typeof screen.getByRole> =
      await screen.findByRole("button", {
        name: "Some projects require SSO authentication. Tap to authenticate.",
      });
    await fireEvent.press(recovery);
    expect(mockNavigate).toHaveBeenCalledWith("Settings", {
      screen: "ProjectsList",
      initial: false,
    });
  });
});

describe("A stat card never claims a count it does not have", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallOnDuty();
  });

  test("the monitor cards show a placeholder while their counts are in flight", async () => {
    mockCounts.current = countsWith({ isLoading: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Monitor issues, not available yet. Tap to view.",
        ),
      ).toBeTruthy();
    });

    expect(
      screen.getByLabelText(
        "Disabled monitors, not available yet. Tap to view.",
      ),
    ).toBeTruthy();

    /*
     * Nowhere on the screen, not just not on those two cards: an unfetched
     * count has no business appearing as a number anywhere.
     */
    expect(screen.queryByText("0")).toBeNull();
  });

  test("a zero the account actually reported is printed as a zero", async () => {
    mockCounts.current = countsWith();

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText("0 Monitor issues. Tap to view."),
      ).toBeTruthy();
    });

    expect(
      screen.getByLabelText("0 Disabled monitors. Tap to view."),
    ).toBeTruthy();
    expect(screen.queryByText("--")).toBeNull();
  });

  test("a count whose request failed is not printed as a zero", async () => {
    mockCounts.current = countsWith({ isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Monitor issues, not available yet. Tap to view.",
        ),
      ).toBeTruthy();
    });

    expect(
      screen.getByLabelText(
        "Disabled monitors, not available yet. Tap to view.",
      ),
    ).toBeTruthy();
    expect(screen.queryByText("0")).toBeNull();
  });

  test("a failure retires the counts that did come back too", async () => {
    /*
     * useAllProjectCounts reports one isError across seven requests and cannot
     * say which of them failed, so a screen that kept printing the numbers it
     * happens to hold would be presenting a mixture of fact and fallback with
     * no way for the responder to tell them apart.
     */
    mockCounts.current = countsWith({ incidentCount: 4, isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(
          "Active Incidents, not available yet. Tap to view.",
        ),
      ).toBeTruthy();
    });

    expect(screen.queryByText("4")).toBeNull();
  });

  test("all seven individual counts are withheld while loading", async () => {
    /*
     * The headline number is a sum of four counts that are all still 0 by
     * fallback, which made it the most confident "nothing is happening" on the
     * screen. Seven cards plus the total is every number the counts feed.
     */
    mockCounts.current = countsWith({ isLoading: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getAllByText("--")).toHaveLength(7);
    });
  });

  test("real counts are still rendered once they land", async () => {
    mockCounts.current = countsWith({
      incidentCount: 1,
      alertCount: 2,
      incidentEpisodeCount: 3,
      alertEpisodeCount: 4,
      monitorCount: 12,
      disabledMonitorCount: 5,
      inoperationalMonitorCount: 6,
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("12")).toBeTruthy();
    });

    expect(
      screen.getByLabelText("5 Disabled monitors. Tap to view."),
    ).toBeTruthy();
    expect(
      screen.getByLabelText("6 Monitor issues. Tap to view."),
    ).toBeTruthy();

    // Related episodes are not added to their incidents as a misleading total.
    expect(screen.queryByText("Total active items")).toBeNull();
    expect(screen.getByText("Incident Episodes")).toBeTruthy();
    expect(screen.queryByText("--")).toBeNull();
  });
});

describe("The on-call card distinguishes not on call from could not ask", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallWith();
  });

  test("a settled answer of no duty is reported as not on call", async () => {
    mockOnCall.current = onCallWith();

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("You're not on call")).toBeTruthy();
    });

    expect(screen.getByText("OFF CALL")).toBeTruthy();
    expect(screen.getByText("No active on-call assignments")).toBeTruthy();
    expect(screen.queryByText("--")).toBeNull();
  });

  test("a duty check that failed is not an all-clear", async () => {
    /*
     * The reason this file exists. `isOnCall` is false here because nothing
     * answered, not because the answer was no, and a responder who reads OFF
     * CALL off this card stops watching their phone.
     */
    mockOnCall.current = onCallWith({ isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByText("Could not load your on-call status"),
      ).toBeTruthy();
    });

    expect(screen.getByText("Pull to refresh or try again.")).toBeTruthy();
    expect(screen.queryByText("You're not on call")).toBeNull();
    expect(screen.queryByText("OFF CALL")).toBeNull();

    /*
     * The counts are settled zeros in this test, so the only placeholder that
     * can be on the screen is the on-call badge.
     */
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("a duty check that failed does not tell a screen reader they are off duty either", async () => {
    /*
     * The card's spoken label is a second copy of the same claim, and it is
     * the only copy a responder using VoiceOver gets.
     */
    mockOnCall.current = onCallWith({ isError: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByLabelText(/Your on-call status could not be loaded/),
      ).toBeTruthy();
    });

    expect(screen.queryByLabelText(/You are not on call/)).toBeNull();
  });

  test("a duty check still in flight has not answered yet", async () => {
    mockOnCall.current = onCallWith({ isLoading: true });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("Checking your duty status...")).toBeTruthy();
    });

    expect(screen.queryByText("You're not on call")).toBeNull();
    expect(screen.queryByText("OFF CALL")).toBeNull();
    expect(screen.getAllByText("--")).toHaveLength(1);
  });

  test("an active shift is counted down to its handoff", async () => {
    mockOnCall.current = onCallWith({
      summary: dutySummary({
        isOnCall: true,
        scheduleAssignmentCount: 1,
        nextHandoffAt: new Date(2026, 2, 3, 14, 0, 0, 0).toISOString(),
      }),
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("You're on call")).toBeTruthy();
    });

    expect(screen.getByText("ON CALL")).toBeTruthy();
    expect(screen.getByText("Handoff in 2h")).toBeTruthy();
  });

  test("a standing assignment is not given a handoff it does not have", async () => {
    /*
     * An escalation rule that names somebody directly has no window at all, so
     * there is no boundary to count down to. Borrowing one from an unrelated
     * schedule would be the app telling a responder when they can stop.
     */
    mockOnCall.current = onCallWith({
      summary: dutySummary({ isOnCall: true, standingAssignmentCount: 1 }),
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(
        screen.getByText("1 active assignment · no scheduled handoff"),
      ).toBeTruthy();
    });

    expect(screen.getByText("ON CALL")).toBeTruthy();
    expect(screen.queryByText(/Handoff in/)).toBeNull();
  });

  test("an off-duty responder is told when they are next on", async () => {
    mockOnCall.current = onCallWith({
      summary: dutySummary({
        nextShiftStartsAt: new Date(2026, 2, 4, 9, 0, 0, 0).toISOString(),
      }),
    });

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("Next shift starts in 21h")).toBeTruthy();
    });

    expect(screen.getByText("OFF CALL")).toBeTruthy();
  });
});

describe("An empty project list says which kind of empty it is", () => {
  beforeEach(() => {
    mockProjects.current = [];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallWith();
  });

  test("an account that really holds no projects gets the onboarding copy", async () => {
    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("No Projects Found")).toBeTruthy();
    });

    expect(screen.getByText(/Contact your administrator/i)).toBeTruthy();
  });

  test("a project list that could not be fetched is not reported as no access", async () => {
    /*
     * The same empty array reaches this screen either way, and the old copy
     * sent a responder whose request had simply failed off to their
     * administrator for access they already have - while every incident they
     * are responsible for stayed invisible.
     */
    mockProjectLoadError.current = new Error("Network request failed");

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("Could Not Load Projects")).toBeTruthy();
    });

    expect(screen.queryByText("No Projects Found")).toBeNull();
    expect(screen.queryByText(/Contact your administrator/i)).toBeNull();
    expect(screen.getByText(/not the same as you having none/i)).toBeTruthy();
  });

  test("Retry asks for the project list again", async () => {
    mockProjectLoadError.current = new Error("Network request failed");

    await render(<HomeScreen />);
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));

    expect(mockRefreshProjects).toHaveBeenCalledTimes(1);
  });
});

type RenderedElement = ReturnType<typeof screen.getByText>;

function flatStyle(element: RenderedElement): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props["style"]) ?? {}) as ViewStyle &
    TextStyle;
}

/*
 * The surface a ListGroup draws its rows on. The group's own testID sits on
 * an unstyled column that also holds the optional title and footer; the
 * rounded card is its first rendered child when there is no title.
 */
function groupSurface(testID: string): RenderedElement {
  const group: RenderedElement = screen.getByTestId(testID);
  const surface: unknown = group.children[0];
  if (!surface || typeof surface === "string") {
    throw new Error(`${testID} rendered no surface`);
  }
  return surface as RenderedElement;
}

async function renderInTheme(scheme: "light" | "dark"): Promise<void> {
  mockColorScheme.current = scheme;
  await render(
    <ThemeProvider>
      <HomeScreen />
    </ThemeProvider>,
  );
}

describe("The Needs attention tiles", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallOnDuty();
    mockColorScheme.current = "light";
  });

  test("each tile leads with its count and says whether it needs a response", async () => {
    mockCounts.current = countsWith({ incidentCount: 3, alertCount: 0 });

    await render(<HomeScreen />);

    const incidents: RenderedElement = screen.getByTestId(
      "home-tile-incidents",
    );
    const alerts: RenderedElement = screen.getByTestId("home-tile-alerts");

    expect(within(incidents).getByText("3")).toBeTruthy();
    expect(within(incidents).getByText("Active Incidents")).toBeTruthy();
    expect(within(incidents).getByText("Needs response")).toBeTruthy();
    expect(within(alerts).getByText("0")).toBeTruthy();
    expect(within(alerts).getByText("All clear")).toBeTruthy();
  });

  test("a count that needs a response is drawn in its accent, a zero stays neutral", async () => {
    mockCounts.current = countsWith({ incidentCount: 2, alertCount: 0 });

    await render(<HomeScreen />);

    expect(
      flatStyle(screen.getByTestId("home-tile-incidents-count")).color,
    ).toBe(lightColors.severityCritical);
    expect(flatStyle(screen.getByTestId("home-tile-alerts-count")).color).toBe(
      lightColors.textPrimary,
    );
    expect(
      flatStyle(screen.getByTestId("home-tile-incidents-status-dot"))
        .backgroundColor,
    ).toBe(lightColors.severityCritical);
    expect(
      flatStyle(screen.getByTestId("home-tile-alerts-status-dot"))
        .backgroundColor,
    ).toBe(lightColors.statusSuccess);
  });

  test("while counts load, tiles say they are checking rather than all clear", async () => {
    mockCounts.current = countsWith({ isLoading: true });

    await render(<HomeScreen />);

    expect(screen.getAllByText("Checking…")).toHaveLength(2);
    expect(screen.queryByText("All clear")).toBeNull();
    expect(
      within(screen.getByTestId("home-tile-incidents")).getByText("--"),
    ).toBeTruthy();
    expect(
      within(screen.getByTestId("home-tile-alerts")).getByText("--"),
    ).toBeTruthy();
  });

  test("a failed count read is explained, and Retry counts asks again", async () => {
    const refetch: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    mockCounts.current = countsWith({
      isError: true,
      refetch: refetch as unknown as () => Promise<void>,
    });

    await render(<HomeScreen />);

    expect(
      screen.getByText(
        "Counts are unavailable. Open a list or retry to check the latest status.",
      ),
    ).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(screen.getAllByText("Unavailable")).toHaveLength(2);
    expect(screen.queryByText("All clear")).toBeNull();

    await fireEvent.press(screen.getByRole("button", { name: "Retry counts" }));

    expect(refetch).toHaveBeenCalledTimes(1);
  });

  test("settled counts show no failure notice", async () => {
    await render(<HomeScreen />);

    expect(screen.queryByRole("button", { name: "Retry counts" })).toBeNull();
    expect(screen.queryByText(/Counts are unavailable/)).toBeNull();
  });

  test("a tile press is felt before it navigates", async () => {
    await render(<HomeScreen />);

    await fireEvent.press(screen.getByTestId("home-tile-alerts"));

    expect(mockLightImpact).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("Inbox", {
      screen: "InboxList",
      params: {
        initialView: "alerts",
        initialSegment: "alerts",
        initialFilter: "active",
      },
    });
  });

  test("tiles and their counts keep their card surface and tabular digits", async () => {
    mockCounts.current = countsWith({ incidentCount: 7 });

    await render(<HomeScreen />);

    const tile: RenderedElement = screen.getByRole("button", {
      name: "7 Active Incidents. Tap to view.",
    });
    expect(tile).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
    expect(
      flatStyle(screen.getByTestId("home-tile-incidents-count")).fontVariant,
    ).toEqual(["tabular-nums"]);
    expect(
      flatStyle(screen.getByTestId("home-row-all-monitors-count")).fontVariant,
    ).toEqual(["tabular-nums"]);
  });
});

describe("The on-call card", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallWith();
    mockColorScheme.current = "light";
  });

  test("opens the On-Call tab", async () => {
    await render(<HomeScreen />);

    await fireEvent.press(screen.getByTestId("home-oncall-card"));

    expect(mockLightImpact).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("OnCall");
  });

  test("on duty is a success pill with a dot", async () => {
    mockOnCall.current = onCallOnDuty();

    await render(<HomeScreen />);

    expect(screen.getByTestId("home-oncall-status")).toHaveStyle({
      backgroundColor: lightColors.statusSuccessBg,
    });
    expect(screen.getByTestId("home-oncall-status-dot")).toHaveStyle({
      backgroundColor: lightColors.oncallActive,
    });
  });

  test("off duty is a neutral pill without a dot", async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId("home-oncall-status")).toHaveStyle({
      backgroundColor: lightColors.backgroundTertiary,
    });
    expect(screen.queryByTestId("home-oncall-status-dot")).toBeNull();
  });

  test("a failed duty check is a warning, never a success", async () => {
    mockOnCall.current = onCallWith({ isError: true });

    await render(<HomeScreen />);

    expect(screen.getByTestId("home-oncall-status")).toHaveStyle({
      backgroundColor: lightColors.statusWarningBg,
    });
    expect(screen.queryByTestId("home-oncall-status-dot")).toBeNull();
  });

  test("the card is a rounded surface, not a bare strip", async () => {
    await render(<HomeScreen />);

    expect(screen.getByTestId("home-oncall-card")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
    });
  });
});

describe("Service health and grouped event rows", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockOnCall.current = onCallOnDuty();
    mockColorScheme.current = "light";
    mockCounts.current = countsWith({
      monitorCount: 9,
      inoperationalMonitorCount: 2,
      disabledMonitorCount: 1,
      incidentEpisodeCount: 4,
      alertEpisodeCount: 5,
    });
  });

  test.each([
    ["home-row-monitor-issues", "Monitor issues", "2"],
    ["home-row-all-monitors", "All monitors", "9"],
    ["home-row-disabled-monitors", "Disabled monitors", "1"],
    ["home-row-incident-episodes", "Incident Episodes", "4"],
    ["home-row-alert-episodes", "Alert Episodes", "5"],
  ])(
    "%s shows its label beside its count",
    async (testID: string, label: string, count: string) => {
      await render(<HomeScreen />);

      const row: RenderedElement = screen.getByTestId(testID);
      expect(within(row).getByText(label)).toBeTruthy();
      expect(within(row).getByText(count)).toBeTruthy();
    },
  );

  test("monitor issues are highlighted only when there are some", async () => {
    const view: Awaited<ReturnType<typeof render>> = await render(
      <HomeScreen />,
    );

    expect(
      flatStyle(screen.getByTestId("home-row-monitor-issues-count")).color,
    ).toBe(lightColors.statusError);
    expect(
      flatStyle(screen.getByTestId("home-row-all-monitors-count")).color,
    ).toBe(lightColors.textPrimary);

    mockCounts.current = countsWith({ inoperationalMonitorCount: 0 });
    await view.rerender(<HomeScreen />);

    expect(
      flatStyle(screen.getByTestId("home-row-monitor-issues-count")).color,
    ).toBe(lightColors.textPrimary);
  });

  test("unknown counts in rows are muted placeholders", async () => {
    mockCounts.current = countsWith({ isLoading: true });

    await render(<HomeScreen />);

    const count: RenderedElement = screen.getByTestId(
      "home-row-monitor-issues-count",
    );
    expect(count.props.children).toBe("--");
    expect(flatStyle(count).color).toBe(lightColors.textTertiary);
  });

  test("rows sit on rounded grouped surfaces", async () => {
    await render(<HomeScreen />);

    for (const group of ["home-service-health", "home-grouped-events"]) {
      expect(groupSurface(group)).toHaveStyle({
        backgroundColor: lightColors.backgroundElevated,
        borderRadius: radius.lg,
      });
    }
    expect(
      screen.getByText("Episodes bring related incidents or alerts together."),
    ).toBeTruthy();
  });

  test("a row press is felt before it navigates", async () => {
    await render(<HomeScreen />);

    await fireEvent.press(screen.getByTestId("home-row-alert-episodes"));

    expect(mockLightImpact).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith("Inbox", {
      screen: "InboxList",
      params: {
        initialView: "alerts",
        initialSegment: "episodes",
        initialFilter: "active",
      },
    });
  });
});

describe("The SSO banner", () => {
  beforeEach(() => {
    mockProjectLoadError.current = null;
    mockCounts.current = countsWith();
    mockOnCall.current = onCallOnDuty();
    mockColorScheme.current = "light";
  });

  test("names every project that still needs single sign-on", async () => {
    mockProjects.current = [
      makeProject({ _id: "p1", name: "Payments", requireSsoForLogin: true }),
      makeProject({ _id: "p2", name: "Search", requireSsoForLogin: true }),
      makeProject({ _id: "p3", name: "Open", requireSsoForLogin: false }),
    ];

    await render(<HomeScreen />);

    const banner: RenderedElement =
      await screen.findByTestId("home-sso-banner");
    expect(
      within(banner).getByText("SSO Authentication Required"),
    ).toBeTruthy();
    expect(
      within(banner).getByText(
        "Sign in with SSO to see activity from Payments, Search.",
      ),
    ).toBeTruthy();
    expect(banner).toHaveStyle({
      backgroundColor: lightColors.statusWarningBg,
      borderRadius: radius.lg,
    });
  });

  test("is absent when no project needs it", async () => {
    mockProjects.current = [makeProject()];

    await render(<HomeScreen />);

    await waitFor(() => {
      expect(screen.getByText("Overview")).toBeTruthy();
    });
    expect(screen.queryByTestId("home-sso-banner")).toBeNull();
  });
});

describe("Home in light and dark appearance", () => {
  beforeEach(() => {
    mockProjects.current = [makeProject()];
    mockProjectLoadError.current = null;
    mockOnCall.current = onCallOnDuty();
    mockCounts.current = countsWith({ incidentCount: 1 });
  });

  test("a dark device paints the canvas, cards and text from the dark palette", async () => {
    await renderInTheme("dark");

    expect(screen.getByTestId("home-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
    for (const card of [
      "home-tile-incidents",
      "home-tile-alerts",
      "home-oncall-card",
    ]) {
      expect(screen.getByTestId(card)).toHaveStyle({
        backgroundColor: darkColors.backgroundElevated,
        borderRadius: radius.lg,
      });
    }
    for (const group of ["home-service-health", "home-grouped-events"]) {
      expect(groupSurface(group)).toHaveStyle({
        backgroundColor: darkColors.backgroundElevated,
        borderColor: darkColors.borderSubtle,
      });
    }
    expect(flatStyle(screen.getByText("Overview")).color).toBe(
      darkColors.textPrimary,
    );
    expect(flatStyle(screen.getByText("Active Alerts")).color).toBe(
      darkColors.textPrimary,
    );
    expect(
      flatStyle(screen.getByTestId("home-tile-incidents-count")).color,
    ).toBe(darkColors.severityCritical);
    expect(screen.getByTestId("home-oncall-status")).toHaveStyle({
      backgroundColor: darkColors.statusSuccessBg,
    });
  });

  test("an active tile's border is a translucent tint of its accent, not a light hex", async () => {
    await renderInTheme("dark");

    const border: unknown = flatStyle(
      screen.getByTestId("home-tile-incidents"),
    ).borderColor;
    expect(border).toMatch(/^rgba\(255, 138, 128, 0\.5\)$/);
    expect(flatStyle(screen.getByTestId("home-tile-alerts")).borderColor).toBe(
      darkColors.borderSubtle,
    );
  });

  test("a light device inside the same provider keeps the light palette", async () => {
    await renderInTheme("light");

    expect(screen.getByTestId("home-scroll")).toHaveStyle({
      backgroundColor: lightColors.backgroundPrimary,
    });
    expect(screen.getByTestId("home-tile-alerts")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
    });
    expect(flatStyle(screen.getByText("Active Alerts")).color).toBe(
      lightColors.textPrimary,
    );
  });

  test("the failure notice and the SSO banner follow dark mode too", async () => {
    mockCounts.current = countsWith({ isError: true });
    mockProjects.current = [makeProject({ requireSsoForLogin: true })];

    await renderInTheme("dark");

    expect(await screen.findByTestId("home-sso-banner")).toHaveStyle({
      backgroundColor: darkColors.statusWarningBg,
    });
    expect(
      flatStyle(
        screen.getByText(
          "Counts are unavailable. Open a list or retry to check the latest status.",
        ),
      ).color,
    ).toBe(darkColors.textPrimary);
  });

  test("screen gutters and section rhythm come from the spacing scale", async () => {
    await renderInTheme("dark");

    expect(
      screen.getByTestId("home-scroll").props.contentContainerStyle,
    ).toMatchObject({ padding: spacing.xl, gap: spacing.xxl });
  });
});
