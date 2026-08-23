import AIService, {
  AUTONOMOUS_AI_FEATURES,
  AI_ALERT_INVESTIGATION_FEATURE,
  AI_INCIDENT_INVESTIGATION_FEATURE,
  AutonomousBudgetStatus,
} from "../../../Server/Services/AIService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test, afterEach } from "@jest/globals";

/*
 * LlmLogService.getTotalTokensUsedSince builds its WHERE clause per subject
 * lane, so the SQL text is not constant — but the bound parameter array has to
 * agree with whichever branch was taken. It did not.
 *
 * PostgreSQL derives a prepared statement's parameter count from the HIGHEST
 * $n in the statement text, never from what the driver sends. The incident
 * branch referenced only $4 while the caller always bound five values, so
 * every capped incident investigation died at Bind with
 *
 *   bind message supplies 5 parameters, but prepared statement "" requires 4
 *
 * and the alert branch referenced $5 while never referencing $4, so it died at
 * Parse with
 *
 *   could not determine data type of parameter $4
 *
 * InvestigationQueue.enqueue() catches any budget-check failure and quietly
 * skips the run, so both lanes lost automatic AI investigations with no
 * user-visible signal beyond an empty "AI Logs" tab. Only projects that had
 * configured a positive daily token ceiling were affected: a null limit
 * returns before the query and an explicit 0 is the intended kill switch.
 *
 * These tests pin the placeholder/binding contract for every branch so the
 * arrays and the clause that reads them cannot drift apart again.
 */

/*
 * Both messages below were reproduced against PostgreSQL 15.18 through the
 * same `pg` driver TypeORM's manager.query() uses, with the exact SQL these
 * branches generate. assertBindable() replays those two server-side rules in
 * process so the suite needs no database.
 */
function assertBindable(sql: string, params: Array<unknown>): void {
  const referenced: Set<number> = new Set<number>();
  let highest: number = 0;

  for (const match of sql.matchAll(/\$(\d+)/g)) {
    const index: number = Number(match[1]);
    referenced.add(index);
    highest = Math.max(highest, index);
  }

  // Parse: a hole below the highest placeholder has no inferable type.
  for (let index: number = 1; index <= highest; index++) {
    if (!referenced.has(index)) {
      throw new Error(`could not determine data type of parameter $${index}`);
    }
  }

  // Bind: the supplied count must equal the count the statement requires.
  if (params.length !== highest) {
    throw new Error(
      `bind message supplies ${params.length} parameters, but prepared statement "" requires ${highest}`,
    );
  }
}

interface CapturedQuery {
  sql: string;
  params: Array<unknown>;
}

/*
 * Every aggregate issued through this harness is checked against the bind
 * contract as it is issued, so each test in this file enforces it even when
 * the test itself is asserting something else.
 */
function captureQueries(
  rows: Array<{ total: string | number | null }> = [{ total: "0" }],
): Array<CapturedQuery> {
  const calls: Array<CapturedQuery> = [];

  jest.spyOn(LlmLogService, "getRepository").mockReturnValue({
    manager: {
      query: (sql: string, params: Array<unknown>) => {
        calls.push({ sql, params });
        assertBindable(sql, params);
        return Promise.resolve(rows);
      },
    },
  } as any);

  return calls;
}

const SINCE: Date = new Date("2026-08-07T00:00:00.000Z");

const INCIDENT_LEGACY: Array<string> = [
  AI_INCIDENT_INVESTIGATION_FEATURE,
  "AI Investigation Grading",
];
const ALERT_LEGACY: Array<string> = [AI_ALERT_INVESTIGATION_FEATURE];

interface Lane {
  name: string;
  subject: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  };
  expectedParamCount: number;
}

function lanes(): Array<Lane> {
  return [
    {
      name: "incident",
      subject: { incidentId: ObjectID.generate() },
      expectedParamCount: 4,
    },
    {
      name: "alert",
      subject: { alertId: ObjectID.generate() },
      expectedParamCount: 4,
    },
    { name: "subjectless", subject: {}, expectedParamCount: 5 },
  ];
}

async function aggregate(data: {
  subject: {
    incidentId?: ObjectID | undefined;
    alertId?: ObjectID | undefined;
  };
  projectId?: ObjectID | undefined;
  features?: Array<string> | undefined;
  legacyIncidentFeatures?: Array<string> | undefined;
  legacyAlertFeatures?: Array<string> | undefined;
  rows?: Array<{ total: string | number | null }> | undefined;
}): Promise<{ calls: Array<CapturedQuery>; total: number }> {
  const calls: Array<CapturedQuery> = captureQueries(data.rows);

  const total: number = await LlmLogService.getTotalTokensUsedSince({
    projectId: data.projectId || ObjectID.generate(),
    since: SINCE,
    features: data.features || AUTONOMOUS_AI_FEATURES,
    legacyIncidentFeatures:
      data.legacyIncidentFeatures === undefined
        ? INCIDENT_LEGACY
        : data.legacyIncidentFeatures,
    legacyAlertFeatures:
      data.legacyAlertFeatures === undefined
        ? ALERT_LEGACY
        : data.legacyAlertFeatures,
    ...data.subject,
  });

  return { calls, total };
}

function highestPlaceholder(sql: string): number {
  return Math.max(
    0,
    ...[...sql.matchAll(/\$(\d+)/g)].map((m: RegExpMatchArray) => {
      return Number(m[1]);
    }),
  );
}

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * The emulator is only worth anything if it actually rejects the shipped bug.
 * These four cases feed it the literal pre-fix clauses so a future edit that
 * weakens assertBindable() cannot make the rest of this file pass vacuously.
 */
describe("PostgreSQL bind contract emulator", () => {
  const PREFIX: string =
    'SELECT COALESCE(SUM("log"."totalTokens"), 0) AS "total" FROM "LlmLog" AS "log" WHERE "log"."projectId" = $1 AND "log"."createdAt" >= $2 AND "log"."feature" = ANY($3)';
  const FIVE: Array<unknown> = ["p", SINCE, ["a"], ["b"], ["c"]];

  test("rejects the pre-fix incident clause with the reported bind error", () => {
    expect(() => {
      return assertBindable(
        `${PREFIX} AND (("log"."feature" = ANY($4)))`,
        FIVE,
      );
    }).toThrow(
      'bind message supplies 5 parameters, but prepared statement "" requires 4',
    );
  });

  test("rejects the pre-fix alert clause, which skipped $4 entirely", () => {
    expect(() => {
      return assertBindable(
        `${PREFIX} AND (("log"."feature" = ANY($5)))`,
        FIVE,
      );
    }).toThrow("could not determine data type of parameter $4");
  });

  test("accepts the pre-fix subjectless clause, which was always consistent", () => {
    expect(() => {
      return assertBindable(
        `${PREFIX} AND NOT ("log"."feature" = ANY($4)) AND NOT ("log"."feature" = ANY($5))`,
        FIVE,
      );
    }).not.toThrow();
  });

  test("rejects binding fewer parameters than the text references", () => {
    expect(() => {
      return assertBindable(
        `${PREFIX} AND NOT ("log"."feature" = ANY($4)) AND NOT ("log"."feature" = ANY($5))`,
        FIVE.slice(0, 4),
      );
    }).toThrow(
      'bind message supplies 4 parameters, but prepared statement "" requires 5',
    );
  });
});

describe("getTotalTokensUsedSince placeholder and binding contract", () => {
  test.each(lanes())(
    "$name lane binds exactly the parameters its SQL references",
    async (lane: Lane) => {
      const { calls } = await aggregate({ subject: lane.subject });

      expect(calls).toHaveLength(1);

      const call: CapturedQuery = calls[0]!;
      expect(call.params).toHaveLength(lane.expectedParamCount);
      expect(highestPlaceholder(call.sql)).toBe(lane.expectedParamCount);
    },
  );

  test.each(lanes())(
    "$name lane leaves no unreferenced placeholder below the highest",
    async (lane: Lane) => {
      const { calls } = await aggregate({ subject: lane.subject });
      const sql: string = calls[0]!.sql;

      for (let index: number = 1; index <= lane.expectedParamCount; index++) {
        expect(sql).toContain(`$${index}`);
      }
    },
  );

  test.each(lanes())(
    "$name lane binds project, since and features as $1..$3",
    async (lane: Lane) => {
      const projectId: ObjectID = ObjectID.generate();
      const { calls } = await aggregate({ subject: lane.subject, projectId });
      const params: Array<unknown> = calls[0]!.params;

      expect(params[0]).toBe(projectId.toString());
      expect(params[1]).toBe(SINCE);
      expect(params[2]).toEqual(AUTONOMOUS_AI_FEATURES);
    },
  );

  test("incident lane binds only its own legacy features, as $4", async () => {
    const { calls } = await aggregate({
      subject: { incidentId: ObjectID.generate() },
    });
    const call: CapturedQuery = calls[0]!;

    expect(call.params).toHaveLength(4);
    expect(call.params[3]).toEqual(INCIDENT_LEGACY);
    expect(call.sql).toContain('"log"."feature" = ANY($4)');
    expect(call.sql).not.toContain("$5");
  });

  test("alert lane binds only its own legacy features, as $4", async () => {
    const { calls } = await aggregate({
      subject: { alertId: ObjectID.generate() },
    });
    const call: CapturedQuery = calls[0]!;

    expect(call.params).toHaveLength(4);
    expect(call.params[3]).toEqual(ALERT_LEGACY);
    expect(call.sql).toContain('"log"."feature" = ANY($4)');
    expect(call.sql).not.toContain("$5");
  });

  test("subjectless lane binds both legacy lists, as $4 and $5", async () => {
    const { calls } = await aggregate({ subject: {} });
    const call: CapturedQuery = calls[0]!;

    expect(call.params).toHaveLength(5);
    expect(call.params[3]).toEqual(INCIDENT_LEGACY);
    expect(call.params[4]).toEqual(ALERT_LEGACY);
    expect(call.sql).toContain('NOT ("log"."feature" = ANY($4))');
    expect(call.sql).toContain('NOT ("log"."feature" = ANY($5))');
  });
});

/*
 * The legacy lists are caller-supplied and vary by deployment age. The
 * contract has to hold for every shape, not just the one AIService passes
 * today — an empty list is what a fresh install sends.
 */
describe("binding contract holds across legacy feature list shapes", () => {
  const shapes: Array<{ name: string; value: Array<string> }> = [
    { name: "empty", value: [] },
    { name: "single", value: ["AI Incident Investigation"] },
    { name: "many", value: ["a", "b", "c", "d", "e"] },
  ];

  for (const lane of lanes()) {
    for (const incident of shapes) {
      for (const alert of shapes) {
        test(`${lane.name} lane stays bindable with ${incident.name} incident and ${alert.name} alert legacy lists`, async () => {
          const { calls } = await aggregate({
            subject: lane.subject,
            legacyIncidentFeatures: incident.value,
            legacyAlertFeatures: alert.value,
          });
          const call: CapturedQuery = calls[0]!;

          expect(call.params).toHaveLength(lane.expectedParamCount);
          expect(highestPlaceholder(call.sql)).toBe(lane.expectedParamCount);
        });
      }
    }
  }

  test("omitted legacy lists default to empty arrays and are still bound", async () => {
    const calls: Array<CapturedQuery> = captureQueries();

    await LlmLogService.getTotalTokensUsedSince({
      projectId: ObjectID.generate(),
      since: SINCE,
      features: AUTONOMOUS_AI_FEATURES,
      incidentId: ObjectID.generate(),
    });

    expect(calls[0]!.params).toHaveLength(4);
    expect(calls[0]!.params[3]).toEqual([]);
  });

  test("omitted legacy lists still bind both slots on the subjectless lane", async () => {
    const calls: Array<CapturedQuery> = captureQueries();

    await LlmLogService.getTotalTokensUsedSince({
      projectId: ObjectID.generate(),
      since: SINCE,
      features: AUTONOMOUS_AI_FEATURES,
    });

    expect(calls[0]!.params).toHaveLength(5);
    expect(calls[0]!.params[3]).toEqual([]);
    expect(calls[0]!.params[4]).toEqual([]);
  });
});

/*
 * Fixing the parameter counts must not blur the lanes: an incident aggregate
 * that started counting alert spend would silently halve both budgets.
 */
describe("subject lane isolation survives the parameter fix", () => {
  test("incident lane never binds alert legacy features", async () => {
    const { calls } = await aggregate({
      subject: { incidentId: ObjectID.generate() },
    });

    expect(calls[0]!.params).not.toContainEqual(ALERT_LEGACY);
  });

  test("alert lane never binds incident legacy features", async () => {
    const { calls } = await aggregate({
      subject: { alertId: ObjectID.generate() },
    });

    expect(calls[0]!.params).not.toContainEqual(INCIDENT_LEGACY);
  });

  test("incident lane matches incident-linked rows and incident run membership", async () => {
    const { calls } = await aggregate({
      subject: { incidentId: ObjectID.generate() },
    });
    const sql: string = calls[0]!.sql;

    expect(sql).toContain(
      '"log"."incidentId" IS NOT NULL AND "log"."alertId" IS NULL',
    );
    expect(sql).toContain('"run"."triggeredByIncidentId" IS NOT NULL');
    expect(sql).not.toContain('"run"."triggeredByAlertId" IS NOT NULL');
  });

  test("alert lane matches alert-linked rows and alert run membership", async () => {
    const { calls } = await aggregate({
      subject: { alertId: ObjectID.generate() },
    });
    const sql: string = calls[0]!.sql;

    expect(sql).toContain(
      '"log"."incidentId" IS NULL AND "log"."alertId" IS NOT NULL',
    );
    expect(sql).toContain('"run"."triggeredByAlertId" IS NOT NULL');
    expect(sql).not.toContain('"run"."triggeredByIncidentId" IS NOT NULL');
  });

  test("subjectless lane excludes both lanes' rows and run membership", async () => {
    const { calls } = await aggregate({ subject: {} });
    const sql: string = calls[0]!.sql;

    expect(sql).toContain(
      '"log"."incidentId" IS NULL AND "log"."alertId" IS NULL',
    );
    expect(sql).toContain('NOT ("log"."feature" = ANY($4))');
    expect(sql).toContain('NOT ("log"."feature" = ANY($5))');
    expect(sql).toContain('NOT (EXISTS (SELECT 1 FROM "AIRun" AS "run"');
  });

  test.each(lanes())(
    "$name lane always scopes to the project, the window and soft-delete",
    async (lane: Lane) => {
      const { calls } = await aggregate({ subject: lane.subject });
      const sql: string = calls[0]!.sql;

      expect(sql).toContain('"log"."projectId" = $1');
      expect(sql).toContain('"log"."createdAt" >= $2');
      expect(sql).toContain('"log"."feature" = ANY($3)');
      expect(sql).toContain('"log"."deletedAt" IS NULL');
    },
  );
});

describe("guard clauses run before any SQL is issued", () => {
  test("an empty feature list short-circuits to zero without querying", async () => {
    const calls: Array<CapturedQuery> = captureQueries();

    const total: number = await LlmLogService.getTotalTokensUsedSince({
      projectId: ObjectID.generate(),
      since: SINCE,
      features: [],
      incidentId: ObjectID.generate(),
    });

    expect(total).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("selecting both lanes is rejected before the query", async () => {
    const calls: Array<CapturedQuery> = captureQueries();

    await expect(
      LlmLogService.getTotalTokensUsedSince({
        projectId: ObjectID.generate(),
        since: SINCE,
        features: AUTONOMOUS_AI_FEATURES,
        incidentId: ObjectID.generate(),
        alertId: ObjectID.generate(),
      }),
    ).rejects.toThrow(/both the incident and alert lanes/);

    expect(calls).toHaveLength(0);
  });
});

describe("aggregate result parsing", () => {
  test.each([
    ["a string sum, as SUM() returns over the wire", "17", 17],
    ["a numeric sum", 42, 42],
    ["a null sum", null, 0],
    ["a zero sum", "0", 0],
  ])(
    "reads %s",
    async (_name: string, total: string | number | null, expected: number) => {
      const { total: parsed } = await aggregate({
        subject: { incidentId: ObjectID.generate() },
        rows: [{ total }],
      });

      expect(parsed).toBe(expected);
    },
  );

  test("an empty result set counts as zero tokens", async () => {
    const { total } = await aggregate({
      subject: { incidentId: ObjectID.generate() },
      rows: [],
    });

    expect(total).toBe(0);
  });
});

/*
 * The end-to-end shape of the reported bug: a project with a POSITIVE incident
 * ceiling. Before the fix the aggregate threw, InvestigationQueue.enqueue()
 * swallowed it, and no investigation was ever created — so a project that
 * responsibly capped its spend lost the feature entirely.
 */
describe("capped lanes report a real budget instead of throwing", () => {
  function projectWithLimits(data: {
    subjectless?: number | undefined;
    incident?: number | undefined;
    alert?: number | undefined;
  }): Project {
    return {
      id: ObjectID.generate(),
      aiDailyAutonomousTokenLimit: data.subjectless,
      incidentAiDailyAutonomousTokenLimit: data.incident,
      alertAiDailyAutonomousTokenLimit: data.alert,
    } as unknown as Project;
  }

  test("a positive incident ceiling under budget is not exhausted", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ incident: 700_000 }));
    const calls: Array<CapturedQuery> = captureQueries([{ total: "1200" }]);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
        incidentId: ObjectID.generate(),
      });

    expect(status.exhausted).toBe(false);
    expect(status.limitInTokens).toBe(700_000);
    expect(status.usedTokensToday).toBe(1200);
    expect(calls).toHaveLength(1);
  });

  test("a positive incident ceiling that is spent is exhausted", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ incident: 700_000 }));
    captureQueries([{ total: "700000" }]);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
        incidentId: ObjectID.generate(),
      });

    expect(status.exhausted).toBe(true);
    expect(status.usedTokensToday).toBe(700_000);
  });

  test("a positive alert ceiling under budget is not exhausted", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ alert: 500_000 }));
    const calls: Array<CapturedQuery> = captureQueries([{ total: "9" }]);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
        alertId: ObjectID.generate(),
      });

    expect(status.exhausted).toBe(false);
    expect(status.limitInTokens).toBe(500_000);
    expect(status.usedTokensToday).toBe(9);
    expect(calls).toHaveLength(1);
  });

  test("a positive subjectless ceiling under budget is not exhausted", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ subjectless: 250_000 }));
    const calls: Array<CapturedQuery> = captureQueries([{ total: "10" }]);

    const status: AutonomousBudgetStatus =
      await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate());

    expect(status.exhausted).toBe(false);
    expect(status.usedTokensToday).toBe(10);
    expect(calls).toHaveLength(1);
  });

  test("the incident lane's aggregate is bindable end to end", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ incident: 700_000 }));
    const calls: Array<CapturedQuery> = captureQueries();

    await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
      incidentId: ObjectID.generate(),
    });

    const call: CapturedQuery = calls[0]!;
    expect(() => {
      return assertBindable(call.sql, call.params);
    }).not.toThrow();
    expect(call.params).toHaveLength(4);
  });

  test("the alert lane's aggregate is bindable end to end", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ alert: 500_000 }));
    const calls: Array<CapturedQuery> = captureQueries();

    await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
      alertId: ObjectID.generate(),
    });

    const call: CapturedQuery = calls[0]!;
    expect(() => {
      return assertBindable(call.sql, call.params);
    }).not.toThrow();
    expect(call.params).toHaveLength(4);
  });

  test("the incident lane carries AIService's real legacy feature list", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ incident: 700_000 }));
    const calls: Array<CapturedQuery> = captureQueries();

    await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
      incidentId: ObjectID.generate(),
    });

    const legacy: Array<string> = calls[0]!.params[3] as Array<string>;
    expect(legacy).toContain(AI_INCIDENT_INVESTIGATION_FEATURE);
    expect(legacy).not.toContain(AI_ALERT_INVESTIGATION_FEATURE);
  });

  test("the alert lane carries AIService's real legacy feature list", async () => {
    jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(projectWithLimits({ alert: 500_000 }));
    const calls: Array<CapturedQuery> = captureQueries();

    await AIService.getAutonomousDailyBudgetStatus(ObjectID.generate(), {
      alertId: ObjectID.generate(),
    });

    const legacy: Array<string> = calls[0]!.params[3] as Array<string>;
    expect(legacy).toContain(AI_ALERT_INVESTIGATION_FEATURE);
    expect(legacy).not.toContain(AI_INCIDENT_INVESTIGATION_FEATURE);
  });
});
