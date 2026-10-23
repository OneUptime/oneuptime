import { Service as NetworkDeviceDiagnosticServiceType } from "../../../Server/Services/NetworkDeviceDiagnosticService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import NetworkDeviceHydrationUtil from "../../../Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import SnmpDataType from "../../../Types/Monitor/SnmpMonitor/SnmpDataType";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import OneUptimeDate from "../../../Types/Date";
import NetworkDeviceDiagnosticType from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticType";
import { NetworkDeviceDiagnosticStatus } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import { NetworkDeviceDiagnosticReport } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  SNMP_WALK_ALREADY_RUNNING_MESSAGE,
  SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
  SNMP_WALK_NO_CREDENTIALS_MESSAGE,
  SNMP_WALK_RUNNING_WINDOW_IN_MINUTES,
  SnmpWalkStopReason,
} from "../../../Types/NetworkDevice/NetworkDeviceSnmpWalk";
import {
  SNMP_WALK_INVALID_AFTER_MESSAGE,
  SNMP_WALK_INVALID_ROOT_MESSAGE,
} from "../../../Utils/NetworkDevice/SnmpWalkResultUtil";
import { EntityManager } from "typeorm";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

/*
 * Creating an SNMP walk (issue #5184) - where it starts, whether the device
 * can be walked at all, and whether it is already being walked - and
 * storing what the probe read.
 *
 * Every refusal here reaches the person on the device's SNMP Walk page the
 * moment they press Walk, so each is pinned with the sentence they read.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_PROBE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const DIAGNOSTIC_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

type DiagnosticServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDeviceDiagnostic>,
  ) => Promise<OnCreate<NetworkDeviceDiagnostic>>;
};

type CountBySpy = {
  mock: { calls: Array<Array<unknown>> };
};

function buildService(runningWalks: number = 0): {
  service: NetworkDeviceDiagnosticServiceType;
  internals: DiagnosticServiceInternals;
  countBy: CountBySpy;
} {
  const service: NetworkDeviceDiagnosticServiceType =
    new NetworkDeviceDiagnosticServiceType();

  const countBy: CountBySpy = jest
    .spyOn(service, "countBy")
    .mockResolvedValue(
      new PositiveNumber(runningWalks) as never,
    ) as unknown as CountBySpy;

  return {
    service,
    internals: service as unknown as DiagnosticServiceInternals,
    countBy,
  };
}

/*
 * Columns to set on a test device; undefined clears one (the tests take a
 * device's credentials or probe away).
 */
type DeviceOverrides = {
  [Column in keyof NetworkDevice]?: NetworkDevice[Column] | undefined;
};

// A device with an SNMP v2c community of its own unless told otherwise.
function deviceRow(overrides: DeviceOverrides = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  device.hostname = "10.0.0.1";
  device.probeId = DEVICE_PROBE_ID;
  device.isArchived = false;
  device.snmpVersion = "V2c";
  device.snmpCommunityString = "s3cret";
  Object.assign(device, overrides);
  return device;
}

type FindOneByIdSpy = {
  mock: { calls: Array<Array<unknown>> };
};

function stubDevice(device: NetworkDevice | null): FindOneByIdSpy {
  return jest
    .spyOn(NetworkDeviceService, "findOneById")
    .mockResolvedValue(device as never) as unknown as FindOneByIdSpy;
}

function makeCreateBy(
  data: Record<string, unknown>,
): CreateBy<NetworkDeviceDiagnostic> {
  const diagnostic: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic();
  Object.assign(diagnostic, data);
  return {
    data: diagnostic,
    props: { tenantId: PROJECT_ID },
  } as unknown as CreateBy<NetworkDeviceDiagnostic>;
}

function walkCreate(
  extra: Record<string, unknown> = {},
): CreateBy<NetworkDeviceDiagnostic> {
  return makeCreateBy({
    networkDeviceId: DEVICE_ID,
    diagnosticType: NetworkDeviceDiagnosticType.SnmpWalk,
    ...extra,
  });
}

beforeEach(() => {
  jest.restoreAllMocks();
  stubProjectDirectory({});
});

describe("where a walk starts", () => {
  test("no starting OID walks everything, from 1.3.6.1", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    const createBy: CreateBy<NetworkDeviceDiagnostic> = walkCreate();

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.snmpWalkRootOid).toBe("1.3.6.1");
    expect(createBy.data.snmpWalkAfterOid).toBeUndefined();
    expect(createBy.data.status).toBe(NetworkDeviceDiagnosticStatus.Pending);
    expect(createBy.data.hostname).toBe("10.0.0.1");
  });

  test("a starting OID is stored as an OID, its leading dot dropped", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    const createBy: CreateBy<NetworkDeviceDiagnostic> = walkCreate({
      snmpWalkRootOid: ".1.3.6.1.4.1.9",
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.snmpWalkRootOid).toBe("1.3.6.1.4.1.9");
  });

  test("a walk that continues another keeps the OID it continues after", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    const createBy: CreateBy<NetworkDeviceDiagnostic> = walkCreate({
      snmpWalkRootOid: "1.3.6.1.2.1.2",
      snmpWalkAfterOid: "1.3.6.1.2.1.2.2.1.10.12",
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.snmpWalkRootOid).toBe("1.3.6.1.2.1.2");
    expect(createBy.data.snmpWalkAfterOid).toBe("1.3.6.1.2.1.2.2.1.10.12");
  });

  test("a MIB name is refused before the device is read", async () => {
    const { internals } = buildService();
    const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

    await expect(
      internals.onBeforeCreate(
        walkCreate({ snmpWalkRootOid: "IF-MIB::ifTable" }),
      ),
    ).rejects.toThrow(SNMP_WALK_INVALID_ROOT_MESSAGE);

    expect(findSpy.mock.calls).toHaveLength(0);
  });

  test("an OID to continue after that is outside the subtree is refused", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    await expect(
      internals.onBeforeCreate(
        walkCreate({
          snmpWalkRootOid: "1.3.6.1.2.1.2",
          snmpWalkAfterOid: "1.3.6.1.4.1.9.1",
        }),
      ),
    ).rejects.toThrow(SNMP_WALK_INVALID_AFTER_MESSAGE);
  });

  test.each([
    NetworkDeviceDiagnosticType.Ping,
    NetworkDeviceDiagnosticType.Traceroute,
  ])(
    "a %s keeps no walk start, whatever was posted",
    async (diagnosticType: NetworkDeviceDiagnosticType) => {
      const { internals, countBy } = buildService();
      stubDevice(deviceRow());
      const createBy: CreateBy<NetworkDeviceDiagnostic> = makeCreateBy({
        networkDeviceId: DEVICE_ID,
        diagnosticType: diagnosticType,
        snmpWalkRootOid: "1.3.6.1.2.1.2",
        snmpWalkAfterOid: "1.3.6.1.2.1.2.1.0",
      });

      await internals.onBeforeCreate(createBy);

      expect(createBy.data.snmpWalkRootOid).toBeUndefined();
      expect(createBy.data.snmpWalkAfterOid).toBeUndefined();
      // Only a walk is limited to one at a time.
      expect(countBy.mock.calls).toHaveLength(0);
    },
  );

  test("a walk result a caller posts is cleared: only the probe writes one", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    const createBy: CreateBy<NetworkDeviceDiagnostic> = walkCreate({
      snmpWalkResult: {
        rootOid: "1.3.6.1",
        rows: [],
        stopReason: SnmpWalkStopReason.Complete,
        requestCount: 0,
        durationInMs: 0,
      },
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.snmpWalkResult).toBeUndefined();
  });
});

describe("whether the device can be walked", () => {
  test("the device is read with the credential columns a poll walks it with", async () => {
    const { internals } = buildService();
    const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

    await internals.onBeforeCreate(walkCreate());

    const select: Record<string, unknown> = (
      findSpy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;

    for (const column of Object.keys(
      NetworkDeviceHydrationUtil.snmpConfigSelect,
    )) {
      expect(select[column]).toBe(true);
    }
  });

  test("a ping reads no credentials", async () => {
    const { internals } = buildService();
    const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

    await internals.onBeforeCreate(
      makeCreateBy({
        networkDeviceId: DEVICE_ID,
        diagnosticType: NetworkDeviceDiagnosticType.Ping,
      }),
    );

    const select: Record<string, unknown> = (
      findSpy.mock.calls[0]![0] as { select: Record<string, unknown> }
    ).select;
    expect(select["snmpCommunityString"]).toBeUndefined();
    expect(select["snmpV3AuthKey"]).toBeUndefined();
  });

  test("an SNMPv3 device with a user can be walked", async () => {
    const { internals } = buildService();
    stubDevice(
      deviceRow({
        snmpVersion: "V3",
        snmpCommunityString: undefined,
        snmpV3Username: "monitoring",
      }),
    );

    await expect(internals.onBeforeCreate(walkCreate())).resolves.toBeDefined();
  });

  test.each([
    ["no credentials at all", { snmpCommunityString: undefined }],
    ["a blank community", { snmpCommunityString: "   " }],
    [
      "SNMPv3 with no user",
      { snmpVersion: "V3", snmpCommunityString: undefined },
    ],
  ])(
    "a device with %s is refused, saying where to add them",
    async (_label: string, overrides: DeviceOverrides) => {
      const { internals } = buildService();
      stubDevice(deviceRow(overrides));

      await expect(internals.onBeforeCreate(walkCreate())).rejects.toThrow(
        SNMP_WALK_NO_CREDENTIALS_MESSAGE,
      );
    },
  );

  test("a device whose credentials come from a profile can be walked", async () => {
    const { internals } = buildService();
    const device: NetworkDevice = deviceRow({ snmpCommunityString: undefined });
    stubDevice(device);
    jest
      .spyOn(NetworkDeviceHydrationUtil, "resolveSnmpCredentials")
      .mockResolvedValue({
        byDeviceId: new Map([
          [
            DEVICE_ID.toString(),
            {
              carrier: { snmpVersion: "V2c", snmpCommunityString: "profile" },
              pollMode: "snmp",
            },
          ],
        ]),
        unresolvedDeviceIds: new Set(),
      });

    await expect(internals.onBeforeCreate(walkCreate())).resolves.toBeDefined();
  });

  test("a credential profile that cannot be read just now is refused, saying to try again", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ snmpCommunityString: undefined }));
    jest
      .spyOn(NetworkDeviceHydrationUtil, "resolveSnmpCredentials")
      .mockResolvedValue({
        byDeviceId: new Map(),
        unresolvedDeviceIds: new Set([DEVICE_ID.toString()]),
      });

    await expect(internals.onBeforeCreate(walkCreate())).rejects.toThrow(
      SNMP_WALK_CREDENTIALS_UNREADABLE_MESSAGE,
    );
  });

  test("the device's own checks come first: an archived device is refused as for a ping", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ isArchived: true }));

    await expect(internals.onBeforeCreate(walkCreate())).rejects.toThrow(
      /archived/,
    );
  });

  test("a device with no probe is refused as for a ping", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ probeId: undefined }));

    await expect(internals.onBeforeCreate(walkCreate())).rejects.toThrow(
      /no probe assigned/,
    );
  });
});

describe("one walk of a device at a time", () => {
  test("a device already being walked is refused", async () => {
    const { internals } = buildService(1);
    stubDevice(deviceRow());

    await expect(internals.onBeforeCreate(walkCreate())).rejects.toThrow(
      SNMP_WALK_ALREADY_RUNNING_MESSAGE,
    );
  });

  test("counts this device's walks that are waiting or running and were asked for recently", async () => {
    const { internals, countBy } = buildService();
    stubDevice(deviceRow());
    const before: Date = OneUptimeDate.getCurrentDate();

    await internals.onBeforeCreate(walkCreate());

    expect(countBy.mock.calls).toHaveLength(1);
    const args: {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    } = countBy.mock.calls[0]![0] as {
      query: Record<string, unknown>;
      props: { isRoot?: boolean };
    };

    expect((args.query["networkDeviceId"] as ObjectID).toString()).toBe(
      DEVICE_ID.toString(),
    );
    expect(args.query["diagnosticType"]).toBe(
      NetworkDeviceDiagnosticType.SnmpWalk,
    );
    expect(JSON.stringify(args.query["status"])).toContain(
      NetworkDeviceDiagnosticStatus.Pending,
    );
    expect(JSON.stringify(args.query["status"])).toContain(
      NetworkDeviceDiagnosticStatus.InProgress,
    );
    expect(JSON.stringify(args.query["status"])).not.toContain(
      NetworkDeviceDiagnosticStatus.Completed,
    );

    // A Raw ">=" operator, its one parameter the start of the window.
    const createdAt: { objectLiteralParameters: Record<string, Date> } = args
      .query["createdAt"] as { objectLiteralParameters: Record<string, Date> };
    const windowStart: Date = Object.values(
      createdAt.objectLiteralParameters,
    )[0]!;
    const expected: number =
      before.getTime() - SNMP_WALK_RUNNING_WINDOW_IN_MINUTES * 60 * 1000;
    expect(Math.abs(windowStart.getTime() - expected)).toBeLessThan(5000);
    expect(args.props.isRoot).toBe(true);
  });

  test("a device that has no credentials is refused for that, not counted", async () => {
    const { internals, countBy } = buildService(1);
    stubDevice(deviceRow({ snmpCommunityString: undefined }));

    await expect(internals.onBeforeCreate(walkCreate())).rejects.toThrow(
      SNMP_WALK_NO_CREDENTIALS_MESSAGE,
    );
    expect(countBy.mock.calls).toHaveLength(0);
  });
});

/*
 * A fake EntityManager that records the statement recordReport runs.
 */
interface RecordedStatement {
  sql: string;
  params: Array<unknown>;
}

function stubTransaction(
  service: NetworkDeviceDiagnosticServiceType,
): Array<RecordedStatement> {
  const statements: Array<RecordedStatement> = [];

  jest
    .spyOn(service, "executeTransaction")
    .mockImplementation(
      async <TResult>(
        runInTransaction: (entityManager: EntityManager) => Promise<TResult>,
      ): Promise<TResult> => {
        return await runInTransaction({
          query: async (sql: string, params: Array<unknown>) => {
            statements.push({ sql, params });
            return [[{ _id: DIAGNOSTIC_ID.toString() }], 1];
          },
        } as unknown as EntityManager);
      },
    );

  return statements;
}

describe("storing what the probe read", () => {
  const walkResult: NetworkDeviceDiagnosticSnmpWalkResult = {
    rootOid: "1.3.6.1.2.1.1",
    rows: [
      {
        oid: "1.3.6.1.2.1.1.5.0",
        type: SnmpDataType.OctetString,
        value: "core-sw-01",
      },
    ],
    stopReason: SnmpWalkStopReason.Complete,
    requestCount: 2,
    durationInMs: 9,
  };

  test("a walk result is stored as jsonb, the ping and traceroute columns NULL", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service);
    const report: NetworkDeviceDiagnosticReport = {
      networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
      status: NetworkDeviceDiagnosticStatus.Completed,
      snmpWalkResult: walkResult,
    };

    const updated: boolean = await service.recordReport({
      probeId: DEVICE_PROBE_ID,
      report: report,
    });

    expect(updated).toBe(true);
    const sql: string = statements[0]!.sql.replace(/\s+/g, " ");
    expect(sql).toContain('"snmpWalkResult" = $8::jsonb');
    expect(statements[0]!.params[7]).toBe(JSON.stringify(walkResult));
    expect(statements[0]!.params[4]).toBeNull();
    expect(statements[0]!.params[5]).toBeNull();
    // The guard against overwriting a Completed row still binds $7.
    expect(statements[0]!.params[6]).toBe(
      NetworkDeviceDiagnosticStatus.Completed,
    );
  });

  test("a ping's report leaves the walk column NULL", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service);

    await service.recordReport({
      probeId: DEVICE_PROBE_ID,
      report: {
        networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: "no route",
      },
    });

    expect(statements[0]!.params[7]).toBeNull();
  });
});
