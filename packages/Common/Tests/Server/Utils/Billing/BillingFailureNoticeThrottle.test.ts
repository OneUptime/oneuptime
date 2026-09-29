import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";

/*
 * The throttle is the only thing standing between a declined card and one
 * email per paging attempt, arriving during the outage the pages were
 * about - and, in the other direction, between a Redis blip and silently
 * never telling anyone that OneUptime can no longer page them at all.
 *
 * So the behaviour worth pinning is not "it calls Redis": it is which
 * notices collapse into one another (same project, same kind, same day),
 * which do not, that the window EXPIRES rather than latching, and that an
 * unreachable cache sends rather than suppresses.
 *
 * GlobalCache is mocked as a real in-memory SET NX with TTL so the
 * concurrency and expiry cases are exercised for real rather than asserted
 * through the mock's call log.
 */

interface StoredEntry {
  value: string;
  expiresAtMs: number;
}

interface SetIfNotExistsCall {
  namespace: string;
  key: string;
  value: string;
  expiresInSeconds: number | undefined;
}

const store: Map<string, StoredEntry> = new Map<string, StoredEntry>();
const setCalls: Array<SetIfNotExistsCall> = [];
const warnings: Array<string> = [];
let nowMs: number = 1_800_000_000_000;
let cacheError: Error | null = null;

async function fakeSetStringIfNotExists(
  namespace: string,
  key: string,
  value: string,
  options?: { expiresInSeconds?: number },
): Promise<boolean> {
  setCalls.push({
    namespace: namespace,
    key: key,
    value: value,
    expiresInSeconds: options?.expiresInSeconds,
  });

  if (cacheError) {
    throw cacheError;
  }

  const fullKey: string = `${namespace}-${key}`;
  const existing: StoredEntry | undefined = store.get(fullKey);

  if (existing && existing.expiresAtMs > nowMs) {
    return false;
  }

  store.set(fullKey, {
    value: value,
    expiresAtMs: nowMs + (options?.expiresInSeconds ?? 0) * 1000,
  });

  return true;
}

jest.mock("../../../../Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      setStringIfNotExists: (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds?: number },
      ): Promise<boolean> => {
        return fakeSetStringIfNotExists(namespace, key, value, options);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      warn: (message: unknown): void => {
        warnings.push(String(message));
      },
      error: (): void => {
        // Not asserted on.
      },
      info: (): void => {
        // Not asserted on.
      },
      debug: (): void => {
        // Not asserted on.
      },
    },
  };
});

import {
  BillingFailureNoticeKind,
  shouldSendBillingFailureNotice,
} from "../../../../Server/Utils/Billing/BillingFailureNoticeThrottle";

describe("shouldSendBillingFailureNotice", () => {
  beforeEach(() => {
    store.clear();
    setCalls.length = 0;
    warnings.length = 0;
    cacheError = null;
    nowMs = 1_800_000_000_000;
  });

  test("sends the first notice of the day", async () => {
    await expect(
      shouldSendBillingFailureNotice({
        projectId: new ObjectID("11111111-1111-1111-1111-111111111111"),
        kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
      }),
    ).resolves.toBe(true);
  });

  /*
   * The storm case: several paging attempts fail within seconds of each
   * other. Exactly one of them may mail the owners.
   */
  test("suppresses every later notice for the same project and kind", async () => {
    const projectId: ObjectID = new ObjectID(
      "11111111-1111-1111-1111-111111111111",
    );

    const results: Array<boolean> = [];

    for (let attempt: number = 0; attempt < 25; attempt++) {
      results.push(
        await shouldSendBillingFailureNotice({
          projectId: projectId,
          kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
        }),
      );
    }

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results[0]).toBe(true);
  });

  /*
   * Attempts do not arrive one at a time. A check-then-act would let every
   * concurrent caller read "no key" and all decide they were first, which
   * is the exact mail bomb this exists to prevent.
   */
  test("only one of many concurrent callers claims the window", async () => {
    const projectId: ObjectID = new ObjectID(
      "22222222-2222-2222-2222-222222222222",
    );

    const results: Array<boolean> = await Promise.all(
      Array.from({ length: 50 }, (): Promise<boolean> => {
        return shouldSendBillingFailureNotice({
          projectId: projectId,
          kind: BillingFailureNoticeKind.AiCreditRechargeFailed,
        });
      }),
    );

    expect(results.filter(Boolean)).toHaveLength(1);
  });

  test("keeps one project's notice from silencing another's", async () => {
    const kind: BillingFailureNoticeKind =
      BillingFailureNoticeKind.SmsAndCallRechargeFailed;

    await expect(
      shouldSendBillingFailureNotice({
        projectId: new ObjectID("33333333-3333-3333-3333-333333333333"),
        kind: kind,
      }),
    ).resolves.toBe(true);

    await expect(
      shouldSendBillingFailureNotice({
        projectId: new ObjectID("44444444-4444-4444-4444-444444444444"),
        kind: kind,
      }),
    ).resolves.toBe(true);
  });

  /*
   * "We cannot page for you" and "we cannot run AI for you" are different
   * problems with different fixes. One must not stand in for the other.
   */
  test("throttles each kind of failure separately", async () => {
    const projectId: ObjectID = new ObjectID(
      "55555555-5555-5555-5555-555555555555",
    );

    await expect(
      shouldSendBillingFailureNotice({
        projectId: projectId,
        kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
      }),
    ).resolves.toBe(true);

    await expect(
      shouldSendBillingFailureNotice({
        projectId: projectId,
        kind: BillingFailureNoticeKind.AiCreditRechargeFailed,
      }),
    ).resolves.toBe(true);

    await expect(
      shouldSendBillingFailureNotice({
        projectId: projectId,
        kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
      }),
    ).resolves.toBe(false);
  });

  /*
   * This is the whole point of a window rather than a latch. A project
   * whose recharge can never succeed - no card, or a card that keeps
   * declining - would otherwise be told once and then never again.
   */
  test("is a window that reopens, not a latch that never clears", async () => {
    const projectId: ObjectID = new ObjectID(
      "66666666-6666-6666-6666-666666666666",
    );
    const kind: BillingFailureNoticeKind =
      BillingFailureNoticeKind.SmsAndCallRechargeFailed;

    await expect(
      shouldSendBillingFailureNotice({ projectId, kind }),
    ).resolves.toBe(true);

    // Still inside the day.
    nowMs += OneUptimeDate.getSecondsInDays(1) * 1000 - 1000;
    await expect(
      shouldSendBillingFailureNotice({ projectId, kind }),
    ).resolves.toBe(false);

    // Past it.
    nowMs += 2000;
    await expect(
      shouldSendBillingFailureNotice({ projectId, kind }),
    ).resolves.toBe(true);
  });

  test("claims the window for exactly one day", async () => {
    await shouldSendBillingFailureNotice({
      projectId: new ObjectID("77777777-7777-7777-7777-777777777777"),
      kind: BillingFailureNoticeKind.AiCreditRechargeFailed,
    });

    expect(setCalls).toHaveLength(1);
    expect(setCalls[0]?.namespace).toBe("billing-failure-notice");
    expect(setCalls[0]?.key).toContain("77777777-7777-7777-7777-777777777777");
    expect(setCalls[0]?.expiresInSeconds).toBe(
      OneUptimeDate.getSecondsInDays(1),
    );
  });

  test("scopes the key by project and kind", async () => {
    await shouldSendBillingFailureNotice({
      projectId: new ObjectID("88888888-8888-8888-8888-888888888888"),
      kind: BillingFailureNoticeKind.AiCreditRechargeFailed,
    });

    expect(setCalls[0]?.key).toBe(
      "88888888-8888-8888-8888-888888888888-ai-credit-recharge-failed",
    );
  });

  /*
   * Fails OPEN. A suppressed "we cannot page anyone for you" is worse than
   * a duplicated one, so an unreachable cache must not become silence.
   */
  test("sends when the shared cache is unreachable", async () => {
    cacheError = new Error("Cache is not connected");

    await expect(
      shouldSendBillingFailureNotice({
        projectId: new ObjectID("99999999-9999-9999-9999-999999999999"),
        kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
      }),
    ).resolves.toBe(true);
  });

  test("keeps sending on every attempt while the cache stays down", async () => {
    cacheError = new Error("Cache is not connected");
    const projectId: ObjectID = new ObjectID(
      "99999999-9999-9999-9999-999999999999",
    );

    for (let attempt: number = 0; attempt < 3; attempt++) {
      await expect(
        shouldSendBillingFailureNotice({
          projectId: projectId,
          kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
        }),
      ).resolves.toBe(true);
    }
  });

  test("says in the log that the window is not being enforced", async () => {
    cacheError = new Error("Cache is not connected");

    await shouldSendBillingFailureNotice({
      projectId: new ObjectID("99999999-9999-9999-9999-999999999999"),
      kind: BillingFailureNoticeKind.SmsAndCallRechargeFailed,
    });

    expect(warnings[0]).toContain("99999999-9999-9999-9999-999999999999");
    expect(warnings[0]).toContain("sms-and-call-recharge-failed");
    expect(warnings[0]).toContain("not enforced");
  });

  test("resumes throttling once the cache comes back", async () => {
    const projectId: ObjectID = new ObjectID(
      "12121212-1212-1212-1212-121212121212",
    );
    const kind: BillingFailureNoticeKind =
      BillingFailureNoticeKind.SmsAndCallRechargeFailed;

    cacheError = new Error("Cache is not connected");
    await expect(
      shouldSendBillingFailureNotice({ projectId, kind }),
    ).resolves.toBe(true);

    cacheError = null;
    await expect(
      shouldSendBillingFailureNotice({ projectId, kind }),
    ).resolves.toBe(true);
    await expect(
      shouldSendBillingFailureNotice({ projectId, kind }),
    ).resolves.toBe(false);
  });
});

describe("BillingFailureNoticeKind", () => {
  /*
   * These values are baked into live Redis keys. Renaming one reopens
   * every window it was throttling, mid-incident.
   */
  test("keeps its persisted values", () => {
    expect(BillingFailureNoticeKind.SmsAndCallRechargeFailed).toBe(
      "sms-and-call-recharge-failed",
    );
    expect(BillingFailureNoticeKind.AiCreditRechargeFailed).toBe(
      "ai-credit-recharge-failed",
    );
  });
});
