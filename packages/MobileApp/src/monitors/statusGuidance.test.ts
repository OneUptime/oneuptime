import { describe, expect, test } from "@jest/globals";
import {
  getMonitorStatusColor,
  getMonitorStatusGuidance,
  type MonitorStatusGuidance,
} from "./statusGuidance";
import { darkColors, lightColors } from "../theme/colors";
import { rgbToHex } from "../utils/color";
import {
  getMonitorRowStatus,
  type MonitorHealthFields,
  type MonitorRowStatus,
} from "../utils/monitorHealth";

/*
 * How the app draws what a monitor's row says (utils/monitorHealth, the
 * web's row rule): the colour that repeats the words, and the banner the
 * monitor's own screen gives where the words stand in for its status
 * (issue #8961).
 */

const NOW: Date = new Date("2026-11-16T12:00:00.000Z");
const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

function monitorOf(
  overrides: Partial<MonitorHealthFields> = {},
): MonitorHealthFields {
  return {
    isArchived: false,
    disableActiveMonitoring: false,
    disableActiveMonitoringBecauseOfManualIncident: false,
    disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: false,
    isNoProbeEnabledOnThisMonitor: false,
    isAllProbesDisconnectedFromThisMonitor: false,
    monitorType: "Website",
    firstMeasuredAt: null,
    createdAt: new Date(NOW.getTime() - MINUTE).toISOString(),
    monitoringInterval: "*/5 * * * *",
    currentMonitorStatus: {
      name: "Operational",
      isOperationalState: true,
      isOfflineState: false,
    },
    ...overrides,
  };
}

function guidanceOf(
  overrides: Partial<MonitorHealthFields> = {},
): MonitorStatusGuidance | null {
  const monitor: MonitorHealthFields = monitorOf(overrides);
  const rowStatus: MonitorRowStatus = getMonitorRowStatus(monitor, NOW);

  return getMonitorStatusGuidance({ monitor, rowStatus });
}

describe("getMonitorStatusColor", () => {
  const green: { r: number; g: number; b: number } = { r: 34, g: 197, b: 94 };

  test.each([
    ["Waiting for data", {}, "textTertiary"],
    [
      "No results yet",
      { createdAt: new Date(NOW.getTime() - 2 * HOUR).toISOString() },
      "statusWarning",
    ],
    [
      "Paused",
      { disableActiveMonitoringBecauseOfManualIncident: true },
      "textTertiary",
    ],
    [
      "No Probe Enabled",
      { isNoProbeEnabledOnThisMonitor: true },
      "statusError",
    ],
    [
      "Probes Disconnected",
      { isAllProbesDisconnectedFromThisMonitor: true },
      "statusError",
    ],
    ["Disabled", { disableActiveMonitoring: true }, "textTertiary"],
    ["Archived", { isArchived: true }, "textTertiary"],
  ] as Array<[string, Partial<MonitorHealthFields>, keyof typeof lightColors]>)(
    "%s is drawn in the theme's %s",
    (
      words: string,
      overrides: Partial<MonitorHealthFields>,
      token: keyof typeof lightColors,
    ) => {
      const rowStatus: MonitorRowStatus = getMonitorRowStatus(
        monitorOf(overrides),
        NOW,
      );

      expect(rowStatus.text).toBe(words);
      expect(getMonitorStatusColor(lightColors, rowStatus, green)).toBe(
        lightColors[token],
      );
      expect(getMonitorStatusColor(darkColors, rowStatus, green)).toBe(
        darkColors[token],
      );
    },
  );

  test("the monitor's own status is drawn in its own colour, or the muted one without", () => {
    const rowStatus: MonitorRowStatus = getMonitorRowStatus(
      monitorOf({ firstMeasuredAt: "2026-11-16T11:00:00.000Z" }),
      NOW,
    );

    expect(getMonitorStatusColor(lightColors, rowStatus, green)).toBe(
      rgbToHex(green),
    );
    expect(getMonitorStatusColor(lightColors, rowStatus, undefined)).toBe(
      lightColors.textTertiary,
    );
  });

  test("a monitor with no status is drawn in the muted colour", () => {
    const rowStatus: MonitorRowStatus = getMonitorRowStatus(
      monitorOf({ currentMonitorStatus: null }),
      NOW,
    );

    expect(getMonitorStatusColor(lightColors, rowStatus, null)).toBe(
      lightColors.textTertiary,
    );
  });
});

describe("getMonitorStatusGuidance", () => {
  test("a monitor whose own status the row says gets no banner", () => {
    expect(
      guidanceOf({ firstMeasuredAt: "2026-11-16T11:00:00.000Z" }),
    ).toBeNull();
    expect(guidanceOf({ currentMonitorStatus: null })).toBeNull();
    expect(
      guidanceOf({
        currentMonitorStatus: {
          name: "Offline",
          isOperationalState: false,
          isOfflineState: true,
        },
      }),
    ).toBeNull();
  });

  test("a monitor whose monitoring is off keeps the words it always had", () => {
    expect(guidanceOf({ disableActiveMonitoring: true })).toEqual({
      tone: "warning",
      icon: "pause-circle",
      title: "Monitoring is paused",
      message:
        "Active checks are disabled. The last recorded status may not reflect this service's current health.",
      testID: "monitor-paused-banner",
    });
  });

  test.each([
    [
      "Website",
      "Waiting for the first check",
      "The first result usually arrives within a few minutes.",
    ],
    [
      "SSL Certificate",
      "Waiting for the first check",
      "The first result usually arrives within a few minutes.",
    ],
    [
      "Incoming Request",
      "Waiting for the first heartbeat",
      "Send a GET or POST request to this monitor's heartbeat URL to start tracking it.",
    ],
    [
      "Incoming Email",
      "Waiting for the first email",
      "Send an email to this monitor's address to start tracking it.",
    ],
    [
      "Server",
      "Waiting for the agent to report",
      "Install the server agent to start sending reports.",
    ],
    [
      "Network Device",
      "Waiting for the first poll",
      "No poll or trap from this device has been evaluated yet. Check that a probe is assigned to poll it.",
    ],
    [
      "Probe Status",
      "Waiting for the first evaluation",
      "This monitor checks the probes it watches every minute. The first result arrives within a minute or two.",
    ],
    [
      "Logs",
      "Waiting for the first evaluation",
      "Its status shows here once the first evaluation has run.",
    ],
    [
      "Kubernetes",
      "Waiting for the first evaluation",
      "Its status shows here once the first evaluation has run.",
    ],
  ])(
    "a %s monitor waiting for its first result: %j",
    (monitorType: string, title: string, message: string) => {
      expect(guidanceOf({ monitorType })).toEqual({
        tone: "info",
        icon: "hourglass-outline",
        title,
        message,
        testID: "monitor-waiting-banner",
      });
    },
  );

  test("an overdue first result says since when, as a check or an evaluation", () => {
    const createdAt: string = new Date(Date.now() - 2 * HOUR).toISOString();
    const late: (monitorType: string) => MonitorStatusGuidance | null = (
      monitorType: string,
    ): MonitorStatusGuidance | null => {
      const monitor: MonitorHealthFields = monitorOf({
        monitorType,
        createdAt,
      });

      return getMonitorStatusGuidance({
        monitor,
        rowStatus: getMonitorRowStatus(monitor),
      });
    };

    expect(late("Website")).toEqual({
      tone: "warning",
      icon: "time-outline",
      title: "No check has completed yet",
      message:
        "No check result has arrived since this monitor was created 2h ago.",
      testID: "monitor-no-results-banner",
    });
    expect(late("Metrics")).toEqual({
      tone: "warning",
      icon: "time-outline",
      title: "No evaluation has completed yet",
      message: "No evaluation has run since this monitor was created 2h ago.",
      testID: "monitor-no-results-banner",
    });
  });

  test("a first check held by an incident or a maintenance event says which, and when checks resume", () => {
    expect(
      guidanceOf({ disableActiveMonitoringBecauseOfManualIncident: true }),
    ).toMatchObject({
      tone: "neutral",
      icon: "pause-circle",
      title: "Monitoring is paused by an incident",
      message:
        "Nothing has checked this monitor yet. Checks resume when the incident that paused this monitor is resolved.",
      testID: "monitor-first-check-paused-banner",
    });
    expect(
      guidanceOf({
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      }),
    ).toMatchObject({
      title: "Monitoring is paused for scheduled maintenance",
      message:
        "Nothing has checked this monitor yet. Checks resume automatically when the maintenance event ends.",
    });
    // Held by both: the incident first, as the web's page puts it.
    expect(
      guidanceOf({
        disableActiveMonitoringBecauseOfManualIncident: true,
        disableActiveMonitoringBecauseOfScheduledMaintenanceEvent: true,
      })?.title,
    ).toBe("Monitoring is paused by an incident");
  });

  test("no probe checking it is a problem to act on, measured or not", () => {
    for (const firstMeasuredAt of [null, "2026-11-01T00:00:00.000Z"]) {
      expect(
        guidanceOf({ firstMeasuredAt, isNoProbeEnabledOnThisMonitor: true }),
      ).toEqual({
        tone: "danger",
        icon: "alert-circle",
        title: "Nothing is checking this monitor",
        message: "No probe is enabled for this monitor, so no checks run.",
        testID: "monitor-no-probe-banner",
      });
      expect(
        guidanceOf({
          firstMeasuredAt,
          isAllProbesDisconnectedFromThisMonitor: true,
        }),
      ).toEqual({
        tone: "danger",
        icon: "cloud-offline-outline",
        title: "Every probe checking this monitor is disconnected",
        message: "No checks run until a probe reconnects.",
        testID: "monitor-probes-disconnected-banner",
      });
    }
  });

  test("an archived monitor says so", () => {
    expect(guidanceOf({ isArchived: true })).toMatchObject({
      tone: "neutral",
      title: "This monitor is archived",
      testID: "monitor-archived-banner",
    });
  });
});
