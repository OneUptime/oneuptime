/**
 * CertificateOrderBudget - the Let's Encrypt allowance of the whole
 * installation, which every certificate order draws from.
 *
 * Every certificate is ordered from one Let's Encrypt account, which may
 * place 300 new orders per three hours, renewals included. The status page
 * and dashboard sweeps, Check now, the order APIs, reissues, the renewal
 * runs and CoreSSL each had caps of their own, and with backlogs those caps
 * added up to more than 400 orders in three hours. This pins the one budget
 * that bounds them together, and that renewals come first.
 */

import CertificateOrderBudget, {
  CertificateOrderReason,
} from "../../../../Server/Utils/Greenlock/CertificateOrderBudget";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import OneUptimeDate from "../../../../Types/Date";
import { InMemoryRedis, useInMemoryRedis } from "./InMemoryRedis";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

const NOW: Date = new Date("2026-10-03T12:07:00.000Z");

const WINDOW_IN_MS: number = OneUptimeDate.convertMinutesToMilliseconds(
  CertificateOrderBudget.WINDOW_IN_MINUTES,
);

async function take(
  reason: CertificateOrderReason,
  now: Date = NOW,
): Promise<boolean> {
  return await CertificateOrderBudget.takeSlot({ reason: reason, now: now });
}

describe("CertificateOrderBudget limits", () => {
  /*
   * Any three hours overlap at most 13 windows of 15 minutes - 12 whole
   * ones and parts of two more - so that many full windows must still fit
   * under Let's Encrypt's limit.
   */
  test("any three hours stay under Let's Encrypt's 300 new orders per account", () => {
    const threeHoursInMinutes: number = 3 * 60;

    const windowsInThreeHours: number =
      Math.ceil(threeHoursInMinutes / CertificateOrderBudget.WINDOW_IN_MINUTES) +
      1;

    expect(windowsInThreeHours * CertificateOrderBudget.ORDERS_PER_WINDOW).toBe(
      260,
    );
    expect(
      windowsInThreeHours * CertificateOrderBudget.ORDERS_PER_WINDOW,
    ).toBeLessThan(CertificateOrderBudget.LETS_ENCRYPT_ORDERS_PER_THREE_HOURS);
    expect(CertificateOrderBudget.LETS_ENCRYPT_ORDERS_PER_THREE_HOURS).toBe(
      300,
    );
  });

  test("renewals and the primary host may use the whole window, new certificates part of it", () => {
    expect(CertificateOrderBudget.getLimit(CertificateOrderReason.Renewal)).toBe(
      CertificateOrderBudget.ORDERS_PER_WINDOW,
    );
    expect(
      CertificateOrderBudget.getLimit(CertificateOrderReason.PrimaryHost),
    ).toBe(CertificateOrderBudget.ORDERS_PER_WINDOW);
    expect(
      CertificateOrderBudget.getLimit(CertificateOrderReason.FirstCertificate),
    ).toBe(CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW);
    expect(CertificateOrderBudget.getLimit(CertificateOrderReason.Reissue)).toBe(
      CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW,
    );
  });

  test("renewals always keep a share no flood of new certificates can take", () => {
    const keptForRenewals: number =
      CertificateOrderBudget.ORDERS_PER_WINDOW -
      CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW;

    expect(keptForRenewals).toBe(8);
    // More than 750 renewals a day, whatever new certificates are ordered.
    expect(keptForRenewals * 4 * 24).toBeGreaterThan(750);
  });

  test("a window is 15 minutes, the same on every replica", () => {
    const start: Date = new Date(
      Math.floor(NOW.getTime() / WINDOW_IN_MS) * WINDOW_IN_MS,
    );

    expect(CertificateOrderBudget.getWindowIndex(start)).toBe(
      CertificateOrderBudget.getWindowIndex(
        new Date(start.getTime() + WINDOW_IN_MS - 1),
      ),
    );
    expect(
      CertificateOrderBudget.getWindowIndex(
        new Date(start.getTime() + WINDOW_IN_MS),
      ),
    ).toBe(CertificateOrderBudget.getWindowIndex(start) + 1);
  });
});

describe("CertificateOrderBudget.takeSlot", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("new certificates get NEW_CERTIFICATE_ORDERS_PER_WINDOW in a window, and no more", async () => {
    useInMemoryRedis();

    const answers: Array<boolean> = [];

    for (
      let i: number = 0;
      i < CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW + 3;
      i++
    ) {
      answers.push(
        await take(
          i % 2 === 0
            ? CertificateOrderReason.FirstCertificate
            : CertificateOrderReason.Reissue,
        ),
      );
    }

    expect(
      answers.filter((answer: boolean) => {
        return answer;
      }),
    ).toHaveLength(CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW);
    expect(answers.slice(-3)).toEqual([false, false, false]);
  });

  /*
   * One counter holds both limits, and a refusal adds nothing to it: new
   * certificates refused at their share do not use up what the renewals
   * may still take.
   */
  test("refused new certificates leave the renewals their share", async () => {
    useInMemoryRedis();

    for (let i: number = 0; i < 50; i++) {
      await take(CertificateOrderReason.FirstCertificate);
    }

    const renewals: Array<boolean> = [];

    for (let i: number = 0; i < 20; i++) {
      renewals.push(await take(CertificateOrderReason.Renewal));
    }

    expect(
      renewals.filter((answer: boolean) => {
        return answer;
      }),
    ).toHaveLength(
      CertificateOrderBudget.ORDERS_PER_WINDOW -
        CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW,
    );
  });

  test("renewals that came first leave new certificates only what is under their share", async () => {
    useInMemoryRedis();

    for (let i: number = 0; i < 10; i++) {
      expect(await take(CertificateOrderReason.Renewal)).toBe(true);
    }

    expect(await take(CertificateOrderReason.FirstCertificate)).toBe(true);
    expect(await take(CertificateOrderReason.FirstCertificate)).toBe(true);
    expect(await take(CertificateOrderReason.FirstCertificate)).toBe(false);

    // The renewals and the primary host go on to the whole window.
    for (let i: number = 0; i < 8; i++) {
      expect(await take(CertificateOrderReason.PrimaryHost)).toBe(true);
    }

    expect(await take(CertificateOrderReason.Renewal)).toBe(false);
  });

  test("the next window has a whole budget again", async () => {
    useInMemoryRedis();

    for (let i: number = 0; i < 25; i++) {
      await take(CertificateOrderReason.Renewal);
    }

    expect(await take(CertificateOrderReason.Renewal)).toBe(false);
    expect(
      await take(
        CertificateOrderReason.Renewal,
        new Date(NOW.getTime() + WINDOW_IN_MS),
      ),
    ).toBe(true);
  });

  test("counts in one key per window, which expires after two windows", async () => {
    const calls: Array<{
      namespace: string;
      key: string;
      options: { limit: number; expiresInSeconds: number };
    }> = [];

    jest
      .spyOn(GlobalCache, "incrementIfBelow")
      .mockImplementation((async (
        namespace: string,
        key: string,
        options: { limit: number; expiresInSeconds: number },
      ) => {
        calls.push({ namespace, key, options });
        return 1;
      }) as never);

    await take(CertificateOrderReason.FirstCertificate);
    await take(CertificateOrderReason.Renewal);

    expect(calls).toEqual([
      {
        namespace: CertificateOrderBudget.NAMESPACE,
        key: `window-${CertificateOrderBudget.getWindowIndex(NOW)}`,
        options: {
          limit: CertificateOrderBudget.NEW_CERTIFICATE_ORDERS_PER_WINDOW,
          expiresInSeconds: CertificateOrderBudget.WINDOW_IN_MINUTES * 2 * 60,
        },
      },
      {
        namespace: CertificateOrderBudget.NAMESPACE,
        key: `window-${CertificateOrderBudget.getWindowIndex(NOW)}`,
        options: {
          limit: CertificateOrderBudget.ORDERS_PER_WINDOW,
          expiresInSeconds: CertificateOrderBudget.WINDOW_IN_MINUTES * 2 * 60,
        },
      },
    ]);
  });

  test("without Redis nothing is taken, so nothing is ordered", async () => {
    const redis: InMemoryRedis = useInMemoryRedis();
    redis.goDown();

    expect(await take(CertificateOrderReason.Renewal)).toBe(false);
    expect(await take(CertificateOrderReason.FirstCertificate)).toBe(false);
  });
});
