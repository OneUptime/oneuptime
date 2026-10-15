import BadDataException from "../../../Types/Exception/BadDataException";
import {
  ACTIVE_DISCOVERY_IMPORT_STATUSES,
  ALL_DISCOVERY_IMPORT_STATUSES,
  DEFAULT_DISCOVERY_IMPORT_POLLING_INTERVAL_IN_MINUTES,
  DEFAULT_DISCOVERY_IMPORT_SETTINGS,
  DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL,
  DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES,
  DiscoveryImportAlerting,
  DiscoveryImportDeviceOutcome,
  DiscoveryImportHostResult,
  DiscoveryImportMonitorOutcome,
  DiscoveryImportProgress,
  DiscoveryImportSettings,
  DiscoveryImportStatus,
  DiscoveryImportView,
  countSettledDevices,
  countSettledMonitors,
  emptyDiscoveryImportProgress,
  getRetryableHostResults,
  isDiscoveryImportActive,
  isDiscoveryImportAlerting,
  isDiscoveryImportPollingInterval,
  isDiscoveryImportStatus,
  isHostResultRetryable,
  isHostResultSettled,
  readDiscoveryImportHostResult,
  readDiscoveryImportHostResults,
  readDiscoveryImportPollingInterval,
  readDiscoveryImportProgress,
  readDiscoveryImportSettings,
  readDiscoveryImportView,
  summarizeDiscoveryImportResults,
} from "../../../Types/NetworkDevice/DiscoveryImport";
import { describe, expect, test } from "@jest/globals";

/*
 * The rules the discovery import's server, worker and Dashboard share
 * (issues #4811-#4813): what a request may ask for, how a host's outcome is
 * counted, which hosts a retry tries again, and how a stored or received
 * record is read back. Each is the one place the rule lives, so each is
 * pinned here on its own.
 */

const TEMPLATE_ID: string = "0d9a5c2e-7f41-4b6a-9e3d-2a1b8c7d6e5f";

function host(
  overrides: Partial<DiscoveryImportHostResult> = {},
): DiscoveryImportHostResult {
  return {
    ipAddress: "10.0.0.1",
    name: "core-sw-01",
    isPingOnly: false,
    device: DiscoveryImportDeviceOutcome.Pending,
    monitor: DiscoveryImportMonitorOutcome.NotRequested,
    ...overrides,
  };
}

function expectRefusal(read: () => unknown, message: string): void {
  let thrown: unknown = undefined;

  try {
    read();
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(BadDataException);
  expect((thrown as Error).message).toBe(message);
}

describe("an import's status", () => {
  test("is one of five, and only Queued and Running are unfinished", () => {
    expect([...ALL_DISCOVERY_IMPORT_STATUSES]).toEqual([
      DiscoveryImportStatus.Queued,
      DiscoveryImportStatus.Running,
      DiscoveryImportStatus.Completed,
      DiscoveryImportStatus.Stopped,
      DiscoveryImportStatus.Failed,
    ]);
    expect([...ACTIVE_DISCOVERY_IMPORT_STATUSES]).toEqual([
      DiscoveryImportStatus.Queued,
      DiscoveryImportStatus.Running,
    ]);

    for (const status of ALL_DISCOVERY_IMPORT_STATUSES) {
      expect({ status, active: isDiscoveryImportActive(status) }).toEqual({
        status,
        active:
          status === DiscoveryImportStatus.Queued ||
          status === DiscoveryImportStatus.Running,
      });
    }
  });

  test("no status is not an active import", () => {
    expect(isDiscoveryImportActive(null)).toBe(false);
    expect(isDiscoveryImportActive(undefined)).toBe(false);
  });

  test("a status this build does not know is not one", () => {
    expect(isDiscoveryImportStatus("Running")).toBe(true);
    expect(isDiscoveryImportStatus("running")).toBe(false);
    expect(isDiscoveryImportStatus("Paused")).toBe(false);
    expect(isDiscoveryImportStatus(undefined)).toBe(false);
    expect(isDiscoveryImportStatus(1)).toBe(false);
  });
});

describe("how often imported devices are checked", () => {
  test("from a minute to an hour, five minutes unless chosen", () => {
    expect([...DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES]).toEqual([
      1, 2, 5, 10, 15, 30, 60,
    ]);
    expect(DEFAULT_DISCOVERY_IMPORT_POLLING_INTERVAL_IN_MINUTES).toBe(5);
    expect(
      DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.includes(
        DEFAULT_DISCOVERY_IMPORT_POLLING_INTERVAL_IN_MINUTES,
      ),
    ).toBe(true);
  });

  test.each(
    DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.map(
      (minutes: number): Array<number> => {
        return [minutes];
      },
    ),
  )("%i minutes is a choice, as a number or as text", (minutes: number) => {
    expect(isDiscoveryImportPollingInterval(minutes)).toBe(true);
    expect(readDiscoveryImportPollingInterval(minutes)).toBe(minutes);
    expect(readDiscoveryImportPollingInterval(` ${minutes} `)).toBe(minutes);
  });

  test("nothing chosen is the device's default, not a mistake", () => {
    expect(readDiscoveryImportPollingInterval(undefined)).toBeNull();
    expect(readDiscoveryImportPollingInterval(null)).toBeNull();
    expect(readDiscoveryImportPollingInterval("")).toBeNull();
  });

  test.each([[0], [3], [-5], [1.5], [61], [1440], ["5m"], ["often"], [NaN]])(
    "%p is refused with the choices, never quietly replaced",
    (value: unknown) => {
      expect(isDiscoveryImportPollingInterval(value)).toBe(false);
      expectRefusal(() => {
        return readDiscoveryImportPollingInterval(value);
      }, DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL);
    },
  );

  test("the refusal names every choice, as a sentence says them", () => {
    expect(DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL).toBe(
      "Pick how often devices are checked: every 1, 2, 5, 10, 15, 30 or 60 minutes.",
    );
  });
});

describe("reading the settings an import is asked for", () => {
  test("nothing asked is the defaults: every five minutes, vendor templates, no monitors", () => {
    for (const value of [undefined, null, {}, [], "settings", 3]) {
      expect(readDiscoveryImportSettings(value)).toEqual(
        DEFAULT_DISCOVERY_IMPORT_SETTINGS,
      );
    }

    expect(DEFAULT_DISCOVERY_IMPORT_SETTINGS).toEqual({
      pollingIntervalInMinutes: 5,
      applyVendorTemplates: true,
      alerting: DiscoveryImportAlerting.None,
    });
  });

  test("never hands back the shared defaults object for a caller to change", () => {
    const settings: DiscoveryImportSettings = readDiscoveryImportSettings({});
    settings.pollingIntervalInMinutes = 60;

    expect(DEFAULT_DISCOVERY_IMPORT_SETTINGS.pollingIntervalInMinutes).toBe(5);
  });

  test("everything asked for, read as asked", () => {
    expect(
      readDiscoveryImportSettings({
        pollingIntervalInMinutes: 1,
        applyVendorTemplates: false,
        alerting: DiscoveryImportAlerting.MonitorTemplate,
        monitorTemplateId: ` ${TEMPLATE_ID} `,
      }),
    ).toEqual({
      pollingIntervalInMinutes: 1,
      applyVendorTemplates: false,
      alerting: DiscoveryImportAlerting.MonitorTemplate,
      monitorTemplateId: TEMPLATE_ID,
    });
  });

  test("a template id without monitors asked for is dropped", () => {
    const settings: DiscoveryImportSettings = readDiscoveryImportSettings({
      alerting: DiscoveryImportAlerting.None,
      monitorTemplateId: TEMPLATE_ID,
    });

    expect(settings.monitorTemplateId).toBeUndefined();
  });

  test("a wrong interval is refused", () => {
    expectRefusal(() => {
      return readDiscoveryImportSettings({ pollingIntervalInMinutes: 7 });
    }, DISCOVERY_IMPORT_POLLING_INTERVAL_REFUSAL);
  });

  test("a vendor-template switch that is not true or false is refused", () => {
    expectRefusal(() => {
      return readDiscoveryImportSettings({ applyVendorTemplates: "yes" });
    }, "Whether to apply each SNMP device's vendor template must be true or false.");
  });

  test("an alerting choice this build does not know is refused", () => {
    expect(isDiscoveryImportAlerting("Ping")).toBe(false);
    expectRefusal(() => {
      return readDiscoveryImportSettings({ alerting: "Ping" });
    }, "Choose whether the import creates a monitor for each device.");
  });

  test.each([[undefined], [""], ["not-a-uuid"], [42]])(
    "monitors asked for with template id %p are refused",
    (monitorTemplateId: unknown) => {
      expectRefusal(() => {
        return readDiscoveryImportSettings({
          alerting: DiscoveryImportAlerting.MonitorTemplate,
          monitorTemplateId: monitorTemplateId,
        });
      }, "Pick the monitor template each imported device is monitored with.");
    },
  );
});

describe("counting what happened to each host", () => {
  test("an import of nothing counts nothing", () => {
    expect(summarizeDiscoveryImportResults([])).toEqual(
      emptyDiscoveryImportProgress(),
    );
  });

  test("devices and monitors are counted apart, from the results alone", () => {
    const results: Array<DiscoveryImportHostResult> = [
      host({
        ipAddress: "10.0.0.1",
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Created,
      }),
      host({
        ipAddress: "10.0.0.2",
        device: DiscoveryImportDeviceOutcome.AlreadyAdded,
        monitor: DiscoveryImportMonitorOutcome.AlreadyThere,
      }),
      host({
        ipAddress: "10.0.0.3",
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Failed,
        monitorError: "Your plan allows 100 active monitors.",
      }),
      host({
        ipAddress: "10.0.0.4",
        device: DiscoveryImportDeviceOutcome.Failed,
        deviceError: "Refused.",
        monitor: DiscoveryImportMonitorOutcome.Skipped,
      }),
      host({
        ipAddress: "10.0.0.5",
        device: DiscoveryImportDeviceOutcome.NotReached,
        monitor: DiscoveryImportMonitorOutcome.Skipped,
      }),
      host({
        ipAddress: "10.0.0.6",
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Pending,
      }),
      host({
        ipAddress: "10.0.0.7",
        device: DiscoveryImportDeviceOutcome.Pending,
        monitor: DiscoveryImportMonitorOutcome.Pending,
      }),
    ];

    const progress: DiscoveryImportProgress =
      summarizeDiscoveryImportResults(results);

    expect(progress).toEqual({
      hosts: 7,
      // The pending device and the pending monitor are not done.
      hostsDone: 5,
      devicesCreated: 3,
      devicesAlreadyAdded: 1,
      devicesFailed: 1,
      devicesNotReached: 1,
      monitorsRequested: 7,
      monitorsCreated: 1,
      monitorsAlreadyThere: 1,
      monitorsFailed: 1,
      monitorsSkipped: 2,
    });
    // The bars: six devices settled of seven, five monitors of seven.
    expect(countSettledDevices(progress)).toBe(6);
    expect(countSettledMonitors(progress)).toBe(5);
  });

  test("an import without monitors asks for none, and is done host by host on the device alone", () => {
    const progress: DiscoveryImportProgress = summarizeDiscoveryImportResults([
      host({ device: DiscoveryImportDeviceOutcome.Created }),
      host({ ipAddress: "10.0.0.2" }),
    ]);

    expect(progress.monitorsRequested).toBe(0);
    expect(progress.hostsDone).toBe(1);
    expect(countSettledMonitors(progress)).toBe(0);
    expect(isHostResultSettled(host())).toBe(false);
    expect(
      isHostResultSettled(
        host({ device: DiscoveryImportDeviceOutcome.Created }),
      ),
    ).toBe(true);
  });
});

describe("which hosts a retry tries again", () => {
  test.each([
    [
      "a refused device",
      DiscoveryImportDeviceOutcome.Failed,
      DiscoveryImportMonitorOutcome.Skipped,
      true,
    ],
    [
      "a host the import never reached",
      DiscoveryImportDeviceOutcome.NotReached,
      DiscoveryImportMonitorOutcome.NotRequested,
      true,
    ],
    [
      "a refused monitor on an imported device",
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportMonitorOutcome.Failed,
      true,
    ],
    [
      "a refused monitor on a device that was already there",
      DiscoveryImportDeviceOutcome.AlreadyAdded,
      DiscoveryImportMonitorOutcome.Failed,
      true,
    ],
    [
      "an imported device with its monitor",
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportMonitorOutcome.Created,
      false,
    ],
    [
      "a device already added",
      DiscoveryImportDeviceOutcome.AlreadyAdded,
      DiscoveryImportMonitorOutcome.NotRequested,
      false,
    ],
    [
      "a monitor skipped because the device takes its status from a bound monitor (it would be skipped again)",
      DiscoveryImportDeviceOutcome.Created,
      DiscoveryImportMonitorOutcome.Skipped,
      false,
    ],
    [
      "a monitor already there",
      DiscoveryImportDeviceOutcome.AlreadyAdded,
      DiscoveryImportMonitorOutcome.AlreadyThere,
      false,
    ],
  ])(
    "%s: %s / %s -> %s",
    (
      _what: string,
      device: DiscoveryImportDeviceOutcome,
      monitor: DiscoveryImportMonitorOutcome,
      retryable: boolean,
    ) => {
      expect(
        isHostResultRetryable(host({ device: device, monitor: monitor })),
      ).toBe(retryable);
    },
  );

  test("only the retryable hosts, in their order", () => {
    const results: Array<DiscoveryImportHostResult> = [
      host({
        ipAddress: "10.0.0.1",
        device: DiscoveryImportDeviceOutcome.Created,
      }),
      host({
        ipAddress: "10.0.0.2",
        device: DiscoveryImportDeviceOutcome.NotReached,
      }),
      host({
        ipAddress: "10.0.0.3",
        device: DiscoveryImportDeviceOutcome.Created,
        monitor: DiscoveryImportMonitorOutcome.Failed,
      }),
    ];

    expect(
      getRetryableHostResults(results).map(
        (result: DiscoveryImportHostResult): string => {
          return result.ipAddress;
        },
      ),
    ).toEqual(["10.0.0.2", "10.0.0.3"]);
  });
});

describe("reading a record back", () => {
  test("progress: missing, negative, fractional and wrong-typed counts are read as whole counts", () => {
    expect(readDiscoveryImportProgress(undefined)).toEqual(
      emptyDiscoveryImportProgress(),
    );
    expect(
      readDiscoveryImportProgress({
        hosts: 10.7,
        hostsDone: -3,
        devicesCreated: "4",
        monitorsCreated: Infinity,
        unknownCount: 9,
      }),
    ).toEqual({ ...emptyDiscoveryImportProgress(), hosts: 10 });
  });

  test("a host result keeps what it says and nothing it does not", () => {
    expect(
      readDiscoveryImportHostResult({
        ipAddress: "10.0.0.9",
        name: "pos-reg-01",
        isPingOnly: true,
        device: DiscoveryImportDeviceOutcome.Created,
        deviceId: "a-device",
        deviceError: "",
        monitor: DiscoveryImportMonitorOutcome.Failed,
        monitorError: "Refused.",
        extra: "dropped",
      }),
    ).toEqual({
      ipAddress: "10.0.0.9",
      name: "pos-reg-01",
      isPingOnly: true,
      device: DiscoveryImportDeviceOutcome.Created,
      deviceId: "a-device",
      monitor: DiscoveryImportMonitorOutcome.Failed,
      monitorError: "Refused.",
    });
  });

  test("an outcome a newer server wrote is read as still pending, never as something it is not", () => {
    expect(
      readDiscoveryImportHostResult({
        ipAddress: "10.0.0.9",
        device: "Quarantined",
        monitor: "Deferred",
      }),
    ).toEqual({
      ipAddress: "10.0.0.9",
      name: "10.0.0.9",
      isPingOnly: false,
      device: DiscoveryImportDeviceOutcome.Pending,
      monitor: DiscoveryImportMonitorOutcome.Pending,
    });
  });

  test("a result with no address is no result", () => {
    expect(readDiscoveryImportHostResult({ name: "x" })).toBeNull();
    expect(readDiscoveryImportHostResult(null)).toBeNull();
    expect(readDiscoveryImportHostResult([])).toBeNull();
    expect(
      readDiscoveryImportHostResults([
        { ipAddress: "10.0.0.1" },
        { name: "no address" },
        "text",
        { ipAddress: "10.0.0.2" },
      ]).map((result: DiscoveryImportHostResult): string => {
        return result.ipAddress;
      }),
    ).toEqual(["10.0.0.1", "10.0.0.2"]);
    expect(readDiscoveryImportHostResults({ ipAddress: "x" })).toEqual([]);
  });

  test("an import the server described is read with its optional parts", () => {
    const view: DiscoveryImportView | null = readDiscoveryImportView({
      id: "import-1",
      scanId: "scan-1",
      status: DiscoveryImportStatus.Completed,
      settings: {
        pollingIntervalInMinutes: 10,
        applyVendorTemplates: true,
        alerting: DiscoveryImportAlerting.MonitorTemplate,
        monitorTemplateId: TEMPLATE_ID,
      },
      monitorTemplateName: "Network device alert pack",
      progress: { hosts: 2, hostsDone: 2, devicesCreated: 2 },
      createdAt: "2026-10-15T09:00:00.000Z",
      startedAt: "2026-10-15T09:00:01.000Z",
      completedAt: "2026-10-15T09:00:09.000Z",
      createdByUserName: "Dana",
      isMine: true,
      error: "",
      retryOfImportId: "import-0",
      isStopRequested: false,
      results: [{ ipAddress: "10.0.0.1" }],
      hasMoreResults: true,
    });

    expect(view).toEqual({
      id: "import-1",
      scanId: "scan-1",
      status: DiscoveryImportStatus.Completed,
      settings: {
        pollingIntervalInMinutes: 10,
        applyVendorTemplates: true,
        alerting: DiscoveryImportAlerting.MonitorTemplate,
        monitorTemplateId: TEMPLATE_ID,
      },
      monitorTemplateName: "Network device alert pack",
      progress: {
        ...emptyDiscoveryImportProgress(),
        hosts: 2,
        hostsDone: 2,
        devicesCreated: 2,
      },
      createdAt: "2026-10-15T09:00:00.000Z",
      startedAt: "2026-10-15T09:00:01.000Z",
      completedAt: "2026-10-15T09:00:09.000Z",
      createdByUserName: "Dana",
      isMine: true,
      retryOfImportId: "import-0",
      results: [
        {
          ipAddress: "10.0.0.1",
          name: "10.0.0.1",
          isPingOnly: false,
          device: DiscoveryImportDeviceOutcome.Pending,
          monitor: DiscoveryImportMonitorOutcome.Pending,
        },
      ],
      hasMoreResults: true,
    });
  });

  test("settings that no longer read are drawn as the defaults rather than dropping the import", () => {
    const view: DiscoveryImportView | null = readDiscoveryImportView({
      id: "import-1",
      scanId: "scan-1",
      status: DiscoveryImportStatus.Running,
      settings: { pollingIntervalInMinutes: 7 },
      isStopRequested: true,
    });

    expect(view?.settings).toEqual(DEFAULT_DISCOVERY_IMPORT_SETTINGS);
    expect(view?.isStopRequested).toBe(true);
    expect(view?.isMine).toBe(false);
    expect(view?.createdAt).toBe("");
    expect(view?.results).toBeUndefined();
  });

  test("an import with a status this build does not know, or no id, is dropped", () => {
    expect(
      readDiscoveryImportView({ id: "i", scanId: "s", status: "Paused" }),
    ).toBeNull();
    expect(
      readDiscoveryImportView({
        scanId: "s",
        status: DiscoveryImportStatus.Running,
      }),
    ).toBeNull();
    expect(
      readDiscoveryImportView({
        id: "i",
        status: DiscoveryImportStatus.Running,
      }),
    ).toBeNull();
    expect(readDiscoveryImportView(null)).toBeNull();
    expect(readDiscoveryImportView([])).toBeNull();
  });
});
