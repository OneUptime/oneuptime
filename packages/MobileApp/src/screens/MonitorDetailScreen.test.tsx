import React from "react";
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";
import {
  act,
  render,
  screen,
  fireEvent,
  within,
} from "@testing-library/react-native";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import MonitorDetailScreen from "./MonitorDetailScreen";
import {
  makeColor,
  makeFeedItem,
  makeMonitor,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
import { ThemeProvider } from "../theme";
import { darkColors, lightColors } from "../theme/colors";
import { radius, spacing } from "../theme/tokens";
import type { FeedItem, MonitorItem } from "../api/types";
import type {
  MonitorProbeItem,
  MonitorStatusTimelineItem,
} from "../api/monitors";

/*
 * A responder reaches this screen from a push notification, and the question
 * they are holding is "is this thing actually down, and since when". The
 * screen answers it four times over from four independent queries - the
 * monitor, its probes, its status history and its feed - and any one of them
 * can be absent while the others have landed.
 *
 * That is what these tests are about. Every section here is behind a truthiness
 * guard, so the failure mode is not a crash: it is a section quietly missing,
 * or worse, a section rendered with a fallback that reads like a fact. The two
 * that matter most are the status pill, because "Operational" on a monitor
 * whose active monitoring is switched off is a lie the responder will act on,
 * and the summary card, which is the only place the actual measurements
 * appear.
 *
 * The four hooks are stand-ins whose state each test sets directly;
 * useMonitorDetail.test.tsx owns how they get there, and what is under test
 * here is purely which screen a given combination of hook states produces. The
 * `mock` prefix is what lets jest.mock's hoisted factories reach the holders.
 *
 * Every render and fireEvent is awaited: in this version of
 * @testing-library/react-native both are async, and an unawaited one returns
 * before React has flushed, so the assertion after it runs against the screen
 * as it was beforehand.
 */

const PROJECT_ID: string = "project-1";
const MONITOR_ID: string = "monitor-1";

interface FakeQuery<T> {
  data: T | null | undefined;
  isLoading: boolean;
  isError: boolean;
  refetch: jest.Mock;
}

function queryState<T>(overrides: Partial<FakeQuery<T>> = {}): FakeQuery<T> {
  return {
    data: undefined,
    isLoading: false,
    isError: false,
    refetch: jest.fn(async () => {
      return undefined;
    }),
    ...overrides,
  };
}

const mockMonitorQuery: { current: FakeQuery<MonitorItem> } = {
  current: queryState<MonitorItem>(),
};
const mockTimelineQuery: { current: FakeQuery<MonitorStatusTimelineItem[]> } = {
  current: queryState<MonitorStatusTimelineItem[]>(),
};
const mockProbesQuery: { current: FakeQuery<MonitorProbeItem[]> } = {
  current: queryState<MonitorProbeItem[]>(),
};
const mockFeedQuery: { current: FakeQuery<FeedItem[]> } = {
  current: queryState<FeedItem[]>(),
};

/*
 * The device appearance ThemeProvider follows. react-native exposes
 * useColorScheme through a getter that cannot be spied on, so the module
 * behind it is replaced.
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

jest.mock("../hooks/useScreenPadding", () => {
  return {
    useScreenPadding: () => {
      return 248;
    },
  };
});

jest.mock("../hooks/useMonitorDetail", () => {
  return {
    useMonitorDetail: () => {
      return mockMonitorQuery.current;
    },
    useMonitorStatusTimeline: () => {
      return mockTimelineQuery.current;
    },
    useMonitorProbes: () => {
      return mockProbesQuery.current;
    },
    useMonitorFeed: () => {
      return mockFeedQuery.current;
    },
  };
});

type ScreenProps = React.ComponentProps<typeof MonitorDetailScreen>;

async function renderScreen(
  scheme: "light" | "dark" | null = null,
): Promise<void> {
  /*
   * The screen reads nothing but route.params, so the rest of the navigation
   * props are not built out - handing it a real navigator would be a lot of
   * scaffolding in front of nothing this file asserts on.
   */
  const props: ScreenProps = {
    route: { params: { monitorId: MONITOR_ID, projectId: PROJECT_ID } },
  } as unknown as ScreenProps;

  if (scheme === null) {
    await render(<MonitorDetailScreen {...props} />);
    return;
  }

  mockColorScheme.current = scheme;
  await render(
    <ThemeProvider>
      <MonitorDetailScreen {...props} />
    </ThemeProvider>,
  );
}

type RenderedElement = ReturnType<typeof screen.getByText>;

function flatStyle(element: RenderedElement): ViewStyle & TextStyle {
  return (StyleSheet.flatten(element.props["style"]) ?? {}) as ViewStyle &
    TextStyle;
}

function makeTimelineEntry(
  overrides: Partial<MonitorStatusTimelineItem> = {},
): MonitorStatusTimelineItem {
  return {
    _id: "monitor-status-timeline-1",
    createdAt: "2026-08-30T09:00:00.000Z",
    startsAt: "2026-08-30T09:00:00.000Z",
    monitorStatus: {
      _id: "monitor-status-2",
      name: "Offline",
      color: { r: 220, g: 38, b: 38 },
    },
    ...overrides,
  };
}

function makeWebsiteProbe(): MonitorProbeItem {
  return {
    _id: "monitor-probe-1",
    probeId: "probe-1",
    probe: { _id: "probe-1", name: "US East" },
    lastMonitoringLog: {
      "probe-1": {
        isOnline: true,
        responseCode: 200,
        responseTimeInMs: 137,
      },
    },
  };
}

beforeEach(() => {
  mockColorScheme.current = "light";
  mockMonitorQuery.current = queryState<MonitorItem>();
  mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>();
  mockProbesQuery.current = queryState<MonitorProbeItem[]>();
  mockFeedQuery.current = queryState<FeedItem[]>();
});

describe("While the monitor is still being fetched", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ isLoading: true });
  });

  test("the responder gets a skeleton rather than an empty screen", async () => {
    await renderScreen();

    expect(screen.getByLabelText("Loading content")).toBeTruthy();
  });

  test("a monitor that has not arrived is not reported as missing", async () => {
    /*
     * `data` is undefined for the whole of the first fetch, and the not-found
     * branch sits directly after it. Getting the order wrong flashes "Monitor
     * not found." at a responder who followed a push notification to a monitor
     * that exists perfectly well.
     */
    await renderScreen();

    expect(screen.queryByText("Monitor not found.")).toBeNull();
  });

  test("no section is rendered from the other three queries either", async () => {
    /*
     * The probe, timeline and feed queries can land before the monitor does.
     * None of their sections belong on screen until there is a monitor to
     * hang them on.
     */
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      data: [makeWebsiteProbe()],
    });
    mockFeedQuery.current = queryState<FeedItem[]>({
      data: [makeFeedItem({ feedInfoInMarkdown: "Monitor went offline" })],
    });

    await renderScreen();

    expect(screen.queryByText("Monitor Summary")).toBeNull();
    expect(screen.queryByText("Activity Feed")).toBeNull();
  });
});

describe("When the monitor could not be loaded", () => {
  test("a monitor that is genuinely gone says so", async () => {
    /*
     * `null` is how a deleted monitor arrives: `fetchMonitorById` resolves it
     * rather than `undefined` so that react-query caches the miss as data
     * instead of rejecting the query, which is what `undefined` would make it
     * do. Either way this screen has one ending for "no monitor", and this is
     * it.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({ data: null });

    await renderScreen();

    expect(screen.getByText("Monitor not found.")).toBeTruthy();
    expect(screen.queryByLabelText("Loading content")).toBeNull();
  });

  test("a failed request offers retry without claiming the monitor was deleted", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({ isError: true });
    await renderScreen();
    expect(screen.queryByText("Monitor not found.")).toBeNull();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
    await fireEvent.press(screen.getByRole("button", { name: "Retry" }));
    expect(mockMonitorQuery.current.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("What a loaded monitor puts on screen", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
  });

  test("the name, the type and the current status", async () => {
    await renderScreen();

    expect(screen.getByText("api.example.com")).toBeTruthy();

    /*
     * Both of these appear twice by design - once in the header card and once
     * in the Details block - and counting them is what keeps a future edit
     * from dropping one of the two without anyone noticing.
     */
    expect(screen.getAllByText("Website")).toHaveLength(2);
    expect(screen.getAllByText("Operational")).toHaveLength(2);
  });

  test("the created timestamp is formatted rather than printed as the wire value", async () => {
    /*
     * The formatted output is locale- and timezone-dependent, so what is
     * asserted is the half that is not: the raw ISO string must not reach the
     * responder, and neither must "Invalid Date".
     */
    await renderScreen();

    expect(screen.getByText("Created")).toBeTruthy();
    expect(screen.queryByText("2026-08-01T00:00:00.000Z")).toBeNull();
    expect(screen.queryByText("Invalid Date")).toBeNull();
  });

  test("a monitor with no createdAt gets a dash rather than 1970", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ createdAt: undefined as unknown as string }),
    });

    await renderScreen();

    expect(screen.getByText("—")).toBeTruthy();
  });

  test("a description is rendered under its own heading", async () => {
    await renderScreen();

    expect(screen.getByText("Description")).toBeTruthy();
    expect(screen.getByText("The public API endpoint.")).toBeTruthy();
  });

  test("a monitor with no description is not given an empty Description block", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ description: "" }),
    });

    await renderScreen();

    expect(screen.queryByText("Description")).toBeNull();
  });

  test("a description that arrives as a typed object is unwrapped, not stringified", async () => {
    /*
     * OneUptime serialises rich fields as { _type, value }. Rendered as-is
     * this heading is followed by a blob of JSON.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({
        description: {
          _type: "Markdown",
          value: "Checks the checkout endpoint.",
        } as unknown as string,
      }),
    });

    await renderScreen();

    expect(screen.getByText("Checks the checkout endpoint.")).toBeTruthy();
    expect(screen.queryByText(/_type/)).toBeNull();
  });

  test("a monitor type the app does not know is shown as the server named it", async () => {
    /*
     * The label map is a nicety, not a gate. A monitor type added on the
     * server after this build shipped must still name itself rather than
     * rendering as nothing.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ monitorType: "QuantumEntanglement" }),
    });

    await renderScreen();

    expect(screen.getAllByText("QuantumEntanglement")).toHaveLength(2);
  });

  test("a known type is shown by its readable name", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ monitorType: "SSLCertificate" }),
    });

    await renderScreen();

    expect(screen.getAllByText("SSL Certificate")).toHaveLength(2);
    expect(screen.queryByText("SSLCertificate")).toBeNull();
  });

  test("a monitor with no type at all still has a heading", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ monitorType: undefined }),
    });

    await renderScreen();

    expect(screen.getAllByText("Monitor")).toHaveLength(2);
  });

  test("a monitor with no status reports it as unknown rather than as healthy", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ currentMonitorStatus: undefined }),
    });

    await renderScreen();

    expect(screen.getByText("Unknown")).toBeTruthy();
    expect(screen.queryByText("Operational")).toBeNull();
  });
});

describe("A monitor whose active monitoring is switched off", () => {
  beforeEach(() => {
    /*
     * The dangerous shape: the monitor still carries the last status it had
     * before it was disabled, so the payload says "Operational" about a
     * monitor that has not been checked since.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ disableActiveMonitoring: true }),
    });
  });

  test("is called disabled in both places it is described", async () => {
    await renderScreen();

    expect(screen.getAllByText("Disabled")).toHaveLength(2);
  });

  test("never shows the stale status it is still carrying", async () => {
    await renderScreen();

    expect(screen.queryByText("Operational")).toBeNull();
  });
});

describe("The status history", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
  });

  test("every transition the server returned is listed", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [
        makeTimelineEntry({
          _id: "timeline-1",
          monitorStatus: {
            _id: "monitor-status-2",
            name: "Offline",
            color: makeColor(),
          },
        }),
        makeTimelineEntry({
          _id: "timeline-2",
          monitorStatus: {
            _id: "monitor-status-3",
            name: "Degraded",
            color: makeColor(),
          },
        }),
      ],
    });

    await renderScreen();

    expect(screen.getByText("Status History")).toBeTruthy();
    expect(screen.getByText("Offline")).toBeTruthy();
    expect(screen.getByText("Degraded")).toBeTruthy();
  });

  test("the root cause is shown beside the transition it explains", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [
        makeTimelineEntry({
          rootCause: "Probe reported a connection timeout",
        }),
      ],
    });

    await renderScreen();

    expect(
      screen.getByText("Probe reported a connection timeout"),
    ).toBeTruthy();
  });

  test("a transition with no status still names itself something", async () => {
    /*
     * The relation can come back unpopulated when the status row was deleted
     * out from under the timeline. A row with a coloured dot and no label
     * beside it reads as a rendering fault.
     */
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [makeTimelineEntry({ monitorStatus: undefined })],
    });

    await renderScreen();

    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  test("a monitor that has never changed status gets no empty history block", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [],
    });

    await renderScreen();

    expect(screen.queryByText("Status History")).toBeNull();
  });

  test("a history that has not arrived yet is not rendered as no history", async () => {
    await renderScreen();

    expect(screen.queryByText("Status History")).toBeNull();
  });
});

describe("The activity feed", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
  });

  test("every feed entry is on screen under its own heading", async () => {
    mockFeedQuery.current = queryState<FeedItem[]>({
      data: [
        makeFeedItem({
          _id: "feed-1",
          feedInfoInMarkdown: "Monitor went offline",
        }),
        makeFeedItem({
          _id: "feed-2",
          feedInfoInMarkdown: "Monitor recovered",
        }),
      ],
    });

    await renderScreen();

    expect(screen.getByText("Activity Feed")).toBeTruthy();
    expect(screen.getByText("Monitor went offline")).toBeTruthy();
    expect(screen.getByText("Monitor recovered")).toBeTruthy();
  });

  test("a monitor with no activity gets no empty feed block", async () => {
    mockFeedQuery.current = queryState<FeedItem[]>({ data: [] });

    await renderScreen();

    expect(screen.queryByText("Activity Feed")).toBeNull();
  });

  test("a feed that has not arrived yet is not rendered as no activity", async () => {
    await renderScreen();

    expect(screen.queryByText("Activity Feed")).toBeNull();
  });
});

describe("The monitor summary", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
  });

  test("the probe's own measurements reach the card", async () => {
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      data: [makeWebsiteProbe()],
    });

    await renderScreen();

    expect(screen.getByText("Monitor Summary")).toBeTruthy();
    expect(screen.getByText("Status Code")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
    expect(screen.getByText("137")).toBeTruthy();
  });

  test("the monitor's own type chooses the summary, not the probe's payload", async () => {
    /*
     * A server monitor's probe log carries infrastructure metrics rather than
     * an HTTP result, and the type on the monitor is the only thing that says
     * which renderer to use. Passing the wrong one through shows a responder
     * an HTTP summary of a machine.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ monitorType: "Server" }),
    });
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      data: [
        {
          _id: "monitor-probe-1",
          lastMonitoringLog: {
            "probe-1": {
              isOnline: true,
              basicInfrastructureMetrics: {
                cpuMetrics: { percentUsed: 44 },
                memoryMetrics: { percentUsed: 71 },
                diskMetrics: [
                  { diskPath: "/", percentUsed: 15 },
                  { diskPath: "/var", percentUsed: 96 },
                ],
              },
            },
          },
        },
      ],
    });

    await renderScreen();

    expect(screen.getByText("CPU")).toBeTruthy();
    expect(screen.getByText("/var")).toBeTruthy();
    expect(screen.getByText("96")).toBeTruthy();
    expect(screen.queryByText("Status Code")).toBeNull();
  });

  test("a monitor with no probes still shows the section and says why it is empty", async () => {
    /*
     * The section is unconditional, so the empty state has to carry the
     * explanation. `probeItems` is defaulted to an empty array on the way in,
     * and an undefined reaching the card would throw inside the render.
     */
    await renderScreen();

    expect(screen.getByText("Monitor Summary")).toBeTruthy();
    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
  });

  test("an empty probe list is treated the same way", async () => {
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({ data: [] });

    await renderScreen();

    expect(screen.getByText("No monitoring data available yet.")).toBeTruthy();
  });
});

describe("Everything landing at once", () => {
  test("the four queries render four sections without colliding", async () => {
    /*
     * The realistic steady state, and the only test here that exercises all
     * four sections in one tree - each of the others deliberately leaves most
     * of them empty.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({
        currentMonitorStatus: makeNamedEntityWithColor({
          _id: "monitor-status-2",
          name: "Offline",
        }),
      }),
    });
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      data: [makeWebsiteProbe()],
    });
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [makeTimelineEntry({ rootCause: "Connection refused" })],
    });
    mockFeedQuery.current = queryState<FeedItem[]>({
      data: [makeFeedItem({ feedInfoInMarkdown: "Monitor went offline" })],
    });

    await renderScreen();

    expect(screen.getByText("Monitor Summary")).toBeTruthy();
    expect(screen.getByText("Details")).toBeTruthy();
    expect(screen.getByText("Status History")).toBeTruthy();
    expect(screen.getByText("Activity Feed")).toBeTruthy();
    expect(screen.getByText("Connection refused")).toBeTruthy();
    expect(screen.getByText("Monitor went offline")).toBeTruthy();
  });
});

describe("Monitor status guidance", () => {
  test("disabled checks are explained so the last status is not mistaken for current health", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ disableActiveMonitoring: true }),
    });
    await renderScreen();
    expect(screen.getByText("Monitoring is paused")).toBeTruthy();
    expect(
      screen.getByText(
        "Active checks are disabled. The last recorded status may not reflect this service's current health.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByTestId("detail-scroll").props.contentContainerStyle
        .paddingBottom,
    ).toBe(248);
  });

  test("a background failure preserves the last available monitor details", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor(),
      isError: true,
    });
    await renderScreen();
    expect(screen.getByText("api.example.com")).toBeTruthy();
    expect(screen.queryByText("Something went wrong")).toBeNull();
  });
});

describe("The monitor summary section", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
  });

  test("the summary is its own card, not a card inside a section card", async () => {
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      data: [makeWebsiteProbe()],
    });

    await renderScreen();

    const section: RenderedElement = screen.getByTestId(
      "monitor-summary-section",
    );
    expect(within(section).getByText("Monitor Summary")).toBeTruthy();
    expect(within(section).getByTestId("monitor-summary-card")).toBeTruthy();
    for (const card of screen.queryAllByTestId("response-section-card")) {
      expect(within(card).queryByTestId("monitor-summary-card")).toBeNull();
    }
  });

  test("measurements still loading show progress, not an empty summary", async () => {
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      isLoading: true,
    });

    await renderScreen();

    expect(screen.getByText("Loading monitor measurements…")).toBeTruthy();
    expect(screen.getByTestId("monitor-summary-loading")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
    });
    expect(screen.queryByTestId("monitor-summary-card")).toBeNull();
    expect(screen.queryByText("No monitoring data available yet.")).toBeNull();
  });

  test("a refetch keeps the last measurements on screen while it runs", async () => {
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      isLoading: true,
      data: [makeWebsiteProbe()],
    });

    await renderScreen();

    expect(screen.getByText("Loading monitor measurements…")).toBeTruthy();
    expect(screen.getByText("200")).toBeTruthy();
  });

  test("a failed measurement read is not shown as no data, and can be retried", async () => {
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      isError: true,
    });

    await renderScreen();

    expect(
      screen.getByText("Unable to load the latest monitor measurements."),
    ).toBeTruthy();
    expect(screen.queryByText("No monitoring data available yet.")).toBeNull();
    expect(screen.queryByTestId("monitor-summary-card")).toBeNull();

    await fireEvent.press(
      screen.getByRole("button", { name: "Retry monitor summary" }),
    );

    expect(mockProbesQuery.current.refetch).toHaveBeenCalledTimes(1);
  });

  test("failed history and activity reads each offer their own retry", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      isError: true,
    });
    mockFeedQuery.current = queryState<FeedItem[]>({ isError: true });

    await renderScreen();

    await fireEvent.press(
      screen.getByRole("button", { name: "Retry status history" }),
    );
    await fireEvent.press(
      screen.getByRole("button", { name: "Retry activity" }),
    );

    expect(mockTimelineQuery.current.refetch).toHaveBeenCalledTimes(1);
    expect(mockFeedQuery.current.refetch).toHaveBeenCalledTimes(1);
    expect(screen.queryByText("Status History")).toBeNull();
    expect(screen.queryByText("Activity Feed")).toBeNull();
  });

  test("pulling to refresh asks all four reads again", async () => {
    await renderScreen();

    await act(async () => {
      await screen
        .getByTestId("detail-scroll")
        .props.refreshControl.props.onRefresh();
    });

    expect(mockMonitorQuery.current.refetch).toHaveBeenCalledTimes(1);
    expect(mockTimelineQuery.current.refetch).toHaveBeenCalledTimes(1);
    expect(mockProbesQuery.current.refetch).toHaveBeenCalledTimes(1);
    expect(mockFeedQuery.current.refetch).toHaveBeenCalledTimes(1);
  });
});

describe("The paused-monitoring banner", () => {
  test("is a rounded warning surface on a disabled monitor", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ disableActiveMonitoring: true }),
    });

    await renderScreen();

    expect(screen.getByTestId("monitor-paused-banner")).toHaveStyle({
      backgroundColor: lightColors.statusWarningBg,
      borderRadius: radius.lg,
      marginBottom: spacing.xxl,
    });
    expect(flatStyle(screen.getByText("Monitoring is paused")).color).toBe(
      lightColors.statusWarning,
    );
  });

  test("is absent while checks are running", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });

    await renderScreen();

    expect(screen.queryByTestId("monitor-paused-banner")).toBeNull();
  });
});

describe("The status history timeline", () => {
  beforeEach(() => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
  });

  test("sits on one card with a rail between consecutive changes", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [
        makeTimelineEntry({ _id: "t-1" }),
        makeTimelineEntry({ _id: "t-2" }),
        makeTimelineEntry({ _id: "t-3" }),
      ],
    });

    await renderScreen();

    expect(screen.getByTestId("monitor-status-history")).toHaveStyle({
      backgroundColor: lightColors.backgroundElevated,
      borderRadius: radius.lg,
      padding: spacing.lg,
    });
    expect(screen.getAllByTestId("monitor-status-history-entry")).toHaveLength(
      3,
    );
    expect(screen.getAllByTestId("monitor-status-history-rail")).toHaveLength(
      2,
    );
  });

  test("each dot takes its status colour, haloed by a translucent tint of it", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [makeTimelineEntry()],
    });

    await renderScreen();

    expect(screen.getByTestId("monitor-status-history-dot")).toHaveStyle({
      backgroundColor: "#dc2626",
    });
    expect(screen.getByTestId("monitor-status-history-halo")).toHaveStyle({
      backgroundColor: "rgba(220, 38, 38, 0.2)",
    });
  });

  test("a change with no status uses a muted theme colour for its dot", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [makeTimelineEntry({ monitorStatus: undefined })],
    });

    await renderScreen();

    expect(screen.getByTestId("monitor-status-history-dot")).toHaveStyle({
      backgroundColor: lightColors.textTertiary,
    });
  });
});

/*
 * The status in effect right now is the newest change, and it has no end. It
 * used to look like every other row - a name and "2m ago" - so the reader had
 * to work out that the top row was the current one. It is now marked
 * Currently Active, the way the web dashboard's status timeline marks it, and
 * its duration counts up every second while the screen is open.
 */
describe("The status in effect now", () => {
  const NOW: number = new Date("2026-10-02T12:45:57.000Z").getTime();
  const SECOND: number = 1000;
  const HOUR: number = 60 * 60 * SECOND;

  const isoAgo: (milliseconds: number) => string = (
    milliseconds: number,
  ): string => {
    return new Date(NOW - milliseconds).toISOString();
  };

  // Newest first, as the status timeline query returns them.
  const ENTRIES: MonitorStatusTimelineItem[] = [
    makeTimelineEntry({
      _id: "t-current",
      createdAt: isoAgo(174 * SECOND),
      startsAt: isoAgo(174 * SECOND),
      monitorStatus: {
        _id: "monitor-status-1",
        name: "Operational",
        color: { r: 22, g: 163, b: 74 },
      },
    }),
    makeTimelineEntry({
      _id: "t-finished",
      createdAt: isoAgo(3 * HOUR),
      startsAt: isoAgo(3 * HOUR),
      endsAt: isoAgo(174 * SECOND),
    }),
    // Never closed, but superseded: it lasted until the change after it.
    makeTimelineEntry({
      _id: "t-orphan",
      createdAt: isoAgo(5 * HOUR),
      startsAt: isoAgo(5 * HOUR),
      monitorStatus: {
        _id: "monitor-status-3",
        name: "Degraded",
        color: { r: 245, g: 158, b: 11 },
      },
    }),
  ];

  // The badge's mark is hidden from assistive technology by design.
  const HIDDEN: { includeHiddenElements: boolean } = {
    includeHiddenElements: true,
  };

  function entry(index: number): ReturnType<typeof screen.getByTestId> {
    return screen.getAllByTestId("monitor-status-history-entry")[index]!;
  }

  function timing(index: number): ReturnType<typeof screen.getByTestId> {
    return screen.getAllByTestId("monitor-status-history-timing")[index]!;
  }

  async function advance(milliseconds: number): Promise<void> {
    await act(async () => {
      jest.advanceTimersByTime(milliseconds);
    });
  }

  beforeEach(() => {
    jest.useFakeTimers({ now: NOW });
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: ENTRIES,
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  test("is marked Currently Active, and nothing else is", async () => {
    await renderScreen();

    expect(screen.getAllByTestId("currently-active-badge")).toHaveLength(1);
    expect(within(entry(0)).getByTestId("currently-active-badge")).toBeTruthy();
    expect(within(entry(0)).getByText("Currently Active")).toBeTruthy();
    expect(within(entry(1)).queryByTestId("currently-active-badge")).toBeNull();
    expect(within(entry(2)).queryByTestId("currently-active-badge")).toBeNull();
  });

  test("the marker sits beside the status name, and is read as its words", async () => {
    await renderScreen();

    const badge: ReturnType<typeof screen.getByTestId> = within(
      entry(0),
    ).getByTestId("currently-active-badge");

    expect(badge.props.accessibilityLabel).toBe("Currently Active");

    const title: ReturnType<typeof screen.getByTestId> = within(
      entry(0),
    ).getByTestId("monitor-status-history-title");

    expect(within(title).getByText("Operational")).toBeTruthy();
    expect(within(title).getByTestId("currently-active-badge")).toBe(badge);
    // A long status name pushes the marker onto its own line, not off screen.
    expect(title).toHaveStyle({ flexDirection: "row", flexWrap: "wrap" });
  });

  test("says how long it has lasted so far", async () => {
    await renderScreen();

    expect(timing(0)).toHaveTextContent("2m ago · for 2m 54s");
    expect(
      within(entry(0)).getByTestId("monitor-status-history-live-duration").props
        .accessibilityRole,
    ).toBe("timer");
  });

  test("its duration counts up every second, with no reload", async () => {
    await renderScreen();

    await advance(SECOND);
    expect(timing(0)).toHaveTextContent(/ · for 2m 55s$/);

    await advance(SECOND);
    expect(timing(0)).toHaveTextContent(/ · for 2m 56s$/);

    await advance(4 * SECOND);
    expect(timing(0)).toHaveTextContent(/ · for 3m 0s$/);
  });

  test("the other changes say how long they lasted, and stand still", async () => {
    await renderScreen();

    expect(timing(1)).toHaveTextContent("3h ago · for 2h 57m 6s");
    // Capped at the start of the change after it, not counted to now.
    expect(timing(2)).toHaveTextContent("5h ago · for 2h 0m 0s");

    await advance(10 * SECOND);

    expect(timing(1)).toHaveTextContent("3h ago · for 2h 57m 6s");
    expect(timing(2)).toHaveTextContent("5h ago · for 2h 0m 0s");
  });

  test("a newest change that has already ended is not marked", async () => {
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [
        makeTimelineEntry({
          _id: "t-ended",
          createdAt: isoAgo(HOUR),
          startsAt: isoAgo(HOUR),
          endsAt: isoAgo(10 * SECOND),
        }),
      ],
    });

    await renderScreen();

    expect(screen.queryByTestId("currently-active-badge")).toBeNull();
    expect(
      screen.queryByTestId("monitor-status-history-live-duration"),
    ).toBeNull();
    expect(timing(0)).toHaveTextContent("1h ago · for 59m 50s");
  });

  test("the marker's dot beats only once the OS says motion is welcome", async () => {
    await renderScreen();

    // The OS answered "no reduced motion" (the default here).
    expect(
      within(entry(0)).getByTestId("currently-active-badge-pulse", HIDDEN),
    ).toBeTruthy();
  });

  test("follows dark mode", async () => {
    await renderScreen("dark");

    expect(within(entry(0)).getByTestId("currently-active-badge")).toHaveStyle({
      backgroundColor: darkColors.statusInfoBg,
    });
  });
});

describe("Monitor detail in light and dark appearance", () => {
  test("a dark device paints the page, cards and banner from the dark palette", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({
      data: makeMonitor({ disableActiveMonitoring: true }),
    });
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      data: [makeWebsiteProbe()],
    });
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [makeTimelineEntry()],
    });

    await renderScreen("dark");

    expect(screen.getByTestId("detail-scroll")).toHaveStyle({
      backgroundColor: darkColors.backgroundPrimary,
    });
    expect(screen.getByTestId("monitor-summary-card")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
      borderColor: darkColors.borderSubtle,
    });
    expect(screen.getByTestId("monitor-status-history")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
    expect(screen.getByTestId("monitor-status-history-halo")).toHaveStyle({
      backgroundColor: "rgba(220, 38, 38, 0.3)",
    });
    expect(screen.getByTestId("monitor-paused-banner")).toHaveStyle({
      backgroundColor: darkColors.statusWarningBg,
    });
    expect(
      flatStyle(screen.getByRole("header", { name: "api.example.com" })).color,
    ).toBe(darkColors.textPrimary);
    for (const card of screen.getAllByTestId("response-section-card")) {
      expect(card).toHaveStyle({
        backgroundColor: darkColors.backgroundElevated,
      });
    }
  });

  test("the loading card and failure page follow dark mode too", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });
    mockProbesQuery.current = queryState<MonitorProbeItem[]>({
      isLoading: true,
    });

    await renderScreen("dark");

    expect(screen.getByTestId("monitor-summary-loading")).toHaveStyle({
      backgroundColor: darkColors.backgroundElevated,
    });
    expect(
      flatStyle(screen.getByText("Loading monitor measurements…")).color,
    ).toBe(darkColors.textSecondary);
  });

  test("page gutters come from the spacing scale", async () => {
    mockMonitorQuery.current = queryState<MonitorItem>({ data: makeMonitor() });

    await renderScreen("light");

    expect(
      screen.getByTestId("detail-scroll").props.contentContainerStyle,
    ).toMatchObject({ padding: spacing.xl, paddingBottom: 248 });
  });
});
