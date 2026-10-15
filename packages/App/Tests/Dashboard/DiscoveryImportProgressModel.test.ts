import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DISCOVERY_IMPORT_MONITOR_BACKED_REASON,
  DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON,
  DISCOVERY_IMPORT_OWN_REASONS,
  DISCOVERY_IMPORT_STOPPED_REASON,
  DISCOVERY_IMPORT_UNFINISHED_REASON,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportStatus,
  DiscoveryImportView,
  emptyDiscoveryImportProgress,
  summarizeDiscoveryImportResults,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import {
  DISCOVERY_IMPORT_TRANSLATED_REASONS,
  DISCOVERY_IMPORT_WAITING_AFTER_MS,
  DiscoveryImportIssueGroup,
  DiscoveryImportIssueKind,
  DiscoveryImportPhase,
  DiscoveryImportProgressModel,
  countReachedDevices,
  countReachedMonitors,
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

describe("the bars fill with what the import got to", () => {
  /*
   * A stopped import: one host imported with its monitor, one refused, and
   * three it never reached - marked the way the runner marks them, each
   * not-reached device with its monitor skipped.
   */
  function stopped(): DiscoveryImportView {
    return view(
      [
        result(
          "10.0.0.1",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.Created,
        ),
        result(
          "10.0.0.2",
          DiscoveryImportDeviceOutcome.Failed,
          DiscoveryImportMonitorOutcome.Skipped,
          {
            deviceError: NAME_TAKEN,
            monitorError: DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON,
          },
        ),
        ...["10.0.0.3", "10.0.0.4", "10.0.0.5"].map(
          (ipAddress: string): DiscoveryImportHostResult => {
            return result(
              ipAddress,
              DiscoveryImportDeviceOutcome.NotReached,
              DiscoveryImportMonitorOutcome.Skipped,
              {
                deviceError: DISCOVERY_IMPORT_STOPPED_REASON,
                monitorError: DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON,
              },
            );
          },
        ),
      ],
      { status: DiscoveryImportStatus.Stopped },
    );
  }

  test("a stopped import's bars show how far it got, not five of five", () => {
    const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
      stopped(),
      CREATED_AT_MS,
    );

    // Settled, every host is - but three were never reached.
    expect(model.devicesSettled).toBe(5);
    expect(model.monitorsSettled).toBe(5);
    // What the import got to: one imported, one refused.
    expect(model.devicesReached).toBe(2);
    expect(model.monitorsReached).toBe(2);
    expect(model.hostCount).toBe(5);
    expect(model.monitorsRequested).toBe(5);
  });

  test("a finished import got to every host, so the bars are full", () => {
    const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
      view(
        [
          result(
            "10.0.0.1",
            DiscoveryImportDeviceOutcome.Created,
            DiscoveryImportMonitorOutcome.Created,
          ),
          result(
            "10.0.0.2",
            DiscoveryImportDeviceOutcome.AlreadyAdded,
            DiscoveryImportMonitorOutcome.AlreadyThere,
          ),
          result(
            "10.0.0.3",
            DiscoveryImportDeviceOutcome.Failed,
            DiscoveryImportMonitorOutcome.Skipped,
            { deviceError: NAME_TAKEN },
          ),
        ],
        { status: DiscoveryImportStatus.Completed },
      ),
    );

    expect(model.devicesReached).toBe(model.hostCount);
    expect(model.monitorsReached).toBe(model.monitorsRequested);
  });

  test("an import without monitors takes nothing off a monitor count it does not have", () => {
    const progress: ReturnType<typeof summarizeDiscoveryImportResults> =
      summarizeDiscoveryImportResults([
        result(
          "10.0.0.1",
          DiscoveryImportDeviceOutcome.Created,
          DiscoveryImportMonitorOutcome.NotRequested,
        ),
        result(
          "10.0.0.2",
          DiscoveryImportDeviceOutcome.NotReached,
          DiscoveryImportMonitorOutcome.NotRequested,
          { deviceError: DISCOVERY_IMPORT_STOPPED_REASON },
        ),
      ]);

    expect(countReachedDevices(progress)).toBe(1);
    expect(countReachedMonitors(progress)).toBe(0);
  });

  test("while it runs, the bars and the settled counts agree", () => {
    const running: DiscoveryImportView = view([
      result(
        "10.0.0.1",
        DiscoveryImportDeviceOutcome.Created,
        DiscoveryImportMonitorOutcome.Created,
      ),
      result(
        "10.0.0.2",
        DiscoveryImportDeviceOutcome.Pending,
        DiscoveryImportMonitorOutcome.Pending,
      ),
    ]);
    const model: DiscoveryImportProgressModel = getDiscoveryImportProgressModel(
      running,
      CREATED_AT_MS,
    );

    expect(model.devicesReached).toBe(model.devicesSettled);
    expect(model.monitorsReached).toBe(model.monitorsSettled);
  });

  test("the counts never go below zero, whatever the progress says", () => {
    const progress: ReturnType<typeof summarizeDiscoveryImportResults> = {
      ...emptyDiscoveryImportProgress(),
      hosts: 3,
      devicesNotReached: 3,
      monitorsRequested: 3,
    };

    expect(countReachedMonitors(progress)).toBe(0);
  });
});

describe("the import's own reasons are in every language", () => {
  const ENGLISH_LOCALE: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
    "en.json",
  );

  test("the Dashboard records exactly the reasons the import writes", () => {
    /*
     * The progress view looks each group's reason up in the reader's
     * language. A reason the runner writes that the Dashboard never recorded
     * would read English in every language - this list is held to the
     * shared one so a reworded reason cannot slip through.
     */
    expect([...DISCOVERY_IMPORT_TRANSLATED_REASONS].sort()).toEqual(
      [...DISCOVERY_IMPORT_OWN_REASONS].sort(),
    );
  });

  test("each is a key of en.json, mapped to itself", () => {
    const english: Record<string, string> = JSON.parse(
      fs.readFileSync(ENGLISH_LOCALE, "utf8"),
    );

    for (const reason of DISCOVERY_IMPORT_OWN_REASONS) {
      expect([reason, english[reason]]).toEqual([reason, reason]);
    }
  });

  test("each reads right under a heading for one host or for hundreds", () => {
    /*
     * "491 hosts were not reached" over "The import was stopped before it
     * reached this host." read as a mistake: the reasons are listed once for
     * a whole group, so none may speak of "this host".
     */
    for (const reason of DISCOVERY_IMPORT_OWN_REASONS) {
      expect(reason).not.toMatch(THIS_HOST);
      expect(reason.endsWith(".")).toBe(true);
    }

    expect(DISCOVERY_IMPORT_STOPPED_REASON).toBe("The import was stopped.");
    expect(DISCOVERY_IMPORT_UNFINISHED_REASON).toBe(
      "The import stopped before it finished.",
    );
    expect(DISCOVERY_IMPORT_MONITOR_BACKED_REASON).not.toMatch(THIS_DEVICE);
  });

  test("a stopped import's hosts are grouped under the stopped reason", () => {
    const groups: Array<DiscoveryImportIssueGroup> = groupDiscoveryImportIssues(
      [
        result(
          "10.0.0.3",
          DiscoveryImportDeviceOutcome.NotReached,
          DiscoveryImportMonitorOutcome.Skipped,
          { deviceError: DISCOVERY_IMPORT_STOPPED_REASON },
        ),
        result(
          "10.0.0.4",
          DiscoveryImportDeviceOutcome.NotReached,
          DiscoveryImportMonitorOutcome.Skipped,
          { deviceError: DISCOVERY_IMPORT_STOPPED_REASON },
        ),
      ],
    );

    expect(groups).toHaveLength(1);
    expect(groups[0]!.kind).toBe(DiscoveryImportIssueKind.NotReached);
    expect(groups[0]!.reason).toBe(DISCOVERY_IMPORT_STOPPED_REASON);
    expect(DISCOVERY_IMPORT_TRANSLATED_REASONS).toContain(groups[0]!.reason);
  });
});

// "this host", "this device": a reason that names one host as if alone.
const THIS_HOST: RegExp = /\bthis host\b/i;
const THIS_DEVICE: RegExp = /\bthis device\b/i;
