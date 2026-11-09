import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Redis as RedisClient } from "ioredis";
import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetActiveMember,
  TelemetryIngestionBudgetCounterDecision,
  TelemetryIngestionBudgetCounterMode,
  TelemetryIngestionBudgetCounterOutcome,
  TelemetryIngestionBudgetCounterRequest,
  TelemetryIngestionBudgetCounterScope,
  TelemetryIngestionBudgetDayCounters,
  TelemetryIngestionBudgetNoticeKind,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import ObjectID from "../../../../Types/ObjectID";
import { TelemetryIngestionBudgetScope } from "../../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * The ingestion budget counters against a REAL Valkey: the one Lua script
 * that decides and charges every budgeted ingest request, the worker's
 * settlement of a compressed body, the notice claims, and the reads the
 * status API and the metrics sweep make.
 *
 * Nothing here is mocked between the counter and Redis, because the
 * properties that matter are Redis's: the script is atomic, so concurrent
 * requests - from any number of ingest pods - can never both take the last
 * bytes of a budget; keys expire; EVALSHA falls back to EVAL. "Pods" are
 * separate ioredis connections taking turns, which is what separate ingest
 * pods are to Redis.
 *
 * It needs Valkey or Redis: CI's test-setup.sh starts one on localhost:6310
 * and `npm test` exports its settings from config.env. Locally:
 *
 *   docker run -d --rm -p 16917:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16917 \
 *     npx jest Tests/Server/Utils/Telemetry/TelemetryIngestionBudgetCounterValkey.test.ts
 *
 * Every key it writes is under a random day id and random scope ids, and is
 * deleted afterwards; nothing else in the database is touched.
 */

jest.setTimeout(60_000);

const DAY_ID: string = `test-${ObjectID.generate().toString()}`;
const NOW: number = Date.parse("2026-11-09T12:00:00Z");
const TTL_SECONDS: number = 3600;

const pods: Array<RedisClient> = [];
let defaultClient: ClientType | null = null;
const writtenPatterns: Array<string> = [];

const newScope: (
  data: Partial<TelemetryIngestionBudgetCounterScope> & {
    scope?: TelemetryIngestionBudgetScope;
  },
) => TelemetryIngestionBudgetCounterScope = (
  data: Partial<TelemetryIngestionBudgetCounterScope> & {
    scope?: TelemetryIngestionBudgetScope;
  },
): TelemetryIngestionBudgetCounterScope => {
  const scopeId: string = data.scopeId || ObjectID.generate().toString();

  writtenPatterns.push(`*${scopeId}*`);

  return {
    scope: data.scope || TelemetryIngestionBudgetScope.Project,
    scopeId: scopeId,
    dailyBudgetBytes: data.dailyBudgetBytes ?? null,
    warningBytes: data.warningBytes ?? null,
    rateLimitBytesPerSecond: data.rateLimitBytesPerSecond ?? null,
  };
};

const request: (
  data: Partial<TelemetryIngestionBudgetCounterRequest> & {
    scopes: Array<TelemetryIngestionBudgetCounterScope>;
  },
) => TelemetryIngestionBudgetCounterRequest = (
  data: Partial<TelemetryIngestionBudgetCounterRequest> & {
    scopes: Array<TelemetryIngestionBudgetCounterScope>;
  },
): TelemetryIngestionBudgetCounterRequest => {
  return {
    projectId: data.projectId || data.scopes[0]!.scopeId,
    signalSlug: data.signalSlug || "logs",
    dayId: data.dayId || DAY_ID,
    dayTtlSeconds: data.dayTtlSeconds ?? TTL_SECONDS,
    bytes: data.bytes ?? 100,
    mode: data.mode || TelemetryIngestionBudgetCounterMode.Refuse,
    scopes: data.scopes,
    nowMs: data.nowMs ?? NOW,
  };
};

const consume: (
  data: Partial<TelemetryIngestionBudgetCounterRequest> & {
    scopes: Array<TelemetryIngestionBudgetCounterScope>;
  },
) => Promise<TelemetryIngestionBudgetCounterDecision> = (
  data: Partial<TelemetryIngestionBudgetCounterRequest> & {
    scopes: Array<TelemetryIngestionBudgetCounterScope>;
  },
): Promise<TelemetryIngestionBudgetCounterDecision> => {
  return TelemetryIngestionBudgetCounter.consume(request(data));
};

const readDay: (
  scope: TelemetryIngestionBudgetCounterScope,
  signalSlug?: string,
) => Promise<TelemetryIngestionBudgetDayCounters> = async (
  scope: TelemetryIngestionBudgetCounterScope,
  signalSlug: string = "logs",
): Promise<TelemetryIngestionBudgetDayCounters> => {
  const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
    await TelemetryIngestionBudgetCounter.readDayCounters([
      {
        dayId: DAY_ID,
        scope: scope.scope,
        scopeId: scope.scopeId,
        signalSlug: signalSlug,
      },
    ]);

  return counters![0]!;
};

const dayKey: (
  scope: TelemetryIngestionBudgetCounterScope,
  signalSlug?: string,
) => string = (
  scope: TelemetryIngestionBudgetCounterScope,
  signalSlug: string = "logs",
): string => {
  return TelemetryIngestionBudgetCounter.getDayKey({
    dayId: DAY_ID,
    scope: scope.scope,
    scopeId: scope.scopeId,
    signalSlug: signalSlug,
  });
};

beforeAll(async () => {
  await Redis.connect();
  defaultClient = Redis.getClient();

  for (let index: number = 0; index < 3; index++) {
    const pod: RedisClient = new RedisClient(Redis.getRedisOptions());
    await pod.connect();
    pods.push(pod);
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const client: ClientType | null = Redis.getClient();

  if (client) {
    for (const pattern of [
      ...writtenPatterns,
      `*${DAY_ID}*`,
    ]) {
      const keys: Array<string> = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(...keys);
      }
    }
  }

  for (const pod of pods) {
    await pod.quit();
  }

  await Redis.disconnect();
});

describe("the daily budget", () => {
  test("admits while the day's count is below the budget, and stores the request that crosses it", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 1000,
    });

    // 999 used: one byte below the budget, so the next request is admitted.
    expect(
      (await consume({ scopes: [scope], bytes: 999 })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);

    const crossing: TelemetryIngestionBudgetCounterDecision = await consume({
      scopes: [scope],
      bytes: 500,
    });

    expect(crossing.outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.Admitted,
    );
    expect((await readDay(scope)).usedBytes).toBe(1499);
  });

  test("refuses at exactly the budget and above it, counting what it refused and charging nothing", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 1000,
    });

    await consume({ scopes: [scope], bytes: 1000 });

    const atBudget: TelemetryIngestionBudgetCounterDecision = await consume({
      scopes: [scope],
      bytes: 10,
    });

    expect(atBudget.outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
    );
    expect(atBudget.scopeIndex).toBe(0);
    expect(atBudget.isFirstExhaustion).toBe(true);

    const again: TelemetryIngestionBudgetCounterDecision = await consume({
      scopes: [scope],
      bytes: 30,
    });

    expect(again.isFirstExhaustion).toBe(false);

    const counters: TelemetryIngestionBudgetDayCounters = await readDay(scope);

    expect(counters.usedBytes).toBe(1000);
    expect(counters.droppedBytes).toBe(40);
    expect(counters.droppedRequests).toBe(2);
    expect(counters.exhaustedAt?.getTime()).toBe(NOW);
  });

  test("never lets concurrent requests from several pods take more than the budget allows", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 50_000,
    });

    let turn: number = 0;

    jest.spyOn(Redis, "getClient").mockImplementation((): ClientType => {
      turn++;
      return pods[turn % pods.length]! as unknown as ClientType;
    });

    const decisions: Array<TelemetryIngestionBudgetCounterDecision> =
      await Promise.all(
        Array.from({ length: 200 }).map(() => {
          return consume({ scopes: [scope], bytes: 1000 });
        }),
      );

    const admitted: number = decisions.filter(
      (decision: TelemetryIngestionBudgetCounterDecision) => {
        return (
          decision.outcome === TelemetryIngestionBudgetCounterOutcome.Admitted
        );
      },
    ).length;
    const firstExhaustions: number = decisions.filter(
      (decision: TelemetryIngestionBudgetCounterDecision) => {
        return decision.isFirstExhaustion === true;
      },
    ).length;

    jest.restoreAllMocks();

    // The 51st sees 50,000 used: exactly fifty are stored, one is the first refusal.
    expect(admitted).toBe(50);
    expect(firstExhaustions).toBe(1);

    const counters: TelemetryIngestionBudgetDayCounters = await readDay(scope);

    expect(counters.usedBytes).toBe(50_000);
    expect(counters.droppedRequests).toBe(150);
    expect(counters.droppedBytes).toBe(150_000);
  });

  test("keeps signals and days apart", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 100,
    });

    await consume({ scopes: [scope], bytes: 100, signalSlug: "logs" });

    expect(
      (await consume({ scopes: [scope], bytes: 10, signalSlug: "traces" }))
        .outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);

    const tomorrow: string = `${DAY_ID}-tomorrow`;

    expect(
      (
        await consume({
          scopes: [scope],
          bytes: 10,
          signalSlug: "logs",
          dayId: tomorrow,
        })
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
  });

  test("marks the warning once, on the request that crosses it", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 1000,
      warningBytes: 800,
    });

    expect(
      (await consume({ scopes: [scope], bytes: 799 }))
        .warningCrossedScopeIndexes,
    ).toEqual([]);
    expect(
      (await consume({ scopes: [scope], bytes: 1 })).warningCrossedScopeIndexes,
    ).toEqual([0]);
    expect(
      (await consume({ scopes: [scope], bytes: 1 })).warningCrossedScopeIndexes,
    ).toEqual([]);
    expect((await readDay(scope)).warningCrossedAt?.getTime()).toBe(NOW);
  });

  test("expires a day's counters and lists the scope in the day's active set", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 1000,
    });
    const projectId: string = scope.scopeId;

    await consume({ scopes: [scope], bytes: 10, dayTtlSeconds: 7200 });

    const client: ClientType = Redis.getClient()!;
    const ttl: number = await client.ttl(dayKey(scope));

    expect(ttl).toBeGreaterThan(7000);
    expect(ttl).toBeLessThanOrEqual(7200);
    expect(
      await client.ttl(TelemetryIngestionBudgetCounter.getActiveSetKey(DAY_ID)),
    ).toBeGreaterThan(0);

    const members: Array<TelemetryIngestionBudgetActiveMember> | null =
      await TelemetryIngestionBudgetCounter.listActiveMembers(DAY_ID);

    expect(members).toContainEqual({
      projectId: projectId,
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: scope.scopeId,
      signalSlug: "logs",
    });

    // A later request does not slide the expiry forward.
    await consume({ scopes: [scope], bytes: 10, dayTtlSeconds: 999_999 });
    expect(await client.ttl(dayKey(scope))).toBeLessThanOrEqual(7200);
  });
});

describe("the per-second rate", () => {
  const MB: number = 1024 * 1024;

  test("admits a second's worth on a full bucket, then refuses with when to come back", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      rateLimitBytesPerSecond: MB,
    });

    // A second of the rate is the burst: two half-megabyte requests fit...
    expect(
      (await consume({ scopes: [scope], bytes: MB / 2 })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    expect(
      (await consume({ scopes: [scope], bytes: MB / 2 })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    expect(
      (await consume({ scopes: [scope], bytes: MB })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);

    // ...and with two seconds owed, the next one waits a second.
    const refused: TelemetryIngestionBudgetCounterDecision = await consume({
      scopes: [scope],
      bytes: 1,
    });

    expect(refused.outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.RateLimited,
    );
    expect(refused.retryAfterSeconds).toBe(1);
    expect((await readDay(scope)).throttledRequests).toBe(1);

    // Two seconds later the bucket has room again.
    expect(
      (await consume({ scopes: [scope], bytes: MB, nowMs: NOW + 2000 }))
        .outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
  });

  test("lets a batch bigger than a second through on a full bucket, and makes it pay by holding the next back", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      rateLimitBytesPerSecond: MB,
    });

    expect(
      (await consume({ scopes: [scope], bytes: 10 * MB })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);

    const refused: TelemetryIngestionBudgetCounterDecision = await consume({
      scopes: [scope],
      bytes: 1,
      nowMs: NOW + 1000,
    });

    expect(refused.outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.RateLimited);
    // Ten seconds owed, one already passed, one second of burst: eight to wait.
    expect(refused.retryAfterSeconds).toBe(8);

    expect(
      (await consume({ scopes: [scope], bytes: 1, nowMs: NOW + 9000 })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
  });

  test("charges no rate for a refused request, so being refused does not make the wait longer", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      rateLimitBytesPerSecond: MB,
    });

    await consume({ scopes: [scope], bytes: 3 * MB });

    for (let attempt: number = 0; attempt < 20; attempt++) {
      await consume({ scopes: [scope], bytes: MB, nowMs: NOW + 100 });
    }

    expect(
      (await consume({ scopes: [scope], bytes: MB, nowMs: NOW + 2000 }))
        .outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
  });

  test("expires the rate key once the bucket is full again", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      rateLimitBytesPerSecond: MB,
    });

    await consume({ scopes: [scope], bytes: MB, nowMs: Date.now() });

    const ttl: number = await Redis.getClient()!.pttl(
      TelemetryIngestionBudgetCounter.getRateKey({
        scope: scope.scope,
        scopeId: scope.scopeId,
        signalSlug: "logs",
      }),
    );

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(2100);
  });

  test("checks the daily budget before the rate: a used-up day is a 403, not a retry", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 100,
      rateLimitBytesPerSecond: 1,
    });

    await consume({ scopes: [scope], bytes: 100 });

    expect((await consume({ scopes: [scope], bytes: 1 })).outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
    );
  });
});

describe("a key's budget beside its project's", () => {
  test("refuses in the scope that is used up, and charges both while either has room", async () => {
    const project: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 10_000,
    });
    const key: TelemetryIngestionBudgetCounterScope = newScope({
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      dailyBudgetBytes: 300,
    });

    await consume({
      projectId: project.scopeId,
      scopes: [project, key],
      bytes: 300,
    });

    const refused: TelemetryIngestionBudgetCounterDecision = await consume({
      projectId: project.scopeId,
      scopes: [project, key],
      bytes: 50,
    });

    expect(refused.outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
    );
    expect(refused.scopeIndex).toBe(1);

    expect((await readDay(project)).usedBytes).toBe(300);
    expect((await readDay(project)).droppedBytes).toBe(0);
    expect((await readDay(key)).usedBytes).toBe(300);
    expect((await readDay(key)).droppedBytes).toBe(50);

    // Another key of the project still has the project's room.
    const other: TelemetryIngestionBudgetCounterScope = newScope({
      scope: TelemetryIngestionBudgetScope.IngestionKey,
    });

    expect(
      (
        await consume({
          projectId: project.scopeId,
          scopes: [project, other],
          bytes: 50,
        })
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    expect((await readDay(project)).usedBytes).toBe(350);
  });

  test("lists a key's scope under its project", async () => {
    const project: TelemetryIngestionBudgetCounterScope = newScope({});
    const key: TelemetryIngestionBudgetCounterScope = newScope({
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      dailyBudgetBytes: 1000,
    });

    await consume({
      projectId: project.scopeId,
      scopes: [project, key],
      bytes: 5,
      signalSlug: "metrics",
    });

    expect(
      await TelemetryIngestionBudgetCounter.listActiveMembers(DAY_ID),
    ).toContainEqual({
      projectId: project.scopeId,
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      scopeId: key.scopeId,
      signalSlug: "metrics",
    });
  });
});

describe("modes", () => {
  test("Drop checks the daily budget but neither checks nor charges the rate", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 10_000,
      rateLimitBytesPerSecond: 10,
    });

    for (let index: number = 0; index < 5; index++) {
      expect(
        (
          await consume({
            scopes: [scope],
            bytes: 1000,
            mode: TelemetryIngestionBudgetCounterMode.Drop,
          })
        ).outcome,
      ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    }

    // The rate was never charged: a sender that can retry still has a full bucket.
    expect(
      (await consume({ scopes: [scope], bytes: 10 })).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);

    await consume({
      scopes: [scope],
      bytes: 10_000,
      mode: TelemetryIngestionBudgetCounterMode.Drop,
    });

    expect(
      (
        await consume({
          scopes: [scope],
          bytes: 1,
          mode: TelemetryIngestionBudgetCounterMode.Drop,
        })
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted);
  });

  test("Check refuses like Refuse and counts nothing; Charge counts without checking", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 100,
    });

    expect(
      (
        await consume({
          scopes: [scope],
          bytes: 0,
          mode: TelemetryIngestionBudgetCounterMode.Check,
        })
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    expect((await readDay(scope)).usedBytes).toBe(0);

    await consume({
      scopes: [scope],
      bytes: 150,
      mode: TelemetryIngestionBudgetCounterMode.Charge,
    });
    expect((await readDay(scope)).usedBytes).toBe(150);

    // Charge counts even past the budget: a Check already admitted it.
    expect(
      (
        await consume({
          scopes: [scope],
          bytes: 50,
          mode: TelemetryIngestionBudgetCounterMode.Charge,
        })
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    expect(
      (
        await consume({
          scopes: [scope],
          bytes: 0,
          mode: TelemetryIngestionBudgetCounterMode.Check,
        })
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted);
    expect((await readDay(scope)).droppedRequests).toBe(1);
  });

  test("counts without limits when only a rate is set, so the day's usage is still known", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      rateLimitBytesPerSecond: 1024 * 1024,
    });

    await consume({ scopes: [scope], bytes: 123 });

    expect((await readDay(scope)).usedBytes).toBe(123);
  });
});

describe("settling a compressed body (reconcile)", () => {
  test("adds the difference to every scope's day, up or down", async () => {
    const project: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 10_000,
    });
    const key: TelemetryIngestionBudgetCounterScope = newScope({
      scope: TelemetryIngestionBudgetScope.IngestionKey,
      dailyBudgetBytes: 5000,
    });

    await consume({
      projectId: project.scopeId,
      scopes: [project, key],
      bytes: 100,
    });

    expect(
      await TelemetryIngestionBudgetCounter.reconcile({
        dayId: DAY_ID,
        signalSlug: "logs",
        scopes: [
          { scope: project.scope, scopeId: project.scopeId, warningBytes: null },
          { scope: key.scope, scopeId: key.scopeId, warningBytes: 1000 },
        ],
        deltaBytes: 900,
        nowMs: NOW,
      }),
    ).toBe(true);

    expect((await readDay(project)).usedBytes).toBe(1000);
    expect((await readDay(key)).usedBytes).toBe(1000);
    expect((await readDay(key)).warningCrossedAt?.getTime()).toBe(NOW);
    expect((await readDay(project)).warningCrossedAt).toBe(null);

    await TelemetryIngestionBudgetCounter.reconcile({
      dayId: DAY_ID,
      signalSlug: "logs",
      scopes: [
        { scope: project.scope, scopeId: project.scopeId, warningBytes: null },
      ],
      deltaBytes: -400,
      nowMs: NOW,
    });

    expect((await readDay(project)).usedBytes).toBe(600);
  });

  test("never recreates a day that has expired, so a late settlement leaves no key without an expiry", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({});

    await TelemetryIngestionBudgetCounter.reconcile({
      dayId: DAY_ID,
      signalSlug: "logs",
      scopes: [{ scope: scope.scope, scopeId: scope.scopeId, warningBytes: 1 }],
      deltaBytes: 500,
      nowMs: NOW,
    });

    expect(await Redis.getClient()!.exists(dayKey(scope))).toBe(0);
  });

  test("makes a used-up budget refuse once settled past it", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 1000,
    });

    // A deflate body counted at its compressed 100 bytes...
    await consume({ scopes: [scope], bytes: 100 });

    // ...that was 1,500 bytes once inflated.
    await TelemetryIngestionBudgetCounter.reconcile({
      dayId: DAY_ID,
      signalSlug: "logs",
      scopes: [{ scope: scope.scope, scopeId: scope.scopeId, warningBytes: null }],
      deltaBytes: 1400,
      nowMs: NOW,
    });

    expect((await consume({ scopes: [scope], bytes: 1 })).outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.DailyBudgetExhausted,
    );
  });
});

describe("notices, reads and failures", () => {
  test("claims each day's notice once, on any server", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 10,
    });

    await consume({ scopes: [scope], bytes: 10 });

    const day: {
      dayId: string;
      scope: TelemetryIngestionBudgetScope;
      scopeId: string;
      signalSlug: string;
    } = {
      dayId: DAY_ID,
      scope: scope.scope,
      scopeId: scope.scopeId,
      signalSlug: "logs",
    };

    const claims: Array<boolean> = await Promise.all(
      Array.from({ length: 10 }).map(() => {
        return TelemetryIngestionBudgetCounter.claimNotice({
          day: day,
          kind: TelemetryIngestionBudgetNoticeKind.Exhausted,
          nowMs: NOW,
        });
      }),
    );

    expect(
      claims.filter((claimed: boolean) => {
        return claimed;
      }),
    ).toHaveLength(1);

    expect(
      await TelemetryIngestionBudgetCounter.claimNotice({
        day: day,
        kind: TelemetryIngestionBudgetNoticeKind.Warning,
        nowMs: NOW,
      }),
    ).toBe(true);

    expect((await readDay(scope)).exhaustedNoticeSentAt?.getTime()).toBe(NOW);
  });

  test("claims nothing for a day that does not exist", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({});

    expect(
      await TelemetryIngestionBudgetCounter.claimNotice({
        day: {
          dayId: DAY_ID,
          scope: scope.scope,
          scopeId: scope.scopeId,
          signalSlug: "logs",
        },
        kind: TelemetryIngestionBudgetNoticeKind.Warning,
        nowMs: NOW,
      }),
    ).toBe(false);
    expect(await Redis.getClient()!.exists(dayKey(scope))).toBe(0);
  });

  test("reads many days positionally, a missing one as zeros", async () => {
    const used: TelemetryIngestionBudgetCounterScope = newScope({});
    const unused: TelemetryIngestionBudgetCounterScope = newScope({});

    await consume({ scopes: [used], bytes: 42 });

    const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
      await TelemetryIngestionBudgetCounter.readDayCounters([
        {
          dayId: DAY_ID,
          scope: unused.scope,
          scopeId: unused.scopeId,
          signalSlug: "logs",
        },
        {
          dayId: DAY_ID,
          scope: used.scope,
          scopeId: used.scopeId,
          signalSlug: "logs",
        },
      ]);

    expect(counters![0]!.usedBytes).toBe(0);
    expect(counters![0]!.exhaustedAt).toBe(null);
    expect(counters![1]!.usedBytes).toBe(42);
  });

  test("falls back to EVAL when the server has not seen the script", async () => {
    await Redis.getClient()!.script("FLUSH");

    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 100,
    });

    expect((await consume({ scopes: [scope], bytes: 1 })).outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.Admitted,
    );
    expect((await readDay(scope)).usedBytes).toBe(1);
  });

  test("answers CounterUnavailable, never throwing, without a client, disconnected, or when the script fails", async () => {
    const scope: TelemetryIngestionBudgetCounterScope = newScope({
      dailyBudgetBytes: 100,
    });

    jest.spyOn(Redis, "getClient").mockReturnValue(null);
    expect((await consume({ scopes: [scope] })).outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.CounterUnavailable,
    );
    expect(await TelemetryIngestionBudgetCounter.readDayCounters([
      { dayId: DAY_ID, scope: scope.scope, scopeId: scope.scopeId, signalSlug: "logs" },
    ])).toBe(null);
    expect(await TelemetryIngestionBudgetCounter.listActiveMembers(DAY_ID)).toBe(
      null,
    );
    jest.restoreAllMocks();

    jest.spyOn(Redis, "isConnected").mockReturnValue(false);
    expect((await consume({ scopes: [scope] })).outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.CounterUnavailable,
    );
    jest.restoreAllMocks();

    const failing: Record<string, unknown> = {
      evalsha: async (): Promise<never> => {
        throw new Error("READONLY You can't write against a read only replica.");
      },
    };

    jest
      .spyOn(Redis, "getClient")
      .mockReturnValue(failing as unknown as ClientType);
    expect((await consume({ scopes: [scope] })).outcome).toBe(
      TelemetryIngestionBudgetCounterOutcome.CounterUnavailable,
    );
    jest.restoreAllMocks();

    // Nothing was counted while it was unavailable.
    expect((await readDay(scope)).usedBytes).toBe(0);
  });

  test("admits a request with no scopes without touching Redis", async () => {
    jest.spyOn(Redis, "getClient").mockReturnValue(null);

    expect(
      (
        await TelemetryIngestionBudgetCounter.consume(
          request({ scopes: [], projectId: "x" }),
        )
      ).outcome,
    ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
  });

  test("parses the active set's members, and skips anything else", () => {
    expect(
      TelemetryIngestionBudgetCounter.parseActiveMember("p|project|p|logs"),
    ).toEqual({
      projectId: "p",
      scope: TelemetryIngestionBudgetScope.Project,
      scopeId: "p",
      signalSlug: "logs",
    });
    expect(
      TelemetryIngestionBudgetCounter.parseActiveMember("p|team|t|logs"),
    ).toBe(null);
    expect(TelemetryIngestionBudgetCounter.parseActiveMember("p|project|p")).toBe(
      null,
    );
    expect(
      TelemetryIngestionBudgetCounter.parseActiveMember("p||p|logs"),
    ).toBe(null);
  });

  test("keeps the active set and the day keys a reader can find", () => {
    expect(TelemetryIngestionBudgetCounter.getActiveSetKey("D")).toBe(
      "telemetry:budget:active:D",
    );
    expect(
      TelemetryIngestionBudgetCounter.getDayKey({
        dayId: "D",
        scope: TelemetryIngestionBudgetScope.IngestionKey,
        scopeId: "k",
        signalSlug: "traces",
      }),
    ).toBe("telemetry:budget:day:D:ingestion-key:k:traces");
    expect(
      TelemetryIngestionBudgetCounter.getRateKey({
        scope: TelemetryIngestionBudgetScope.Project,
        scopeId: "p",
        signalSlug: "logs",
      }),
    ).toBe("telemetry:budget:rate:project:p:logs");
  });
});
