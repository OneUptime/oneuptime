/*
 * IncomingRequestReceivedAtStore: when OneUptime last RECEIVED a request on
 * an Incoming Request monitor's URL.
 *
 * Heartbeats are answered 2xx at the endpoint and evaluated later by a
 * Telemetry worker. The heartbeat cron used to judge "received in the last N
 * minutes" by the time a worker persisted the heartbeat, so a Telemetry
 * backlog longer than the window flipped every heartbeat monitor Offline at
 * once while every sender was still being answered 2xx (and coalescing
 * dropped most of the requests that arrived during the backlog outright).
 * The store records each arrival at the endpoint instead.
 *
 * GlobalCache.setNumberIfGreater is replaced by an in-memory model of its
 * contract (monotonic max, update-only when asked, the number held
 * afterwards), so these tests can replay whole sequences - arrivals during a
 * backlog, a flood of made-up keys - against the store's real logic. The
 * primitive's own call shape is pinned in GlobalCache.test.ts.
 */

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setNumberIfGreater: jest.fn(),
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

import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import logger from "../../../../Server/Utils/Logger";
import IncomingRequestReceivedAtStore from "../../../../Server/Utils/Monitor/IncomingRequestReceivedAtStore";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { createHash } from "crypto";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

const SECRET_KEY: string = "2d229271-17c4-4b4f-9a3b-3c6ff1a1a2ee";
const OTHER_SECRET_KEY: string = "8a7a6c4e-3f8b-4b8e-9f0a-1c2d3e4f5a6b";

const setNumberIfGreater: jest.Mock =
  GlobalCache.setNumberIfGreater as unknown as jest.Mock;
const loggerError: jest.Mock = logger.error as unknown as jest.Mock;

// The Redis keyspace, as the model of setNumberIfGreater sees it.
let redis: Map<string, number>;

type SetNumberIfGreaterOptions = {
  expiresInSeconds: number;
  onlyIfExists?: boolean | undefined;
};

function useInMemoryRedis(): void {
  redis = new Map<string, number>();

  setNumberIfGreater.mockImplementation(((
    namespace: string,
    key: string,
    value: number,
    options: SetNumberIfGreaterOptions,
  ): Promise<number | null> => {
    const fullKey: string = `${namespace}-${key}`;
    const stored: number | undefined = redis.get(fullKey);

    if (stored === undefined) {
      if (options.onlyIfExists) {
        return Promise.resolve(null);
      }

      redis.set(fullKey, value);
      return Promise.resolve(value);
    }

    if (value > stored) {
      redis.set(fullKey, value);
      return Promise.resolve(value);
    }

    return Promise.resolve(stored);
  }) as any);
}

function at(isoTime: string): Date {
  return new Date(isoTime);
}

function minutesAfter(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

function storedArrival(secretKey: string): Date | null {
  const value: number | undefined = redis.get(
    `${IncomingRequestReceivedAtStore.NAMESPACE}-${IncomingRequestReceivedAtStore.getKey(secretKey)}`,
  );

  return value === undefined ? null : new Date(value);
}

describe("IncomingRequestReceivedAtStore", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useInMemoryRedis();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("getKey", () => {
    test("hashes the secret key so it is never spelled out in a Redis key name", () => {
      const key: string | null =
        IncomingRequestReceivedAtStore.getKey(SECRET_KEY);

      expect(key).toBe(createHash("sha256").update(SECRET_KEY).digest("hex"));
      expect(key).not.toContain(SECRET_KEY);
      expect(key).toMatch(/^[0-9a-f]{64}$/);
    });

    /*
     * The uuid column matches case-insensitively, so a sender that writes
     * its key in upper case (or with stray whitespace) reaches the same
     * monitor - and must reach the same marker the cron reads.
     */
    test("ignores case and surrounding whitespace", () => {
      expect(
        IncomingRequestReceivedAtStore.getKey(` ${SECRET_KEY.toUpperCase()} `),
      ).toBe(IncomingRequestReceivedAtStore.getKey(SECRET_KEY));
    });

    test("an ObjectID (the cron's view of the key) maps to the same marker as the URL string", () => {
      expect(
        IncomingRequestReceivedAtStore.getKey(new ObjectID(SECRET_KEY)),
      ).toBe(IncomingRequestReceivedAtStore.getKey(SECRET_KEY));
    });

    test("different secret keys get different markers", () => {
      expect(IncomingRequestReceivedAtStore.getKey(SECRET_KEY)).not.toBe(
        IncomingRequestReceivedAtStore.getKey(OTHER_SECRET_KEY),
      );
    });

    test("no key for a missing or blank secret key", () => {
      expect(IncomingRequestReceivedAtStore.getKey(undefined)).toBeNull();
      expect(IncomingRequestReceivedAtStore.getKey(null)).toBeNull();
      expect(IncomingRequestReceivedAtStore.getKey("   ")).toBeNull();
    });
  });

  describe("advanceIfTracked (the ingest endpoint)", () => {
    test("advances a registered marker to the arrival time, update-only, with a one day expiry", async () => {
      const registeredAt: Date = at("2026-10-05T12:00:00.000Z");
      const arrival: Date = at("2026-10-05T12:01:00.000Z");

      await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: registeredAt,
      });

      setNumberIfGreater.mockClear();

      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: SECRET_KEY,
        receivedAt: arrival,
      });

      expect(setNumberIfGreater).toHaveBeenCalledTimes(1);
      expect(setNumberIfGreater).toHaveBeenCalledWith(
        IncomingRequestReceivedAtStore.NAMESPACE,
        IncomingRequestReceivedAtStore.getKey(SECRET_KEY),
        arrival.getTime(),
        {
          expiresInSeconds: OneUptimeDate.getSecondsInDays(1),
          onlyIfExists: true,
        },
      );
      expect(storedArrival(SECRET_KEY)).toEqual(arrival);
    });

    /*
     * Anyone can POST to any secret key. If the endpoint could create
     * markers, a flood of made-up keys would fill Redis; it can only advance
     * a marker that the worker (after resolving the key to a monitor) or the
     * cron (for a monitor it checks) created.
     */
    test("a flood of made-up secret keys creates no Redis keys", async () => {
      for (let i: number = 0; i < 500; i++) {
        await IncomingRequestReceivedAtStore.advanceIfTracked({
          secretKey: ObjectID.generate().toString(),
          receivedAt: at("2026-10-05T12:00:00.000Z"),
        });
      }

      expect(setNumberIfGreater).toHaveBeenCalledTimes(500);
      expect(redis.size).toBe(0);
    });

    test("never moves a marker backwards (requests can be handled out of order across pods)", async () => {
      const newer: Date = at("2026-10-05T12:05:00.000Z");

      await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: newer,
      });

      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:04:00.000Z"),
      });

      expect(storedArrival(SECRET_KEY)).toEqual(newer);
    });

    test("a Redis failure is swallowed and logged - the request must not fail", async () => {
      setNumberIfGreater.mockImplementation((() => {
        return Promise.reject(new Error("connection reset"));
      }) as any);

      await expect(
        IncomingRequestReceivedAtStore.advanceIfTracked({
          secretKey: SECRET_KEY,
          receivedAt: at("2026-10-05T12:00:00.000Z"),
        }),
      ).resolves.toBeUndefined();

      expect(loggerError).toHaveBeenCalled();
    });

    test("does nothing for a blank secret key or an unusable time", async () => {
      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: "",
        receivedAt: at("2026-10-05T12:00:00.000Z"),
      });

      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: SECRET_KEY,
        receivedAt: new Date("not a date"),
      });

      expect(setNumberIfGreater).not.toHaveBeenCalled();
    });
  });

  describe("track (the ingest worker and the heartbeat cron)", () => {
    test("registers a missing marker and returns the time it was given", async () => {
      const receivedAt: Date = at("2026-10-05T12:00:00.000Z");

      const latest: Date = await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: receivedAt,
      });

      expect(latest).toEqual(receivedAt);
      expect(storedArrival(SECRET_KEY)).toEqual(receivedAt);

      const options: SetNumberIfGreaterOptions = setNumberIfGreater.mock
        .calls[0]![3] as SetNumberIfGreaterOptions;

      expect(options.onlyIfExists).toBeFalsy();
      expect(options.expiresInSeconds).toBe(OneUptimeDate.getSecondsInDays(1));
    });

    test("returns a newer arrival the endpoint recorded", async () => {
      await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:00:00.000Z"),
      });

      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:09:30.000Z"),
      });

      const latest: Date = await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:00:00.000Z"),
      });

      expect(latest).toEqual(at("2026-10-05T12:09:30.000Z"));
    });

    test("never returns earlier than the time it was given, and advances the marker to it", async () => {
      await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:00:00.000Z"),
      });

      const latest: Date = await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:03:00.000Z"),
      });

      expect(latest).toEqual(at("2026-10-05T12:03:00.000Z"));
      expect(storedArrival(SECRET_KEY)).toEqual(at("2026-10-05T12:03:00.000Z"));
    });

    test("accepts the ISO string a JSON round trip turns the time into", async () => {
      const latest: Date = await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: "2026-10-05T12:00:00.000Z" as unknown as Date,
      });

      expect(latest).toBeInstanceOf(Date);
      expect(latest).toEqual(at("2026-10-05T12:00:00.000Z"));
    });

    test("falls back to the time it was given when Redis fails", async () => {
      setNumberIfGreater.mockImplementation((() => {
        return Promise.reject(new Error("connection reset"));
      }) as any);

      const receivedAt: Date = at("2026-10-05T12:00:00.000Z");

      await expect(
        IncomingRequestReceivedAtStore.track({
          secretKey: SECRET_KEY,
          receivedAt: receivedAt,
        }),
      ).resolves.toEqual(receivedAt);

      expect(loggerError).toHaveBeenCalled();
    });

    test("falls back to the time it was given when Redis answers nothing", async () => {
      setNumberIfGreater.mockImplementation((() => {
        return Promise.resolve(null);
      }) as any);

      const receivedAt: Date = at("2026-10-05T12:00:00.000Z");

      await expect(
        IncomingRequestReceivedAtStore.track({
          secretKey: SECRET_KEY,
          receivedAt: receivedAt,
        }),
      ).resolves.toEqual(receivedAt);
    });

    test("a monitor without a secret key never touches Redis", async () => {
      const receivedAt: Date = at("2026-10-05T12:00:00.000Z");

      await expect(
        IncomingRequestReceivedAtStore.track({
          secretKey: undefined,
          receivedAt: receivedAt,
        }),
      ).resolves.toEqual(receivedAt);

      expect(setNumberIfGreater).not.toHaveBeenCalled();
    });

    test("keeps each monitor's arrivals apart", async () => {
      await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:00:00.000Z"),
      });
      await IncomingRequestReceivedAtStore.track({
        secretKey: OTHER_SECRET_KEY,
        receivedAt: at("2026-10-05T12:00:00.000Z"),
      });

      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: SECRET_KEY,
        receivedAt: at("2026-10-05T12:10:00.000Z"),
      });

      await expect(
        IncomingRequestReceivedAtStore.track({
          secretKey: OTHER_SECRET_KEY,
          receivedAt: at("2026-10-05T12:00:00.000Z"),
        }),
      ).resolves.toEqual(at("2026-10-05T12:00:00.000Z"));
    });
  });

  describe("getReceivedAtAsOf", () => {
    const checkedAt: Date = at("2026-10-05T12:30:00.000Z");

    test("keeps a receipt that precedes the check", () => {
      const receivedAt: Date = at("2026-10-05T12:29:31.000Z");

      expect(
        IncomingRequestReceivedAtStore.getReceivedAtAsOf(receivedAt, checkedAt),
      ).toBe(receivedAt);
    });

    /*
     * The criteria measure the gap between receipt and check without its
     * sign, so a receipt stamped by a pod whose clock runs ahead would read
     * as a heartbeat that old.
     */
    test("passes a value it cannot read through untouched, as before the store existed", () => {
      const unreadable: Date = "garbled" as unknown as Date;

      expect(
        IncomingRequestReceivedAtStore.getReceivedAtAsOf(unreadable, checkedAt),
      ).toBe(unreadable);
    });

    test("clamps a receipt stamped after the check (clock skew) to the check", () => {
      expect(
        IncomingRequestReceivedAtStore.getReceivedAtAsOf(
          minutesAfter(checkedAt, 7),
          checkedAt,
        ),
      ).toBe(checkedAt);
    });
  });

  /*
   * The 2026-10-05 failure, replayed: the Telemetry queue fell ~11 minutes
   * behind. Two senders kept posting this monitor's heartbeat every minute
   * and every POST was answered 2xx, but no heartbeat was persisted for the
   * whole backlog - coalescing dropped the requests that arrived while the
   * monitor's previous job was still waiting. The cron then judged the last
   * PERSISTED heartbeat, 11 minutes old, against a 5 minute window.
   */
  describe("a Telemetry backlog longer than the heartbeat window", () => {
    const lastPersisted: Date = at("2026-10-05T12:11:16.000Z");

    beforeEach(async () => {
      // The cron registered the monitor on an earlier tick.
      await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: lastPersisted,
      });
    });

    test("the cron sees the arrivals the queue has not processed yet", async () => {
      // Every 30 seconds, for 11 minutes, a heartbeat arrives at the endpoint.
      for (let second: number = 30; second <= 660; second += 30) {
        await IncomingRequestReceivedAtStore.advanceIfTracked({
          secretKey: SECRET_KEY,
          receivedAt: new Date(lastPersisted.getTime() + second * 1000),
        });
      }

      const checkedAt: Date = minutesAfter(lastPersisted, 11.25);

      const latest: Date = await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        // What the cron loaded from Postgres: still the last persisted one.
        receivedAt: lastPersisted,
      });

      const receivedAt: Date = IncomingRequestReceivedAtStore.getReceivedAtAsOf(
        latest,
        checkedAt,
      );

      expect(receivedAt).toEqual(minutesAfter(lastPersisted, 11));
      expect(OneUptimeDate.getDifferenceInMinutes(receivedAt, checkedAt)).toBe(
        0,
      );
    });

    test("a sender that really stopped still goes stale", async () => {
      await IncomingRequestReceivedAtStore.advanceIfTracked({
        secretKey: SECRET_KEY,
        receivedAt: minutesAfter(lastPersisted, 0.5),
      });

      // Nothing else arrives. Twelve minutes later:
      const checkedAt: Date = minutesAfter(lastPersisted, 12);

      const latest: Date = await IncomingRequestReceivedAtStore.track({
        secretKey: SECRET_KEY,
        receivedAt: lastPersisted,
      });

      expect(
        OneUptimeDate.getDifferenceInMinutes(
          IncomingRequestReceivedAtStore.getReceivedAtAsOf(latest, checkedAt),
          checkedAt,
        ),
      ).toBeGreaterThan(5);
    });
  });
});
