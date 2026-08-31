import React from "react";
import { render, screen } from "@testing-library/react-native";
import { describe, expect, test, beforeEach } from "@jest/globals";
import MonitorDetailScreen from "./MonitorDetailScreen";
import {
  makeColor,
  makeFeedItem,
  makeMonitor,
  makeNamedEntityWithColor,
} from "../__tests__/testSupport";
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

async function renderScreen(): Promise<void> {
  /*
   * The screen reads nothing but route.params, so the rest of the navigation
   * props are not built out - handing it a real navigator would be a lot of
   * scaffolding in front of nothing this file asserts on.
   */
  const props: ScreenProps = {
    route: { params: { monitorId: MONITOR_ID, projectId: PROJECT_ID } },
  } as unknown as ScreenProps;

  await render(<MonitorDetailScreen {...props} />);
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

  test("a failed request leaves the responder on a settled screen, not a spinner", async () => {
    /*
     * A rejected query keeps `data` undefined, so this lands on the same
     * branch as a deleted monitor. What is pinned here is only that the
     * screen settles: it does not sit spinning forever, and it does not
     * render half a monitor out of the sections that did load.
     */
    mockMonitorQuery.current = queryState<MonitorItem>({ isError: true });
    mockTimelineQuery.current = queryState<MonitorStatusTimelineItem[]>({
      data: [makeTimelineEntry()],
    });

    await renderScreen();

    expect(screen.getByText("Monitor not found.")).toBeTruthy();
    expect(screen.queryByLabelText("Loading content")).toBeNull();
    expect(screen.queryByText("Status History")).toBeNull();
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
