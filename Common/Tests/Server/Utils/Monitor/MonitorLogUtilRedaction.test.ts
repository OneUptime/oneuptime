/*
 * https://github.com/OneUptime/oneuptime/issues/3360
 *
 * MonitorLogUtil is the widest-reach persistence sink in the monitoring path:
 * every monitor type, every evaluation, straight into `MonitorLog.logBody` --
 * a column whose read ACL includes `Permission.Viewer`. Whatever
 * `saveMonitorLog` is handed is what a read-only API key can select back out.
 *
 * The unit-level behaviour of the redactor is pinned in
 * MonitorPayloadRedaction.test.ts. What THIS suite pins is the wiring: that
 * the row actually enqueued for ClickHouse is the redacted one, that the
 * caller's live `dataToProcess` is not collaterally damaged on the way, and
 * that the rest of the row (ids, timestamps, retention) is unchanged -- so the
 * fix cannot be quietly reverted by someone reinstating the raw
 * `JSON.parse(JSON.stringify(...))`.
 *
 * Flushing: the buffer drains on a 5s timer or at 10,000 rows, neither of
 * which a test should wait for. Rather than reach into a private, the suite
 * drives the flush through MonitorLogUtil's own PUBLIC contract -- the
 * GracefulShutdown handler it registers, which awaits `flushAndWait()`. The
 * mock below captures that callback so a test can invoke it directly.
 */

const mockShutdown: { callback: (() => Promise<void> | void) | null } = {
  callback: null,
};

jest.mock("../../../../Server/Utils/GracefulShutdown", () => {
  return {
    __esModule: true,
    default: {
      registerHandler: (
        _name: string,
        _priority: number,
        callback: () => Promise<void> | void,
      ): void => {
        mockShutdown.callback = callback;
      },
    },
    ShutdownPriority: {
      HttpServer: 10,
      Workers: 20,
      Buffers: 30,
      DataStores: 40,
      Telemetry: 50,
    },
  };
});

jest.mock("../../../../Server/Services/MonitorLogService", () => {
  return {
    __esModule: true,
    default: {
      insertJsonRows: jest.fn(() => {
        return Promise.resolve();
      }),
    },
  };
});

jest.mock("../../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: jest.fn(() => {
        return Promise.resolve({ monitorLogRetentionInDays: 7 });
      }),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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

import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorLogService from "../../../../Server/Services/MonitorLogService";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

const SECRET: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";

const MONITOR_ID: ObjectID = new ObjectID(
  "8f14e45f-ceea-467a-9575-1b0d0d3e7a9c",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "3c6e0b8a-9c15-4f8b-a1d2-7e5f4c3b2a19",
);

/*
 * Loosely typed on purpose: the module factory above returns an untyped
 * jest.fn(), and pinning a signature here only fights ts-jest without making
 * the assertions any stronger.
 */
const insertJsonRows: jest.Mock =
  MonitorLogService.insertJsonRows as unknown as jest.Mock;

type SaveAndFlushFunction = (
  dataToProcess: DataToProcess,
) => Promise<JSONObject>;

/*
 * Run one payload all the way through to the row handed to ClickHouse.
 *
 * `saveMonitorLog` is deliberately fire-and-forget (the monitor hot path must
 * not block on a retention lookup), so the promise chain has to be given a
 * turn of the event loop before the row exists in the buffer at all.
 */
const saveAndFlush: SaveAndFlushFunction = async (
  dataToProcess: DataToProcess,
): Promise<JSONObject> => {
  MonitorLogUtil.saveMonitorLog({
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
    dataToProcess: dataToProcess,
  });

  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  if (!mockShutdown.callback) {
    throw new Error(
      "MonitorLogUtil did not register its shutdown flush handler",
    );
  }

  await mockShutdown.callback();

  const calls: Array<Array<unknown>> = insertJsonRows.mock
    .calls as unknown as Array<Array<unknown>>;

  expect(calls.length).toBeGreaterThan(0);

  const rows: Array<JSONObject> = calls[
    calls.length - 1
  ]![0] as Array<JSONObject>;

  expect(rows).toHaveLength(1);

  return rows[0]!;
};

type ServerBeatFunction = () => JSONObject;

// The payload the Go agent sends, with the two fields MonitorResource stamps on.
const serverBeat: ServerBeatFunction = (): JSONObject => {
  return {
    secretKey: SECRET,
    hostname: "web-01.internal",
    monitorId: MONITOR_ID,
    projectId: PROJECT_ID,
    requestReceivedAt: new Date("2026-08-23T10:00:00.000Z"),
    onlyCheckRequestReceivedAt: false,
    basicInfrastructureMetrics: {
      cpuMetrics: { percentUsed: 12.5, cores: 8 },
      memoryMetrics: { total: 16_777_216, percentUsed: 75 },
    },
    processes: [{ pid: 42, name: "node", command: "node index.js" }],
  };
};

describe("MonitorLogUtil.saveMonitorLog", () => {
  beforeEach(() => {
    insertJsonRows.mockClear();
  });

  it("does not write the server-agent secret into logBody", async () => {
    const row: JSONObject = await saveAndFlush(
      serverBeat() as unknown as DataToProcess,
    );

    const logBody: JSONObject = row["logBody"] as JSONObject;

    expect(logBody["secretKey"]).toBe(REDACTED);
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("still writes everything the monitor is actually for", async () => {
    const row: JSONObject = await saveAndFlush(
      serverBeat() as unknown as DataToProcess,
    );

    const logBody: JSONObject = row["logBody"] as JSONObject;

    expect(logBody["hostname"]).toBe("web-01.internal");
    expect(logBody["onlyCheckRequestReceivedAt"]).toBe(false);
    expect(
      (logBody["basicInfrastructureMetrics"] as JSONObject)["cpuMetrics"],
    ).toEqual({ percentUsed: 12.5, cores: 8 });
    expect(logBody["processes"]).toEqual([
      { pid: 42, name: "node", command: "node index.js" },
    ]);
  });

  it("leaves the caller's live payload untouched", async () => {
    /*
     * saveMonitorLog returns immediately and MonitorResource keeps evaluating
     * criteria against the same object afterwards. Redacting in place would
     * change the monitor's verdict, not just its stored log -- so the clone,
     * not the original, must be what gets masked.
     */
    const live: JSONObject = serverBeat();

    await saveAndFlush(live as unknown as DataToProcess);

    expect(live["secretKey"]).toBe(SECRET);
    expect(live["hostname"]).toBe("web-01.internal");
  });

  it("keeps the rest of the row intact", async () => {
    /*
     * Redaction must not disturb the columns ClickHouse partitions, sorts and
     * expires on. A row that loses its retentionDate never gets TTL'd.
     */
    const row: JSONObject = await saveAndFlush(
      serverBeat() as unknown as DataToProcess,
    );

    expect(row["monitorId"]).toBe(MONITOR_ID.toString());
    expect(row["projectId"]).toBe(PROJECT_ID.toString());
    expect(typeof row["_id"]).toBe("string");
    expect(typeof row["time"]).toBe("string");
    expect(typeof row["createdAt"]).toBe("string");
    expect(typeof row["retentionDate"]).toBe("string");
  });

  it("masks caller-supplied auth headers on an incoming-request monitor", async () => {
    /*
     * The other half of the issue: an incoming-request monitor stores the
     * headers and body of whatever called it, so a caller's bearer token was
     * landing in Viewer-readable logBody as well.
     */
    const row: JSONObject = await saveAndFlush({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      incomingRequestReceivedAt: new Date("2026-08-23T10:00:00.000Z"),
      checkedAt: new Date("2026-08-23T10:00:01.000Z"),
      requestHeaders: {
        authorization: `Bearer ${SECRET}`,
        "content-type": "application/json",
      },
      requestBody: { status: "ok" },
    } as unknown as DataToProcess);

    const logBody: JSONObject = row["logBody"] as JSONObject;
    const headers: JSONObject = logBody["requestHeaders"] as JSONObject;

    expect(headers["authorization"]).toBe(REDACTED);
    expect(headers["content-type"]).toBe("application/json");
    expect((logBody["requestBody"] as JSONObject)["status"]).toBe("ok");
    expect(JSON.stringify(row)).not.toContain(SECRET);
  });

  it("writes nothing at all when required ids are missing", async () => {
    /*
     * Pins the existing guards, which the redaction change sits directly on
     * top of: a row with no monitorId cannot be scoped or TTL'd.
     */
    MonitorLogUtil.saveMonitorLog({
      monitorId: undefined as unknown as ObjectID,
      projectId: PROJECT_ID,
      dataToProcess: serverBeat() as unknown as DataToProcess,
    });

    MonitorLogUtil.saveMonitorLog({
      monitorId: MONITOR_ID,
      projectId: undefined as unknown as ObjectID,
      dataToProcess: serverBeat() as unknown as DataToProcess,
    });

    MonitorLogUtil.saveMonitorLog({
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
      dataToProcess: undefined as unknown as DataToProcess,
    });

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });

    if (mockShutdown.callback) {
      await mockShutdown.callback();
    }

    expect(insertJsonRows).not.toHaveBeenCalled();
  });
});
