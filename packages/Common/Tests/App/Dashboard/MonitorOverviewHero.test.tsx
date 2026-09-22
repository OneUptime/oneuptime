/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import MonitorOverviewHero, {
  ComponentProps,
  getMonitorOverviewIcon,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/Overview/MonitorOverviewHero";
import { ResourceOwnerEntry } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/OwnerEntry";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  forbidSection,
  getLoadingSection,
  OverviewSection,
  resolveSection,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/OverviewSection";
import Team from "../../../Models/DatabaseModels/Team";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import MonitorOverviewFamilyUtil, {
  MonitorOverviewFamily,
} from "../../../Utils/Monitor/MonitorOverviewFamily";
import MonitorOverviewPresentationUtil, {
  MonitorOverviewPresentation,
  MonitorOverviewPresentationInput,
  MonitorOverviewRunState,
  MonitorOverviewStatusRef,
} from "../../../Utils/Monitor/MonitorOverviewPresentationUtil";
import { MonitorOverviewProbeSummary } from "../../../Utils/Monitor/MonitorOverviewProbeUtil";

/*
 * The monitor overview hero, RENDERED from the real presentation model: one
 * case per run state of the hero table, plus the pieces the layout owns -
 * the inline status dot, the live "for {duration}", the pulse times, the
 * facts band, owners, the target line and the refresh controls.
 *
 * The clock is pinned so "Operational for 3 days, 4 hours" and "a minute
 * ago" are exact.
 */

const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const MONITOR_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DEVICE_ID: string = "66666666-6666-4666-8666-666666666666";
const DAY: number = 86400;

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const OPERATIONAL: MonitorOverviewStatusRef = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Operational",
  color: "#10B981",
  isOperationalState: true,
  isOfflineState: false,
};

const OFFLINE: MonitorOverviewStatusRef = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Offline",
  color: "#EF4444",
  isOperationalState: false,
  isOfflineState: true,
};

const stepsOf: (...stepData: Array<JSONObject>) => MonitorSteps = (
  ...stepData: Array<JSONObject>
): MonitorSteps => {
  return {
    data: {
      monitorStepsInstanceArray: stepData.map((data: JSONObject) => {
        return { data: { id: STEP_ID, ...data } };
      }),
    },
  } as unknown as MonitorSteps;
};

const probeSummary: (
  overrides?: Partial<MonitorOverviewProbeSummary>,
) => MonitorOverviewProbeSummary = (
  overrides?: Partial<MonitorOverviewProbeSummary>,
): MonitorOverviewProbeSummary => {
  return {
    rows: [],
    attachedCount: 2,
    enabledCount: 2,
    reportingCount: 2,
    disabledCount: 0,
    disconnectedCount: 0,
    lastResultAt: secondsAgo(60),
    nextCheckAt: secondsAgo(-240),
    latestResult: {
      probeId: "33333333-3333-4333-8333-333333333333",
      probeName: "London",
      monitoredAt: secondsAgo(60),
      isOnline: true,
      responseTimeInMs: 120,
      responseCode: 200,
    },
    responseTime: {
      medianMs: 120,
      minMs: 100,
      maxMs: 140,
      respondedCount: 2,
      totalCount: 2,
    },
    ...overrides,
  };
};

const NO_RESULTS: Partial<MonitorOverviewProbeSummary> = {
  reportingCount: 0,
  lastResultAt: undefined,
  latestResult: undefined,
  responseTime: null,
};

const inputFor: (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentationInput = (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentationInput => {
  const isProbeCheck: boolean =
    MonitorOverviewFamilyUtil.getFamily(monitorType) ===
    MonitorOverviewFamily.ProbeCheck;

  return {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: stepsOf({
      monitorDestination: "https://api.example.com/health",
      requestType: "GET",
      networkDeviceMonitor: { networkDeviceId: DEVICE_ID },
    }),
    monitoringInterval: "*/5 * * * *",
    createdAt: secondsAgo(30 * DAY),
    currentStatus: OPERATIONAL,
    statusSince: secondsAgo(3 * DAY + 4 * 3600),
    pause: {
      isDisabled: false,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes: isProbeCheck ? probeSummary() : null,
    heartbeat: {
      lastReceivedAt: secondsAgo(120),
      lastCheckedAt: secondsAgo(30),
      requestMethod: "POST",
    },
    email: { lastReceivedAt: secondsAgo(300), lastCheckedAt: secondsAgo(40) },
    agent: {
      lastReportAt: secondsAgo(45),
      hostname: "web-01.example.com",
      cpuPercent: 42.4,
      memoryPercent: 63.6,
    },
    telemetry: {
      lastEvaluatedAt: secondsAgo(30),
      nextEvaluationAt: secondsAgo(-270),
    },
    latestEvaluationAt: secondsAgo(90),
    ...overrides,
  };
};

const presentationFor: (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
) => MonitorOverviewPresentation = (
  monitorType: MonitorType,
  overrides?: Partial<MonitorOverviewPresentationInput>,
): MonitorOverviewPresentation => {
  return MonitorOverviewPresentationUtil.build(
    inputFor(monitorType, overrides),
  );
};

const LOADED_NO_OWNERS: OverviewSection<Array<ResourceOwnerEntry>> =
  resolveSection<Array<ResourceOwnerEntry>>({
    value: [],
    subjectId: MONITOR_ID.toString(),
  });

type RenderHeroFunction = (overrides?: Partial<ComponentProps>) => RenderResult;

const renderHero: RenderHeroFunction = (
  overrides?: Partial<ComponentProps>,
): RenderResult => {
  const props: ComponentProps = {
    monitorId: MONITOR_ID,
    monitorType: MonitorType.API,
    presentation: presentationFor(MonitorType.API),
    owners: LOADED_NO_OWNERS,
    isRefreshing: false,
    refreshError: "",
    lastLoadedAt: secondsAgo(30),
    onRefresh: () => {},
    ...overrides,
  };

  return render(
    <MemoryRouter>
      <MonitorOverviewHero {...props} />
    </MemoryRouter>,
  );
};

const routeFor: (pageMap: PageMap) => string = (pageMap: PageMap): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageMap] as Route, {
    modelId: MONITOR_ID,
  }).toString();
};

const BADGE_TONE_CLASS: Record<string, string> = {
  good: "text-emerald-800",
  warning: "text-amber-800",
  danger: "text-red-800",
  info: "text-blue-800",
  neutral: "text-gray-700",
};

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

interface RunStateCase {
  name: string;
  monitorType: MonitorType;
  overrides: Partial<MonitorOverviewPresentationInput>;
  runState: MonitorOverviewRunState;
  badge: string;
  badgeTone: string;
  secondary: Array<string>;
  headline: string;
  hasExplanation: boolean;
  lastKnown?: string | undefined;
  cta?: { text: string; page: PageMap } | undefined;
}

const RUN_STATE_CASES: Array<RunStateCase> = [
  {
    name: "1 manual with a status",
    monitorType: MonitorType.Manual,
    overrides: {},
    runState: MonitorOverviewRunState.Manual,
    badge: "Operational",
    badgeTone: "good",
    secondary: ["Manual"],
    headline: "Operational for 3 days, 4 hours",
    hasExplanation: true,
    cta: { text: "Change status", page: PageMap.MONITOR_VIEW_STATUS_TIMELINE },
  },
  {
    name: "1b manual with no status",
    monitorType: MonitorType.Manual,
    overrides: { currentStatus: undefined, statusSince: undefined },
    runState: MonitorOverviewRunState.Manual,
    badge: "Unknown status",
    badgeTone: "neutral",
    secondary: ["Manual"],
    headline: "No status recorded yet",
    hasExplanation: true,
    cta: { text: "Change status", page: PageMap.MONITOR_VIEW_STATUS_TIMELINE },
  },
  {
    name: "2a disabled with no probe enabled",
    monitorType: MonitorType.API,
    overrides: {
      pause: {
        isDisabled: true,
        byManualIncident: false,
        byScheduledMaintenance: false,
      },
      probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
    },
    runState: MonitorOverviewRunState.Paused,
    badge: "Disabled",
    badgeTone: "neutral",
    secondary: ["Probes Not Enabled"],
    headline: "Monitoring is turned off",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: { text: "Open settings", page: PageMap.MONITOR_VIEW_SETTINGS },
  },
  {
    name: "2b paused by an incident",
    monitorType: MonitorType.API,
    overrides: {
      pause: {
        isDisabled: false,
        byManualIncident: true,
        byScheduledMaintenance: false,
      },
    },
    runState: MonitorOverviewRunState.Paused,
    badge: "Paused",
    badgeTone: "neutral",
    secondary: [],
    headline: "Monitoring is paused by an incident",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: { text: "View incidents", page: PageMap.MONITOR_VIEW_INCIDENTS },
  },
  {
    name: "2c paused for maintenance",
    monitorType: MonitorType.API,
    overrides: {
      pause: {
        isDisabled: false,
        byManualIncident: false,
        byScheduledMaintenance: true,
      },
    },
    runState: MonitorOverviewRunState.Paused,
    badge: "Paused",
    badgeTone: "neutral",
    secondary: [],
    headline: "Monitoring is paused for scheduled maintenance",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
  },
  {
    name: "3a every attached probe switched off",
    monitorType: MonitorType.API,
    overrides: {
      probes: probeSummary({
        ...NO_RESULTS,
        enabledCount: 0,
        disabledCount: 2,
      }),
    },
    runState: MonitorOverviewRunState.NotChecking,
    badge: "Probes Not Enabled",
    badgeTone: "danger",
    secondary: [],
    headline: "Every probe is turned off for this monitor",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: { text: "Manage probes", page: PageMap.MONITOR_VIEW_PROBES },
  },
  {
    name: "3b no probe attached",
    monitorType: MonitorType.API,
    overrides: {
      probes: probeSummary({
        ...NO_RESULTS,
        attachedCount: 0,
        enabledCount: 0,
      }),
    },
    runState: MonitorOverviewRunState.NotChecking,
    badge: "Probes Not Enabled",
    badgeTone: "danger",
    secondary: [],
    headline: "No probes are attached to this monitor",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: { text: "Add a probe", page: PageMap.MONITOR_VIEW_PROBES },
  },
  {
    name: "3c no probe enabled, attachment unknown",
    monitorType: MonitorType.API,
    overrides: {
      probes: null,
      probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
    },
    runState: MonitorOverviewRunState.NotChecking,
    badge: "Probes Not Enabled",
    badgeTone: "danger",
    secondary: [],
    headline: "Nothing is checking this monitor",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: { text: "Manage probes", page: PageMap.MONITOR_VIEW_PROBES },
  },
  {
    name: "3d every probe disconnected",
    monitorType: MonitorType.API,
    overrides: {
      probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: true },
    },
    runState: MonitorOverviewRunState.NotChecking,
    badge: "Probes Disconnected",
    badgeTone: "danger",
    secondary: [],
    headline: "Every probe checking this monitor is disconnected",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: { text: "Check probes", page: PageMap.MONITOR_VIEW_PROBES },
  },
  {
    name: "4a no criteria",
    monitorType: MonitorType.API,
    overrides: { monitorSteps: stepsOf() },
    runState: MonitorOverviewRunState.NotConfigured,
    badge: "Not set up",
    badgeTone: "neutral",
    secondary: [],
    headline: "This monitor has no criteria yet",
    hasExplanation: true,
    cta: { text: "Set up criteria", page: PageMap.MONITOR_VIEW_CRITERIA },
  },
  {
    name: "4b network device with no device",
    monitorType: MonitorType.NetworkDevice,
    overrides: { monitorSteps: stepsOf({}) },
    runState: MonitorOverviewRunState.NotConfigured,
    badge: "Not set up",
    badgeTone: "neutral",
    secondary: [],
    headline: "No network device is selected",
    hasExplanation: true,
    cta: { text: "Choose a device", page: PageMap.MONITOR_VIEW_CRITERIA },
  },
  {
    name: "5 probe check waiting for its first result",
    monitorType: MonitorType.API,
    overrides: {
      createdAt: secondsAgo(60),
      probes: probeSummary(NO_RESULTS),
    },
    runState: MonitorOverviewRunState.AwaitingFirstData,
    badge: "Waiting for data",
    badgeTone: "info",
    secondary: [],
    headline: "Waiting for the first check",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
  },
  {
    name: "5 heartbeat waiting for its first request",
    monitorType: MonitorType.IncomingRequest,
    overrides: {
      heartbeat: { lastReceivedAt: undefined, lastCheckedAt: undefined },
    },
    runState: MonitorOverviewRunState.AwaitingFirstData,
    badge: "Waiting for data",
    badgeTone: "info",
    secondary: [],
    headline: "Waiting for the first heartbeat",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: {
      text: "Setup instructions",
      page: PageMap.MONITOR_VIEW_DOCUMENTATION,
    },
  },
  {
    name: "5 server waiting for the agent",
    monitorType: MonitorType.Server,
    overrides: { agent: { lastReportAt: undefined } },
    runState: MonitorOverviewRunState.AwaitingFirstData,
    badge: "Waiting for data",
    badgeTone: "info",
    secondary: [],
    headline: "Waiting for the agent to report",
    hasExplanation: true,
    lastKnown: "Last recorded status: Operational",
    cta: {
      text: "Setup instructions",
      page: PageMap.MONITOR_VIEW_DOCUMENTATION,
    },
  },
  {
    name: "6a overdue with results",
    monitorType: MonitorType.API,
    overrides: {
      probes: probeSummary({
        lastResultAt: secondsAgo(2 * 3600),
        nextCheckAt: undefined,
      }),
    },
    runState: MonitorOverviewRunState.Overdue,
    badge: "Operational",
    badgeTone: "good",
    secondary: ["Checks overdue"],
    headline: "Operational for 3 days, 4 hours",
    hasExplanation: true,
    cta: { text: "Check probes", page: PageMap.MONITOR_VIEW_PROBES },
  },
  {
    name: "6b overdue, never reported",
    monitorType: MonitorType.API,
    overrides: {
      createdAt: secondsAgo(2 * DAY),
      probes: probeSummary({ ...NO_RESULTS, nextCheckAt: undefined }),
    },
    runState: MonitorOverviewRunState.Overdue,
    /*
     * Nothing was ever measured, so the stored status is only the default
     * the monitor was created with: it is neither the badge nor the
     * headline, just the last recorded status.
     */
    badge: "No results yet",
    badgeTone: "warning",
    secondary: ["Checks overdue"],
    headline: "No check has completed yet",
    lastKnown: "Last recorded status: Operational",
    hasExplanation: true,
    cta: { text: "Check probes", page: PageMap.MONITOR_VIEW_PROBES },
  },
  {
    name: "7 running",
    monitorType: MonitorType.API,
    overrides: {},
    runState: MonitorOverviewRunState.Running,
    badge: "Operational",
    badgeTone: "good",
    secondary: [],
    headline: "Operational for 3 days, 4 hours",
    hasExplanation: false,
  },
  {
    name: "7b running with no status",
    monitorType: MonitorType.API,
    overrides: { currentStatus: undefined, statusSince: undefined },
    runState: MonitorOverviewRunState.Running,
    badge: "Unknown status",
    badgeTone: "neutral",
    secondary: [],
    headline: "No status recorded yet",
    hasExplanation: false,
  },
];

describe("MonitorOverviewHero run states", () => {
  test.each(RUN_STATE_CASES)("$name", (testCase: RunStateCase) => {
    const presentation: MonitorOverviewPresentation = presentationFor(
      testCase.monitorType,
      testCase.overrides,
    );

    // The case really is the run state it is named after.
    expect(presentation.runState).toBe(testCase.runState);

    renderHero({
      monitorType: testCase.monitorType,
      presentation: presentation,
    });

    const badge: HTMLElement = within(
      screen.getByTestId("monitor-overview-badge"),
    ).getByText(testCase.badge, { exact: true });
    expect(badge).toHaveClass(BADGE_TONE_CLASS[testCase.badgeTone]!);

    expect(
      screen
        .queryAllByTestId("monitor-overview-secondary-badge")
        .map((element: HTMLElement) => {
          return element.textContent;
        }),
    ).toEqual(testCase.secondary);

    expect(screen.getByTestId("monitor-overview-headline")).toHaveTextContent(
      testCase.headline,
    );

    if (testCase.hasExplanation) {
      expect(presentation.explanation).toBeTruthy();
      expect(
        screen.getByTestId("monitor-overview-explanation"),
      ).toHaveTextContent(presentation.explanation!);
    } else {
      expect(screen.queryByTestId("monitor-overview-explanation")).toBeNull();
    }

    if (testCase.lastKnown) {
      expect(
        screen.getByTestId("monitor-overview-last-known"),
      ).toHaveTextContent(testCase.lastKnown);
    } else {
      expect(screen.queryByTestId("monitor-overview-last-known")).toBeNull();
    }

    if (testCase.cta) {
      expect(
        screen.getByRole("link", { name: testCase.cta.text }),
      ).toHaveAttribute("href", routeFor(testCase.cta.page));
    } else {
      for (const text of [
        "Open settings",
        "View incidents",
        "Manage probes",
        "Check probes",
        "Setup instructions",
        "Change status",
      ]) {
        expect(screen.queryByRole("link", { name: text })).toBeNull();
      }
    }

    // The tile carries the hero's tone, whatever the badge says.
    const tileClass: Record<string, string> = {
      good: "bg-emerald-50",
      warning: "bg-amber-50",
      danger: "bg-red-50",
      info: "bg-sky-50",
      neutral: "bg-gray-100",
    };
    expect(screen.getByTestId("monitor-overview-icon")).toHaveClass(
      tileClass[presentation.tone]!,
    );
  });

  test("an overdue monitor drops good to warning in the tile, and an offline one stays danger", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        probes: probeSummary({ lastResultAt: secondsAgo(2 * 3600) }),
      }),
    });
    expect(screen.getByTestId("monitor-overview-icon")).toHaveClass(
      "bg-amber-50",
      "text-amber-700",
    );
    cleanup();

    renderHero({
      presentation: presentationFor(MonitorType.API, {
        currentStatus: OFFLINE,
        probes: probeSummary({ lastResultAt: secondsAgo(2 * 3600) }),
      }),
    });
    expect(screen.getByTestId("monitor-overview-icon")).toHaveClass(
      "bg-red-50",
      "text-red-700",
    );
  });

  test.each([
    [MonitorOverviewRunState.Running, "good", IconProp.CheckCircle],
    [MonitorOverviewRunState.Running, "warning", IconProp.Alert],
    [MonitorOverviewRunState.Running, "danger", IconProp.ExclaimationCircle],
    [MonitorOverviewRunState.Running, "neutral", IconProp.Info],
    [MonitorOverviewRunState.Overdue, "warning", IconProp.Clock],
    [MonitorOverviewRunState.Paused, "neutral", IconProp.PauseCircle],
    [MonitorOverviewRunState.NotChecking, "danger", IconProp.SignalSlash],
    [
      MonitorOverviewRunState.NotConfigured,
      "neutral",
      IconProp.WrenchScrewdriver,
    ],
    [MonitorOverviewRunState.AwaitingFirstData, "info", IconProp.Clock],
    [MonitorOverviewRunState.Manual, "good", IconProp.Pencil],
  ])(
    "the %s icon for a %s tone is %s",
    (runState: MonitorOverviewRunState, tone: string, icon: IconProp) => {
      const presentation: MonitorOverviewPresentation = {
        ...presentationFor(MonitorType.API),
        runState: runState,
        tone: tone as MonitorOverviewPresentation["tone"],
      };

      expect(getMonitorOverviewIcon(presentation)).toBe(icon);
    },
  );
});

describe("MonitorOverviewHero layout", () => {
  test("the status dot has an inline background colour and no colour class", () => {
    renderHero({});

    const dot: HTMLElement = screen.getByTestId("monitor-overview-status-dot");

    expect(dot).toHaveAttribute("aria-hidden", "true");
    expect(dot.style.backgroundColor).toBe("rgb(16, 185, 129)");
    expect(dot.className).not.toMatch(/(^|\s)bg-/);
  });

  test("no dot when the badge is not the status", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
      }),
    });

    expect(screen.queryByTestId("monitor-overview-status-dot")).toBeNull();
  });

  test("the headline's duration is live, with the exact start time on hover", () => {
    const since: Date = secondsAgo(3 * DAY + 4 * 3600);

    renderHero({});

    const headline: HTMLElement = screen.getByTestId(
      "monitor-overview-headline",
    );
    expect(headline).toHaveTextContent("Operational for 3 days, 4 hours");

    const duration: HTMLElement = within(headline).getByText("3 days, 4 hours");
    expect(duration.parentElement).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(since),
    );
  });

  test("with no start time the headline makes no duration claim", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        statusSince: undefined,
      }),
    });

    expect(screen.getByTestId("monitor-overview-headline").textContent).toBe(
      "Operational",
    );
  });

  test("the pulse says when it last checked and when it checks next, as <time> elements", () => {
    renderHero({});

    const pulse: HTMLElement = screen.getByTestId("monitor-overview-pulse");
    expect(pulse).toHaveTextContent("Last checked a minute ago");

    const times: Array<HTMLElement> = Array.from(
      pulse.querySelectorAll("time"),
    );
    expect(times).toHaveLength(2);
    expect(times[0]).toHaveAttribute("dateTime", secondsAgo(60).toISOString());
    expect(times[0]!.getAttribute("title")).toBeTruthy();
    expect(times[1]).toHaveAttribute(
      "dateTime",
      secondsAgo(-240).toISOString(),
    );

    expect(screen.getByTestId("monitor-overview-cadence")).toHaveTextContent(
      "Every 5 minutes · next in 4 minutes",
    );
    expect(screen.queryByTestId("monitor-overview-overdue")).toBeNull();
  });

  test("unknown probes read as unavailable, never as 'not checked yet'", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        probes: null,
      }),
    });

    const pulse: HTMLElement = screen.getByTestId("monitor-overview-pulse");
    expect(pulse).toHaveTextContent("Last checked: unavailable");
    expect(pulse).not.toHaveTextContent("Not checked yet");
    expect(within(pulse).getByText("Last checked: unavailable")).toHaveClass(
      "text-gray-400",
    );
  });

  test("a manual monitor's pulse says there are no automated checks and has no cadence", () => {
    renderHero({
      monitorType: MonitorType.Manual,
      presentation: presentationFor(MonitorType.Manual),
    });

    expect(screen.getByTestId("monitor-overview-pulse")).toHaveTextContent(
      "No automated checks",
    );
    expect(screen.queryByTestId("monitor-overview-cadence")).toBeNull();
  });

  test("an overdue monitor says by how much, in amber", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        probes: probeSummary({
          lastResultAt: secondsAgo(2 * 3600),
          nextCheckAt: undefined,
        }),
      }),
    });

    const overdue: HTMLElement = screen.getByTestId("monitor-overview-overdue");
    // Two hours since the last result, one five-minute cadence of which was due.
    expect(overdue).toHaveTextContent("Overdue by 1h 55m");
    expect(overdue).toHaveClass("text-amber-700");
  });

  test('"Probes Not Enabled" is on the page when no probe is enabled', () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        probeFlags: { isNoProbeEnabled: true, isAllProbesDisconnected: false },
      }),
    });

    expect(screen.getByText("Probes Not Enabled")).toBeInTheDocument();
  });

  test("the facts are a labelled definition list, in order, owners last", () => {
    renderHero({
      monitorType: MonitorType.SSLCertificate,
      presentation: presentationFor(MonitorType.SSLCertificate, {
        probes: probeSummary({
          latestResult: {
            probeId: "33333333-3333-4333-8333-333333333333",
            probeName: "London",
            monitoredAt: secondsAgo(60),
            isOnline: true,
            sslExpiresAt: new Date(NOW.getTime() + 40 * DAY * 1000),
          },
        }),
      }),
    });

    const facts: HTMLElement = screen.getByLabelText("Monitor at a glance");
    expect(facts.tagName).toBe("DL");
    expect(facts).toHaveClass("sm:grid-cols-2", "xl:grid-cols-4");
    expect(
      within(facts)
        .getAllByRole("term")
        .map((term: HTMLElement) => {
          return term.textContent;
        }),
    ).toEqual(["Latest result", "Certificate expires", "Probes", "Owners"]);
    expect(within(facts).getAllByRole("definition")).toHaveLength(4);

    expect(
      screen.getByTestId("monitor-overview-fact-latest-result"),
    ).toHaveTextContent("Up");
    expect(
      screen.getByTestId("monitor-overview-fact-certificate-expiry"),
    ).toHaveTextContent("in 40 days");
  });

  test("three facts sit in three columns from sm up", () => {
    renderHero({});

    expect(screen.getByLabelText("Monitor at a glance")).toHaveClass(
      "grid-cols-1",
      "sm:grid-cols-3",
    );
  });

  test("a good result is emerald, a muted fact is grey, and a link fact goes to its page", () => {
    renderHero({});

    const latest: HTMLElement = within(
      screen.getByTestId("monitor-overview-fact-latest-result"),
    ).getByRole("definition");
    expect(latest).toHaveClass("text-emerald-700");
    expect(latest).toHaveTextContent("Up · 120 ms · HTTP 200");
    expect(latest).toHaveTextContent("from London");

    expect(
      within(screen.getByTestId("monitor-overview-fact-probes")).getByRole(
        "link",
        { name: "2 of 2 reporting" },
      ),
    ).toHaveAttribute("href", routeFor(PageMap.MONITOR_VIEW_PROBES));
    cleanup();

    renderHero({
      presentation: presentationFor(MonitorType.API, { probes: null }),
    });
    expect(
      within(
        screen.getByTestId("monitor-overview-fact-latest-result"),
      ).getByRole("definition"),
    ).toHaveClass("text-gray-400");
  });

  test("the device fact links to the device the step names", () => {
    renderHero({
      monitorType: MonitorType.NetworkDevice,
      presentation: presentationFor(MonitorType.NetworkDevice),
    });

    expect(screen.getByRole("link", { name: "View device" })).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.NETWORK_DEVICE_VIEW] as Route,
        { modelId: new ObjectID(DEVICE_ID) },
      ).toString(),
    );
  });

  test("a heartbeat's last check is a relative time, not text", () => {
    renderHero({
      monitorType: MonitorType.IncomingRequest,
      presentation: presentationFor(MonitorType.IncomingRequest),
    });

    const fact: HTMLElement = screen.getByTestId(
      "monitor-overview-fact-heartbeat-check",
    );
    expect(fact.querySelector("time")).toHaveAttribute(
      "dateTime",
      secondsAgo(30).toISOString(),
    );
  });

  describe("owners", () => {
    test("no owners says so and links to the Owners page", () => {
      renderHero({ owners: LOADED_NO_OWNERS });

      const owners: HTMLElement = screen.getByTestId(
        "monitor-overview-fact-owners",
      );
      expect(owners).toHaveTextContent("No owners");
      expect(
        within(owners).getByRole("link", { name: "Add owners" }),
      ).toHaveAttribute("href", routeFor(PageMap.MONITOR_VIEW_OWNERS));
      expect(owners).not.toHaveTextContent("Unavailable");
    });

    test("owners that could not be read are unavailable, with no invitation to add more", () => {
      renderHero({
        owners: forbidSection<Array<ResourceOwnerEntry>>({
          reason: "No access",
          subjectId: MONITOR_ID.toString(),
        }),
      });

      const owners: HTMLElement = screen.getByTestId(
        "monitor-overview-fact-owners",
      );
      expect(owners).toHaveTextContent("Unavailable");
      expect(within(owners).getByText("Unavailable")).toHaveClass(
        "text-gray-400",
      );
      expect(within(owners).queryByRole("link")).toBeNull();
      expect(owners).not.toHaveTextContent("No owners");
    });

    test("while loading there is neither an invitation nor 'Unavailable'", () => {
      renderHero({ owners: getLoadingSection<Array<ResourceOwnerEntry>>() });

      const owners: HTMLElement = screen.getByTestId(
        "monitor-overview-fact-owners",
      );
      expect(within(owners).queryByRole("link")).toBeNull();
      expect(owners).not.toHaveTextContent("Unavailable");
      expect(owners).not.toHaveTextContent("No owners");
    });

    test("owners render as the avatar stack", () => {
      const team: Team = new Team();
      team._id = "5f8b7c1e2d3a4b5c6d7e8f91";
      team.name = "Payments";

      renderHero({
        owners: resolveSection<Array<ResourceOwnerEntry>>({
          value: [{ kind: "team", team: team }],
          subjectId: MONITOR_ID.toString(),
        }),
      });

      const owners: HTMLElement = screen.getByTestId(
        "monitor-overview-fact-owners",
      );
      expect(owners).not.toHaveTextContent("No owners");
      expect(owners).not.toHaveTextContent("Unavailable");
      expect(within(owners).queryByRole("link")).toBeNull();
      expect(
        screen.queryByTestId("monitor-overview-owners-partial"),
      ).toBeNull();
    });

    test("owners from a partial or failed read are shown, but not as the whole list", () => {
      const team: Team = new Team();
      team._id = "5f8b7c1e2d3a4b5c6d7e8f91";
      team.name = "Payments";

      const partial: OverviewSection<Array<ResourceOwnerEntry>> = {
        ...resolveSection<Array<ResourceOwnerEntry>>({
          value: [{ kind: "team", team: team }],
          subjectId: MONITOR_ID.toString(),
        }),
        refreshError: "You need permission to read this monitor's owner users.",
      };

      renderHero({ owners: partial });

      const note: HTMLElement = screen.getByTestId(
        "monitor-overview-owners-partial",
      );
      expect(note).toHaveTextContent("List may be incomplete");
      expect(note).toHaveAttribute(
        "title",
        "You need permission to read this monitor's owner users.",
      );
      expect(
        screen.getByTestId("monitor-overview-fact-owners"),
      ).toContainElement(note);
    });
  });

  test("the target is monospaced with its full value on hover, and never shows credentials", () => {
    const view: RenderResult = renderHero({
      monitorType: MonitorType.Website,
      presentation: presentationFor(MonitorType.Website, {
        monitorSteps: stepsOf(
          {
            monitorDestination:
              "https://admin:hunter2@shop.example.com/health?token=abc123#top",
          },
          {},
        ),
      }),
    });

    const target: HTMLElement = screen.getByTestId("monitor-overview-target");
    expect(target).toHaveTextContent("Website");

    const value: HTMLElement = screen.getByTestId(
      "monitor-overview-target-value",
    );
    expect(value).toHaveTextContent("https://shop.example.com/health");
    expect(value).toHaveClass("font-mono");
    expect(value).toHaveAttribute("title", "https://shop.example.com/health");
    expect(target).toHaveTextContent("(+1 more step)");

    expect(view.container.innerHTML).not.toContain("hunter2");
    expect(view.container.innerHTML).not.toContain("admin");
    expect(view.container.innerHTML).not.toContain("abc123");
  });

  test("a type with no target shows only its name", () => {
    renderHero({
      monitorType: MonitorType.Manual,
      presentation: presentationFor(MonitorType.Manual),
    });

    const target: HTMLElement = screen.getByTestId("monitor-overview-target");
    expect(target).toHaveTextContent("Manual");
    expect(screen.queryByTestId("monitor-overview-target-value")).toBeNull();
  });

  test("the target line is not a paragraph, because the type icon is a div", () => {
    renderHero({});

    const target: HTMLElement = screen.getByTestId("monitor-overview-target");
    expect(target.tagName).toBe("DIV");
    // No block element may end up inside a <p> anywhere in the hero.
    expect(
      screen
        .getByTestId("monitor-overview-hero")
        .querySelectorAll("p div, p section, p ul"),
    ).toHaveLength(0);
  });

  test("Refresh calls back, and is disabled while refreshing", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    renderHero({ onRefresh: onRefresh });
    fireEvent.click(screen.getByTestId("monitor-overview-refresh"));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    cleanup();

    renderHero({ onRefresh: onRefresh, isRefreshing: true });
    expect(screen.getByTestId("monitor-overview-refresh")).toBeDisabled();
  });

  test("a failed refresh is announced, and says what is on screen", () => {
    const prefers12Hour: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    try {
      renderHero({ refreshError: "Network error." });

      const alert: HTMLElement = screen.getByRole("alert");
      expect(alert).toHaveAttribute(
        "data-testid",
        "monitor-overview-refresh-error",
      );
      expect(alert).toHaveTextContent(
        "Couldn't refresh. Showing what loaded at 11:59. Network error.",
      );
      expect(alert).toHaveClass("text-red-700");
      expect(alert.querySelector("time")).toHaveAttribute(
        "dateTime",
        secondsAgo(30).toISOString(),
      );
    } finally {
      prefers12Hour.mockRestore();
    }
  });

  test("the alert's text holds still while refreshes keep failing", () => {
    /*
     * An alert is re-read in full whenever its text changes. A relative
     * time ticking inside it ("3 minutes ago", "4 minutes ago") made a
     * screen reader interrupt its user once a minute.
     */
    renderHero({ refreshError: "Network error." });

    const before: string = screen.getByRole("alert").textContent || "";

    act(() => {
      jest.advanceTimersByTime(5 * 60 * 1000);
    });

    expect(screen.getByRole("alert").textContent).toBe(before);
  });

  test("a load from an earlier day names the day as well as the time", () => {
    const prefers12Hour: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    try {
      renderHero({
        refreshError: "Network error.",
        lastLoadedAt: new Date("2026-09-20T23:58:00.000Z"),
      });

      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't refresh. Showing what loaded at Sep 20, 23:58. Network error.",
      );
    } finally {
      prefers12Hour.mockRestore();
    }
  });

  test("with nothing loaded yet the alert says so without a time", () => {
    renderHero({ refreshError: "Network error.", lastLoadedAt: null });

    const alert: HTMLElement = screen.getByRole("alert");
    expect(alert).toHaveTextContent(
      "Couldn't refresh. Showing what loaded earlier. Network error.",
    );
    expect(alert.querySelector("time")).toBeNull();
  });

  test("no alert when the last refresh worked", () => {
    renderHero({});

    expect(screen.queryByRole("alert")).toBeNull();
  });
});
