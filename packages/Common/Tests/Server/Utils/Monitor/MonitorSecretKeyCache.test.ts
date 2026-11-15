import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import MonitorSecretKeyCache, {
  MonitorOfSecretKey,
  MonitorSecretKeyKind,
} from "../../../../Server/Utils/Monitor/MonitorSecretKeyCache";
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
 * Which monitor a secret key belongs to, kept for a minute
 * (MonitorSecretKeyCache), so an agent reporting every 30 seconds - or a
 * sender calling its incoming request URL every few seconds - is not looked
 * up in Postgres every time.
 *
 * What matters: an entry answers only for its own key and kind, a secret key
 * never appears in Redis, entries expire, and a Redis that fails is a miss -
 * never an error, never another monitor.
 *
 * Redis is a map; it can be made to fail.
 */

jest.mock("../../../../Server/Utils/Logger");

let redis: Map<string, string>;
let redisFails: boolean;
let expiries: Array<number | undefined>;

const SECRET_KEY: string = ObjectID.generate().toString();
const OTHER_SECRET_KEY: string = ObjectID.generate().toString();

const monitor: MonitorOfSecretKey = {
  monitorId: ObjectID.generate(),
  projectId: ObjectID.generate(),
};

beforeEach(() => {
  redis = new Map<string, string>();
  redisFails = false;
  expiries = [];

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      return redis.get(`${namespace}-${key}`) ?? null;
    });

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number | undefined },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        expiries.push(options?.expiresInSeconds);
        redis.set(`${namespace}-${key}`, value);
      },
    );

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      redis.delete(`${namespace}-${key}`);
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function keep(
  secretKey: string = SECRET_KEY,
  kind: MonitorSecretKeyKind = MonitorSecretKeyKind.ServerMonitor,
): Promise<void> {
  await MonitorSecretKeyCache.setMonitor({
    kind: kind,
    secretKey: secretKey,
    monitor: monitor,
  });
}

async function lookUp(
  secretKey: string = SECRET_KEY,
  kind: MonitorSecretKeyKind = MonitorSecretKeyKind.ServerMonitor,
): Promise<MonitorOfSecretKey | null> {
  return await MonitorSecretKeyCache.getMonitor({
    kind: kind,
    secretKey: secretKey,
  });
}

describe("MonitorSecretKeyCache", () => {
  test("a key nothing was kept for is unknown", async () => {
    expect(await lookUp()).toBeNull();
  });

  test("a key kept answers with its monitor and the monitor's project", async () => {
    await keep();

    const found: MonitorOfSecretKey | null = await lookUp();

    expect(found?.monitorId.toString()).toBe(monitor.monitorId.toString());
    expect(found?.projectId.toString()).toBe(monitor.projectId.toString());
  });

  test("an entry answers only for its own key", async () => {
    await keep();

    expect(await lookUp(OTHER_SECRET_KEY)).toBeNull();
  });

  test("an entry answers only for its own kind of monitor", async () => {
    await keep(SECRET_KEY, MonitorSecretKeyKind.ServerMonitor);

    expect(
      await lookUp(SECRET_KEY, MonitorSecretKeyKind.IncomingRequest),
    ).toBeNull();
  });

  test("a key in another case, or with spaces round it, is the same key - as Postgres matches the uuid", async () => {
    await keep(SECRET_KEY.toUpperCase());

    expect(
      (await lookUp(`  ${SECRET_KEY.toLowerCase()} `))?.monitorId.toString(),
    ).toBe(monitor.monitorId.toString());
  });

  test("the secret key never appears in Redis, in a key name or a value", async () => {
    await keep();

    for (const [name, value] of Array.from(redis.entries())) {
      expect(name.toLowerCase()).not.toContain(SECRET_KEY.toLowerCase());
      expect(value.toLowerCase()).not.toContain(SECRET_KEY.toLowerCase());
    }

    expect(redis.size).toBe(1);
  });

  test("an entry is kept for a minute, no longer", async () => {
    await keep();

    expect(expiries).toEqual([60]);
    expect(MonitorSecretKeyCache.EXPIRES_IN_SECONDS).toBe(60);
  });

  test("a forgotten key is looked up again", async () => {
    await keep();
    await MonitorSecretKeyCache.forget({
      kind: MonitorSecretKeyKind.ServerMonitor,
      secretKey: SECRET_KEY,
    });

    expect(await lookUp()).toBeNull();
  });

  test("an empty key is never kept or found", async () => {
    await keep("  ");

    expect(redis.size).toBe(0);
    expect(await lookUp("")).toBeNull();
    expect(
      MonitorSecretKeyCache.getKey({
        kind: MonitorSecretKeyKind.IncomingRequest,
        secretKey: "",
      }),
    ).toBeNull();
  });

  test("a value Redis holds that is not a monitor and a project is unknown", async () => {
    await keep();

    for (const value of [
      "garbage",
      `${monitor.monitorId.toString()}:`,
      `:${monitor.projectId.toString()}`,
      `${monitor.monitorId.toString()}:not-a-uuid`,
    ]) {
      for (const name of Array.from(redis.keys())) {
        redis.set(name, value);
      }

      expect(await lookUp()).toBeNull();
    }
  });

  test("a Redis that fails is a miss and never throws", async () => {
    await keep();

    redisFails = true;

    await expect(lookUp()).resolves.toBeNull();
    await expect(keep(OTHER_SECRET_KEY)).resolves.toBeUndefined();
    await expect(
      MonitorSecretKeyCache.forget({
        kind: MonitorSecretKeyKind.ServerMonitor,
        secretKey: SECRET_KEY,
      }),
    ).resolves.toBeUndefined();
  });
});
