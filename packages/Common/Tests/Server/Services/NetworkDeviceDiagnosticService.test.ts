import { Service as NetworkDeviceDiagnosticServiceType } from "../../../Server/Services/NetworkDeviceDiagnosticService";
import NetworkDeviceService from "../../../Server/Services/NetworkDeviceService";
import ProbeService from "../../../Server/Services/ProbeService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "../../../Models/DatabaseModels/NetworkDeviceDiagnostic";
import Probe from "../../../Models/DatabaseModels/Probe";
import Project from "../../../Models/DatabaseModels/Project";
import BadDataException from "../../../Types/Exception/BadDataException";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import NetworkDeviceDiagnosticType from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticType";
import { NetworkDeviceDiagnosticStatus } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import {
  NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES,
  NetworkDeviceDiagnosticPingResult,
  NetworkDeviceDiagnosticReport,
} from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import NetworkPathTrace from "../../../Types/Monitor/NetworkMonitor/NetworkPathTrace";
import { EntityManager } from "typeorm";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * WHAT THIS FILE IS DEFENDING
 *
 * A diagnostic is the one write in the product where a browser asks a probe
 * to reach into a network on its behalf, by device id. Three things have to
 * hold at the point that row is written, and all three live in
 * onBeforeCreate:
 *
 *   - the device is the CALLER'S. The hook reads it as root (it runs before
 *     the create's permission check), so it must scope the read by hand, and
 *     a device in another project must be indistinguishable from one that
 *     does not exist.
 *   - the probe is attachable to the device's project. The device's own
 *     probe was checked when it was assigned; one the caller names arrives
 *     from the browser and has to be checked here.
 *   - the row starts clean. Whatever a caller posted for status or a result
 *     column, the row is written Pending with no result, because the
 *     dashboard renders Completed as "there is a result".
 *
 * The rest is the SQL the probe's claim and report go through. Neither can
 * be exercised without a live Postgres, and a dropped predicate is invisible
 * from the outside — the query still runs, still returns rows, and simply
 * hands diagnostics to the wrong probe or lets one probe overwrite
 * another's result. So the statements are asserted against their text and
 * their bound parameters, the way NetworkDevicePollingTenancy does for the
 * polling claim.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const DEVICE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const DEVICE_PROBE_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CHOSEN_PROBE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const DIAGNOSTIC_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SECOND_DIAGNOSTIC_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

type DiagnosticServiceInternals = {
  onBeforeCreate: (
    createBy: CreateBy<NetworkDeviceDiagnostic>,
  ) => Promise<OnCreate<NetworkDeviceDiagnostic>>;
  /*
   * DatabaseService's private wrapper: copies props.tenantId onto
   * data.projectId and THEN calls the hook. The tenant tests below go through
   * it, because that stamp is what makes the relation object the only
   * spelling a client can still point at another project.
   */
  _onBeforeCreate: (
    createBy: CreateBy<NetworkDeviceDiagnostic>,
  ) => Promise<OnCreate<NetworkDeviceDiagnostic>>;
};

function buildService(): {
  service: NetworkDeviceDiagnosticServiceType;
  internals: DiagnosticServiceInternals;
} {
  const service: NetworkDeviceDiagnosticServiceType =
    new NetworkDeviceDiagnosticServiceType();
  return {
    service,
    internals: service as unknown as DiagnosticServiceInternals,
  };
}

// The device the hook loads; overrides model the states the hook refuses.
function deviceRow(overrides: Partial<NetworkDevice> = {}): NetworkDevice {
  const device: NetworkDevice = new NetworkDevice(DEVICE_ID);
  device.projectId = PROJECT_ID;
  device.hostname = "10.0.0.1";
  device.probeId = DEVICE_PROBE_ID;
  device.isArchived = false;
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

type AttachabilitySpy = {
  mock: { calls: Array<Array<unknown>> };
};

function stubProbeAttachability(isAttachable: boolean): AttachabilitySpy {
  return jest
    .spyOn(ProbeService, "isProbeAttachableToProject")
    .mockResolvedValue(isAttachable) as unknown as AttachabilitySpy;
}

/*
 * The hook runs before the model's own type checks, so a client really can
 * post anything here; the payload is written through a Record cast for the
 * same reason the discovery-scan tests do it.
 */
function makeCreateBy(
  data: Record<string, unknown>,
  props: Record<string, unknown> = { tenantId: PROJECT_ID },
): CreateBy<NetworkDeviceDiagnostic> {
  const diagnostic: NetworkDeviceDiagnostic = new NetworkDeviceDiagnostic();
  Object.assign(diagnostic, data);
  return {
    data: diagnostic,
    props: props,
  } as unknown as CreateBy<NetworkDeviceDiagnostic>;
}

function pingCreate(
  extra: Record<string, unknown> = {},
  props?: Record<string, unknown>,
): CreateBy<NetworkDeviceDiagnostic> {
  return makeCreateBy(
    {
      networkDeviceId: DEVICE_ID,
      diagnosticType: NetworkDeviceDiagnosticType.Ping,
      ...extra,
    },
    props,
  );
}

describe("onBeforeCreate fills the row in from the device", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  test.each(["networkDeviceId", "networkDevice"] as const)(
    "copies the hostname, the probe and the project from the device named by %s",
    async (spelling: "networkDeviceId" | "networkDevice") => {
      const { internals } = buildService();
      stubDevice(deviceRow());

      const createBy: CreateBy<NetworkDeviceDiagnostic> = makeCreateBy({
        [spelling]:
          spelling === "networkDeviceId"
            ? DEVICE_ID
            : new NetworkDevice(DEVICE_ID),
        diagnosticType: NetworkDeviceDiagnosticType.Ping,
      });

      const result: OnCreate<NetworkDeviceDiagnostic> =
        await internals.onBeforeCreate(createBy);

      expect(result.createBy).toBe(createBy);
      expect(createBy.data.networkDeviceId?.toString()).toBe(
        DEVICE_ID.toString(),
      );
      expect(createBy.data.hostname).toBe("10.0.0.1");
      expect(createBy.data.probeId?.toString()).toBe(
        DEVICE_PROBE_ID.toString(),
      );
      expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
      expect(createBy.data.status).toBe(NetworkDeviceDiagnosticStatus.Pending);
    },
  );

  test("reads the device as root, by its id", async () => {
    const { internals } = buildService();
    const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

    await internals.onBeforeCreate(pingCreate());

    expect(findSpy.mock.calls).toHaveLength(1);
    const findArgs: { id: ObjectID; props: { isRoot?: boolean } } = findSpy.mock
      .calls[0]![0] as { id: ObjectID; props: { isRoot?: boolean } };
    expect(findArgs.id.toString()).toBe(DEVICE_ID.toString());
    expect(findArgs.props.isRoot).toBe(true);
  });

  test("does not re-check the device's own probe, which was checked when it was assigned", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    const attachability: AttachabilitySpy = stubProbeAttachability(false);

    await expect(internals.onBeforeCreate(pingCreate())).resolves.toBeDefined();

    expect(attachability.mock.calls).toHaveLength(0);
  });

  test.each(["probeId", "probe"] as const)(
    "a probe the caller names as %s wins over the device's, once it passes the tenancy check",
    async (spelling: "probeId" | "probe") => {
      const { internals } = buildService();
      stubDevice(deviceRow());
      const attachability: AttachabilitySpy = stubProbeAttachability(true);

      const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate({
        [spelling]:
          spelling === "probeId" ? CHOSEN_PROBE_ID : new Probe(CHOSEN_PROBE_ID),
      });

      await internals.onBeforeCreate(createBy);

      expect(createBy.data.probeId?.toString()).toBe(
        CHOSEN_PROBE_ID.toString(),
      );
      expect(attachability.mock.calls).toHaveLength(1);
      const checked: { probeId: ObjectID; projectId: ObjectID } = attachability
        .mock.calls[0]![0] as { probeId: ObjectID; projectId: ObjectID };
      expect(checked.probeId.toString()).toBe(CHOSEN_PROBE_ID.toString());
      expect(checked.projectId.toString()).toBe(PROJECT_ID.toString());
    },
  );

  /*
   * THE tenancy test for the probe. A probe from another project that could
   * claim this row would be handed the device's hostname.
   */
  test("refuses a caller-named probe that is not attachable to the device's project", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    stubProbeAttachability(false);

    await expect(
      internals.onBeforeCreate(pingCreate({ probeId: CHOSEN_PROBE_ID })),
    ).rejects.toThrow(/does not belong to this project/);
  });

  test("refuses a payload that points probeId and probe at different rows", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());
    stubProbeAttachability(true);

    await expect(
      internals.onBeforeCreate(
        pingCreate({
          probeId: CHOSEN_PROBE_ID,
          probe: new Probe(DEVICE_PROBE_ID),
        }),
      ),
    ).rejects.toThrow(/Conflicting Probe references/);
  });

  test("a probe: null means no preference, and the relation is dropped so it cannot null the chosen probeId", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate({
      probe: null,
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.probeId?.toString()).toBe(DEVICE_PROBE_ID.toString());
    expect(createBy.data.probe).toBeUndefined();
  });

  test("refuses a create that names no device", async () => {
    const { internals } = buildService();
    const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

    await expect(
      internals.onBeforeCreate(
        makeCreateBy({ diagnosticType: NetworkDeviceDiagnosticType.Ping }),
      ),
    ).rejects.toThrow(/Network Device is required/);

    expect(findSpy.mock.calls).toHaveLength(0);
  });

  test.each([
    ["a misspelling", "ping"],
    ["an unknown type", "Nmap"],
    ["an empty string", ""],
    ["nothing at all", undefined],
    ["a number", 42],
  ])(
    "refuses %s as the diagnostic type, naming the valid ones",
    async (_label: string, diagnosticType: unknown) => {
      const { internals } = buildService();
      const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

      await expect(
        internals.onBeforeCreate(
          makeCreateBy({ networkDeviceId: DEVICE_ID, diagnosticType }),
        ),
      ).rejects.toThrow(/Ping, Traceroute/);

      expect(findSpy.mock.calls).toHaveLength(0);
    },
  );

  test("refuses a device that does not exist", async () => {
    const { internals } = buildService();
    stubDevice(null);

    await expect(internals.onBeforeCreate(pingCreate())).rejects.toThrow(
      "Network Device not found.",
    );
  });

  /*
   * THE tenancy test for the device. The hook reads as root, so this is the
   * only thing between a dashboard in project A and a device in project B
   * whose id it guessed — and the refusal must read exactly like "no such
   * device", or the guess is confirmed.
   */
  test("refuses a device from another project with the same words as a missing one", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ projectId: OTHER_PROJECT_ID }));

    await expect(
      internals.onBeforeCreate(pingCreate({}, { tenantId: PROJECT_ID })),
    ).rejects.toThrow("Network Device not found.");
  });

  test.each(["projectId", "project"] as const)(
    "compares against the project the caller carries as %s",
    async (spelling: "projectId" | "project") => {
      const { internals } = buildService();
      stubDevice(deviceRow({ projectId: OTHER_PROJECT_ID }));

      await expect(
        internals.onBeforeCreate(
          pingCreate(
            {
              [spelling]:
                spelling === "projectId" ? PROJECT_ID : new Project(PROJECT_ID),
            },
            { isRoot: true },
          ),
        ),
      ).rejects.toThrow("Network Device not found.");
    },
  );

  /*
   * THE re-homing test. DatabaseService._onBeforeCreate stamps the tenant
   * onto data.projectId before the hook, so the column always agrees with
   * the caller; a `project` relation object is the spelling a client can
   * still point at another project, and TypeORM derives the join column from
   * the relation when both are set. Reading only the column would let such a
   * row land in the other project with every check passed.
   */
  test("refuses a project relation that disagrees with the tenant DatabaseService stamped", async () => {
    const { internals } = buildService();
    const findSpy: FindOneByIdSpy = stubDevice(deviceRow());

    const attempt: Promise<OnCreate<NetworkDeviceDiagnostic>> =
      internals._onBeforeCreate(
        pingCreate(
          { project: new Project(OTHER_PROJECT_ID) },
          { tenantId: PROJECT_ID },
        ),
      );

    await expect(attempt).rejects.toBeInstanceOf(BadDataException);
    await expect(attempt).rejects.toThrow(/Conflicting Project references/);

    // Refused before the device is even looked up.
    expect(findSpy.mock.calls).toHaveLength(0);
  });

  test("refuses a payload that points projectId and project at different rows", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    await expect(
      internals.onBeforeCreate(
        pingCreate(
          { projectId: PROJECT_ID, project: new Project(OTHER_PROJECT_ID) },
          { isRoot: true },
        ),
      ),
    ).rejects.toThrow(/Conflicting Project references/);
  });

  test("accepts a project relation that names the caller's own project, and drops it in favour of the column", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate(
      { project: new Project(PROJECT_ID) },
      { tenantId: PROJECT_ID },
    );

    await internals._onBeforeCreate(createBy);

    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.data.project).toBeUndefined();
  });

  test("a root create carrying only the project relation resolves projectId from it", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate(
      { project: new Project(PROJECT_ID) },
      { isRoot: true },
    );

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(createBy.data.project).toBeUndefined();
  });

  test("a root create with no project of its own takes the device's", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ projectId: OTHER_PROJECT_ID }));

    const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate(
      {},
      { isRoot: true },
    );

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.projectId?.toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("refuses an archived device", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ isArchived: true }));

    await expect(internals.onBeforeCreate(pingCreate())).rejects.toThrow(
      /archived/,
    );
  });

  test.each([
    ["missing", undefined],
    ["empty", ""],
    ["blank", "   "],
  ])(
    "refuses a device whose hostname is %s",
    async (_label: string, hostname: string | undefined) => {
      const { internals } = buildService();
      const device: NetworkDevice = deviceRow();
      (device as unknown as Record<string, unknown>)["hostname"] = hostname;
      stubDevice(device);

      await expect(internals.onBeforeCreate(pingCreate())).rejects.toThrow(
        /no hostname or IP address/,
      );
    },
  );

  test("trims the hostname it copies", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ hostname: "  core-sw1.example.com \t" }));

    const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate();

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.hostname).toBe("core-sw1.example.com");
  });

  test("refuses when neither the caller nor the device names a probe, and says where to assign one", async () => {
    const { internals } = buildService();
    const device: NetworkDevice = deviceRow();
    delete device.probeId;
    stubDevice(device);

    const attempt: Promise<OnCreate<NetworkDeviceDiagnostic>> =
      internals.onBeforeCreate(pingCreate());

    await expect(attempt).rejects.toThrow(/no probe assigned/);
    await expect(attempt).rejects.toThrow(/Device → Settings/);
  });

  test("every refusal is a BadDataException, so the dashboard shows the message", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow({ isArchived: true }));

    await expect(internals.onBeforeCreate(pingCreate())).rejects.toBeInstanceOf(
      BadDataException,
    );
  });

  /*
   * Whatever the client posted, the row starts Pending with nothing in it.
   * The columns are `create: []`, but the hook runs before that check, and a
   * root caller is not subject to it at all.
   */
  test("forces Pending and clears every result column, whatever the caller posted", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    const createBy: CreateBy<NetworkDeviceDiagnostic> = pingCreate(
      {
        status: NetworkDeviceDiagnosticStatus.Completed,
        statusMessage: "already done",
        pingResult: { isOnline: true, failureCause: "" },
        traceRouteResult: { timestamp: new Date() },
        startedAt: new Date(),
        completedAt: new Date(),
        hostname: "attacker.example.com",
      },
      { isRoot: true },
    );

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.status).toBe(NetworkDeviceDiagnosticStatus.Pending);
    expect(createBy.data.hostname).toBe("10.0.0.1");
    expect(createBy.data.statusMessage).toBeUndefined();
    expect(createBy.data.pingResult).toBeUndefined();
    expect(createBy.data.traceRouteResult).toBeUndefined();
    expect(createBy.data.startedAt).toBeUndefined();
    expect(createBy.data.completedAt).toBeUndefined();
  });

  test("accepts a traceroute as well as a ping", async () => {
    const { internals } = buildService();
    stubDevice(deviceRow());

    const createBy: CreateBy<NetworkDeviceDiagnostic> = makeCreateBy({
      networkDeviceId: DEVICE_ID,
      diagnosticType: NetworkDeviceDiagnosticType.Traceroute,
    });

    await internals.onBeforeCreate(createBy);

    expect(createBy.data.diagnosticType).toBe(
      NetworkDeviceDiagnosticType.Traceroute,
    );
  });
});

/*
 * A fake EntityManager that records every statement and answers each with
 * the next scripted result. The service only ever calls `query`.
 */
interface RecordedStatement {
  sql: string;
  params: Array<unknown>;
}

function stubTransaction(
  service: NetworkDeviceDiagnosticServiceType,
  results: Array<unknown>,
): Array<RecordedStatement> {
  const statements: Array<RecordedStatement> = [];
  const queue: Array<unknown> = [...results];

  jest
    .spyOn(service, "executeTransaction")
    .mockImplementation(
      async <TResult>(
        runInTransaction: (entityManager: EntityManager) => Promise<TResult>,
      ): Promise<TResult> => {
        const entityManager: {
          query: (sql: string, params: Array<unknown>) => Promise<unknown>;
        } = {
          query: async (
            sql: string,
            params: Array<unknown>,
          ): Promise<unknown> => {
            statements.push({ sql, params });
            return queue.length > 0 ? queue.shift() : [];
          },
        };

        return await runInTransaction(
          entityManager as unknown as EntityManager,
        );
      },
    );

  return statements;
}

function flatten(sql: string): string {
  return sql.replace(/\s+/g, " ").trim();
}

describe("claimPendingForProbe", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  async function claim(
    selectRows: Array<{ _id: string }>,
    limit: number = 20,
  ): Promise<{
    ids: Array<ObjectID>;
    statements: Array<RecordedStatement>;
  }> {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      selectRows,
      [[], selectRows.length],
    ]);

    const ids: Array<ObjectID> = await service.claimPendingForProbe({
      probeId: DEVICE_PROBE_ID,
      limit,
    });

    return { ids, statements };
  }

  test("selects only this probe's Pending, undeleted rows inside the claim window, oldest first, skipping locked ones", async () => {
    const before: number = Date.now();
    const { statements } = await claim([{ _id: DIAGNOSTIC_ID.toString() }], 7);
    const after: number = Date.now();

    const select: RecordedStatement = statements[0]!;
    const sql: string = flatten(select.sql);

    expect(sql).toContain('FROM "NetworkDeviceDiagnostic"');
    expect(sql).toContain('"probeId" = $1');
    expect(select.params[0]).toBe(DEVICE_PROBE_ID.toString());

    expect(sql).toContain('"status" = $4');
    expect(select.params[3]).toBe(NetworkDeviceDiagnosticStatus.Pending);

    expect(sql).toContain('"createdAt" >= $3');
    const windowStart: Date = select.params[2] as Date;
    expect(windowStart).toBeInstanceOf(Date);
    const windowInMs: number =
      NETWORK_DEVICE_DIAGNOSTIC_CLAIM_WINDOW_IN_MINUTES * 60 * 1000;
    expect(windowStart.getTime()).toBeGreaterThanOrEqual(before - windowInMs);
    expect(windowStart.getTime()).toBeLessThanOrEqual(after - windowInMs);

    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('ORDER BY d."createdAt" ASC');
    expect(sql).toContain("LIMIT $2");
    expect(select.params[1]).toBe(7);
    expect(sql).toContain("FOR UPDATE OF d SKIP LOCKED");
  });

  test("marks the selected rows In Progress with a start time, in the same transaction", async () => {
    const { statements } = await claim([
      { _id: DIAGNOSTIC_ID.toString() },
      { _id: SECOND_DIAGNOSTIC_ID.toString() },
    ]);

    expect(statements).toHaveLength(2);
    const update: RecordedStatement = statements[1]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('UPDATE "NetworkDeviceDiagnostic"');
    expect(sql).toContain('"status" = $2');
    expect(update.params[1]).toBe(NetworkDeviceDiagnosticStatus.InProgress);
    expect(sql).toContain('"startedAt" = now()');
    expect(sql).toContain('"updatedAt" = now()');
    expect(sql).toContain('WHERE "_id" = ANY($1::uuid[])');
    expect(update.params[0]).toEqual([
      DIAGNOSTIC_ID.toString(),
      SECOND_DIAGNOSTIC_ID.toString(),
    ]);
  });

  test("hands the claimed ids back as ObjectIDs, in claim order", async () => {
    const { ids } = await claim([
      { _id: DIAGNOSTIC_ID.toString() },
      { _id: SECOND_DIAGNOSTIC_ID.toString() },
    ]);

    expect(ids).toHaveLength(2);
    expect(ids[0]).toBeInstanceOf(ObjectID);
    expect(ids[0]!.toString()).toBe(DIAGNOSTIC_ID.toString());
    expect(ids[1]!.toString()).toBe(SECOND_DIAGNOSTIC_ID.toString());
  });

  test("issues no UPDATE and returns nothing when there is nothing to claim", async () => {
    const { ids, statements } = await claim([]);

    expect(ids).toEqual([]);
    expect(statements).toHaveLength(1);
  });

  // Status strings are bound, never interpolated: the same words everywhere.
  test("binds the status words rather than spelling them into the SQL", async () => {
    const { statements } = await claim([{ _id: DIAGNOSTIC_ID.toString() }]);

    for (const statement of statements) {
      expect(statement.sql).not.toContain("'Pending'");
      expect(statement.sql).not.toContain("'In Progress'");
    }
  });
});

describe("recordReport", () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  const pingResult: NetworkDeviceDiagnosticPingResult = {
    isOnline: true,
    failureCause: "",
    pingResponse: {
      packetsSent: 5,
      packetsReceived: 5,
      packetLossPercent: 0,
      avgRoundTripTimeInMs: 12.4,
    },
  };

  const traceRouteResult: NetworkPathTrace = {
    timestamp: new Date("2026-09-15T10:00:00Z"),
    traceRoute: {
      hops: [],
      destinationAddress: "10.0.0.1",
      destinationHostName: undefined,
      isComplete: true,
      totalHops: 0,
      failedHop: undefined,
      failureMessage: undefined,
    },
  };

  function completedPing(): NetworkDeviceDiagnosticReport {
    return {
      networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
      status: NetworkDeviceDiagnosticStatus.Completed,
      pingResult,
    };
  }

  async function record(
    report: NetworkDeviceDiagnosticReport,
    updateResult: unknown,
  ): Promise<{ updated: boolean; statements: Array<RecordedStatement> }> {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, [
      updateResult,
    ]);

    const updated: boolean = await service.recordReport({
      probeId: DEVICE_PROBE_ID,
      report,
    });

    return { updated, statements };
  }

  test("writes one UPDATE keyed on the row AND the reporting probe, never over a Completed row", async () => {
    const { statements } = await record(completedPing(), [[{ _id: "x" }], 1]);

    expect(statements).toHaveLength(1);
    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('UPDATE "NetworkDeviceDiagnostic"');
    expect(sql).toContain('WHERE "_id" = $1');
    expect(update.params[0]).toBe(DIAGNOSTIC_ID.toString());
    expect(sql).toContain('"probeId" = $2');
    expect(update.params[1]).toBe(DEVICE_PROBE_ID.toString());
    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"status" <> $7');
    expect(update.params[6]).toBe(NetworkDeviceDiagnosticStatus.Completed);
    expect(sql).toContain('"completedAt" = now()');
    expect(sql).toContain('"updatedAt" = now()');
  });

  test("stores a ping result as jsonb and leaves the traceroute column NULL", async () => {
    const { statements } = await record(completedPing(), [[{ _id: "x" }], 1]);
    const update: RecordedStatement = statements[0]!;
    const sql: string = flatten(update.sql);

    expect(sql).toContain('"status" = $3');
    expect(update.params[2]).toBe(NetworkDeviceDiagnosticStatus.Completed);
    expect(sql).toContain('"statusMessage" = $4');
    expect(update.params[3]).toBeNull();
    expect(sql).toContain('"pingResult" = $5::jsonb');
    expect(update.params[4]).toBe(JSON.stringify(pingResult));
    expect(sql).toContain('"traceRouteResult" = $6::jsonb');
    expect(update.params[5]).toBeNull();
  });

  test("stores a traceroute result as jsonb and leaves the ping column NULL", async () => {
    const { statements } = await record(
      {
        networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
        status: NetworkDeviceDiagnosticStatus.Completed,
        traceRouteResult,
      },
      [[{ _id: "x" }], 1],
    );
    const update: RecordedStatement = statements[0]!;

    expect(update.params[4]).toBeNull();
    expect(update.params[5]).toBe(JSON.stringify(traceRouteResult));
  });

  test("stores a failure with its message and no result", async () => {
    const { statements } = await record(
      {
        networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: "Unsupported diagnostic type",
      },
      [[{ _id: "x" }], 1],
    );
    const update: RecordedStatement = statements[0]!;

    expect(update.params[2]).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(update.params[3]).toBe("Unsupported diagnostic type");
    expect(update.params[4]).toBeNull();
    expect(update.params[5]).toBeNull();
  });

  /*
   * The raw UPDATE skips DatabaseService.checkMaxLengthOfFields, so a probe
   * message longer than the varchar column would make Postgres reject the
   * statement and leave the row In Progress until retention deletes it.
   */
  test("truncates a status message to the column's length before binding it", async () => {
    const longMessage: string = "x".repeat(600);

    const { statements } = await record(
      {
        networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
        status: NetworkDeviceDiagnosticStatus.Failed,
        statusMessage: longMessage,
      },
      [[{ _id: "x" }], 1],
    );

    const bound: string = statements[0]!.params[3] as string;
    const columnLength: number | undefined = getMaxLengthFromTableColumnType(
      new NetworkDeviceDiagnostic().getTableColumnMetadata("statusMessage")
        .type,
    );

    expect(columnLength).toBe(ColumnLength.LongText);
    expect(bound).toHaveLength(500);
    expect(bound).toBe(longMessage.substring(0, ColumnLength.LongText));
  });

  /*
   * The driver hands back `[rows, rowCount]` for an UPDATE; a driver that
   * returns the bare rows must still be read right (the statement RETURNs
   * the id for exactly that reason), and anything else must read as "not
   * stored" — the ingest route turns false into an error the probe logs.
   */
  test.each([
    ["[rows, 1]", [[{ _id: "x" }], 1], true],
    ["[rows, 0]", [[], 0], false],
    ["bare rows", [{ _id: "x" }], true],
    ["bare empty rows", [], false],
    ["nothing", undefined, false],
  ])(
    "reads a driver result of %s as updated=%s",
    async (_label: string, driverResult: unknown, expected: boolean) => {
      const { updated } = await record(completedPing(), driverResult);

      expect(updated).toBe(expected);
    },
  );

  test.each([
    NetworkDeviceDiagnosticStatus.Pending,
    NetworkDeviceDiagnosticStatus.InProgress,
    "Done",
    "",
    undefined,
  ])(
    "refuses a report whose status is %s, without touching the database",
    async (status: string | undefined) => {
      const { service } = buildService();
      const statements: Array<RecordedStatement> = stubTransaction(service, []);

      await expect(
        service.recordReport({
          probeId: DEVICE_PROBE_ID,
          report: {
            networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
            status: status as string,
          },
        }),
      ).rejects.toThrow(BadDataException);

      expect(statements).toHaveLength(0);
    },
  );

  test("refuses a report that names no diagnostic", async () => {
    const { service } = buildService();
    const statements: Array<RecordedStatement> = stubTransaction(service, []);

    await expect(
      service.recordReport({
        probeId: DEVICE_PROBE_ID,
        report: {
          networkDeviceDiagnosticId: "",
          status: NetworkDeviceDiagnosticStatus.Completed,
        },
      }),
    ).rejects.toThrow(BadDataException);

    expect(statements).toHaveLength(0);
  });
});

describe("registration and retention", () => {
  /*
   * An unregistered service is inert: nothing boots it, nothing prunes it.
   * Asserted against the index's source rather than by importing it —
   * `Services/Index` loads every service, and in this repository that graph
   * reaches modules a unit test cannot type-check without the full runtime.
   */
  test("the service is registered in the Services index", () => {
    const indexSource: string = fs.readFileSync(
      path.join(__dirname, "../../../Server/Services/Index.ts"),
      "utf8",
    );

    expect(indexSource).toContain(
      'import NetworkDeviceDiagnosticService from "./NetworkDeviceDiagnosticService";',
    );
    expect(indexSource).toMatch(/^\s+NetworkDeviceDiagnosticService,$/m);
  });

  test("rows are hard-deleted two days after creation, like MonitorTest rows", () => {
    const { service } = buildService();

    expect(service.hardDeleteItemByColumnName).toBe("createdAt");
    expect(service.hardDeleteItemsOlderThanDays).toBe(2);
  });
});
