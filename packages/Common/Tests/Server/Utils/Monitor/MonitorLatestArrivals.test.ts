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

import Monitor from "../../../../Models/DatabaseModels/Monitor";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import MonitorHeartbeatState from "../../../../Server/Utils/Monitor/MonitorHeartbeatState";
import MonitorLatestArrivals from "../../../../Server/Utils/Monitor/MonitorLatestArrivals";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE LATEST HEARTBEAT A READER OF A MONITOR SEES (issue #8123).
 *
 * Heartbeats write the Monitor row only every few minutes since #8119; the
 * latest arrival of every server report and incoming request is kept in
 * Redis. A monitor read through the API has that arrival put over the
 * row's, where it is newer, so its page shows a report or a request within
 * seconds - and the row's values when Redis cannot be reached. Redis is a
 * map here, read in one round trip per kind.
 */

const REPORTED_AT: Date = new Date("2026-11-16T12:00:00.000Z");
const WRITTEN_AT: Date = new Date("2026-11-16T11:58:30.000Z");

let redis: Map<string, string>;
let getStrings: jest.SpiedFunction<typeof GlobalCache.getStrings>;
let redisFails: boolean;

function monitor(n: number, values: Partial<Monitor> = {}): Monitor {
  const row: Monitor = new Monitor();
  row.id = new ObjectID(
    `dededede-0000-4000-8000-${String(n).padStart(12, "0")}`,
  );
  row._id = row.id.toString();
  Object.assign(row, values);
  return row;
}

beforeEach(() => {
  redis = new Map<string, string>();
  redisFails = false;

  getStrings = jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(async (namespace: string, keys: Array<string>) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      return keys.map((key: string): string | null => {
        return redis.get(`${namespace}-${key}`) ?? null;
      });
    });

  jest
    .spyOn(GlobalCache, "setNumberIfGreater")
    .mockImplementation(
      async (namespace: string, key: string, value: number) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        const name: string = `${namespace}-${key}`;
        const stored: number | undefined = redis.has(name)
          ? Number(redis.get(name))
          : undefined;

        if (stored === undefined || value > stored) {
          redis.set(name, String(value));
          return value;
        }

        return stored;
      },
    );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a server monitor's last report", () => {
  test("the report kept is put over the older one written", async () => {
    const row: Monitor = monitor(1, {
      serverMonitorRequestReceivedAt: WRITTEN_AT,
    });
    await MonitorHeartbeatState.recordServerReport({
      monitorId: row.id!,
      receivedAt: REPORTED_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      REPORTED_AT.getTime(),
    );
  });

  test("a row whose report is the newer keeps it", async () => {
    const row: Monitor = monitor(2, {
      serverMonitorRequestReceivedAt: REPORTED_AT,
    });
    await MonitorHeartbeatState.recordServerReport({
      monitorId: row.id!,
      receivedAt: WRITTEN_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      REPORTED_AT.getTime(),
    );
  });

  test("a row read with the column empty gets the report kept", async () => {
    const row: Monitor = monitor(3);
    (row as unknown as JSONObject)["serverMonitorRequestReceivedAt"] = null;
    await MonitorHeartbeatState.recordServerReport({
      monitorId: row.id!,
      receivedAt: REPORTED_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      REPORTED_AT.getTime(),
    );
  });

  test("a read that did not select the column is left as it was, and costs nothing", async () => {
    const row: Monitor = monitor(4);
    await MonitorHeartbeatState.recordServerReport({
      monitorId: row.id!,
      receivedAt: REPORTED_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt).toBeUndefined();
    expect(getStrings).not.toHaveBeenCalled();
  });

  test("a monitor with no report kept keeps the row's", async () => {
    const row: Monitor = monitor(5, {
      serverMonitorRequestReceivedAt: WRITTEN_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      WRITTEN_AT.getTime(),
    );
  });
});

describe("an incoming request monitor's last request", () => {
  test("the arrival kept is put over the request written, in the shape the row holds it", async () => {
    const asText: Monitor = monitor(11, {
      incomingMonitorRequest: {
        incomingRequestReceivedAt: WRITTEN_AT.toISOString(),
        requestMethod: "POST",
        requestBody: { status: "ok" },
      } as unknown as Monitor["incomingMonitorRequest"],
    });
    const asDate: Monitor = monitor(12, {
      incomingMonitorRequest: {
        incomingRequestReceivedAt: WRITTEN_AT,
      } as unknown as Monitor["incomingMonitorRequest"],
    });
    const asEnvelope: Monitor = monitor(13, {
      incomingMonitorRequest: {
        incomingRequestReceivedAt: {
          _type: "DateTime",
          value: WRITTEN_AT.toISOString(),
        },
      } as unknown as Monitor["incomingMonitorRequest"],
    });

    for (const row of [asText, asDate, asEnvelope]) {
      await MonitorHeartbeatState.recordIncomingRequest({
        monitorId: row.id!,
        receivedAt: REPORTED_AT,
      });
    }

    await MonitorLatestArrivals.putOverRows([asText, asDate, asEnvelope]);

    const receivedAt: (row: Monitor) => unknown = (row: Monitor): unknown => {
      return (row.incomingMonitorRequest as unknown as JSONObject)[
        "incomingRequestReceivedAt"
      ];
    };

    expect(receivedAt(asText)).toBe(REPORTED_AT.toISOString());
    expect(receivedAt(asDate)).toEqual(REPORTED_AT);
    expect(receivedAt(asEnvelope)).toEqual({
      _type: "DateTime",
      value: REPORTED_AT.toISOString(),
    });

    // What the request said is the row's, as written.
    expect(
      (asText.incomingMonitorRequest as unknown as JSONObject)["requestBody"],
    ).toEqual({ status: "ok" });
  });

  test("a request written after the one kept is left as it is", async () => {
    const row: Monitor = monitor(14, {
      incomingMonitorRequest: {
        incomingRequestReceivedAt: REPORTED_AT.toISOString(),
      } as unknown as Monitor["incomingMonitorRequest"],
    });
    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: row.id!,
      receivedAt: WRITTEN_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(
      (row.incomingMonitorRequest as unknown as JSONObject)[
        "incomingRequestReceivedAt"
      ],
    ).toBe(REPORTED_AT.toISOString());
  });

  test("a monitor with no request yet is left with none: only a request written can be updated", async () => {
    const row: Monitor = monitor(15);
    (row as unknown as JSONObject)["incomingMonitorRequest"] = null;
    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: row.id!,
      receivedAt: REPORTED_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.incomingMonitorRequest).toBeNull();
  });

  test("a server report's time is never put on a request, nor a request's on a report", async () => {
    const row: Monitor = monitor(16, {
      serverMonitorRequestReceivedAt: WRITTEN_AT,
      incomingMonitorRequest: {
        incomingRequestReceivedAt: WRITTEN_AT.toISOString(),
      } as unknown as Monitor["incomingMonitorRequest"],
    });
    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: row.id!,
      receivedAt: REPORTED_AT,
    });

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      WRITTEN_AT.getTime(),
    );
    expect(
      (row.incomingMonitorRequest as unknown as JSONObject)[
        "incomingRequestReceivedAt"
      ],
    ).toBe(REPORTED_AT.toISOString());
  });
});

describe("what it costs, and what it does without Redis", () => {
  test("one round trip per kind for a whole list", async () => {
    const rows: Array<Monitor> = [21, 22, 23].map((n: number): Monitor => {
      return monitor(n, {
        serverMonitorRequestReceivedAt: WRITTEN_AT,
        incomingMonitorRequest: {
          incomingRequestReceivedAt: WRITTEN_AT.toISOString(),
        } as unknown as Monitor["incomingMonitorRequest"],
      });
    });

    await MonitorLatestArrivals.putOverRows(rows);

    expect(getStrings).toHaveBeenCalledTimes(2);
    expect(getStrings.mock.calls[0]![1]).toHaveLength(3);
  });

  test("nothing to read, nothing read", async () => {
    await MonitorLatestArrivals.putOverRows([]);
    await MonitorLatestArrivals.putOverRows([monitor(31)]);

    expect(getStrings).not.toHaveBeenCalled();
  });

  test("Redis that cannot be reached leaves every row's values as they are, and throws nothing", async () => {
    const row: Monitor = monitor(41, {
      serverMonitorRequestReceivedAt: WRITTEN_AT,
      incomingMonitorRequest: {
        incomingRequestReceivedAt: WRITTEN_AT.toISOString(),
      } as unknown as Monitor["incomingMonitorRequest"],
    });
    redisFails = true;

    await expect(MonitorLatestArrivals.putOverRows([row])).resolves.toBe(
      undefined,
    );

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      WRITTEN_AT.getTime(),
    );
    expect(
      (row.incomingMonitorRequest as unknown as JSONObject)[
        "incomingRequestReceivedAt"
      ],
    ).toBe(WRITTEN_AT.toISOString());
  });

  test("an arrival kept as anything but a time is no arrival", async () => {
    const row: Monitor = monitor(42, {
      serverMonitorRequestReceivedAt: WRITTEN_AT,
    });
    redis.set(
      `${MonitorHeartbeatState.NAMESPACE}-server-report-${row.id!.toString()}`,
      "not a time",
    );

    await MonitorLatestArrivals.putOverRows([row]);

    expect(row.serverMonitorRequestReceivedAt?.getTime()).toBe(
      WRITTEN_AT.getTime(),
    );
  });
});

describe("MonitorHeartbeatState: incoming request arrivals by monitor", () => {
  test("the latest of all is kept, by the monitor's id whatever its case", async () => {
    const monitorId: ObjectID = new ObjectID(
      "DEDEDEDE-0000-4000-8000-000000000051",
    );

    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: monitorId,
      receivedAt: REPORTED_AT,
    });
    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: monitorId,
      receivedAt: WRITTEN_AT,
    });

    const arrivals: Map<string, Date> =
      await MonitorHeartbeatState.getLatestArrivals({
        kind: "incoming-request",
        monitorIds: [monitorId.toString().toLowerCase()],
      });

    expect(arrivals.get(monitorId.toString().toLowerCase())?.getTime()).toBe(
      REPORTED_AT.getTime(),
    );
  });

  test("nothing kept for an arrival that is not a time", async () => {
    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: new ObjectID("dededede-0000-4000-8000-000000000052"),
      receivedAt: undefined,
    });
    await MonitorHeartbeatState.recordIncomingRequest({
      monitorId: new ObjectID("dededede-0000-4000-8000-000000000052"),
      receivedAt: "not a time",
    });

    expect(redis.size).toBe(0);
  });

  test("a Redis that cannot be reached keeps nothing and throws nothing", async () => {
    redisFails = true;

    await expect(
      MonitorHeartbeatState.recordIncomingRequest({
        monitorId: new ObjectID("dededede-0000-4000-8000-000000000053"),
        receivedAt: REPORTED_AT,
      }),
    ).resolves.toBe(undefined);
    await expect(
      MonitorHeartbeatState.getLatestArrivals({
        kind: "server-report",
        monitorIds: [new ObjectID("dededede-0000-4000-8000-000000000053")],
      }),
    ).resolves.toEqual(new Map<string, Date>());
  });

  test("the same monitor asked twice is read once", async () => {
    await MonitorHeartbeatState.getLatestArrivals({
      kind: "server-report",
      monitorIds: [
        "dededede-0000-4000-8000-000000000054",
        "DEDEDEDE-0000-4000-8000-000000000054",
      ],
    });

    expect(getStrings.mock.calls[0]![1]).toHaveLength(1);
  });
});
