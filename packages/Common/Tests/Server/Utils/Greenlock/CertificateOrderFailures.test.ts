/**
 * CertificateOrderFailures - the last failed certificate order of each name.
 *
 * An order that fails leaves nothing in the database, so a domain whose order
 * kept failing - a CAA record that leaves Let's Encrypt out, a server Let's
 * Encrypt cannot reach - showed "Issuing a free certificate" for days, and
 * the sweeps ordered it again every 15 minutes, each time against the account
 * the whole installation shares. This record is what the Status column shows,
 * and what makes the sweeps wait longer after each failure in a row.
 */

import CertificateOrderFailures, {
  CertificateOrderFailure,
} from "../../../../Server/Utils/Greenlock/CertificateOrderFailures";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OneUptimeDate from "../../../../Types/Date";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

const NOW: Date = new Date("2026-10-03T12:00:00.000Z");

function minutesAfter(date: Date, minutes: number): Date {
  return OneUptimeDate.addRemoveMinutes(date, minutes);
}

function failure(failures: number, failedAt: Date = NOW): CertificateOrderFailure {
  return { error: "Unable to order certificate", failedAt, failures };
}

describe("CertificateOrderFailures retry delay", () => {
  test("waits 15 minutes after one failure, doubling with each further one, up to 6 hours", () => {
    expect(
      [1, 2, 3, 4, 5, 6, 7, 8, 50, 1000].map((failures: number) => {
        return CertificateOrderFailures.getRetryDelayInMinutes(failures);
      }),
    ).toEqual([15, 30, 60, 120, 240, 360, 360, 360, 360, 360]);
  });

  test("an odd count is read as one failure", () => {
    expect(CertificateOrderFailures.getRetryDelayInMinutes(0)).toBe(15);
    expect(CertificateOrderFailures.getRetryDelayInMinutes(-3)).toBe(15);
    expect(CertificateOrderFailures.getRetryDelayInMinutes(NaN)).toBe(15);
  });

  /*
   * After the first failures the sweeps, every 15 minutes, order a name that
   * keeps failing a few times an hour, then four times a day - not 96.
   */
  test("a name that keeps failing is ordered a few times on the first day, then four times a day", () => {
    let at: Date = NOW;
    let failures: number = 0;
    const attempts: Array<Date> = [];
    const end: Date = minutesAfter(NOW, 3 * 24 * 60);

    // The sweeps run every 15 minutes; each attempt fails.
    for (let tick: Date = NOW; tick < end; tick = minutesAfter(tick, 15)) {
      const record: CertificateOrderFailure | undefined =
        failures > 0 ? failure(failures, at) : undefined;

      if (!CertificateOrderFailures.isWaitingToRetry(record, tick)) {
        attempts.push(tick);
        at = tick;
        failures++;
      }
    }

    const firstDay: number = attempts.filter((attempt: Date) => {
      return attempt < minutesAfter(NOW, 24 * 60);
    }).length;

    const thirdDay: number = attempts.filter((attempt: Date) => {
      return attempt >= minutesAfter(NOW, 2 * 24 * 60);
    }).length;

    expect(firstDay).toBeLessThanOrEqual(10);
    expect(thirdDay).toBe(4);
  });

  test("a name is waiting until its delay is up, minus a little grace for how long the order took", () => {
    const record: CertificateOrderFailure = failure(1);

    expect(CertificateOrderFailures.getRetryAt(record)).toEqual(
      minutesAfter(NOW, 15),
    );
    expect(
      CertificateOrderFailures.isWaitingToRetry(record, minutesAfter(NOW, 5)),
    ).toBe(true);
    // The sweep on the tick the delay ends on orders it.
    expect(
      CertificateOrderFailures.isWaitingToRetry(
        record,
        minutesAfter(NOW, 15 - CertificateOrderFailures.RETRY_GRACE_IN_MINUTES),
      ),
    ).toBe(false);
    expect(
      CertificateOrderFailures.isWaitingToRetry(record, minutesAfter(NOW, 15)),
    ).toBe(false);
    expect(CertificateOrderFailures.isWaitingToRetry(undefined, NOW)).toBe(
      false,
    );
  });
});

describe("CertificateOrderFailures records", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("records a failure by its normalized name, and counts failures in a row", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();

    await CertificateOrderFailures.record({
      domain: " Status.Acme.com",
      error: "Unable to order certificate for status.acme.com.",
      now: NOW,
    });

    expect(
      redis.cache.has(`${CertificateOrderFailures.NAMESPACE}-status.acme.com`),
    ).toBe(true);

    await CertificateOrderFailures.record({
      domain: "status.acme.com",
      error: "Still unable.",
      now: minutesAfter(NOW, 15),
    });

    const recorded: Map<string, CertificateOrderFailure> =
      await CertificateOrderFailures.get(["STATUS.acme.com"]);

    expect(recorded.get("status.acme.com")).toEqual({
      error: "Still unable.",
      failedAt: minutesAfter(NOW, 15),
      failures: 2,
    });
  });

  test("keeps a record for a week", async () => {
    const setString: Mock<(...args: Array<unknown>) => Promise<void>> =
      jest.fn(async (): Promise<void> => {});
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null as never);
    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(setString as never);

    await CertificateOrderFailures.record({
      domain: "status.acme.com",
      error: "Unable",
      now: NOW,
    });

    expect(setString.mock.calls[0]![3]).toEqual({
      expiresInSeconds: 7 * 24 * 60 * 60,
    });
  });

  test("an empty message is recorded as a plain one", async () => {
    useInMemoryRedis();

    await CertificateOrderFailures.record({
      domain: "status.acme.com",
      error: "  ",
      now: NOW,
    });

    expect(
      (await CertificateOrderFailures.get(["status.acme.com"])).get(
        "status.acme.com",
      )?.error,
    ).toBe("We could not order an SSL certificate for this domain.");
  });

  test("clear forgets a name's failures", async () => {
    useInMemoryRedis();

    await CertificateOrderFailures.record({
      domain: "status.acme.com",
      error: "Unable",
      now: NOW,
    });
    await CertificateOrderFailures.clear("Status.Acme.com");

    expect(
      (await CertificateOrderFailures.get(["status.acme.com"])).size,
    ).toBe(0);

    // The next failure starts a new run of failures.
    await CertificateOrderFailures.record({
      domain: "status.acme.com",
      error: "Unable",
      now: NOW,
    });

    expect(
      (await CertificateOrderFailures.get(["status.acme.com"])).get(
        "status.acme.com",
      )?.failures,
    ).toBe(1);
  });

  test("reads many names in round trips of a few hundred, and skips what it cannot read", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();

    const names: Array<string> = Array.from(
      { length: 1100 },
      (_value: unknown, index: number) => {
        return `domain${index}.acme.com`;
      },
    );

    await CertificateOrderFailures.record({
      domain: names[1050]!,
      error: "Unable",
      now: NOW,
    });

    redis.cache.set(
      `${CertificateOrderFailures.NAMESPACE}-${names[3]}`,
      "not json",
    );
    redis.cache.set(
      `${CertificateOrderFailures.NAMESPACE}-${names[4]}`,
      JSON.stringify({ error: 42, failedAt: "yesterday" }),
    );

    const getStrings: SpyInstance<typeof GlobalCache.getStrings> =
      jest.spyOn(GlobalCache, "getStrings");

    const recorded: Map<string, CertificateOrderFailure> =
      await CertificateOrderFailures.get([...names, names[0]!, ""]);

    expect([...recorded.keys()]).toEqual([names[1050]]);
    expect(getStrings).toHaveBeenCalledTimes(3);
  });

  test("never throws: without Redis nothing is recorded, cleared or read", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();
    redis.goDown();

    await expect(
      CertificateOrderFailures.record({
        domain: "status.acme.com",
        error: "Unable",
        now: NOW,
      }),
    ).resolves.toBeUndefined();
    await expect(
      CertificateOrderFailures.clear("status.acme.com"),
    ).resolves.toBeUndefined();
    expect((await CertificateOrderFailures.get(["status.acme.com"])).size).toBe(
      0,
    );
  });

  test("withoutThoseWaitingToRetry keeps what may be ordered now", async () => {
    useInMemoryRedis();

    await CertificateOrderFailures.record({
      domain: "failing.acme.com",
      error: "Unable",
      now: NOW,
    });
    await CertificateOrderFailures.record({
      domain: "failed-long-ago.acme.com",
      error: "Unable",
      now: minutesAfter(NOW, -60),
    });

    const items: Array<{ fullDomain: string }> = [
      { fullDomain: "new.acme.com" },
      { fullDomain: "Failing.Acme.com" },
      { fullDomain: "failed-long-ago.acme.com" },
    ];

    expect(
      await CertificateOrderFailures.withoutThoseWaitingToRetry({
        items: items,
        getDomain: (item: { fullDomain: string }): string => {
          return item.fullDomain;
        },
        now: minutesAfter(NOW, 5),
      }),
    ).toEqual([
      { fullDomain: "new.acme.com" },
      { fullDomain: "failed-long-ago.acme.com" },
    ]);
  });
});
