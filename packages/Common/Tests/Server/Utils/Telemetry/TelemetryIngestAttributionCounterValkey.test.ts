import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import Redis, { ClientType } from "../../../../Server/Infrastructure/Redis";
import TelemetryIngestAttributionCounter, {
  TELEMETRY_USAGE_COUNTER_TTL_SECONDS,
  TelemetryIngestAttributionScopeCharge,
  TelemetryIngestAttributionSettle,
  TelemetryUsageCounterEntry,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestAttributionCounter";
import TelemetryIngestionBudgetCounter, {
  TelemetryIngestionBudgetCounterMode,
  TelemetryIngestionBudgetCounterOutcome,
  TelemetryIngestionBudgetDayCounters,
} from "../../../../Server/Utils/Telemetry/TelemetryIngestionBudgetCounter";
import ObjectID from "../../../../Types/ObjectID";
import { TelemetryIngestionBudgetScope } from "../../../../Types/Telemetry/TelemetryIngestionBudget";

/*
 * The counters a telemetry batch is attributed to (issues #6355, #6386),
 * against a REAL Valkey: the one script that settles a batch - its team and
 * label budgets charged, what they dropped taken back off the project's and
 * the key's day, its usage added to the five-minute counters - and the
 * reads the status API, the budget sweep and the usage sweep make of them.
 *
 * It needs Valkey or Redis, as TelemetryIngestionBudgetCounterValkey does:
 *
 *   docker run -d --rm -p 16917:6379 valkey/valkey:9.1-alpine
 *   VALKEY_HOST=localhost VALKEY_PORT=16917 \
 *     npx jest Tests/Server/Utils/Telemetry/TelemetryIngestAttributionCounterValkey.test.ts
 *
 * Every key it writes is under a random day id, project and scope ids, and
 * a bucket far in the past, and is deleted afterwards.
 */

jest.setTimeout(60_000);

const DAY_ID: string = `test-${ObjectID.generate().toString()}`;
// A bucket no real batch writes: 1990.
const NOW: number = Date.parse("1990-06-01T12:02:00Z");
const BUCKET_ID: string =
  TelemetryIngestAttributionCounter.getUsageBucketId(NOW);
const written: Array<string> = [];

const newId: () => string = (): string => {
  const id: string = ObjectID.generate().toString();
  written.push(`*${id}*`);
  return id;
};

const teamCharge: (
  data: Partial<TelemetryIngestAttributionScopeCharge>,
) => TelemetryIngestAttributionScopeCharge = (
  data: Partial<TelemetryIngestAttributionScopeCharge>,
): TelemetryIngestAttributionScopeCharge => {
  return {
    scope: TelemetryIngestionBudgetScope.Team,
    scopeId: data.scopeId || newId(),
    admittedBytes: 0,
    droppedBytes: 0,
    droppedRequests: 0,
    dailyBudgetBytes: 1000,
    warningBytes: 800,
    ...data,
  };
};

const settle: (
  data: Partial<TelemetryIngestAttributionSettle> & { projectId: string },
) => Promise<Array<number> | null> = (
  data: Partial<TelemetryIngestAttributionSettle> & { projectId: string },
): Promise<Array<number> | null> => {
  return TelemetryIngestAttributionCounter.settle({
    signalSlug: "logs",
    dayId: DAY_ID,
    dayTtlSeconds: 3600,
    nowMs: NOW,
    scopes: [],
    refund: null,
    usage: [],
    ...data,
  });
};

const readDay: (
  scope: TelemetryIngestionBudgetScope,
  scopeId: string,
) => Promise<TelemetryIngestionBudgetDayCounters> = async (
  scope: TelemetryIngestionBudgetScope,
  scopeId: string,
): Promise<TelemetryIngestionBudgetDayCounters> => {
  const counters: Array<TelemetryIngestionBudgetDayCounters> | null =
    await TelemetryIngestionBudgetCounter.readDayCounters([
      { dayId: DAY_ID, scope: scope, scopeId: scopeId, signalSlug: "logs" },
    ]);

  return counters![0]!;
};

const usageField: (resourceId: string, name: string) => string = (
  resourceId: string,
  name: string,
): string => {
  return TelemetryIngestAttributionCounter.getUsageField({
    signalSlug: "logs",
    resourceType: "OpenTelemetry",
    resourceId: resourceId,
    resourceName: name,
  });
};

beforeAll(async () => {
  await Redis.connect();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  const client: ClientType | null = Redis.getClient();

  if (client) {
    for (const pattern of [
      ...written,
      `*${DAY_ID}*`,
      `telemetry:usage:*:${BUCKET_ID}*`,
    ]) {
      const keys: Array<string> = await client.keys(pattern);

      if (keys.length > 0) {
        await client.del(...keys);
      }
    }
  }

  await Redis.disconnect();
});

describe("a team's or a label's budget", () => {
  test("is charged in the budget counters' own day hash, and answered with what it used", async () => {
    const projectId: string = newId();
    const team: TelemetryIngestAttributionScopeCharge = teamCharge({
      admittedBytes: 600,
    });
    const label: TelemetryIngestAttributionScopeCharge = teamCharge({
      scope: TelemetryIngestionBudgetScope.Label,
      admittedBytes: 50,
    });

    expect(
      await settle({ projectId: projectId, scopes: [team, label] }),
    ).toEqual([600, 50]);
    expect(
      await settle({
        projectId: projectId,
        scopes: [{ ...team, admittedBytes: 300 }],
      }),
    ).toEqual([900]);

    const day: TelemetryIngestionBudgetDayCounters = await readDay(
      TelemetryIngestionBudgetScope.Team,
      team.scopeId,
    );

    expect(day.usedBytes).toBe(900);
    // 900 is past the 800 warning line: the sweep's warning email follows.
    expect(day.warningCrossedAt).not.toBe(null);
    expect(day.exhaustedAt).toBe(null);
  });

  test("is listed in the day's active set, so the budget sweep reads it", async () => {
    const projectId: string = newId();
    const team: TelemetryIngestAttributionScopeCharge = teamCharge({
      admittedBytes: 1,
    });

    await settle({ projectId: projectId, scopes: [team] });

    const client: ClientType = Redis.getClient()!;
    const member: string = TelemetryIngestionBudgetCounter.getActiveMember({
      projectId: projectId,
      scope: TelemetryIngestionBudgetScope.Team,
      scopeId: team.scopeId,
      signalSlug: "logs",
    });

    expect(
      await client.sismember(
        TelemetryIngestionBudgetCounter.getActiveSetKey(DAY_ID),
        member,
      ),
    ).toBe(1);
    expect(TelemetryIngestionBudgetCounter.parseActiveMember(member)).toEqual({
      projectId: projectId,
      scope: TelemetryIngestionBudgetScope.Team,
      scopeId: team.scopeId,
      signalSlug: "logs",
    });
    // A day hash outlives the day only as long as it was told.
    expect(
      await client.ttl(
        TelemetryIngestionBudgetCounter.getDayKey({
          dayId: DAY_ID,
          scope: TelemetryIngestionBudgetScope.Team,
          scopeId: team.scopeId,
          signalSlug: "logs",
        }),
      ),
    ).toBeGreaterThan(3500);
  });

  test("counts what it dropped, and when it first did", async () => {
    const projectId: string = newId();
    const team: TelemetryIngestAttributionScopeCharge = teamCharge({
      droppedBytes: 400,
      droppedRequests: 1,
    });

    expect(await settle({ projectId: projectId, scopes: [team] })).toEqual([0]);

    const day: TelemetryIngestionBudgetDayCounters = await readDay(
      TelemetryIngestionBudgetScope.Team,
      team.scopeId,
    );

    expect(day.usedBytes).toBe(0);
    expect(day.droppedBytes).toBe(400);
    expect(day.droppedRequests).toBe(1);
    // The sweep's "used up" email follows.
    expect(day.exhaustedAt).not.toBe(null);
  });
});

describe("what a team's or a label's budget dropped", () => {
  test("is taken back off the day the request path charged, never below zero", async () => {
    const projectId: string = newId();
    const keyId: string = newId();

    // The request path counts a batch against the project and its key.
    for (const scopeId of [projectId, keyId]) {
      expect(
        (
          await TelemetryIngestionBudgetCounter.consume({
            projectId: projectId,
            signalSlug: "logs",
            dayId: DAY_ID,
            dayTtlSeconds: 3600,
            bytes: 1000,
            mode: TelemetryIngestionBudgetCounterMode.Refuse,
            scopes: [
              {
                scope:
                  scopeId === projectId
                    ? TelemetryIngestionBudgetScope.Project
                    : TelemetryIngestionBudgetScope.IngestionKey,
                scopeId: scopeId,
                dailyBudgetBytes: 10_000,
                warningBytes: null,
                rateLimitBytesPerSecond: null,
              },
            ],
            nowMs: NOW,
          })
        ).outcome,
      ).toBe(TelemetryIngestionBudgetCounterOutcome.Admitted);
    }

    const refundScopes: Array<{
      scope: TelemetryIngestionBudgetScope;
      scopeId: string;
    }> = [
      { scope: TelemetryIngestionBudgetScope.Project, scopeId: projectId },
      { scope: TelemetryIngestionBudgetScope.IngestionKey, scopeId: keyId },
    ];

    await settle({
      projectId: projectId,
      refund: { bytes: 300, scopes: refundScopes },
    });

    expect(
      (await readDay(TelemetryIngestionBudgetScope.Project, projectId))
        .usedBytes,
    ).toBe(700);
    expect(
      (await readDay(TelemetryIngestionBudgetScope.IngestionKey, keyId))
        .usedBytes,
    ).toBe(700);

    // More than was counted: the day reads 0, never a negative.
    await settle({
      projectId: projectId,
      refund: { bytes: 5000, scopes: refundScopes },
    });

    expect(
      (await readDay(TelemetryIngestionBudgetScope.Project, projectId))
        .usedBytes,
    ).toBe(0);
  });

  test("creates no day the request path never counted", async () => {
    const projectId: string = newId();

    await settle({
      projectId: projectId,
      refund: {
        bytes: 300,
        scopes: [
          { scope: TelemetryIngestionBudgetScope.Project, scopeId: projectId },
        ],
      },
    });

    const client: ClientType = Redis.getClient()!;

    expect(
      await client.exists(
        TelemetryIngestionBudgetCounter.getDayKey({
          dayId: DAY_ID,
          scope: TelemetryIngestionBudgetScope.Project,
          scopeId: projectId,
          signalSlug: "logs",
        }),
      ),
    ).toBe(0);
  });
});

describe("the usage counters", () => {
  test("add each resource's bytes to its bucket, list the project, and read back as entries", async () => {
    const projectId: string = newId();
    const serviceId: string = newId();
    const otherId: string = newId();

    await settle({
      projectId: projectId,
      usage: [
        { field: usageField(serviceId, "checkout"), bytes: 700 },
        { field: usageField(otherId, "cart: v2 | eu"), bytes: 300 },
      ],
    });
    await settle({
      projectId: projectId,
      usage: [{ field: usageField(serviceId, "checkout"), bytes: 50 }],
    });

    expect(
      await TelemetryIngestAttributionCounter.listUsageProjects(BUCKET_ID),
    ).toContain(projectId);

    const usage: Map<string, Array<TelemetryUsageCounterEntry>> | null =
      await TelemetryIngestAttributionCounter.readUsage(BUCKET_ID, [projectId]);
    const entries: Array<TelemetryUsageCounterEntry> = usage!
      .get(projectId)!
      .sort((a: TelemetryUsageCounterEntry, b: TelemetryUsageCounterEntry) => {
        return b.bytes - a.bytes;
      });

    expect(entries).toEqual([
      {
        signalSlug: "logs",
        resourceType: "OpenTelemetry",
        resourceId: serviceId,
        resourceName: "checkout",
        bytes: 750,
      },
      {
        signalSlug: "logs",
        resourceType: "OpenTelemetry",
        resourceId: otherId,
        // Any character a name can hold survives the field.
        resourceName: "cart: v2 | eu",
        bytes: 300,
      },
    ]);

    const client: ClientType = Redis.getClient()!;
    const ttl: number = await client.ttl(
      TelemetryIngestAttributionCounter.getUsageKey(BUCKET_ID, projectId),
    );

    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TELEMETRY_USAGE_COUNTER_TTL_SECONDS);
  });

  test("are forgotten once published, so a sweep that runs again writes nothing twice", async () => {
    const projectId: string = newId();

    await settle({
      projectId: projectId,
      usage: [{ field: usageField(newId(), "svc"), bytes: 10 }],
    });
    await TelemetryIngestAttributionCounter.deleteUsage(BUCKET_ID, [projectId]);

    expect(
      await TelemetryIngestAttributionCounter.listUsageProjects(BUCKET_ID),
    ).not.toContain(projectId);
    expect(
      (
        await TelemetryIngestAttributionCounter.readUsage(BUCKET_ID, [
          projectId,
        ])
      )?.get(projectId),
    ).toEqual([]);
  });

  test("a batch with nothing to count makes no round trip", async () => {
    const client: ClientType = Redis.getClient()!;
    const evalsha: jest.Mock = jest.spyOn(
      client,
      "evalsha",
    ) as unknown as jest.Mock;

    expect(await settle({ projectId: newId() })).toEqual([]);
    expect(evalsha).not.toHaveBeenCalled();
  });
});

describe("a usage field", () => {
  test("reads back what it was written with, and nothing that is not one", () => {
    const field: string = usageField("svc-id", "name");

    expect(
      TelemetryIngestAttributionCounter.parseUsageField(field, "12"),
    ).toEqual({
      signalSlug: "logs",
      resourceType: "OpenTelemetry",
      resourceId: "svc-id",
      resourceName: "name",
      bytes: 12,
    });

    for (const [bad, bytes] of [
      ["not json", "1"],
      ['["logs","OpenTelemetry","id"]', "1"],
      ['["","OpenTelemetry","id","n"]', "1"],
      ['["logs","OpenTelemetry","","n"]', "1"],
      [field, "0"],
      [field, "-3"],
      [field, "many"],
    ] as Array<[string, string]>) {
      expect({
        bad,
        bytes,
        read: TelemetryIngestAttributionCounter.parseUsageField(bad, bytes),
      }).toEqual({ bad, bytes, read: null });
    }
  });

  test("buckets are five minutes, by when they start", () => {
    const bucket: string = TelemetryIngestAttributionCounter.getUsageBucketId(
      Date.parse("2026-11-09T12:07:30Z"),
    );

    expect(
      TelemetryIngestAttributionCounter.getUsageBucketStart(
        bucket,
      ).toISOString(),
    ).toBe("2026-11-09T12:05:00.000Z");
  });
});
