import { mockRouter } from "Common/Tests/Server/API/Helpers";
import { ON_HIGHEST_PLAN } from "Common/Tests/Server/TestingUtils/RequestPlan";
import CommonAPI from "Common/Server/API/CommonAPI";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import ProbeService from "Common/Server/Services/ProbeService";
import AuditLogService from "Common/Server/Services/AuditLogService";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import Probe, {
  ProbeConnectionStatus,
} from "Common/Models/DatabaseModels/Probe";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Permission from "Common/Types/Permission";
import UserType from "Common/Types/UserType";
import {
  DISCOVERY_SCAN_STARTED_MESSAGE,
  isDiscoveryScanWaitingForFirstReport,
} from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import { DISCOVERY_SCAN_RUN_PATH } from "Common/Utils/NetworkDiscovery/DiscoveryScanRun";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SCAN RUN AGAIN, FROM THE BUTTON TO ITS NEW RESULTS (OneUptime issue
 * #10334).
 *
 * "All Tablets Discovery" - 10.16-49.0-255.45-47, ICMP - found two tablets
 * three days ago. A third has been installed since. Simon presses Run Again;
 * the probe polls, claims the scan, reports its progress and then its
 * result. Every step is the real code - the run route and
 * NetworkDeviceDiscoveryScanService.runAgain, the probe-ingest claim and
 * result endpoints - against ONE scan row in memory, which answers the
 * service's reads and its guarded writes as Postgres would. So:
 *
 *   - it is the same scan that runs, and no scan is created;
 *   - the new run's results replace the old ones on that row;
 *   - a scheduled scan keeps its schedule, its next run counted from this
 *     run's end;
 *   - the results land fresh, for the auto import rules.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Telemetry/Middleware/ProbeAuthorization", () => {
  return {
    __esModule: true,
    default: {
      isAuthorizedServiceMiddleware: jest.fn(),
    },
  };
});

/*
 * Importing the two routers registers their routes on the mocked router:
 * Run Again's, and the probe's claim and result endpoints.
 */
import "Common/Server/API/NetworkDeviceDiscoveryScanRunAPI";
import "../../FeatureSet/Telemetry/API/ProbeIngest/DiscoveryScan";

const PROJECT_ID: ObjectID = new ObjectID(
  "10334000-0000-4000-8000-0000000000c1",
);
const PROBE_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000c2");
const SCAN_ID: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000c3");
const SIMON: ObjectID = new ObjectID("10334000-0000-4000-8000-0000000000c4");

const PRESSED_AT: Date = new Date("2026-11-22T10:00:00.000Z");
const THREE_DAYS_AGO: Date = new Date("2026-11-19T10:00:00.000Z");

const TWO_TABLETS: Array<DiscoveredNetworkDevice> = [
  { ipAddress: "10.16.0.45", snmpReachable: false },
  { ipAddress: "10.16.0.46", snmpReachable: false },
];
const THREE_TABLETS: Array<DiscoveredNetworkDevice> = [
  ...TWO_TABLETS,
  { ipAddress: "10.17.0.45", snmpReachable: false },
];

type Row = Record<string, unknown>;

let row: Row;
let rowsEverMade: number;

function tabletsScan(overrides: Row = {}): Row {
  return {
    _id: SCAN_ID.toString(),
    projectId: PROJECT_ID,
    name: "All Tablets Discovery",
    cidr: "10.16-49.0-255.45-47",
    probeId: PROBE_ID,
    isSnmpEnabled: false,
    isNetbiosLookupEnabled: false,
    snmpConfigs: null,
    snmpVersion: null,
    snmpCommunityString: null,
    snmpPort: null,
    snmpV3SecurityLevel: null,
    snmpV3Username: null,
    snmpV3AuthProtocol: null,
    snmpV3AuthKey: null,
    snmpV3PrivProtocol: null,
    snmpV3PrivKey: null,
    isRecurring: false,
    rescanIntervalInMinutes: null,
    status: "Completed",
    statusMessage: "Ping sweep finished: 2 hosts answered.",
    startedAt: new Date("2026-11-19T09:56:00.000Z"),
    completedAt: THREE_DAYS_AGO,
    nextScanAt: null,
    discoveredDevices: TWO_TABLETS,
    scannedHostCount: 8704,
    respondedHostCount: 2,
    autoImportProcessedAt: THREE_DAYS_AGO,
    runRequestedAt: null,
    runRequestedByUserId: null,
    version: 7,
    ...overrides,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
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

// Whether a query's plain values all hold of the row (operators match anything).
function matchesPlainValues(query: Row): boolean {
  return Object.entries(query).every(
    ([column, value]: [string, unknown]): boolean => {
      if (value && typeof value === "object" && !(value instanceof ObjectID)) {
        return true;
      }

      return sameValue(row[column], value);
    },
  );
}

function asModel(select: Row): NetworkDeviceDiscoveryScan {
  const model: NetworkDeviceDiscoveryScan = new NetworkDeviceDiscoveryScan();

  for (const column of Object.keys(select)) {
    (model as unknown as Row)[column] = row[column];
  }

  model.id = new ObjectID(String(row["_id"]));

  return model;
}

// A write, with its compare-and-set guard as the UPDATE's WHERE would hold it.
function guardedWrite(data: Row, expectedData?: Row): boolean {
  const holds: boolean = Object.entries(expectedData || {}).every(
    ([column, value]: [string, unknown]): boolean => {
      return sameValue(row[column], value);
    },
  );

  if (holds) {
    Object.assign(row, data);
  }

  return holds;
}

function useTheOneScanRow(): void {
  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "findOneBy")
    .mockImplementation((async (findBy: {
      query: Row;
      select: Row;
    }): Promise<NetworkDeviceDiscoveryScan | null> => {
      return matchesPlainValues(findBy.query) ? asModel(findBy.select) : null;
    }) as never);

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "findBy")
    .mockImplementation((async (findBy: {
      query: Row;
      select: Row;
    }): Promise<Array<NetworkDeviceDiscoveryScan>> => {
      return matchesPlainValues(findBy.query) ? [asModel(findBy.select)] : [];
    }) as never);

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "updateColumnsByIdWithoutHooks")
    .mockImplementation((async (input: {
      data: Row;
      expectedData?: Row;
    }): Promise<void> => {
      guardedWrite(input.data, input.expectedData);
    }) as never);

  jest
    .spyOn(
      NetworkDeviceDiscoveryScanService,
      "compareAndSetColumnsByIdWithoutHooks",
    )
    .mockImplementation((async (input: {
      data: Row;
      expectedData: Row;
    }): Promise<boolean> => {
      return guardedWrite(input.data, input.expectedData);
    }) as never);

  // The result endpoint's final write: run state only, the hooks' cheap exit.
  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "updateOneById")
    .mockImplementation((async (input: { data: Row }): Promise<number> => {
      Object.assign(row, input.data);
      return 1;
    }) as never);

  jest
    .spyOn(NetworkDeviceDiscoveryScanService, "create")
    .mockImplementation((async () => {
      rowsEverMade++;
      throw new Error("Running a scan again must not make another scan.");
    }) as never);
}

async function call(
  method: string,
  uri: string,
  req: Row,
): Promise<{ thrown: unknown }> {
  const next: jest.Mock = jest.fn();

  await mockRouter
    .match(method, uri)
    .handlerFunction(
      { headers: {}, query: {}, params: {}, body: {}, ...req } as unknown as ExpressRequest,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { thrown: next.mock.calls[0]?.[0] };
}

async function pressRunAgain(): Promise<void> {
  const { thrown } = await call("post", DISCOVERY_SCAN_RUN_PATH, {
    params: { scanId: SCAN_ID.toString() },
  });

  expect(thrown).toBeUndefined();
}

// The probe's poll: it is handed the scans its claim took.
async function probePolls(): Promise<Array<NetworkDeviceDiscoveryScan>> {
  const response: { sendEntityArrayResponse: jest.Mock } = (
    jest.requireMock("Common/Server/Utils/Response") as {
      default: { sendEntityArrayResponse: jest.Mock };
    }
  ).default;
  response.sendEntityArrayResponse.mockClear();

  const { thrown } = await call("post", "/probe/discovery-scan/list", {
    probe: new Probe(PROBE_ID),
    body: {},
  });

  expect(thrown).toBeUndefined();

  return (response.sendEntityArrayResponse.mock.calls[0]?.[2] ||
    []) as Array<NetworkDeviceDiscoveryScan>;
}

async function probeReports(body: JSONObject): Promise<void> {
  const { thrown } = await call("post", "/probe/discovery-scan/result", {
    probe: new Probe(PROBE_ID),
    body: { scanId: SCAN_ID.toString(), ...body },
  });

  expect(thrown).toBeUndefined();
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["performance"] });
  jest.setSystemTime(PRESSED_AT);

  row = tabletsScan();
  rowsEverMade = 0;
  useTheOneScanRow();

  const simon: DatabaseCommonInteractionProps = {
    tenantId: PROJECT_ID,
    userId: SIMON,
    userType: UserType.User,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectMember,
            labelIds: [],
            isBlockPermission: false,
          },
        ],
      },
    },
    ...ON_HIGHEST_PLAN,
  } as unknown as DatabaseCommonInteractionProps;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(simon as never);

  jest.spyOn(ProbeService, "findOneById").mockImplementation((async () => {
    const probe: Probe = new Probe(PROBE_ID);
    probe.name = "Office Probe";
    probe.projectId = PROJECT_ID;
    probe.connectionStatus = ProbeConnectionStatus.Connected;
    return probe;
  }) as never);

  jest.spyOn(AuditLogService, "recordUpdate").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("All Tablets Discovery, run again", () => {
  test("is the same scan from the button to its new results: queued, claimed, sweeping, finished - and no scan is made", async () => {
    await pressRunAgain();

    expect(row["status"]).toBe("Pending");
    expect(row["runRequestedByUserId"]).toEqual(SIMON);

    // The probe's next poll claims THIS scan, with its own target and method.
    const claimed: Array<NetworkDeviceDiscoveryScan> = await probePolls();

    expect(claimed).toHaveLength(1);
    expect(claimed[0]!.id?.toString()).toBe(SCAN_ID.toString());
    expect(claimed[0]!.cidr).toBe("10.16-49.0-255.45-47");
    expect(claimed[0]!.isSnmpEnabled).toBe(false);
    expect(row["status"]).toBe("In Progress");
    expect(isDiscoveryScanWaitingForFirstReport(row)).toBe(true);

    jest.setSystemTime(new Date("2026-11-22T10:04:00.000Z"));
    await probeReports({
      isPartial: true,
      statusMessage: "Ping sweep: 4,096 of 8,704 addresses swept.",
      scannedHostCount: 4096,
      discoveredDevices: [THREE_TABLETS[0]!, THREE_TABLETS[2]!],
    });

    expect(row["status"]).toBe("In Progress");
    expect(isDiscoveryScanWaitingForFirstReport(row)).toBe(false);

    jest.setSystemTime(new Date("2026-11-22T10:09:00.000Z"));
    await probeReports({
      success: true,
      statusMessage: "Ping sweep finished: 3 hosts answered.",
      scannedHostCount: 8704,
      discoveredDevices: THREE_TABLETS,
    });

    expect(row["_id"]).toBe(SCAN_ID.toString());
    expect(row["status"]).toBe("Completed");
    expect(rowsEverMade).toBe(0);
    expect(NetworkDeviceDiscoveryScanService.create).not.toHaveBeenCalled();
  });

  test("replaces the previous run's results with the new run's", async () => {
    await pressRunAgain();

    // Until the first report the old hosts stay, marked as the run before's.
    expect(row["discoveredDevices"]).toEqual(TWO_TABLETS);

    await probePolls();
    await probeReports({
      isPartial: true,
      scannedHostCount: 1024,
      discoveredDevices: [THREE_TABLETS[2]!],
    });

    // The first report retired the old hosts: only this run's are on the row.
    expect(row["discoveredDevices"]).toEqual([THREE_TABLETS[2]]);

    await probeReports({
      success: true,
      scannedHostCount: 8704,
      discoveredDevices: THREE_TABLETS,
    });

    expect(row["discoveredDevices"]).toEqual(THREE_TABLETS);
    expect(row["respondedHostCount"]).toBe(3);
    expect(row["scannedHostCount"]).toBe(8704);
  });

  test("lands its results fresh, for the auto import rules to import within a minute", async () => {
    await pressRunAgain();
    await probePolls();

    jest.setSystemTime(new Date("2026-11-22T10:09:00.000Z"));
    await probeReports({
      success: true,
      scannedHostCount: 8704,
      discoveredDevices: THREE_TABLETS,
    });

    // New results: the marker the worker sweeps for, and a completion of now.
    expect(row["autoImportProcessedAt"]).toBeNull();
    expect(OneUptimeDate.fromString(row["completedAt"] as Date)).toEqual(
      new Date("2026-11-22T10:09:00.000Z"),
    );
    expect(OneUptimeDate.fromString(row["startedAt"] as Date)).toEqual(
      PRESSED_AT,
    );
  });

  test("keeps who asked for the run through to its end", async () => {
    await pressRunAgain();
    await probePolls();
    await probeReports({
      success: true,
      scannedHostCount: 8704,
      discoveredDevices: THREE_TABLETS,
    });

    expect(row["runRequestedByUserId"]).toEqual(SIMON);
    expect(OneUptimeDate.fromString(row["runRequestedAt"] as Date)).toEqual(
      PRESSED_AT,
    );
    expect(AuditLogService.recordUpdate).toHaveBeenCalledTimes(1);
  });

  test("a second press while the run is queued or sweeping queues nothing more", async () => {
    await pressRunAgain();

    const queued: { thrown: unknown } = await call(
      "post",
      DISCOVERY_SCAN_RUN_PATH,
      { params: { scanId: SCAN_ID.toString() } },
    );

    expect((queued.thrown as Error).message).toContain("already queued");

    await probePolls();

    const running: { thrown: unknown } = await call(
      "post",
      DISCOVERY_SCAN_RUN_PATH,
      { params: { scanId: SCAN_ID.toString() } },
    );

    expect((running.thrown as Error).message).toContain("already running");
    expect(row["status"]).toBe("In Progress");
    expect(row["statusMessage"]).toBe(DISCOVERY_SCAN_STARTED_MESSAGE);
    expect(AuditLogService.recordUpdate).toHaveBeenCalledTimes(1);
  });
});

describe("a scheduled scan run again on demand", () => {
  beforeEach(() => {
    row = tabletsScan({
      isRecurring: true,
      rescanIntervalInMinutes: 1440,
      nextScanAt: new Date("2026-11-22T22:00:00.000Z"),
    });
  });

  test("keeps its schedule: it still repeats, as often, its next run counted from this run's end", async () => {
    await pressRunAgain();
    await probePolls();

    jest.setSystemTime(new Date("2026-11-22T10:09:00.000Z"));
    await probeReports({
      success: true,
      scannedHostCount: 8704,
      discoveredDevices: THREE_TABLETS,
    });

    expect(row["isRecurring"]).toBe(true);
    expect(row["rescanIntervalInMinutes"]).toBe(1440);
    expect(OneUptimeDate.fromString(row["nextScanAt"] as Date)).toEqual(
      new Date("2026-11-23T10:09:00.000Z"),
    );
  });

  test("still repeats when the run it was asked for fails", async () => {
    await pressRunAgain();
    await probePolls();

    jest.setSystemTime(new Date("2026-11-22T10:09:00.000Z"));
    await probeReports({
      success: false,
      statusMessage: "The probe cannot send ping: NET_RAW is missing.",
    });

    expect(row["status"]).toBe("Failed");
    expect(row["isRecurring"]).toBe(true);
    expect(OneUptimeDate.fromString(row["nextScanAt"] as Date)).toEqual(
      new Date("2026-11-23T10:09:00.000Z"),
    );
  });
});
