import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import MonitorProbeResultOrder from "../../../../Server/Utils/Monitor/MonitorProbeResultOrder";
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
 * The newest check result each probe sent for each monitor
 * (MonitorProbeResultOrder): what lets a result that waited for the
 * monitor's lock behind a newer one from the same probe be dropped instead
 * of judged after it.
 *
 * A result must never be dropped unless a newer one from the same probe, for
 * the same monitor, was really seen - so the cases here are the ones that
 * could get that wrong: another probe, another monitor, the same time, an
 * older one arriving late, ids in another case, and a Redis that fails.
 *
 * Redis is a map the "servers" share; it can be made to fail.
 */

jest.mock("../../../../Server/Utils/Logger");

let redis: Map<string, string>;
let redisFails: boolean;
let expiries: Array<number>;

const monitorId: ObjectID = ObjectID.generate();
const otherMonitorId: ObjectID = ObjectID.generate();
const probeId: ObjectID = ObjectID.generate();
const otherProbeId: ObjectID = ObjectID.generate();

const T0: Date = new Date("2026-11-14T10:00:00.000Z");

function later(seconds: number): Date {
  return new Date(T0.getTime() + seconds * 1000);
}

beforeEach(() => {
  redis = new Map<string, string>();
  redisFails = false;
  expiries = [];

  // What the Lua script does: keeps the greater number.
  jest
    .spyOn(GlobalCache, "setNumberIfGreater")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: number,
        options: { expiresInSeconds: number },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        expiries.push(options.expiresInSeconds);

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

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      return redis.get(`${namespace}-${key}`) ?? null;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function result(
  checkedAt: Date | string | undefined,
  values: { monitor?: ObjectID; probe?: ObjectID | undefined } = {},
): {
  monitorId: ObjectID;
  probeId: ObjectID | undefined;
  checkedAt: Date | string | undefined;
} {
  return {
    monitorId: values.monitor || monitorId,
    probeId: "probe" in values ? values.probe : probeId,
    checkedAt: checkedAt,
  };
}

describe("MonitorProbeResultOrder", () => {
  test("a result nothing newer was seen after is not superseded", async () => {
    await MonitorProbeResultOrder.record(result(T0));

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(false);
  });

  test("a result the same probe checked later supersedes it", async () => {
    await MonitorProbeResultOrder.record(result(T0));
    await MonitorProbeResultOrder.record(result(later(60)));

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(true);
    expect(await MonitorProbeResultOrder.isSuperseded(result(later(60)))).toBe(
      false,
    );
  });

  test("an older result that arrives late does not move the newest back", async () => {
    await MonitorProbeResultOrder.record(result(later(60)));
    // The older one's job started after the newer one's.
    await MonitorProbeResultOrder.record(result(T0));

    expect(await MonitorProbeResultOrder.isSuperseded(result(later(60)))).toBe(
      false,
    );
    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(true);
  });

  test("two results checked at the same moment never drop each other", async () => {
    await MonitorProbeResultOrder.record(result(T0));
    await MonitorProbeResultOrder.record(result(new Date(T0.getTime())));

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(false);
  });

  test("another probe's newer result for the monitor supersedes nothing of this probe's", async () => {
    await MonitorProbeResultOrder.record(result(T0));
    await MonitorProbeResultOrder.record(
      result(later(60), { probe: otherProbeId }),
    );

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(false);
  });

  test("the probe's newer result for another monitor supersedes nothing for this one", async () => {
    await MonitorProbeResultOrder.record(result(T0));
    await MonitorProbeResultOrder.record(
      result(later(60), { monitor: otherMonitorId }),
    );

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(false);
  });

  test("ids in another case are the same monitor and probe, as Postgres compares them", async () => {
    await MonitorProbeResultOrder.record(result(T0));
    await MonitorProbeResultOrder.record(
      result(later(60), {
        monitor: new ObjectID(monitorId.toString().toUpperCase()),
        probe: new ObjectID(probeId.toString().toUpperCase()),
      }),
    );

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(true);
  });

  test("a time sent as a string orders like the same time as a date", async () => {
    // What a result looks like after the queue serialized it.
    await MonitorProbeResultOrder.record(result(later(60).toISOString()));

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(true);
    expect(await MonitorProbeResultOrder.isSuperseded(result(later(60)))).toBe(
      false,
    );
  });

  test("a result that names no probe or no time is neither recorded nor ever superseded", async () => {
    await MonitorProbeResultOrder.record(result(T0, { probe: undefined }));
    await MonitorProbeResultOrder.record(result(undefined));
    await MonitorProbeResultOrder.record(result("not a time"));

    expect(redis.size).toBe(0);

    await MonitorProbeResultOrder.record(result(later(60)));

    expect(
      await MonitorProbeResultOrder.isSuperseded(
        result(T0, { probe: undefined }),
      ),
    ).toBe(false);
    expect(await MonitorProbeResultOrder.isSuperseded(result(undefined))).toBe(
      false,
    );
  });

  test("what is recorded expires, refreshed by every result", async () => {
    await MonitorProbeResultOrder.record(result(T0));
    await MonitorProbeResultOrder.record(result(later(60)));

    expect(expiries).toEqual([
      MonitorProbeResultOrder.EXPIRES_IN_SECONDS,
      MonitorProbeResultOrder.EXPIRES_IN_SECONDS,
    ]);
    // Longer than any backlog worth ordering.
    expect(MonitorProbeResultOrder.EXPIRES_IN_SECONDS).toBeGreaterThanOrEqual(
      30 * 60,
    );
  });

  test("a Redis that fails orders nothing and drops nothing, and never throws", async () => {
    await MonitorProbeResultOrder.record(result(later(60)));

    redisFails = true;

    await expect(
      MonitorProbeResultOrder.record(result(later(120))),
    ).resolves.toBeUndefined();
    await expect(
      MonitorProbeResultOrder.isSuperseded(result(T0)),
    ).resolves.toBe(false);
  });

  test("a value Redis holds that is not a time supersedes nothing", async () => {
    await MonitorProbeResultOrder.record(result(T0));

    for (const name of Array.from(redis.keys())) {
      redis.set(name, "garbage");
    }

    expect(await MonitorProbeResultOrder.isSuperseded(result(T0))).toBe(false);
  });
});
