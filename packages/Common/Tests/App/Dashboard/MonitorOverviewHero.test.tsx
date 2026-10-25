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
import { getJestSpyOn } from "../../Spy";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import Color from "../../../Types/Color";
import {
  MODEL_SWITCH_SAVED_EVENT,
  ModelSwitchSaved,
} from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import { TURN_MONITORING_ON_BUTTON_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/MonitoringSwitchCopy";
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
import TeamMember from "../../../Models/DatabaseModels/TeamMember";
import User from "../../../Models/DatabaseModels/User";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import { OwnersChange } from "../../../../App/FeatureSet/Dashboard/src/Components/Owners/AddOwners";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
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

let columnGate: PermissionGateResult = { isAllowed: true };
let statusEventGate: PermissionGateResult = { isAllowed: true };

const OPERATIONAL_STATUS_ROW: MonitorStatus = (() => {
  const status: MonitorStatus = new MonitorStatus();
  status._id = OPERATIONAL.id;
  status.name = OPERATIONAL.name;
  status.color = new Color(OPERATIONAL.color!);
  return status;
})();

const OFFLINE_STATUS_ROW: MonitorStatus = (() => {
  const status: MonitorStatus = new MonitorStatus();
  status._id = OFFLINE.id;
  status.name = OFFLINE.name;
  status.color = new Color(OFFLINE.color!);
  return status;
})();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);

  // Whether the reader may turn monitoring on (the column's update gate).
  columnGate = { isAllowed: true };
  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return columnGate;
    },
  );

  // Whether the reader may change a manual monitor's status (a new event).
  statusEventGate = { isAllowed: true };
  getJestSpyOn(PermissionGate, "check").mockImplementation(
    (): PermissionGateResult => {
      return statusEventGate;
    },
  );

  // The project's statuses, which a manual monitor's ⋯ menu offers.
  getJestSpyOn(ModelAPI, "getList").mockImplementation(
    async (): Promise<unknown> => {
      return {
        data: [OPERATIONAL_STATUS_ROW, OFFLINE_STATUS_ROW],
        count: 2,
        skip: 0,
        limit: 10,
      };
    },
  );
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
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
  // A call to action done in place: the button's name.
  ctaButton?: string | undefined;
  /*
   * The More actions (⋯) menu beside Refresh, with Change status in it:
   * a manual monitor's, and no other's.
   */
  hasChangeStatusMenu?: boolean | undefined;
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
    hasChangeStatusMenu: true,
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
    hasChangeStatusMenu: true,
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
    // Turned back on in place, not on a trip to Settings.
    ctaButton: "Turn monitoring on",
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

    if (testCase.ctaButton) {
      expect(
        screen.getByRole("button", { name: testCase.ctaButton }),
      ).toBeEnabled();
      // The button is the call to action: no link beside it.
      expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
    } else if (testCase.cta) {
      expect(
        screen.getByRole("link", { name: testCase.cta.text }),
      ).toHaveAttribute("href", routeFor(testCase.cta.page));
      expect(
        screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
      ).toBeNull();
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

    // Change status is never under the text, as a link or a button.
    expect(screen.queryByRole("link", { name: "Change status" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Change status" })).toBeNull();

    // Refresh is at the top right of every hero; the ⋯ only on a manual one.
    const actions: HTMLElement = screen.getByRole("group", {
      name: "Monitor actions",
    });
    expect(
      within(actions).getByRole("button", { name: "Refresh" }),
    ).toBeInTheDocument();
    expect(
      within(actions).queryAllByRole("button", { name: "More actions" }),
    ).toHaveLength(testCase.hasChangeStatusMenu ? 1 : 0);
    expect(presentation.moreActions).toEqual(
      testCase.hasChangeStatusMenu ? ["changeStatus"] : [],
    );

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
    test("no owners says so, and Add owners opens the Add owners list right there - not the Owners page", async () => {
      renderHero({ owners: LOADED_NO_OWNERS });

      const owners: HTMLElement = screen.getByTestId(
        "monitor-overview-fact-owners",
      );
      expect(owners).toHaveTextContent("No owners");
      expect(within(owners).queryByRole("link")).toBeNull();
      expect(owners).not.toHaveTextContent("Unavailable");

      const add: HTMLElement = within(owners).getByRole("button", {
        name: "Add owners",
      });

      expect(add).toHaveAttribute("data-testid", "monitor-overview-add-owners");
      expect(add).toHaveAttribute("aria-haspopup", "dialog");
      expect(add).toHaveAttribute("aria-expanded", "false");

      await act(async () => {
        fireEvent.click(add);
      });

      expect(
        screen.getByRole("dialog", { name: "Add owners" }),
      ).toBeInTheDocument();
      expect(add).toHaveAttribute("aria-expanded", "true");
    });

    test("a person picked becomes an owner of this monitor, and the page is told to read the owners again", async () => {
      const jordan: User = new User();
      jordan._id = "80000000-0000-4000-8000-000000000003";
      jordan.name = new Name("Jordan Patel");
      jordan.email = new Email("jordan.patel@acme-commerce.example");

      getJestSpyOn(ModelAPI, "getList").mockImplementation(
        async (request: unknown): Promise<unknown> => {
          if ((request as { modelType: unknown }).modelType === TeamMember) {
            const member: TeamMember = new TeamMember();
            member.user = jordan;
            return { data: [member], count: 1, skip: 0, limit: 25 };
          }
          return { data: [], count: 0, skip: 0, limit: 25 };
        },
      );
      const create: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        ModelAPI,
        "create",
      ).mockImplementation(async (): Promise<unknown> => {
        return {};
      });
      window.history.replaceState(
        {},
        "",
        "/dashboard/10000000-0000-4000-8000-000000000001/monitors",
      );
      const changes: Array<OwnersChange> = [];

      renderHero({
        owners: LOADED_NO_OWNERS,
        onOwnersChanged: (change: OwnersChange): void => {
          changes.push(change);
        },
      });

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add owners" }));
      });

      const list: HTMLElement = screen.getByRole("dialog", {
        name: "Add owners",
      });

      await act(async () => {
        await Promise.resolve();
      });

      await act(async () => {
        fireEvent.click(within(list).getByText("Jordan Patel"));
      });

      expect(create).toHaveBeenCalledTimes(1);

      const request: { model: Record<string, unknown>; modelType: unknown } =
        create.mock.calls[0]![0] as {
          model: Record<string, unknown>;
          modelType: unknown;
        };

      expect(request.modelType).toBe(MonitorOwnerUser);
      expect(String(request.model["monitorId"])).toBe(MONITOR_ID.toString());
      expect(String(request.model["userId"])).toBe(jordan._id);
      expect(changes).toEqual([{ wasAdded: true }]);
      expect(within(list).getByText("Added Jordan Patel.")).toBeInTheDocument();
    });

    test("a reader who may not add owners reads No owners, and nothing offers to add", () => {
      statusEventGate = { isAllowed: false };

      renderHero({ owners: LOADED_NO_OWNERS });

      const owners: HTMLElement = screen.getByTestId(
        "monitor-overview-fact-owners",
      );

      expect(owners).toHaveTextContent(/^OwnersNo owners$/);
      expect(within(owners).queryByRole("button")).toBeNull();
      expect(within(owners).queryByRole("link")).toBeNull();
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
      // After the avatars, the next owner's place: a dashed circle that adds.
      const place: HTMLElement = within(owners).getByRole("button", {
        name: "Add owners",
      });
      expect(place).toHaveAttribute(
        "data-testid",
        "monitor-overview-add-more-owners",
      );
      expect(place).toHaveClass("h-6", "w-6", "rounded-full", "border-dashed");
    });

    test("owners, to a reader who may not add one: the avatars alone", () => {
      statusEventGate = { isAllowed: false };
      const team: Team = new Team();
      team._id = "5f8b7c1e2d3a4b5c6d7e8f91";
      team.name = "Payments";

      renderHero({
        owners: resolveSection<Array<ResourceOwnerEntry>>({
          value: [{ kind: "team", team: team }],
          subjectId: MONITOR_ID.toString(),
        }),
      });

      expect(
        within(screen.getByTestId("monitor-overview-fact-owners")).queryByRole(
          "button",
        ),
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
      // A list that may be incomplete offers no place to add more.
      expect(
        within(screen.getByTestId("monitor-overview-fact-owners")).queryByRole(
          "button",
          { name: "Add owners" },
        ),
      ).toBeNull();
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

  test("Refresh calls back, and takes no second press while a read is out", () => {
    const onRefresh: MockFunction = getJestMockFunction();

    renderHero({ onRefresh: onRefresh });
    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(onRefresh).toHaveBeenCalledTimes(1);
    cleanup();

    renderHero({ onRefresh: onRefresh, isRefreshing: true });

    const refresh: HTMLElement = screen.getByTestId("monitor-overview-refresh");
    expect(refresh).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(refresh);
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  test("beside Refresh, the hero says when the data on screen was read", () => {
    const prefers12Hour: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OneUptimeDate, "getUserPrefers12HourFormat")
      .mockReturnValue(false);

    try {
      renderHero({ lastLoadedAt: secondsAgo(30) });

      expect(
        within(
          screen.getByRole("group", { name: "Monitor actions" }),
        ).getByTestId("monitor-overview-refreshed-at"),
      ).toHaveTextContent("Refreshed at 11:59");
    } finally {
      prefers12Hour.mockRestore();
    }
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

/*
 * A monitor someone turned off: the hero's call to action turns it back on
 * in place. It used to be an "Open settings" link to a Settings page where
 * the reader had to find a switch called "Disable Active Monitoring", press
 * Edit, turn it off and Save.
 */
describe("MonitorOverviewHero turns monitoring back on", () => {
  const DISABLED_INPUT: Partial<MonitorOverviewPresentationInput> = {
    pause: {
      isDisabled: true,
      byManualIncident: false,
      byScheduledMaintenance: false,
    },
  };

  let updateByIdMock: jest.SpyInstance<any, any>;

  beforeEach(() => {
    updateByIdMock = getJestSpyOn(ModelAPI, "updateById").mockImplementation(
      async (): Promise<unknown> => {
        return {};
      },
    );
  });

  const renderDisabled: (
    overrides?: Partial<ComponentProps>,
  ) => RenderResult = (overrides?: Partial<ComponentProps>): RenderResult => {
    return renderHero({
      presentation: presentationFor(MonitorType.API, DISABLED_INPUT),
      ...overrides,
    });
  };

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    });
  };

  test("pressing it turns monitoring on for this monitor, tells the page, and tells the screen", async () => {
    const onMonitoringTurnedOn: MockFunction = getJestMockFunction();
    const heard: Array<ModelSwitchSaved> = [];
    const listener: (event: Event) => void = (event: Event): void => {
      heard.push((event as CustomEvent).detail as ModelSwitchSaved);
    };
    window.addEventListener(MODEL_SWITCH_SAVED_EVENT, listener);

    try {
      renderDisabled({ onMonitoringTurnedOn });

      fireEvent.click(
        screen.getByRole("button", { name: "Turn monitoring on" }),
      );
      await flush();

      expect(updateByIdMock).toHaveBeenCalledTimes(1);
      const call: {
        modelType: unknown;
        id: ObjectID;
        data: Record<string, unknown>;
      } = updateByIdMock.mock.calls[0]![0];
      expect(call.modelType).toBe(Monitor);
      expect(call.id.toString()).toBe(MONITOR_ID.toString());
      // Exactly the column the Monitoring switch writes, and nothing else.
      expect(call.data).toEqual({ disableActiveMonitoring: false });

      expect(onMonitoringTurnedOn).toHaveBeenCalledTimes(1);
      expect(heard).toEqual([
        {
          tableName: "Monitor",
          modelId: MONITOR_ID.toString(),
          column: "disableActiveMonitoring",
          value: false,
          source: "",
        },
      ]);
    } finally {
      window.removeEventListener(MODEL_SWITCH_SAVED_EVENT, listener);
    }
  });

  test("it saves once however fast it is pressed, and is busy while it saves", async () => {
    let finish: () => void = (): void => {};
    updateByIdMock.mockImplementation((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = (): void => {
          resolve({});
        };
      });
    });

    renderDisabled();

    const button: HTMLElement = screen.getByTestId(
      TURN_MONITORING_ON_BUTTON_TEST_ID,
    );
    fireEvent.click(button);
    fireEvent.click(button);
    await flush();

    expect(updateByIdMock).toHaveBeenCalledTimes(1);
    expect(
      screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
    ).toBeDisabled();

    await act(async () => {
      finish();
    });
    await flush();

    expect(
      screen.getByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID),
    ).not.toBeDisabled();
  });

  test("a refused change says why, and the page is not told it worked", async () => {
    const onMonitoringTurnedOn: MockFunction = getJestMockFunction();
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to update this Monitor.");
    });

    renderDisabled({ onMonitoringTurnedOn });

    fireEvent.click(screen.getByRole("button", { name: "Turn monitoring on" }));
    await flush();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "You do not have permission to update this Monitor.",
    );
    expect(onMonitoringTurnedOn).not.toHaveBeenCalled();
    // Still there, to try again.
    expect(
      screen.getByRole("button", { name: "Turn monitoring on" }),
    ).toBeEnabled();
  });

  test("someone who may not change it sees it locked, with why", () => {
    columnGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    renderDisabled();

    const button: HTMLElement = screen.getByTestId(
      TURN_MONITORING_ON_BUTTON_TEST_ID,
    );
    expect(button).toBeDisabled();

    fireEvent.click(button);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("it starts where the text above it does: Button's dialog margin is cleared", () => {
    /*
     * Button carries md:ml-3 for a dialog's footer, which set this one 12px
     * in from the headline from md up. The wrapper clears it on the button,
     * or on the span a locked button's tooltip wraps it in.
     */
    const MARGIN_CLEARING: Array<string> = [
      "[&>button]:ml-0",
      "[&>button]:md:ml-0",
      "[&>*>button]:ml-0",
      "[&>*>button]:md:ml-0",
    ];

    renderDisabled();

    const wrapper: HTMLElement = screen.getByTestId(
      "monitor-overview-call-to-action",
    );
    const button: HTMLElement = screen.getByTestId(
      TURN_MONITORING_ON_BUTTON_TEST_ID,
    );

    expect(wrapper).toHaveClass("mt-4", ...MARGIN_CLEARING);
    expect(button.parentElement).toBe(wrapper);
    cleanup();

    columnGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to update this Monitor. You need one of these permissions: Project Owner.",
    };

    renderDisabled();

    const lockedWrapper: HTMLElement = screen.getByTestId(
      "monitor-overview-call-to-action",
    );
    const lockedButton: HTMLElement = screen.getByTestId(
      TURN_MONITORING_ON_BUTTON_TEST_ID,
    );

    expect(lockedWrapper).toHaveClass(...MARGIN_CLEARING);
    // One element between them: the span the [&>*>button] rule reaches.
    expect(lockedButton.parentElement?.parentElement).toBe(lockedWrapper);
  });

  test("while the permissions are still loading it offers nothing, rather than a lock it cannot explain", () => {
    columnGate = { isAllowed: false };

    renderDisabled();

    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
    expect(screen.queryByRole("link", { name: "Open settings" })).toBeNull();
  });

  test("an archived monitor still points at its settings, and paused ones at their cause", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        pause: {
          isArchived: true,
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
      }),
    });

    expect(screen.getByRole("link", { name: "Open settings" })).toHaveAttribute(
      "href",
      routeFor(PageMap.MONITOR_VIEW_SETTINGS),
    );
    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
    // A link call to action sits in the same wrapper as the button does.
    expect(
      screen.getByTestId("monitor-overview-call-to-action"),
    ).toContainElement(screen.getByRole("link", { name: "Open settings" }));
    cleanup();

    renderHero({
      presentation: presentationFor(MonitorType.API, {
        pause: {
          isDisabled: false,
          byManualIncident: true,
          byScheduledMaintenance: false,
        },
      }),
    });

    expect(screen.getByRole("link", { name: "View incidents" })).toBeTruthy();
    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
  });

  test("a running monitor has no such button", () => {
    renderHero({});

    expect(screen.queryByTestId(TURN_MONITORING_ON_BUTTON_TEST_ID)).toBeNull();
    expect(updateByIdMock).not.toHaveBeenCalled();
  });
});

/*
 * Where the hero's actions sit. They used to be a "Refresh" button with the
 * pulse under it in a right-hand column that dropped under the text below
 * lg - on a phone, Refresh ended up at the left, after the explanation. Now
 * Refresh (and a manual monitor's ⋯) keep to the top right at every width,
 * on the badges' line, and the pulse sits under them from lg and after the
 * text below it.
 */
describe("MonitorOverviewHero actions placement", () => {
  // A stack that turns into a row from a screen up: `lg:flex-row`.
  const RESPONSIVE_ROW: RegExp = /^(sm|md|lg|xl|2xl):flex-row$/;
  const BREAKPOINT_VARIANT: RegExp = /^(sm|md|lg|xl|2xl):/;
  const WHITESPACE: RegExp = /\s+/;

  const classesOf: (element: Element | null) => Array<string> = (
    element: Element | null,
  ): Array<string> => {
    return (element?.getAttribute("class") || "").split(WHITESPACE);
  };

  test("the layout is a grid of the state and a column sized to the actions", () => {
    renderHero({});

    expect(screen.getByTestId("monitor-overview-layout")).toHaveClass(
      "grid",
      "min-w-0",
      "flex-1",
      "grid-cols-[minmax(0,1fr)_auto]",
    );
  });

  test("the actions sit on the badges' line, at the right, at every width", () => {
    renderHero({});

    const badges: HTMLElement = screen.getByTestId(
      "monitor-overview-badges-cell",
    );
    const actionsCell: HTMLElement = screen.getByTestId(
      "monitor-overview-actions-cell",
    );

    expect(badges).toHaveClass("col-start-1", "row-start-1", "self-center");
    expect(badges).toContainElement(
      screen.getByTestId("monitor-overview-badge"),
    );
    expect(actionsCell).toHaveClass("col-start-2", "row-start-1", "self-start");
    expect(actionsCell).toContainElement(
      screen.getByRole("group", { name: "Monitor actions" }),
    );

    // No breakpoint moves them: not a class of the cell names one.
    for (const token of classesOf(actionsCell)) {
      expect(token).not.toMatch(BREAKPOINT_VARIANT);
    }
  });

  test("the state takes both columns until lg, and the first one from lg", () => {
    renderHero({});

    const state: HTMLElement = screen.getByTestId(
      "monitor-overview-state-cell",
    );

    expect(state).toHaveClass(
      "col-span-2",
      "col-start-1",
      "row-start-2",
      "lg:col-span-1",
    );
    expect(state).toContainElement(
      screen.getByTestId("monitor-overview-headline"),
    );
    expect(state).toContainElement(
      screen.getByTestId("monitor-overview-target"),
    );
  });

  test("the pulse follows the text until lg, then sits under the actions, right-aligned", () => {
    renderHero({});

    const pulseCell: HTMLElement = screen.getByTestId(
      "monitor-overview-pulse-cell",
    );

    expect(pulseCell).toHaveClass(
      "col-span-2",
      "col-start-1",
      "row-start-3",
      "lg:col-span-1",
      "lg:col-start-2",
      "lg:row-start-2",
    );
    expect(pulseCell).toContainElement(
      screen.getByTestId("monitor-overview-pulse"),
    );
    expect(screen.getByTestId("monitor-overview-pulse")).toHaveClass(
      "text-left",
      "lg:text-right",
    );
  });

  test("the markup keeps the reading order: the state, its call to action, then the actions and the pulse", () => {
    renderHero({
      presentation: presentationFor(MonitorType.API, {
        pause: {
          isDisabled: true,
          byManualIncident: false,
          byScheduledMaintenance: false,
        },
      }),
    });

    const order: Array<string> = Array.from(
      screen
        .getByTestId("monitor-overview-hero")
        .querySelectorAll("[data-testid]"),
    )
      .map((element: Element): string => {
        return element.getAttribute("data-testid") || "";
      })
      .filter((testId: string): boolean => {
        return [
          "monitor-overview-badge",
          "monitor-overview-headline",
          TURN_MONITORING_ON_BUTTON_TEST_ID,
          "monitor-overview-refresh",
          "monitor-overview-pulse",
        ].includes(testId);
      });

    expect(order).toEqual([
      "monitor-overview-badge",
      "monitor-overview-headline",
      TURN_MONITORING_ON_BUTTON_TEST_ID,
      "monitor-overview-refresh",
      "monitor-overview-pulse",
    ]);
  });

  test("nothing stacks the actions under the text any more", () => {
    renderHero({});

    let element: HTMLElement | null = screen.getByRole("group", {
      name: "Monitor actions",
    });

    while (element && element !== document.body) {
      const tokens: Array<string> = classesOf(element);
      const isStackingRow: boolean =
        tokens.includes("flex-col") &&
        tokens.some((token: string): boolean => {
          return RESPONSIVE_ROW.test(token);
        });

      expect({ isStackingRow }).toEqual({ isStackingRow: false });
      element = element.parentElement;
    }
  });
});

/*
 * A manual monitor's status is changed from the ⋯ beside Refresh. "Please
 * move the change status button near the refresh button, and it should be
 * hidden behind the more button (three dots)." It used to be a "Change
 * status" link under the hero's text, to the Status Timeline page.
 * MonitorChangeStatusMenu.test.tsx covers the menu itself.
 */
describe("MonitorOverviewHero changes a manual monitor's status", () => {
  const renderManual: (overrides?: Partial<ComponentProps>) => RenderResult = (
    overrides?: Partial<ComponentProps>,
  ): RenderResult => {
    return renderHero({
      monitorType: MonitorType.Manual,
      presentation: presentationFor(MonitorType.Manual),
      currentStatusId: OPERATIONAL.id,
      ...overrides,
    });
  };

  const flush: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let i: number = 0; i < 5; i++) {
        await Promise.resolve();
      }
    });
  };

  test("the ⋯ beside Refresh offers every status but the current one", async () => {
    renderManual();
    await flush();

    const actions: HTMLElement = screen.getByRole("group", {
      name: "Monitor actions",
    });

    fireEvent.click(
      within(actions).getByRole("button", { name: "More actions" }),
    );

    const menu: HTMLElement = screen.getByRole("menu");

    expect(menu).toHaveTextContent("CHANGE STATUS TO");
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Offline"]);
  });

  test("a status picked there is recorded for this monitor, and the page is told", async () => {
    const createMock: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      ModelAPI,
      "create",
    ).mockImplementation(async (): Promise<unknown> => {
      return {};
    });
    const onStatusChanged: MockFunction = getJestMockFunction();

    renderManual({ onStatusChanged });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Offline",
      }),
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Change status to Offline?",
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    });
    await flush();

    expect(createMock).toHaveBeenCalledTimes(1);

    const call: { model: MonitorStatusTimeline; modelType: unknown } =
      createMock.mock.calls[0]![0] as {
        model: MonitorStatusTimeline;
        modelType: unknown;
      };

    expect(call.modelType).toBe(MonitorStatusTimeline);
    expect(call.model.monitorId?.toString()).toBe(MONITOR_ID.toString());
    expect(call.model.monitorStatusId?.toString()).toBe(OFFLINE.id);
    expect(onStatusChanged).toHaveBeenCalledTimes(1);
  });

  test("a monitor with no status recorded yet is offered every status", async () => {
    renderManual({
      presentation: presentationFor(MonitorType.Manual, {
        currentStatus: undefined,
        statusSince: undefined,
      }),
      currentStatusId: undefined,
    });
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    expect(
      within(screen.getByRole("menu"))
        .getAllByRole("menuitem")
        .map((item: HTMLElement): string => {
          return (item.textContent || "").trim();
        }),
    ).toEqual(["Operational", "Offline"]);
  });

  test("someone who may not change it finds the statuses locked, saying why", async () => {
    statusEventGate = {
      isAllowed: false,
      disabledReason:
        "You do not have permission to create this Monitor Status Event.",
    };

    renderManual();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));

    const item: HTMLElement = within(screen.getByRole("menu")).getByRole(
      "menuitem",
      { name: "Offline" },
    );

    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("an open dialog belongs to its monitor: moving to another monitor closes it", async () => {
    const view: RenderResult = renderManual();
    await flush();

    fireEvent.click(screen.getByRole("button", { name: "More actions" }));
    fireEvent.click(
      within(screen.getByRole("menu")).getByRole("menuitem", {
        name: "Offline",
      }),
    );
    expect(screen.getByTestId("modal")).toBeInTheDocument();

    view.rerender(
      <MemoryRouter>
        <MonitorOverviewHero
          monitorId={new ObjectID("12121212-1212-4212-8212-121212121212")}
          monitorType={MonitorType.Manual}
          presentation={presentationFor(MonitorType.Manual)}
          owners={LOADED_NO_OWNERS}
          isRefreshing={false}
          refreshError=""
          lastLoadedAt={secondsAgo(30)}
          onRefresh={() => {}}
          currentStatusId={OPERATIONAL.id}
        />
      </MemoryRouter>,
    );
    await flush();

    expect(screen.queryByTestId("modal")).toBeNull();
  });

  test("the status is changed from the menu only: the hero's text has no Change status", async () => {
    renderManual();
    await flush();

    const state: HTMLElement = screen.getByTestId(
      "monitor-overview-state-cell",
    );

    expect(within(state).queryByText("Change status")).toBeNull();
    expect(within(state).queryByRole("link")).toBeNull();
    expect(within(state).queryByRole("button")).toBeNull();
  });
});
