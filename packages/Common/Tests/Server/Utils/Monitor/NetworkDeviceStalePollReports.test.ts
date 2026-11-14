import Redis from "../../../../Server/Infrastructure/Redis";
import NetworkDeviceStalePollReports, {
  GONE_DEVICE_SPELL,
  NEVER_POLLED_SPELL,
  STALE_POLL_REPORT_TTL_SECONDS,
  StalePollReport,
} from "../../../../Server/Utils/Monitor/NetworkDeviceStalePollReports";
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
 * Which stale spells the stale poll check reported already: a stamp per
 * (monitor, device) naming the spell - where the device's polls stopped -
 * so a monitor is evaluated as unreachable once per spell, not every five
 * minutes until the polls come back. The next poll moves lastPolledAt, so
 * the stamp names a spell that is over, and nothing on the poll path writes
 * here. A fake Redis stands in for the real one.
 */

class FakeRedis {
  public values: Map<string, string> = new Map();
  public expiries: Map<string, number> = new Map();
  public mgetCalls: number = 0;

  public async mget(keys: Array<string>): Promise<Array<string | null>> {
    this.mgetCalls++;
    return keys.map((key: string): string | null => {
      return this.values.get(key) ?? null;
    });
  }

  public pipeline(): {
    set: (key: string, value: string, ex: string, ttl: number) => unknown;
    exec: () => Promise<Array<unknown>>;
  } {
    const writes: Array<() => void> = [];

    const pipeline: {
      set: (key: string, value: string, ex: string, ttl: number) => unknown;
      exec: () => Promise<Array<unknown>>;
    } = {
      set: (key: string, value: string, ex: string, ttl: number): unknown => {
        writes.push(() => {
          expect(ex).toBe("EX");
          this.values.set(key, value);
          this.expiries.set(key, ttl);
        });
        return pipeline;
      },
      exec: async (): Promise<Array<unknown>> => {
        writes.forEach((write: () => void) => {
          write();
        });
        return [];
      },
    };

    return pipeline;
  }
}

const MONITOR: ObjectID = ObjectID.generate();
const OTHER_MONITOR: ObjectID = ObjectID.generate();
const DEVICE: string = ObjectID.generate().toString();
const LAST_POLLED_AT: Date = new Date("2026-11-14T09:00:00.000Z");

let redis: FakeRedis;

beforeEach(() => {
  redis = new FakeRedis();
  jest.spyOn(Redis, "getClient").mockReturnValue(redis as never);
  jest.spyOn(Redis, "isConnected").mockReturnValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

function report(
  monitorId: ObjectID,
  lastPolledAt: Date | null | undefined,
): StalePollReport {
  return {
    monitorId: monitorId,
    deviceId: DEVICE,
    spell: NetworkDeviceStalePollReports.spellOf({ lastPolledAt }),
  };
}

describe("the spell a device is in", () => {
  test("is named by the poll its polls stopped after", () => {
    expect(
      NetworkDeviceStalePollReports.spellOf({ lastPolledAt: LAST_POLLED_AT }),
    ).toBe("2026-11-14T09:00:00.000Z");
  });

  test("a device never polled is in the 'never' spell", () => {
    expect(NetworkDeviceStalePollReports.spellOf({})).toBe(NEVER_POLLED_SPELL);
    expect(NetworkDeviceStalePollReports.spellOf({ lastPolledAt: null })).toBe(
      NEVER_POLLED_SPELL,
    );
  });

  test("a device that no longer exists is in the 'gone' spell", () => {
    expect(NetworkDeviceStalePollReports.spellOf(null)).toBe(GONE_DEVICE_SPELL);
  });

  test("a time read back as a string names the same spell", () => {
    expect(
      NetworkDeviceStalePollReports.spellOf({
        lastPolledAt: "2026-11-14T09:00:00.000Z" as unknown as Date,
      }),
    ).toBe("2026-11-14T09:00:00.000Z");
  });
});

describe("reports", () => {
  test("nothing is reported before a run reports it", async () => {
    expect(
      await NetworkDeviceStalePollReports.getReported([
        report(MONITOR, LAST_POLLED_AT),
      ]),
    ).toEqual(new Set());
  });

  test("a spell reported is reported, for that monitor only", async () => {
    await NetworkDeviceStalePollReports.markReported([
      report(MONITOR, LAST_POLLED_AT),
    ]);

    const reported: Set<string> =
      await NetworkDeviceStalePollReports.getReported([
        report(MONITOR, LAST_POLLED_AT),
        report(OTHER_MONITOR, LAST_POLLED_AT),
      ]);

    expect(reported).toEqual(
      new Set([NetworkDeviceStalePollReports.getKey(MONITOR, DEVICE)]),
    );
  });

  test("a poll ends the spell: the same monitor is not reported for the next one", async () => {
    await NetworkDeviceStalePollReports.markReported([
      report(MONITOR, LAST_POLLED_AT),
    ]);

    // A poll came at 09:20, then the polls stopped again.
    const nextSpell: StalePollReport = report(
      MONITOR,
      new Date("2026-11-14T09:20:00.000Z"),
    );

    expect(
      await NetworkDeviceStalePollReports.getReported([nextSpell]),
    ).toEqual(new Set());
  });

  test("a device never polled, then polled once and stopped, is two spells", async () => {
    await NetworkDeviceStalePollReports.markReported([report(MONITOR, null)]);

    expect(
      (await NetworkDeviceStalePollReports.getReported([report(MONITOR, null)]))
        .size,
    ).toBe(1);
    expect(
      (
        await NetworkDeviceStalePollReports.getReported([
          report(MONITOR, LAST_POLLED_AT),
        ])
      ).size,
    ).toBe(0);
  });

  test("stamps expire after STALE_POLL_REPORT_TTL_SECONDS", async () => {
    await NetworkDeviceStalePollReports.markReported([
      report(MONITOR, LAST_POLLED_AT),
    ]);

    expect(
      redis.expiries.get(NetworkDeviceStalePollReports.getKey(MONITOR, DEVICE)),
    ).toBe(STALE_POLL_REPORT_TTL_SECONDS);
    expect(STALE_POLL_REPORT_TTL_SECONDS).toBe(30 * 24 * 60 * 60);
  });

  test("a page of reports is one read", async () => {
    await NetworkDeviceStalePollReports.getReported(
      Array.from({ length: 500 }, () => {
        return report(ObjectID.generate(), LAST_POLLED_AT);
      }),
    );

    expect(redis.mgetCalls).toBe(1);
  });

  test("no reports asks Redis nothing", async () => {
    await NetworkDeviceStalePollReports.getReported([]);
    await NetworkDeviceStalePollReports.markReported([]);

    expect(redis.mgetCalls).toBe(0);
    expect(redis.values.size).toBe(0);
  });

  test("without Redis, it says so rather than reporting everything again", async () => {
    jest.spyOn(Redis, "isConnected").mockReturnValue(false);

    await expect(
      NetworkDeviceStalePollReports.getReported([
        report(MONITOR, LAST_POLLED_AT),
      ]),
    ).rejects.toThrow("Redis is not connected");
  });

  test("keys name the monitor and the device", () => {
    expect(NetworkDeviceStalePollReports.getKey(MONITOR, DEVICE)).toBe(
      `network-device-stale-poll-reported:${MONITOR.toString()}:${DEVICE}`,
    );
  });
});
