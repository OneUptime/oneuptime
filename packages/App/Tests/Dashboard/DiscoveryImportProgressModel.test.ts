import { describe, expect, test } from "@jest/globals";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportStatus,
  DiscoveryImportView,
  emptyDiscoveryImportProgress,
  summarizeDiscoveryImportResults,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import {
  DISCOVERY_IMPORT_WAITING_AFTER_MS,
  DiscoveryImportIssueGroup,
  DiscoveryImportIssueKind,
  DiscoveryImportPhase,
  DiscoveryImportProgressModel,
  countRetryableHosts,
  getDiscoveryImportIssueKind,
  getDiscoveryImportPhase,
  getDiscoveryImportProgressModel,
  groupDiscoveryImportIssues,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/DiscoveryImport/DiscoveryImportProgressModel";

/*
 * Progress anyone can trust (OneUptime issue #4812). The progress view is
 * drawn from this: devices and monitors counted apart, the failures grouped
 * by their server-given reason with the most actionable first, the phase
 * words ("Waiting for another import", "Stopping"), and exactly how many
 * hosts Retry would try again - the number on the button.
 */

const CREATED_AT: string = "2026-10-15T09:00:00.000Z";
const CREATED_AT_MS: number = new Date(CREATED_AT).getTime();

function result(
  ipAddress: string,
  device: DiscoveryImportDeviceOutcome,
  monitor: DiscoveryImportMonitorOutcome,
  extra: Partial<DiscoveryImportHostResult> = {},
): DiscoveryImportHostResult {
  return {
    ipAddress: ipAddress,
    name: `host-${ipAddress}`,
    isPingOnly: false,
    device: device,
    monitor: monitor,
    ...extra,
  };
}

function view(
  results: Array<DiscoveryImportHostResult>,
  overrides: Partial<DiscoveryImportView> = {},
): DiscoveryImportView {
  return {
    id: "import-1",
    scanId: "scan-1",
    status: DiscoveryImportStatus.Running,
    settings: { ...DEFAULT_DISCOVERY_IMPORT_SETTINGS },
    progress: summarizeDiscoveryImportResults(results),
    createdAt: CREATED_AT,
    isMine: true,
    results: results,
    ...overrides,
  };
}

const REFUSED: string = "Your plan allows 100 active monitors.";
const NAME_TAKEN: string = "A device named core-sw-01 already exists.";

describe("the phase of an import", () => {
  test("queued: starting, then - after a while - waiting for another import", () => {
    const queued: DiscoveryImportView = view([], {
      status: DiscoveryImportStatus.Queued,
    });

    expect(getDiscoveryImportPhase(queued, CREATED_AT_MS + 1000)).toBe(
      DiscoveryImportPhase.Starting,
    );
    expect(
      getDiscoveryImportPhase(
        queued,
        CREATED_AT_MS + DISCOVERY_IMPORT_WAITING_AFTER_MS + 1,
      ),
    ).toBe(DiscoveryImportPhase.Waiting);
    // A creation time that cannot be read never claims a wait.
    expect(
      getDiscoveryImportPhase(
        view([], { status: DiscoveryImportStatus.Queued, createdAt: "" }),
        CREATED_AT_MS + 10 * DISCOVERY_IMPORT_WAITING_AFTER_MS,
      ),
    ).toBe(DiscoveryImportPhase.Starting);
  });

  test("running, stopping, finished, stopped, failed", () => {
    expect(getDiscoveryImportPhase(view([]))).toBe(
      DiscoveryImportPhase.Running,
    );
    expect(getDiscoveryImportPhase(view([], { isStopRequested: true }))).toBe(
      DiscoveryImportPhase.Stopping,
    );
    expect(
      getDiscoveryImportPhase(
        view([], { status: DiscoveryImportStatus.Completed }),
      ),
    ).toBe(DiscoveryImportPhase.Finished);
    expect(
      getDiscoveryImportPhase(
        view([], { status: DiscoveryImportStatus.Stopped }),
      ),
    ).toBe(DiscoveryImportPhase.Stopped);
    expect(
      getDiscoveryImportPhase(
        view([], { status: DiscoveryImportStatus.Failed }),
      ),
    ).toBe(DiscoveryImportPhase.Failed);
  });
});

describe("what went wrong, host by host", () => {
  test("each host's issue is its device's first, then its monitor's", () => {
    expect(
      getDiscoveryImportIssueKind(
        result(
          "10.0.0.1",
          DiscoveryImportDeviceOutcome.Failed,
          DiscoveryImportMonitorOutcome.Skipped,
        ),
      ),
    ).toBe(DiscoveryImportIssueKind.DeviceFailed);
    expect(
      getDiscoveryImportIssueKind(
        result(
          "10.0.0.2",
          DiscoveryImportDeviceOutcome.NotReached,
          DiscoveryImportMonitorOutcome.Skipped,
        ),
      ),
    ).toBe(DiscoveryImportIssueKind.NotReached);
    expect(
      getDiscoveryImportIssueKind(
        result(
          "10.0.0.3",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Failed,
        ),
      ),
    ).toBe(DiscoveryImportIssueKind.MonitorFailed);
    expect(
      getDiscoveryImportIssueKind(
        result(
          "10.0.0.4",
          DiscoveryImportDeviceOutcome.AlreadyAdded,
          DiscoveryImportMonitorOutcome.Skipped,
        ),
      ),
    ).toBe(DiscoveryImportIssueKind.MonitorSkipped);
    expect(
      getDiscoveryImportIssueKind(
        result(
          "10.0.0.5",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Created,
        ),
      ),
    ).toBeNull();
  });

  test("hosts that failed for the same reason are one group; the most actionable group comes first", () => {
    const groups: Array<DiscoveryImportIssueGroup> = groupDiscoveryImportIssues(
      [
        result(
          "10.0.0.1",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Skipped,
          { monitorError: "Takes its status from a bound monitor." },
        ),
        result(
          "10.0.0.2",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Failed,
          { monitorError: REFUSED, deviceId: "device-2" },
        ),
        result(
          "10.0.0.3",
          DiscoveryImportDeviceOutcome.NotReached,
          DiscoveryImportMonitorOutcome.Skipped,
          { deviceError: "The import was stopped before this host." },
        ),
        result(
          "10.0.0.4",
          DiscoveryImportDeviceOutcome.Failed,
          DiscoveryImportMonitorOutcome.Skipped,
          { deviceError: NAME_TAKEN },
        ),
        result(
          "10.0.0.5",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Failed,
          { monitorError: REFUSED, deviceId: "device-5" },
        ),
        result(
          "10.0.0.6",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Created,
        ),
      ],
    );

    expect(
      groups.map((group: DiscoveryImportIssueGroup) => {
        return [
          group.kind,
          group.reason,
          group.hosts.map((host: { ipAddress: string }) => {
            return host.ipAddress;
          }),
        ];
      }),
    ).toEqual([
      [DiscoveryImportIssueKind.DeviceFailed, NAME_TAKEN, ["10.0.0.4"]],
      [
        DiscoveryImportIssueKind.MonitorFailed,
        REFUSED,
        ["10.0.0.2", "10.0.0.5"],
      ],
      [
        DiscoveryImportIssueKind.NotReached,
        "The import was stopped before this host.",
        ["10.0.0.3"],
      ],
      [
        DiscoveryImportIssueKind.MonitorSkipped,
        "Takes its status from a bound monitor.",
        ["10.0.0.1"],
      ],
    ]);
    // A device that is in links to its page.
    expect(groups[1]!.hosts[0]).toEqual({
      name: "host-10.0.0.2",
      ipAddress: "10.0.0.2",
      deviceId: "device-2",
    });
  });

  test("the same words for a different kind of failure are a different group", () => {
    const groups: Array<DiscoveryImportIssueGroup> = groupDiscoveryImportIssues(
      [
        result(
          "10.0.0.1",
          DiscoveryImportDeviceOutcome.Failed,
          DiscoveryImportMonitorOutcome.Skipped,
          { deviceError: "Refused." },
        ),
        result(
          "10.0.0.2",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Failed,
          { monitorError: "Refused." },
        ),
      ],
    );

    expect(groups).toHaveLength(2);
  });

  test("a host with no name is listed by its address", () => {
    const groups: Array<DiscoveryImportIssueGroup> = groupDiscoveryImportIssues(
      [
        result(
          "10.0.0.9",
          DiscoveryImportDeviceOutcome.Failed,
          DiscoveryImportMonitorOutcome.NotRequested,
          { name: "" },
        ),
      ],
    );

    expect(groups[0]!.hosts[0]!.name).toBe("10.0.0.9");
    expect(groups[0]!.reason).toBe("");
  });
});

describe("how many hosts Retry tries again", () => {
  const RESULTS: Array<DiscoveryImportHostResult> = [
    result(
      "10.0.0.1",
      DiscoveryImportDeviceOutcome.Failed,
      DiscoveryImportMonitorOutcome.Skipped,
    ),
    result(
      "10.0.0.2",
      DiscoveryImportDeviceOutcome.NotReached,
      DiscoveryImportMonitorOutcome.Skipped,
    ),
    result(
      "10.0.0.3",
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportMonitorOutcome.Failed,
    ),
    result(
      "10.0.0.4",
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportMonitorOutcome.Skipped,
    ),
    result(
      "10.0.0.5",
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportMonitorOutcome.Created,
    ),
  ];

  test("from the results when the view carries them all", () => {
    expect(
      countRetryableHosts(
        view(RESULTS, { status: DiscoveryImportStatus.Completed }),
      ),
    ).toBe(3);
  });

  test("from the counts when the list was cut short, and the two agree", () => {
    const full: DiscoveryImportView = view(RESULTS, {
      status: DiscoveryImportStatus.Completed,
    });

    expect(
      countRetryableHosts({
        ...full,
        results: RESULTS.slice(0, 1),
        hasMoreResults: true,
      }),
    ).toBe(3);
    expect(countRetryableHosts({ ...full, results: undefined })).toBe(3);
  });

  test("never while the import is still running", () => {
    const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
      view(RESULTS),
    );

    expect(model.isActive).toBe(true);
    expect(model.retryableCount).toBe(0);
  });
});

describe("the bars", () => {
  test("devices of hosts, monitors of the monitors asked for, overall of the hosts done", () => {
    const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
      view([
        result(
          "10.0.0.1",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Created,
        ),
        result(
          "10.0.0.2",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Pending,
        ),
        result(
          "10.0.0.3",
          DiscoveryImportDeviceOutcome.Pending,
          DiscoveryImportMonitorOutcome.Pending,
        ),
      ]),
      CREATED_AT_MS,
    );

    expect(model.phase).toBe(DiscoveryImportPhase.Running);
    expect(model.hostCount).toBe(3);
    expect(model.devicesSettled).toBe(2);
    expect(model.monitorsRequested).toBe(3);
    expect(model.monitorsSettled).toBe(1);
    expect(model.overallPercent).toBe(33);
  });

  test("an import of nothing is at zero, not at a division by zero", () => {
    const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
      {
        ...view([]),
        progress: emptyDiscoveryImportProgress(),
      },
    );

    expect(model.overallPercent).toBe(0);
    expect(model.issueGroups).toEqual([]);
    expect(model.hasMoreIssues).toBe(false);
  });

  test("a list cut short says so", () => {
    expect(
      getDiscoveryImportProgressModel(view([], { hasMoreResults: true }))
        .hasMoreIssues,
    ).toBe(true);
  });
});
