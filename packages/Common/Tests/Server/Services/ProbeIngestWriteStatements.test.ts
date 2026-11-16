jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import PacketCapture from "../../../Models/DatabaseModels/PacketCapture";
import Probe from "../../../Models/DatabaseModels/Probe";
import { Service as MonitorTestServiceType } from "../../../Server/Services/MonitorTestService";
import { Service as NetworkDeviceDiagnosticServiceType } from "../../../Server/Services/NetworkDeviceDiagnosticService";
import {
  HEARTBEAT_TIMEOUT_MESSAGE,
  PICKUP_TIMEOUT_MESSAGE,
  Service as PacketCaptureServiceType,
  UPLOAD_TIMEOUT_MESSAGE,
} from "../../../Server/Services/PacketCaptureService";
import ProbeService from "../../../Server/Services/ProbeService";
import { NetworkDeviceDiagnosticStatus } from "../../../Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import ObjectID from "../../../Types/ObjectID";
import { PacketCaptureCapability } from "../../../Types/PacketCapture/PacketCaptureCapability";
import PacketCaptureEndReason from "../../../Types/PacketCapture/PacketCaptureEndReason";
import PacketCaptureStatus from "../../../Types/PacketCapture/PacketCaptureStatus";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import {
  CapturedStatement,
  expectPlaceholdersMatchParameters,
  normalizeSql,
} from "../TestingUtils/PastDueMonitoringClaimSql";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * WHAT A PROBE REPORTS IS WRITTEN IN ONE STATEMENT (OneUptime issue #8870).
 *
 * A monitor test's step result, a device diagnostic's report, and packet
 * capture's writes - the probe's capability, its heartbeat, its failure and
 * completion reports, Stop from the dashboard and the stale capture sweep -
 * are each an UPDATE whose own WHERE is the guard. Each ran inside a
 * transaction: a BEGIN and a COMMIT round trip on top of the statement, with
 * the connection held between them, for nothing that had to commit
 * together. The on-demand claims went the same way in #7392
 * (ProbeClaimStatements).
 *
 * Each write is captured at its service's getRepository().manager.query,
 * and executeTransaction is made to throw, so a write that opens a
 * transaction again fails here. Each is held to: how many statements it
 * sends, what they are, every placeholder bound, and the probe or project it
 * is keyed on bound where the statement says. The stale sweep is three
 * statements, each its own guard, in the order that says why a capture
 * failed. The retention sweep is the exception: a batch's captures and
 * their files are two statements that must commit together.
 *
 * The real Postgres suites count the round trips (statementsSentBy):
 * MonitorTestProbeResponsePostgres, OnDemandProbeJobClaimsPostgres and
 * PacketCaptureSqlPostgres.
 */

const PROBE_ID: ObjectID = new ObjectID("b5000000-0000-4000-8000-000000000008");
const PROJECT_ID: ObjectID = new ObjectID(
  "c6000000-0000-4000-8000-000000000009",
);
const TEST_ID: ObjectID = new ObjectID("d7000000-0000-4000-8000-00000000000a");
const DIAGNOSTIC_ID: ObjectID = new ObjectID(
  "e8000000-0000-4000-8000-00000000000b",
);
const CAPTURE_ID: ObjectID = new ObjectID(
  "f9000000-0000-4000-8000-00000000000c",
);

const ONE_ROW_WRITTEN: unknown = [[{ _id: "x", stopRequestedAt: null }], 1];

interface ServiceConnection {
  getRepository: () => unknown;
  executeTransaction: () => Promise<unknown>;
}

/*
 * The service's own connection: every statement sent on it, each answered
 * `answer`. A transaction is refused.
 */
function captureStatements(
  service: unknown,
  answer: unknown = ONE_ROW_WRITTEN,
): Array<CapturedStatement> {
  const statements: Array<CapturedStatement> = [];

  jest
    .spyOn(service as ServiceConnection, "executeTransaction")
    .mockImplementation((async (): Promise<never> => {
      throw new Error(
        "A write that is one statement must not open a transaction.",
      );
    }) as never);

  jest.spyOn(service as ServiceConnection, "getRepository").mockReturnValue({
    manager: {
      query: async (
        sql: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        statements.push({ sql, parameters: parameters || [] });
        return answer;
      },
    },
  } as never);

  return statements;
}

// The value bound to the placeholder `pattern` captures, which must occur.
function boundTo(statement: CapturedStatement, pattern: RegExp): unknown {
  const match: RegExpMatchArray | null = normalizeSql(statement.sql).match(
    pattern,
  );

  expect(match).not.toBeNull();

  return statement.parameters[Number(match![1]) - 1];
}

function runningCapture(): PacketCapture {
  const capture: PacketCapture = new PacketCapture(CAPTURE_ID);
  capture.projectId = PROJECT_ID;
  capture.status = PacketCaptureStatus.Running;
  capture.interfaceName = "eth0";
  capture.maxFileSizeInMB = 1;
  capture.startedAt = new Date("2026-11-16T09:00:00Z");
  return capture;
}

const CAPABILITY: PacketCaptureCapability = {
  isEnabled: true,
  isToolAvailable: true,
  interfaces: [{ name: "eth0", addresses: ["10.0.0.2/24"] }],
  limits: {
    maxDurationInSeconds: 600,
    maxPackets: 1000000,
    maxFileSizeInMB: 10,
  },
};

interface ProbeIngestWrite {
  name: string;
  table: string;
  // The probe (or, for Stop, the project) the write is keyed on, and where.
  keyedOn: { column: string; value: string };
  // Runs the write: the statements it sent.
  run: () => Promise<Array<CapturedStatement>>;
}

const WRITES: Array<ProbeIngestWrite> = [
  {
    name: "monitor test step result",
    table: "MonitorTest",
    keyedOn: { column: "probeId", value: PROBE_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: MonitorTestServiceType = new MonitorTestServiceType();
      const statements: Array<CapturedStatement> = captureStatements(service);

      expect(
        await service.mergeStepProbeResponse({
          testId: TEST_ID,
          probeId: PROBE_ID,
          monitorStepProbeResponse: {
            step: { isOnline: true } as unknown as ProbeMonitorResponse,
          },
        }),
      ).toBe(true);

      return statements;
    },
  },
  {
    name: "device diagnostic report",
    table: "NetworkDeviceDiagnostic",
    keyedOn: { column: "probeId", value: PROBE_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: NetworkDeviceDiagnosticServiceType =
        new NetworkDeviceDiagnosticServiceType();
      const statements: Array<CapturedStatement> = captureStatements(service);

      expect(
        await service.recordReport({
          probeId: PROBE_ID,
          report: {
            networkDeviceDiagnosticId: DIAGNOSTIC_ID.toString(),
            status: NetworkDeviceDiagnosticStatus.Failed,
            statusMessage: "The device did not answer.",
          },
        }),
      ).toBe(true);

      return statements;
    },
  },
  {
    name: "packet capture capability report",
    table: "Probe",
    keyedOn: { column: "_id", value: PROBE_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: PacketCaptureServiceType = new PacketCaptureServiceType();
      const probe: Probe = new Probe(PROBE_ID);
      probe.projectId = PROJECT_ID;
      probe.isGlobalProbe = false;
      jest.spyOn(ProbeService, "findOneById").mockResolvedValue(probe as never);
      const statements: Array<CapturedStatement> = captureStatements(service);

      expect(
        await service.recordProbeCapability({
          probeId: PROBE_ID,
          capability: CAPABILITY,
        }),
      ).toBe(true);

      return statements;
    },
  },
  {
    name: "packet capture heartbeat",
    table: "PacketCapture",
    keyedOn: { column: "probeId", value: PROBE_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: PacketCaptureServiceType = new PacketCaptureServiceType();
      const statements: Array<CapturedStatement> = captureStatements(service, [
        [{ _id: CAPTURE_ID.toString(), stopRequestedAt: null }],
        1,
      ]);

      expect(
        await service.findCapturesToStop({
          probeId: PROBE_ID,
          runningPacketCaptureIds: [CAPTURE_ID.toString()],
        }),
      ).toEqual([]);

      return statements;
    },
  },
  {
    name: "packet capture failure report",
    table: "PacketCapture",
    keyedOn: { column: "probeId", value: PROBE_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: PacketCaptureServiceType = new PacketCaptureServiceType();
      const statements: Array<CapturedStatement> = captureStatements(service);

      expect(
        await service.recordFailure({
          probeId: PROBE_ID,
          packetCaptureId: CAPTURE_ID,
          statusMessage: "tcpdump could not open eth0.",
        }),
      ).toBe(true);

      return statements;
    },
  },
  {
    name: "packet capture completion report",
    table: "PacketCapture",
    keyedOn: { column: "probeId", value: PROBE_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: PacketCaptureServiceType = new PacketCaptureServiceType();
      // The read of the Running capture is DatabaseService's own.
      jest
        .spyOn(service, "findOneBy")
        .mockResolvedValue(runningCapture() as never);
      const statements: Array<CapturedStatement> = captureStatements(service);

      expect(
        await service.recordCompletion({
          probeId: PROBE_ID,
          packetCaptureId: CAPTURE_ID,
          pcap: null,
          endReason: PacketCaptureEndReason.DurationReached,
        }),
      ).toBe(true);

      return statements;
    },
  },
  {
    name: "Stop from the dashboard",
    table: "PacketCapture",
    keyedOn: { column: "projectId", value: PROJECT_ID.toString() },
    run: async (): Promise<Array<CapturedStatement>> => {
      const service: PacketCaptureServiceType = new PacketCaptureServiceType();
      jest
        .spyOn(service, "findOneBy")
        .mockResolvedValue(runningCapture() as never);
      const statements: Array<CapturedStatement> = captureStatements(service, [
        [{ _id: CAPTURE_ID.toString(), stopRequestedAt: new Date() }],
        1,
      ]);

      await service.requestStop({
        packetCaptureId: CAPTURE_ID,
        projectId: PROJECT_ID,
      });

      return statements;
    },
  },
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(WRITES)("the $name", (write: ProbeIngestWrite) => {
  test("is one UPDATE on the service's own connection, never in a transaction", async () => {
    const statements: Array<CapturedStatement> = await write.run();

    expect(statements).toHaveLength(1);

    const sql: string = normalizeSql(statements[0]!.sql);

    expect(sql.startsWith(`UPDATE "${write.table}" SET `)).toBe(true);
    expect(sql).not.toMatch(/\b(BEGIN|COMMIT|START TRANSACTION)\b/);
  });

  test("binds every placeholder it names, and is keyed on what it says", async () => {
    const statement: CapturedStatement = (await write.run())[0]!;

    expectPlaceholdersMatchParameters(statement);

    expect(
      boundTo(statement, new RegExp(`"${write.keyedOn.column}" = \\$(\\d+)`)),
    ).toBe(write.keyedOn.value);
  });
});

describe("the stale capture sweep", () => {
  async function sweep(): Promise<{
    failed: number;
    statements: Array<CapturedStatement>;
  }> {
    const service: PacketCaptureServiceType = new PacketCaptureServiceType();
    const statements: Array<CapturedStatement> = captureStatements(service, [
      [{ _id: "x" }],
      1,
    ]);

    return { failed: await service.failStaleCaptures(), statements };
  }

  test("is three UPDATEs on the service's own connection, each committing on its own", async () => {
    const { failed, statements } = await sweep();

    expect(statements).toHaveLength(3);
    // Each found one capture to fail.
    expect(failed).toBe(3);

    for (const statement of statements) {
      expect(
        normalizeSql(statement.sql).startsWith('UPDATE "PacketCapture" SET '),
      ).toBe(true);
      expectPlaceholdersMatchParameters(statement);
      // Every status it compares or writes is bound, never spelled out.
      expect(normalizeSql(statement.sql)).not.toMatch(/"status" = '/);
    }
  });

  test("runs in the order that says why: not picked up, then past its deadline, then not heard from", async () => {
    const { statements } = await sweep();

    expect(
      statements.map((statement: CapturedStatement): unknown => {
        return statement.parameters[1];
      }),
    ).toEqual([
      PICKUP_TIMEOUT_MESSAGE,
      UPLOAD_TIMEOUT_MESSAGE,
      HEARTBEAT_TIMEOUT_MESSAGE,
    ]);

    expect(normalizeSql(statements[0]!.sql)).toContain('"createdAt" < $4');
    expect(statements[0]!.parameters[2]).toBe(PacketCaptureStatus.Pending);
    expect(normalizeSql(statements[1]!.sql)).toContain(
      `"startedAt" + ("maxDurationInSeconds" * INTERVAL '1 second') < $4`,
    );
    expect(statements[1]!.parameters[2]).toBe(PacketCaptureStatus.Running);
    expect(normalizeSql(statements[2]!.sql)).toContain('"updatedAt" < $4');
    expect(statements[2]!.parameters[2]).toBe(PacketCaptureStatus.Running);
  });

  test("a statement that fails stops the sweep there, and is thrown for the job to log", async () => {
    const service: PacketCaptureServiceType = new PacketCaptureServiceType();
    const sent: Array<string> = [];

    jest.spyOn(service, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string): Promise<unknown> => {
          sent.push(sql);

          if (sent.length === 2) {
            throw new Error("canceling statement due to lock timeout");
          }

          return [[], 0];
        },
      },
    } as never);

    await expect(service.failStaleCaptures()).rejects.toThrow("lock timeout");
    expect(sent).toHaveLength(2);
  });
});

describe("the retention sweep", () => {
  test("stays a transaction a batch: a capture and its file commit together", async () => {
    const service: PacketCaptureServiceType = new PacketCaptureServiceType();
    const statements: Array<string> = [];
    const answers: Array<unknown> = [
      [[{ _id: CAPTURE_ID.toString(), fileId: TEST_ID.toString() }], 1],
      [],
    ];
    let transactions: number = 0;

    jest.spyOn(service, "executeTransaction").mockImplementation((async (
      run: (manager: unknown) => Promise<unknown>,
    ): Promise<unknown> => {
      transactions++;

      return await run({
        query: async (sql: string): Promise<unknown> => {
          statements.push(normalizeSql(sql));
          return answers.shift();
        },
      });
    }) as never);

    expect(await service.deleteExpiredCaptures()).toBe(1);

    expect(transactions).toBe(1);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('DELETE FROM "PacketCapture"');
    expect(statements[1]).toBe(
      'DELETE FROM "File" WHERE "_id" = ANY($1::uuid[])',
    );
  });
});
