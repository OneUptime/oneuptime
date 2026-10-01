import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
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
import { describe, expect, it } from "@jest/globals";

/*
 * The monitor overview of an archived monitor.
 *
 * An archived monitor is not checked, so the status it shows is the one it
 * had when it was archived. The overview must say so: paused, with
 * "Archived" as the reason - ahead of "Disabled", because archiving is what
 * also took the monitor off the lists, and unarchiving is the step that
 * brings it back. A monitor that is not archived reads exactly as before.
 */

const NOW: Date = new Date("2026-10-01T12:00:00.000Z");
const STEP_ID: string = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const secondsAgo: (seconds: number) => Date = (seconds: number): Date => {
  return new Date(NOW.getTime() - seconds * 1000);
};

const OFFLINE: MonitorOverviewStatusRef = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Offline",
  color: "#EF4444",
  isOperationalState: false,
  isOfflineState: true,
};

const OPERATIONAL: MonitorOverviewStatusRef = {
  id: "22222222-2222-4222-8222-222222222222",
  name: "Operational",
  color: "#10B981",
  isOperationalState: true,
  isOfflineState: false,
};

const STEPS: MonitorSteps = {
  data: {
    monitorStepsInstanceArray: [
      {
        data: {
          id: STEP_ID,
          monitorDestination: "https://api.example.com/health",
        },
      },
    ],
  },
} as unknown as MonitorSteps;

const PROBES: MonitorOverviewProbeSummary = {
  rows: [],
  attachedCount: 2,
  enabledCount: 2,
  reportingCount: 2,
  disabledCount: 0,
  disconnectedCount: 0,
  lastResultAt: secondsAgo(60),
  nextCheckAt: secondsAgo(-240),
  latestResult: {
    probeId: "11111111-1111-4111-8111-111111111111",
    probeName: "London",
    monitoredAt: secondsAgo(60),
    isOnline: false,
    responseTimeInMs: 120,
    responseCode: 503,
  },
  responseTime: {
    medianMs: 120,
    minMs: 100,
    maxMs: 140,
    respondedCount: 2,
    totalCount: 2,
  },
} as MonitorOverviewProbeSummary;

interface PauseFlags {
  isArchived?: boolean | undefined;
  isDisabled?: boolean;
  byManualIncident?: boolean;
  byScheduledMaintenance?: boolean;
}

function monitor(
  monitorType: MonitorType,
  pause: PauseFlags,
  currentStatus: MonitorOverviewStatusRef = OFFLINE,
): MonitorOverviewPresentationInput {
  const family: MonitorOverviewFamily =
    MonitorOverviewFamilyUtil.getFamily(monitorType);

  return {
    now: NOW,
    monitorType: monitorType,
    monitorSteps: STEPS,
    monitoringInterval: "*/5 * * * *",
    createdAt: secondsAgo(30 * 86400),
    currentStatus: currentStatus,
    statusSince: secondsAgo(2 * 86400),
    pause: {
      ...(pause.isArchived === undefined
        ? {}
        : { isArchived: pause.isArchived }),
      isDisabled: pause.isDisabled ?? false,
      byManualIncident: pause.byManualIncident ?? false,
      byScheduledMaintenance: pause.byScheduledMaintenance ?? false,
    },
    probeFlags: { isNoProbeEnabled: false, isAllProbesDisconnected: false },
    probes: family === MonitorOverviewFamily.ProbeCheck ? PROBES : null,
    heartbeat: {
      lastReceivedAt: secondsAgo(120),
      lastCheckedAt: secondsAgo(30),
      requestMethod: "POST",
    },
    email: { lastReceivedAt: secondsAgo(300), lastCheckedAt: secondsAgo(40) },
    agent: {
      lastReportAt: secondsAgo(45),
      hostname: "web-01.example.com",
      cpuPercent: 42,
      memoryPercent: 63,
    },
    telemetry: {
      lastScheduledAt: secondsAgo(30),
      nextEvaluationAt: secondsAgo(-270),
    },
    latestEvaluationAt: secondsAgo(90),
    evaluationStatus: "loaded",
  } as MonitorOverviewPresentationInput;
}

function build(
  input: MonitorOverviewPresentationInput,
): MonitorOverviewPresentation {
  return MonitorOverviewPresentationUtil.build(input);
}

const CHECKED_TYPES: Array<MonitorType> = [
  MonitorType.API,
  MonitorType.Website,
  MonitorType.IncomingRequest,
  MonitorType.IncomingEmail,
  MonitorType.Server,
  MonitorType.Logs,
];

describe("the overview of an archived monitor", () => {
  it.each(CHECKED_TYPES)(
    "a %s monitor that is archived is paused, never running",
    (monitorType: MonitorType) => {
      const input: MonitorOverviewPresentationInput = monitor(monitorType, {
        isArchived: true,
      });

      expect(MonitorOverviewPresentationUtil.getRunState(input)).toBe(
        MonitorOverviewRunState.Paused,
      );
      expect(build(input).runState).toBe(MonitorOverviewRunState.Paused);
    },
  );

  it("says it is archived, what that means, and where to change it", () => {
    const presentation: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, { isArchived: true }),
    );

    expect(presentation.badge).toEqual({ text: "Archived", tone: "neutral" });
    expect(presentation.tone).toBe("neutral");
    expect(presentation.headline).toEqual({
      text: "Monitoring is off because it is archived",
    });
    expect(presentation.explanation).toContain(
      "No checks run while the monitor is archived",
    );
    expect(presentation.explanation).toContain("opens no incidents or alerts");
    expect(presentation.explanation).toContain(
      "hidden from monitor lists and status pages",
    );
    expect(presentation.callToAction).toEqual({
      text: "Open settings",
      linkKey: "settings",
    });
  });

  it("keeps the frozen status as the last one recorded, not as the current one", () => {
    const presentation: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, { isArchived: true }, OFFLINE),
    );

    // Offline was the status at archiving: shown as history, not as now.
    expect(presentation.badge.text).not.toBe("Offline");
    expect(presentation.tone).not.toBe("danger");
    expect(presentation.lastKnownStatus).toBe("Last recorded status: Offline");
  });

  it("an archived monitor that was operational does not look healthy", () => {
    const presentation: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, { isArchived: true }, OPERATIONAL),
    );

    expect(presentation.tone).not.toBe("good");
    expect(presentation.badge.text).toBe("Archived");
  });

  it("archived is the reason given even when it is also disabled, or paused by an incident or maintenance", () => {
    const presentation: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, {
        isArchived: true,
        isDisabled: true,
        byManualIncident: true,
        byScheduledMaintenance: true,
      }),
    );

    expect(presentation.badge.text).toBe("Archived");
    expect(presentation.headline.text).toBe(
      "Monitoring is off because it is archived",
    );
  });

  it("a manual monitor is still manual: archiving does not change who sets its status", () => {
    expect(
      MonitorOverviewPresentationUtil.getRunState(
        monitor(MonitorType.Manual, { isArchived: true }),
      ),
    ).toBe(MonitorOverviewRunState.Manual);
  });
});

describe("the overview of a monitor that is not archived", () => {
  it("a disabled monitor still reads as disabled", () => {
    const presentation: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, { isArchived: false, isDisabled: true }),
    );

    expect(presentation.badge.text).toBe("Disabled");
    expect(presentation.headline.text).toBe("Monitoring is turned off");
  });

  it("a caller that does not pass the archive flag reads as not archived", () => {
    const withoutFlag: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, { isDisabled: true }),
    );

    expect(withoutFlag.badge.text).toBe("Disabled");
  });

  it("a live monitor runs and shows its status as before", () => {
    const presentation: MonitorOverviewPresentation = build(
      monitor(MonitorType.API, { isArchived: false }, OPERATIONAL),
    );

    expect(presentation.runState).toBe(MonitorOverviewRunState.Running);
    expect(presentation.badge.text).toBe("Operational");
    expect(presentation.tone).toBe("good");
  });
});
