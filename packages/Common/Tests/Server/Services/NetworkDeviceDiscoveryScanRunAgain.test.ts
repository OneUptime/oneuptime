import NetworkDeviceDiscoveryScanService, {
  DISCOVERY_SCAN_RUN_AUDIT_COLUMNS,
} from "../../../Server/Services/NetworkDeviceDiscoveryScanService";
import ProbeService from "../../../Server/Services/ProbeService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe, {
  ProbeConnectionStatus,
} from "../../../Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DatabaseCommonInteractionPropsUtil from "../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import OneUptimeDate from "../../../Types/Date";
import UserType from "../../../Types/UserType";
import {
  DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL,
  DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL,
  DISCOVERY_SCAN_NOT_FOUND_REFUSAL,
  DISCOVERY_SCAN_PROBE_GONE_REFUSAL,
  DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL,
  DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL,
  DiscoveryScanRunResult,
  getDiscoveryScanProbeOfflineRefusal,
} from "../../../Utils/NetworkDiscovery/DiscoveryScanRun";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * RUN AGAIN, THE SERVER'S HALF (OneUptime issue #10334).
 *
 * "All Tablets Discovery" - 10.16-49.0-255.45-47, ICMP, not repeating - ran
 * once, three days ago, and could not run again: the only way to sweep the
 * range a second time was to create the same scan once more, a duplicate in
 * the list each time. NetworkDeviceDiscoveryScanService.runAgain puts THAT
 * scan back in its probe's queue.
 *
 * Pinned here, against one scan row kept in memory - the reads, the
 * compare-and-set and the audit call answered from it, the rest of the
 * service real:
 *
 *   - the same row is queued, and nothing is created: no second scan;
 *   - only run state is written - the target, probe, method, credentials,
 *     name and schedule stay as they are, and the previous hosts stay until
 *     the new run's first report replaces them;
 *   - a scan queued or sweeping already is refused, saying which, and so is
 *     a scan that is gone, or whose probe is gone or not connected;
 *   - the write is a compare-and-set on the status read, so a run started in
 *     between is never queued twice;
 *   - who asked, and when, is kept on the row and recorded in the audit log
 *     as theirs - and a refused run records nothing.
 *
 * Who may ask is the route's to check (NetworkDeviceDiscoveryScanRunAPI).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-000000000002",
);
const SCAN_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-000000000003");
const PROBE_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-000000000004",
);
const SIMON: ObjectID = new ObjectID("10334000-0000-4000-8000-000000000005");

const NOW: Date = new Date("2026-11-22T10:00:00.000Z");
const THREE_DAYS_AGO: Date = new Date("2026-11-19T10:00:00.000Z");

const TABLETS: Array<DiscoveredNetworkDevice> = [
  { ipAddress: "10.16.0.45", snmpReachable: false },
  { ipAddress: "10.16.0.46", snmpReachable: false },
];

// A principal of the project holding exactly these permissions.
function principalWith(data: {
  permissions: Array<Permission>;
  userType?: UserType;
  projectId?: ObjectID;
}): DatabaseCommonInteractionProps {
  const projectId: ObjectID = data.projectId || PROJECT_ID;
  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: projectId,
    permissions: data.permissions.map(
      (permission: Permission): UserPermission => {
        return {
          _type: "UserPermission",
          permission: permission,
          labelIds: [],
          isBlockPermission: false,
        };
      },
    ),
  };
  const isApiKey: boolean = data.userType === UserType.API;

  return {
    tenantId: projectId,
    ...(isApiKey ? {} : { userId: SIMON }),
    userType: data.userType || UserType.User,
    userTenantAccessPermission: { [projectId.toString()]: tenant },
    ...ON_HIGHEST_PLAN,
  };
}

// Simon, a project member, pressing Run Again.
const SIMON_PRESSING: DatabaseCommonInteractionProps = principalWith({
  permissions: [Permission.ProjectMember],
});

type Row = Record<string, unknown>;

// The scan as it stood three days after its only run.
function tabletsScan(overrides: Row = {}): Row {
  return {
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "All Tablets Discovery",
    cidr: "10.16-49.0-255.45-47",
    probeId: PROBE_ID,
    isSnmpEnabled: false,
    isRecurring: false,
    rescanIntervalInMinutes: null,
    status: "Completed",
    statusMessage: "Ping sweep finished.",
    startedAt: new Date("2026-11-19T09:56:00.000Z"),
    completedAt: THREE_DAYS_AGO,
    nextScanAt: null,
    discoveredDevices: TABLETS,
    scannedHostCount: 34 * 256 * 3,
    respondedHostCount: 2,
    autoImportProcessedAt: THREE_DAYS_AGO,
    runRequestedAt: null,
    runRequestedByUserId: null,
    ...overrides,
  };
}

interface CompareAndSet {
  id: string;
  data: Row;
  expectedData: Row;
  won: boolean;
}

interface ScanWorld {
  row: Row | null;
  writes: Array<CompareAndSet>;
  // Runs once, just before the next compare-and-set checks the row.
  beforeNextWrite: ((row: Row) => void) | null;
}

let world: ScanWorld;
let probe: Probe | null;
let recordUpdateSpy: jest.SpiedFunction<typeof AuditLogService.recordUpdate>;
let createSpy: jest.SpiedFunction<
  typeof NetworkDeviceDiscoveryScanService.create
>;

function isSameValue(left: unknown, right: unknown): boolean {
  const text: (value: unknown) => string = (value: unknown): string => {
    if (value === undefined || value === null) {
      return "";
    }

    if (value instanceof Date) {
      return value.toISOString();
    }

    return String(value).toLowerCase();
  };

  return text(left) === text(right);
}

function connectedProbe(overrides: Partial<Probe> = {}): Probe {
  const row: Probe = new Probe(PROBE_ID);
  row.name = "Office Probe";
  row.projectId = PROJECT_ID;
  row.connectionStatus = ProbeConnectionStatus.Connected;
  Object.assign(row, overrides);
  return row;
}

async function runAgain(
  props: DatabaseCommonInteractionProps = SIMON_PRESSING,
  projectId: ObjectID = PROJECT_ID,
): Promise<DiscoveryScanRunResult> {
  return NetworkDeviceDiscoveryScanService.runAgain({
    scanId: SCAN_ID,
    projectId: projectId,
    props: props,
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(NOW);

  world = { row: tabletsScan(), writes: [], beforeNextWrite: null };
  probe = connectedProbe();

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: Row;
      select: Row;
    }): Promise<NetworkDeviceDiscoveryScan | null> => {
      const row: Row | null = world.row;

      if (
        !row ||
        !isSameValue(findBy.query["_id"], row["_id"]) ||
        !isSameValue(findBy.query["projectId"], row["projectId"])
      ) {
        return null;
      }

      // Only the columns the read selected, as Postgres answers it.
      const model: NetworkDeviceDiscoveryScan =
        new NetworkDeviceDiscoveryScan();

      for (const column of Object.keys(findBy.select)) {
        (model as unknown as Row)[column] = row[column];
      }

      return model;
    }) as never);

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "compareAndSetColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      id: ObjectID;
      data: Row;
      expectedData: Row;
    }): Promise<boolean> => {
      const row: Row | null = world.row;

      if (row && world.beforeNextWrite) {
        const change: (row: Row) => void = world.beforeNextWrite;
        world.beforeNextWrite = null;
        change(row);
      }

      const won: boolean = Boolean(
        row &&
          isSameValue(input.id, row["_id"]) &&
          Object.entries(input.expectedData).every(
            ([column, value]: [string, unknown]): boolean => {
              return isSameValue(row[column], value);
            },
          ),
      );

      world.writes.push({
        id: input.id.toString(),
        data: { ...input.data },
        expectedData: { ...input.expectedData },
        won: won,
      });

      if (won && row) {
        Object.assign(row, input.data);
      }

      return won;
    }) as never);

  createSpy = jest
    .spyOn(NetworkDeviceDiscoveryScanService, "create")
    .mockImplementation((async () => {
      throw new Error("Run Again must never create a scan.");
    }) as never);

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async (
    findOneById: { id: ObjectID },
  ): Promise<Probe | null> => {
    return probe && isSameValue(findOneById.id, probe.id) ? probe : null;
  }) as never);

  recordUpdateSpy = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("Run Again queues the same scan again", () => {
  it("puts the one-time scan back in its probe's queue, as the same row, and makes no second scan", async () => {
    const result: DiscoveryScanRunResult = await runAgain();

    expect(result).toEqual({
      scanId: SCAN_ID.toString(),
      status: "Pending",
      runRequestedAt: NOW.toISOString(),
    });

    expect(world.writes).toHaveLength(1);
    expect(world.writes[0]!.id).toBe(SCAN_ID.toString());
    expect(world.writes[0]!.won).toBe(true);
    expect(world.row!["status"]).toBe("Pending");
    expect(world.row!["_id"]).toBe(SCAN_ID.toString());
    expect(createSpy).not.toHaveBeenCalled();
  });

  it("writes the run state a new scan starts in, and the request, and nothing else", async () => {
    await runAgain();

    expect(world.writes[0]!.data).toEqual({
      status: "Pending",
      statusMessage: null,
      startedAt: null,
      completedAt: null,
      nextScanAt: null,
      runRequestedAt: NOW,
      runRequestedByUserId: SIMON,
    });
  });

  it("runs with the scan's own target, probe, method, credentials and name: none of them is written", async () => {
    await runAgain();

    const written: Array<string> = Object.keys(world.writes[0]!.data);

    for (const setting of [
      "cidr",
      "probeId",
      "probe",
      "isSnmpEnabled",
      "snmpConfigs",
      "snmpCommunityString",
      "snmpV3AuthKey",
      "isNetbiosLookupEnabled",
      "useShortDeviceNames",
      "name",
    ]) {
      expect(written).not.toContain(setting);
    }

    expect(world.row!["cidr"]).toBe("10.16-49.0-255.45-47");
    expect(world.row!["isSnmpEnabled"]).toBe(false);
    expect(world.row!["name"]).toBe("All Tablets Discovery");
  });

  it("leaves a scheduled scan's schedule as it is: whether it repeats and how often are not written", async () => {
    world.row = tabletsScan({
      isRecurring: true,
      rescanIntervalInMinutes: 1440,
      nextScanAt: new Date("2026-11-22T22:00:00.000Z"),
    });

    await runAgain();

    const written: Array<string> = Object.keys(world.writes[0]!.data);

    expect(written).not.toContain("isRecurring");
    expect(written).not.toContain("rescanIntervalInMinutes");
    expect(world.row!["isRecurring"]).toBe(true);
    expect(world.row!["rescanIntervalInMinutes"]).toBe(1440);
    /*
     * A run in flight has no next run yet, as when the schedule queues one;
     * the result endpoint stamps it from this run's completion.
     */
    expect(world.row!["nextScanAt"]).toBeNull();
  });

  it("keeps the previous hosts until the new run reports: the claim marks them as the run before's", async () => {
    await runAgain();

    const written: Array<string> = Object.keys(world.writes[0]!.data);

    expect(written).not.toContain("discoveredDevices");
    expect(written).not.toContain("scannedHostCount");
    expect(written).not.toContain("respondedHostCount");
    expect(world.row!["discoveredDevices"]).toEqual(TABLETS);
  });

  it("holds the write to the status it read, so it lands only while the run is still over", async () => {
    await runAgain();

    expect(world.writes[0]!.expectedData).toEqual({ status: "Completed" });
  });

  it("runs a scan whose last run failed", async () => {
    world.row = tabletsScan({ status: "Failed" });

    await runAgain();

    expect(world.writes[0]!.expectedData).toEqual({ status: "Failed" });
    expect(world.row!["status"]).toBe("Pending");
  });

  it("names who asked on the row, and an API key leaves no person named", async () => {
    await runAgain();
    expect(world.row!["runRequestedByUserId"]).toEqual(SIMON);
    expect(world.row!["runRequestedAt"]).toEqual(NOW);

    world.row = tabletsScan();
    world.writes = [];

    await runAgain(
      principalWith({
        // A write needs a read, as an edit of the scan does.
        permissions: [
          Permission.EditNetworkDeviceDiscoveryScan,
          Permission.ReadNetworkDeviceDiscoveryScan,
        ],
        userType: UserType.API,
      }),
    );

    expect(world.writes[0]!.data["runRequestedByUserId"]).toBeNull();
    expect(world.row!["runRequestedAt"]).toEqual(NOW);
  });

  it("asks the probe of the scan, and runs from a connected global probe", async () => {
    probe = connectedProbe({ projectId: undefined, name: "Global Probe" });

    await runAgain();

    expect(world.row!["status"]).toBe("Pending");
    expect(ProbeService.findOneById).toHaveBeenCalledWith(
      expect.objectContaining({
        id: PROBE_ID,
        props: { isRoot: true },
      }),
    );
  });
});

describe("Run Again refuses what it cannot do, and says why", () => {
  function expectNothingWritten(): void {
    expect(world.writes.filter((write: CompareAndSet) => write.won)).toEqual(
      [],
    );
    expect(recordUpdateSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  }

  it("refuses a scan that is sweeping, saying it is running", async () => {
    world.row = tabletsScan({ status: "In Progress", completedAt: null });

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL),
    );
    expect(world.writes).toEqual([]);
    expectNothingWritten();
  });

  it("refuses a scan that is queued already, saying it is queued", async () => {
    world.row = tabletsScan({ status: "Pending", completedAt: null });

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL),
    );
    expectNothingWritten();
  });

  it("refuses a second press while the first run is queued", async () => {
    await runAgain();

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL),
    );

    expect(world.writes).toHaveLength(1);
    expect(recordUpdateSpy).toHaveBeenCalledTimes(1);
  });

  it("refuses a scan that is gone", async () => {
    world.row = null;

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_NOT_FOUND_REFUSAL),
    );
    expectNothingWritten();
  });

  it("reads the scan within the caller's project: another project's id reads as no scan", async () => {
    await expect(
      runAgain(
        principalWith({
          permissions: [Permission.ProjectOwner],
          projectId: OTHER_PROJECT_ID,
        }),
        OTHER_PROJECT_ID,
      ),
    ).rejects.toThrow(new BadDataException(DISCOVERY_SCAN_NOT_FOUND_REFUSAL));
    expectNothingWritten();
    expect(world.row!["status"]).toBe("Completed");
  });

  it("refuses whoever may not edit scans before anything is read or written, saying so", async () => {
    await expect(
      runAgain(principalWith({ permissions: [Permission.Viewer] })),
    ).rejects.toThrow(
      new NotAuthorizedException(DISCOVERY_SCAN_RUN_NOT_ALLOWED_REFUSAL),
    );
    expect(world.writes).toEqual([]);
    expect(ProbeService.findOneById).not.toHaveBeenCalled();
    expectNothingWritten();
  });

  it("refuses a credential that may only read, whatever it holds, in its own words", async () => {
    await expect(
      runAgain({
        ...principalWith({ permissions: [Permission.ProjectOwner] }),
        isReadOnlyCredential: true,
      }),
    ).rejects.toThrow(
      new NotAuthorizedException(
        DatabaseCommonInteractionPropsUtil.READ_ONLY_CREDENTIAL_MESSAGE,
      ),
    );
    expect(world.writes).toEqual([]);
    expectNothingWritten();
  });

  it("refuses when the probe is not connected, naming the probe, and leaves the last results reviewable", async () => {
    probe = connectedProbe({
      connectionStatus: ProbeConnectionStatus.Disconnected,
    });

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(getDiscoveryScanProbeOfflineRefusal("Office Probe")),
    );
    expectNothingWritten();
    expect(world.row!["status"]).toBe("Completed");
    expect(world.row!["discoveredDevices"]).toEqual(TABLETS);
  });

  it("names the probe in the refusal's words", () => {
    expect(getDiscoveryScanProbeOfflineRefusal("Office Probe")).toBe(
      "This scan's probe, Office Probe, is not connected to OneUptime, so the scan cannot run now. Start the probe, or pick another probe in Edit.",
    );
    expect(getDiscoveryScanProbeOfflineRefusal("  ")).toBe(
      DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL,
    );
  });

  it("refuses a probe that has never connected", async () => {
    probe = connectedProbe({
      connectionStatus: undefined,
      name: undefined,
    });

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_UNNAMED_PROBE_OFFLINE_REFUSAL),
    );
    expectNothingWritten();
  });

  it("refuses when the probe is gone", async () => {
    probe = null;

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_PROBE_GONE_REFUSAL),
    );
    expectNothingWritten();
  });

  it("refuses a probe of another project as one that is not there", async () => {
    probe = connectedProbe({ projectId: OTHER_PROJECT_ID });

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_PROBE_GONE_REFUSAL),
    );
    expectNothingWritten();
  });
});

describe("Run Again never queues a run twice", () => {
  it("loses to a run the schedule queued between the read and the write, and says it is queued", async () => {
    world.row = tabletsScan({ isRecurring: true, rescanIntervalInMinutes: 60 });
    world.beforeNextWrite = (row: Row): void => {
      // The requeue worker, a moment earlier.
      row["status"] = "Pending";
      row["completedAt"] = null;
    };

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_ALREADY_QUEUED_REFUSAL),
    );

    expect(world.writes).toHaveLength(1);
    expect(world.writes[0]!.won).toBe(false);
    expect(world.row!["runRequestedByUserId"]).toBeNull();
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });

  it("loses to a probe that claimed the scan in between, and says it is running", async () => {
    world.beforeNextWrite = (row: Row): void => {
      row["status"] = "In Progress";
    };

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL),
    );
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });

  it("tries once more when the run moved on but is still over: a late result on a failed run", async () => {
    world.row = tabletsScan({ status: "Failed" });
    world.beforeNextWrite = (row: Row): void => {
      row["status"] = "Completed";
    };

    await runAgain();

    expect(world.writes.map((write: CompareAndSet) => write.won)).toEqual([
      false,
      true,
    ]);
    expect(world.writes[1]!.expectedData).toEqual({ status: "Completed" });
    expect(world.row!["status"]).toBe("Pending");
    expect(recordUpdateSpy).toHaveBeenCalledTimes(1);
  });

  it("answers a scan that moves on under every attempt as running", async () => {
    jest
      .spyOn(
        NetworkDeviceDiscoveryScanService,
        "compareAndSetColumnsByIdWithoutHooks",
      )
      .mockResolvedValue(false);

    await expect(runAgain()).rejects.toThrow(
      new BadDataException(DISCOVERY_SCAN_ALREADY_RUNNING_REFUSAL),
    );
    expect(
      NetworkDeviceDiscoveryScanService.compareAndSetColumnsByIdWithoutHooks,
    ).toHaveBeenCalledTimes(2);
    expect(recordUpdateSpy).not.toHaveBeenCalled();
  });
});

describe("Run Again is recorded as the requester's", () => {
  it("records one update of the scan, by the person who pressed it, naming runRequestedAt and the status", async () => {
    await runAgain();

    expect(recordUpdateSpy).toHaveBeenCalledTimes(1);

    const call: Parameters<typeof AuditLogService.recordUpdate>[0] =
      recordUpdateSpy.mock.calls[0]![0];

    expect(call.model).toBeInstanceOf(NetworkDeviceDiscoveryScan);
    expect(call.itemId.toString()).toBe(SCAN_ID.toString());
    expect(call.props).toBe(SIMON_PRESSING);
    expect(call.includeColumns).toEqual(["runRequestedAt", "status"]);
    expect([...DISCOVERY_SCAN_RUN_AUDIT_COLUMNS]).toEqual(
      call.includeColumns,
    );
    expect(call.updatedFields).toEqual({
      status: "Pending",
      runRequestedAt: NOW,
    });
  });

  it("compares with the scan as it was, and names it by its name", async () => {
    await runAgain();

    const before: NetworkDeviceDiscoveryScan = recordUpdateSpy.mock.calls[0]![0]
      .before as NetworkDeviceDiscoveryScan;

    expect(before.status).toBe("Completed");
    expect(before.runRequestedAt).toBeNull();
    expect(before.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(before.name).toBe("All Tablets Discovery");
    expect(before.cidr).toBe("10.16-49.0-255.45-47");
  });

  it("records the run of an earlier request as a change from that request", async () => {
    world.row = tabletsScan({
      runRequestedAt: THREE_DAYS_AGO,
      runRequestedByUserId: SIMON,
    });

    await runAgain();

    const before: NetworkDeviceDiscoveryScan = recordUpdateSpy.mock.calls[0]![0]
      .before as NetworkDeviceDiscoveryScan;

    expect(before.runRequestedAt).toEqual(THREE_DAYS_AGO);
    expect(OneUptimeDate.fromString(world.row!["runRequestedAt"] as Date)).toEqual(
      NOW,
    );
  });
});
