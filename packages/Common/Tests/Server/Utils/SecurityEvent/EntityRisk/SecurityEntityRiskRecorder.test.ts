import Semaphore from "../../../../../Server/Infrastructure/Semaphore";
import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityEntityCriticalityService from "../../../../../Server/Services/SecurityEntityCriticalityService";
import SecurityEntityRiskService from "../../../../../Server/Services/SecurityEntityRiskService";
import SecurityCaseIngest, {
  SecurityDetectionSignal,
  securityCaseGroupingKey,
} from "../../../../../Server/Utils/SecurityCase/SecurityCaseIngest";
import SecurityEntityRiskRecorder, {
  ENTITY_RISK_ENTITIES_PER_CALL,
  SecurityEntityRiskRecordResult,
} from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskRecorder";
import { SecurityRiskFinding } from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskFindings";
import logger from "../../../../../Server/Utils/Logger";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityEntityRisk from "../../../../../Models/DatabaseModels/SecurityEntityRisk";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../../Types/ObjectID";
import OcsfSeverity from "../../../../../Types/SecurityEvent/OcsfSeverity";
import SecurityDetectionSource from "../../../../../Types/SecurityCase/SecurityDetectionSource";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityEntityCriticality,
  SecurityEntityRiskContribution,
  SecurityEntityRiskHistoryPoint,
} from "../../../../../Types/SecurityCase/SecurityEntityRisk";
import { SecurityEntityCriticalityRule } from "../../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import { getJestSpyOn } from "../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The recorder that keeps each entity's risk: every finding adds to the row
 * of the entities it names, under the project's lock; the row's score,
 * criticality, sources, history and the moment it next falls are written;
 * risk that reaches the threshold hands a detection to the case ingest once
 * the lock is given back, and the same findings never hand a second one;
 * the refresh lowers scores as sources go quiet and forgets entities quiet
 * for a month. It never throws.
 *
 * The rows live in a store of the test's own, behind the service's reads
 * and writes, so what one call writes the next one reads.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RULE_A: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const NOW: Date = new Date("2026-10-14T12:00:00.000Z");
const HOUR_IN_MS: number = 60 * 60 * 1000;
const DAY_IN_MS: number = 24 * HOUR_IN_MS;

function ago(milliseconds: number): Date {
  return new Date(NOW.getTime() - milliseconds);
}

function finding(
  overrides: Partial<SecurityRiskFinding> = {},
): SecurityRiskFinding {
  return {
    projectId: PROJECT_ID,
    source: SecurityDetectionSource.DetectionRule,
    sourceKey: `rule:${RULE_A.toString()}`,
    sourceName: "Brute force",
    severity: OcsfSeverity.High,
    points: 50,
    entities: [{ type: SecurityEntityType.User, value: "Alice@Corp.Example" }],
    mitreTactics: ["TA0006"],
    mitreTechniques: ["T1110"],
    seenAt: ago(HOUR_IN_MS),
    detectionRuleId: RULE_A,
    ...overrides,
  };
}

interface StoredRow {
  _id: string;
  projectId: string;
  [column: string]: unknown;
}

interface World {
  rows: Array<StoredRow>;
  settings: Map<string, { enabled: boolean; threshold: number }>;
  rules: Array<SecurityEntityCriticalityRule>;
  order: Array<string>;
  signals: Array<SecurityDetectionSignal>;
  spies: {
    lock: Spy;
    release: Spy;
    findBy: Spy;
    create: Spy;
    update: Spy;
    deleteBy: Spy;
    ingest: Spy;
    getRules: Spy;
    project: Spy;
    loggerError: Spy;
  };
}

let world: World;

function matchesQuery(row: StoredRow, query: Record<string, unknown>): boolean {
  for (const [column, wanted] of Object.entries(query)) {
    const value: unknown = row[column];

    if (wanted instanceof Includes) {
      const values: Array<string> = (
        wanted.values as Array<string | ObjectID>
      ).map((item: string | ObjectID): string => {
        return item.toString();
      });

      if (!values.includes(String(value))) {
        return false;
      }

      continue;
    }

    if (wanted instanceof ObjectID) {
      if (String(value) !== wanted.toString()) {
        return false;
      }

      continue;
    }

    if (
      wanted &&
      typeof wanted === "object" &&
      "_value" in (wanted as Record<string, unknown>)
    ) {
      // A raw comparison (QueryHelper.lessThanEqualTo / lessThan): read its parameters.
      const raw: { _getSql: (alias: string) => string } & Record<
        string,
        unknown
      > = wanted as never;
      const parameters: Record<string, unknown> =
        (raw["_objectLiteralParameters"] as Record<string, unknown>) || {};
      const bound: unknown = Object.values(parameters)[0];
      const sql: string = raw._getSql("x");
      const time: number =
        value instanceof Date ? value.getTime() : Number.NaN;
      const limit: number = bound instanceof Date ? bound.getTime() : Number.NaN;

      if (Number.isNaN(time)) {
        return false;
      }

      if (sql.includes("<=") ? !(time <= limit) : !(time < limit)) {
        return false;
      }

      continue;
    }

    if (value !== wanted) {
      return false;
    }
  }

  return true;
}

function toModel(row: StoredRow): SecurityEntityRisk {
  const model: SecurityEntityRisk = new SecurityEntityRisk();
  model._id = row._id;
  model.projectId = new ObjectID(row.projectId);

  for (const [column, value] of Object.entries(row)) {
    if (column === "_id" || column === "projectId") {
      continue;
    }

    (model as unknown as Record<string, unknown>)[column] =
      value === undefined ? undefined : JSON.parse(JSON.stringify(value));

    if (value instanceof Date) {
      (model as unknown as Record<string, unknown>)[column] = new Date(
        value.getTime(),
      );
    }
  }

  return model;
}

function install(
  data: {
    enabled?: boolean;
    threshold?: number;
    rules?: Array<SecurityEntityCriticalityRule>;
  } = {},
): void {
  const order: Array<string> = [];
  const rows: Array<StoredRow> = [];
  const signals: Array<SecurityDetectionSignal> = [];

  world = {
    rows,
    settings: new Map([
      [
        PROJECT_ID.toString(),
        {
          enabled: data.enabled !== false,
          threshold: data.threshold || 100,
        },
      ],
      [OTHER_PROJECT_ID.toString(), { enabled: true, threshold: 100 }],
    ]),
    rules: data.rules || [],
    order,
    signals,
    spies: {
      lock: getJestSpyOn(Semaphore, "lock").mockImplementation(
        async (lock: unknown) => {
          order.push(`lock:${(lock as { key: string }).key}`);
          return { id: "mutex" } as never;
        },
      ),
      release: getJestSpyOn(Semaphore, "release").mockImplementation(
        async () => {
          order.push("release");
        },
      ),
      findBy: getJestSpyOn(SecurityEntityRiskService, "findBy").mockImplementation(
        async (findBy: unknown) => {
          const query: Record<string, unknown> = (
            findBy as { query: Record<string, unknown> }
          ).query;
          order.push("find");
          return rows
            .filter((row: StoredRow): boolean => {
              return matchesQuery(row, query);
            })
            .map(toModel) as never;
        },
      ),
      create: getJestSpyOn(SecurityEntityRiskService, "create").mockImplementation(
        async (createBy: unknown) => {
          const model: SecurityEntityRisk = (
            createBy as { data: SecurityEntityRisk }
          ).data;
          const stored: StoredRow = {
            _id: ObjectID.generate().toString(),
            projectId: model.projectId!.toString(),
          };

          for (const column of [
            "entityType",
            "entityValue",
            "entityKey",
            "riskScore",
            "criticality",
            "contributorCount",
            "contributions",
            "mitreTactics",
            "mitreTechniques",
            "firstRiskAt",
            "lastRiskAt",
            "riskExpiresAt",
            "riskCaseAt",
            "riskHistory",
          ]) {
            const value: unknown = (model as unknown as Record<string, unknown>)[
              column
            ];

            if (value !== undefined) {
              stored[column] = value;
            }
          }

          rows.push(stored);
          order.push(`create:${String(stored["entityKey"])}`);
          return model as never;
        },
      ),
      update: getJestSpyOn(
        SecurityEntityRiskService,
        "updateColumnsByIdWithoutHooks",
      ).mockImplementation(async (input: unknown) => {
        const { id, data: update } = input as {
          id: ObjectID;
          data: Record<string, unknown>;
        };
        const row: StoredRow | undefined = rows.find((item: StoredRow) => {
          return item._id === id.toString();
        });

        if (row) {
          Object.assign(row, update);
          order.push(`update:${String(row["entityKey"])}`);
        }

        return undefined as never;
      }),
      deleteBy: getJestSpyOn(
        SecurityEntityRiskService,
        "deleteBy",
      ).mockImplementation(async (deleteBy: unknown) => {
        const query: Record<string, unknown> = (
          deleteBy as { query: Record<string, unknown> }
        ).query;
        const gone: Array<StoredRow> = rows.filter((row: StoredRow) => {
          return matchesQuery(row, query);
        });

        for (const row of gone) {
          rows.splice(rows.indexOf(row), 1);
        }

        return gone.length as never;
      }),
      ingest: getJestSpyOn(
        SecurityCaseIngest,
        "recordDetections",
      ).mockImplementation(async (handed: unknown) => {
        order.push("ingest");
        signals.push(...(handed as Array<SecurityDetectionSignal>));
        return {
          casesOpened: 1,
          detectionsAdded: 1,
          detectionsRepeated: 0,
        } as never;
      }),
      getRules: getJestSpyOn(
        SecurityEntityCriticalityService,
        "getRules",
      ).mockImplementation(async () => {
        return world.rules as never;
      }),
      project: getJestSpyOn(ProjectService, "findOneById").mockImplementation(
        async (findBy: unknown) => {
          const id: string = (findBy as { id: ObjectID }).id.toString();
          const settings: { enabled: boolean; threshold: number } | undefined =
            world.settings.get(id);
          const project: Project = new Project();
          project.enableSecurityRiskCases = settings?.enabled === true;
          project.securityRiskCaseThreshold = settings?.threshold || 100;
          return project as never;
        },
      ),
      loggerError: getJestSpyOn(logger, "error").mockImplementation(() => {
        return undefined as never;
      }),
    },
  };
}

function rowOf(value: string): StoredRow | undefined {
  return world.rows.find((row: StoredRow): boolean => {
    return row["entityKey"] === value.trim().toLowerCase();
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: NOW, doNotFake: ["nextTick", "setImmediate"] });
  install();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("recording what was found", () => {
  test("a finding gives the entity it names a row: its score, sources, history and when it next falls", async () => {
    const result: SecurityEntityRiskRecordResult =
      await SecurityEntityRiskRecorder.record([finding()]);

    expect(result).toEqual({ entitiesUpdated: 1, riskCasesRaised: 0 });

    const row: StoredRow = rowOf("alice@corp.example")!;

    expect(row).toMatchObject({
      projectId: PROJECT_ID.toString(),
      entityType: SecurityEntityType.User,
      entityValue: "Alice@Corp.Example",
      entityKey: "alice@corp.example",
      riskScore: 50,
      contributorCount: 1,
      mitreTactics: ["TA0006"],
      mitreTechniques: ["T1110"],
    });
    expect(row["firstRiskAt"]).toEqual(ago(HOUR_IN_MS));
    expect(row["lastRiskAt"]).toEqual(ago(HOUR_IN_MS));
    expect(row["riskExpiresAt"]).toEqual(
      new Date(ago(HOUR_IN_MS).getTime() + 7 * DAY_IN_MS),
    );
    expect(row["riskHistory"]).toEqual([{ day: "2026-10-14", score: 50 }]);
    expect(row["criticality"]).toBeUndefined();

    const contributions: Array<SecurityEntityRiskContribution> = row[
      "contributions"
    ] as Array<SecurityEntityRiskContribution>;

    expect(contributions).toHaveLength(1);
    expect(contributions[0]).toMatchObject({
      sourceKey: `rule:${RULE_A.toString()}`,
      source: SecurityDetectionSource.DetectionRule,
      sourceName: "Brute force",
      points: 50,
      hits: 1,
      detectionRuleId: RULE_A.toString(),
    });

    // Under the project's lock, given back before anything else.
    expect(world.order).toEqual([
      `lock:${PROJECT_ID.toString()}`,
      "find",
      "create:alice@corp.example",
      "release",
    ]);
    expect(world.spies.ingest).not.toHaveBeenCalled();
  });

  test("the same source again counts once; another source adds to it", async () => {
    await SecurityEntityRiskRecorder.record([finding()]);
    await SecurityEntityRiskRecorder.record([
      finding({ seenAt: ago(30 * 60 * 1000) }),
    ]);

    expect(rowOf("alice@corp.example")!["riskScore"]).toBe(50);
    expect(world.spies.create).toHaveBeenCalledTimes(1);

    await SecurityEntityRiskRecorder.record([
      finding({
        sourceKey: "connection:okta:new country",
        source: SecurityDetectionSource.ConnectedProduct,
        sourceName: "New country (Okta)",
        severity: OcsfSeverity.Medium,
        points: 25,
        mitreTactics: ["TA0001"],
      }),
    ]);

    const row: StoredRow = rowOf("alice@corp.example")!;

    expect(row["riskScore"]).toBe(75);
    expect(row["contributorCount"]).toBe(2);
    expect(row["mitreTactics"]).toEqual(["TA0006", "TA0001"]);
    expect(
      (row["contributions"] as Array<SecurityEntityRiskContribution>).find(
        (item: SecurityEntityRiskContribution): boolean => {
          return item.sourceKey === `rule:${RULE_A.toString()}`;
        },
      )!.hits,
    ).toBe(2);
  });

  test("one finding about several entities adds to each, once each", async () => {
    await SecurityEntityRiskRecorder.record([
      finding({
        entities: [
          { type: SecurityEntityType.User, value: "alice" },
          { type: SecurityEntityType.Host, value: "web-01" },
          { type: SecurityEntityType.User, value: "ALICE" },
          { type: SecurityEntityType.FileHash, value: "d41d8cd98f00b204e9800998ecf8427e" },
        ],
      }),
    ]);

    expect(
      world.rows.map((row: StoredRow): unknown => {
        return row["entityKey"];
      }),
    ).toEqual(["alice", "web-01"]);
  });

  test("findings that add nothing, or name nobody who carries risk, write nothing", async () => {
    const result: SecurityEntityRiskRecordResult =
      await SecurityEntityRiskRecorder.record([
        finding({ points: 0 }),
        finding({
          entities: [{ type: SecurityEntityType.Domain, value: "evil.example" }],
        }),
      ]);

    expect(result).toEqual({ entitiesUpdated: 0, riskCasesRaised: 0 });
    expect(world.rows).toHaveLength(0);
    // The finding with no points never takes the lock; the other finds nobody under it.
    expect(world.spies.lock).toHaveBeenCalledTimes(1);
    expect(world.spies.findBy).not.toHaveBeenCalled();
  });

  test("each project is recorded under its own lock", async () => {
    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ projectId: OTHER_PROJECT_ID }),
    ]);

    expect(world.order.filter((step: string) => {
      return step.startsWith("lock:");
    })).toEqual([
      `lock:${PROJECT_ID.toString()}`,
      `lock:${OTHER_PROJECT_ID.toString()}`,
    ]);
    expect(world.rows.map((row: StoredRow) => {
      return row.projectId;
    })).toEqual([PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()]);
  });

  test("a finding from the future counts from now", async () => {
    await SecurityEntityRiskRecorder.record([
      finding({ seenAt: new Date(NOW.getTime() + 3 * DAY_IN_MS) }),
    ]);

    expect(rowOf("alice@corp.example")!["lastRiskAt"]).toEqual(NOW);
  });

  test("takes in at most ENTITY_RISK_ENTITIES_PER_CALL entities a call", async () => {
    const entities: Array<{ type: SecurityEntityType; value: string }> = [];

    for (let index: number = 0; index < ENTITY_RISK_ENTITIES_PER_CALL + 25; index++) {
      entities.push({ type: SecurityEntityType.IpAddress, value: `198.51.100.${index}` });
    }

    const result: SecurityEntityRiskRecordResult =
      await SecurityEntityRiskRecorder.record([finding({ entities })]);

    expect(result.entitiesUpdated).toBe(ENTITY_RISK_ENTITIES_PER_CALL);
  });

  test("weighs the score by the entity's criticality, and keeps which", async () => {
    install({
      rules: [
        { value: "dc-*", criticality: SecurityEntityCriticality.Extreme },
        {
          value: "alice@corp.example",
          entityType: SecurityEntityType.User,
          criticality: SecurityEntityCriticality.Low,
        },
      ],
    });

    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({
        entities: [{ type: SecurityEntityType.Host, value: "DC-01" }],
      }),
    ]);

    expect(rowOf("alice@corp.example")).toMatchObject({
      riskScore: 25,
      criticality: SecurityEntityCriticality.Low,
    });
    expect(rowOf("dc-01")).toMatchObject({
      riskScore: 100,
      criticality: SecurityEntityCriticality.Extreme,
    });
  });
});

describe("risk that opens a case", () => {
  test("reaching the threshold hands one detection about the entity to the case ingest, after the lock", async () => {
    await SecurityEntityRiskRecorder.record([
      finding({ mitreTactics: ["TA0006"] }),
      finding({
        sourceKey: "rule:spray",
        sourceName: "Password spraying",
        mitreTactics: ["TA0001"],
        mitreTechniques: ["T1110.003"],
      }),
    ]);

    expect(world.order).toEqual([
      `lock:${PROJECT_ID.toString()}`,
      "find",
      "create:alice@corp.example",
      "release",
      "ingest",
    ]);
    expect(world.signals).toHaveLength(1);

    const signal: SecurityDetectionSignal = world.signals[0]!;

    expect(signal).toMatchObject({
      projectId: PROJECT_ID,
      source: SecurityDetectionSource.EntityRisk,
      fingerprint: "entity-risk:alice@corp.example",
      title: "High risk — Alice@Corp.Example",
      severity: OcsfSeverity.High,
      eventCount: 2,
      groupValue: "Alice@Corp.Example",
      entities: [{ type: SecurityEntityType.User, value: "Alice@Corp.Example" }],
      ruleName: "Entity Risk",
      seenAt: NOW,
    });
    expect(signal.mitreTactics.sort()).toEqual(["TA0001", "TA0006"]);
    // It joins the open case about the entity.
    expect(securityCaseGroupingKey(signal)).toBe("entity:alice@corp.example");
    expect(signal.description).toContain("**100**");
    expect(signal.description).toContain("**Password spraying**");
    expect(signal.description).toContain("**Brute force**");

    expect(rowOf("alice@corp.example")!["riskCaseAt"]).toEqual(NOW);
  });

  test("Critical from twice the threshold", async () => {
    install({ threshold: 50 });

    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ sourceKey: "rule:b", points: 50 }),
    ]);

    expect(world.signals[0]!.severity).toBe(OcsfSeverity.Critical);
    expect(world.signals[0]!.title).toBe("Critical risk — Alice@Corp.Example");
  });

  test("the same findings never open a second case; new ones that add up again do", async () => {
    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ sourceKey: "rule:b" }),
    ]);

    expect(world.signals).toHaveLength(1);

    // The sources fire again, later: still counted, never again for a case.
    jest.setSystemTime(new Date(NOW.getTime() + 2 * HOUR_IN_MS));
    await SecurityEntityRiskRecorder.record([
      finding({ seenAt: new Date(NOW.getTime() + HOUR_IN_MS) }),
      finding({
        sourceKey: "rule:b",
        seenAt: new Date(NOW.getTime() + HOUR_IN_MS),
      }),
    ]);

    expect(world.signals).toHaveLength(1);
    expect(rowOf("alice@corp.example")!["riskScore"]).toBe(100);

    // One new source is not enough on its own ...
    await SecurityEntityRiskRecorder.record([
      finding({
        sourceKey: "rule:c",
        seenAt: new Date(NOW.getTime() + HOUR_IN_MS),
      }),
    ]);

    expect(world.signals).toHaveLength(1);

    // ... two new ones are.
    await SecurityEntityRiskRecorder.record([
      finding({
        sourceKey: "rule:d",
        seenAt: new Date(NOW.getTime() + HOUR_IN_MS),
      }),
    ]);

    expect(world.signals).toHaveLength(2);
    expect(rowOf("alice@corp.example")!["riskScore"]).toBe(200);
  });

  test("nothing opens while the project does not open cases from risk", async () => {
    install({ enabled: false });

    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ sourceKey: "rule:b", points: 100 }),
    ]);

    expect(world.spies.ingest).not.toHaveBeenCalled();
    expect(rowOf("alice@corp.example")).toMatchObject({ riskScore: 150 });
    expect(rowOf("alice@corp.example")!["riskCaseAt"]).toBeUndefined();
  });

  test("at the project's own threshold", async () => {
    install({ threshold: 150 });

    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ sourceKey: "rule:b" }),
    ]);

    expect(world.spies.ingest).not.toHaveBeenCalled();

    await SecurityEntityRiskRecorder.record([
      finding({ sourceKey: "rule:c" }),
    ]);

    expect(world.signals).toHaveLength(1);
  });
});

describe("never throwing", () => {
  test("a write that fails is logged; the other entities are written and the lock given back", async () => {
    world.spies.create.mockImplementationOnce(async () => {
      throw new Error("database is down");
    });

    const result: SecurityEntityRiskRecordResult =
      await SecurityEntityRiskRecorder.record([
        finding({
          entities: [
            { type: SecurityEntityType.User, value: "alice" },
            { type: SecurityEntityType.User, value: "bob" },
          ],
        }),
      ]);

    expect(result.entitiesUpdated).toBe(1);
    expect(rowOf("bob")).toBeDefined();
    expect(world.order[world.order.length - 1]).toBe("release");
    expect(world.spies.loggerError).toHaveBeenCalled();
  });

  test("a lock that cannot be taken costs the project's risk this time, nothing more", async () => {
    world.spies.lock.mockImplementationOnce(async () => {
      throw new Error("Redis client is not connected");
    });

    await expect(
      SecurityEntityRiskRecorder.record([finding()]),
    ).resolves.toEqual({ entitiesUpdated: 0, riskCasesRaised: 0 });
    expect(world.rows).toHaveLength(0);
  });

  test("a case ingest that fails leaves the risk written", async () => {
    world.spies.ingest.mockImplementationOnce(async () => {
      throw new Error("could not open the case");
    });

    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ sourceKey: "rule:b" }),
    ]);

    expect(rowOf("alice@corp.example")!["riskScore"]).toBe(100);
    expect(world.spies.loggerError).toHaveBeenCalled();
  });
});

describe("the refresh", () => {
  test("lowers a score as its next source stops counting, and never opens a case for it", async () => {
    await SecurityEntityRiskRecorder.record([
      finding({ seenAt: ago(6 * DAY_IN_MS) }),
      finding({ sourceKey: "rule:b", seenAt: ago(HOUR_IN_MS), points: 25 }),
      finding({
        entities: [{ type: SecurityEntityType.Host, value: "web-01" }],
        seenAt: ago(HOUR_IN_MS),
      }),
    ]);

    expect(rowOf("alice@corp.example")!["riskScore"]).toBe(75);

    world.order.length = 0;
    jest.setSystemTime(new Date(NOW.getTime() + 2 * DAY_IN_MS));

    const refreshed: number = await SecurityEntityRiskRecorder.refreshDue();

    // Only alice's brute force went quiet: web-01's sources all count still.
    expect(refreshed).toBe(1);
    expect(rowOf("alice@corp.example")).toMatchObject({
      riskScore: 25,
      contributorCount: 1,
    });
    expect(rowOf("web-01")!["riskScore"]).toBe(50);
    expect(world.spies.ingest).not.toHaveBeenCalled();
    expect(
      (rowOf("alice@corp.example")!["riskHistory"] as Array<SecurityEntityRiskHistoryPoint>),
    ).toEqual([
      { day: "2026-10-14", score: 75 },
      { day: "2026-10-16", score: 25 },
    ]);
    // Which projects are due is read first; each is then refreshed under its lock.
    expect(world.order).toEqual([
      "find",
      `lock:${PROJECT_ID.toString()}`,
      "find",
      "update:alice@corp.example",
      "release",
    ]);
  });

  test("a whole recompute weighs every entity anew, and a risk it raises can open a case", async () => {
    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({ sourceKey: "rule:b", points: 25 }),
    ]);

    expect(world.spies.ingest).not.toHaveBeenCalled();

    world.rules.push({
      value: "alice@*",
      criticality: SecurityEntityCriticality.High,
    });

    const refreshed: number = await SecurityEntityRiskRecorder.refreshProject({
      projectId: PROJECT_ID,
      isWhole: true,
    });

    expect(refreshed).toBe(1);
    expect(rowOf("alice@corp.example")).toMatchObject({
      riskScore: 113,
      criticality: SecurityEntityCriticality.High,
    });
    expect(world.signals).toHaveLength(1);
  });

  test("forgets the entities quiet for a month, and only them", async () => {
    await SecurityEntityRiskRecorder.record([
      finding(),
      finding({
        entities: [{ type: SecurityEntityType.Host, value: "web-01" }],
        seenAt: ago(5 * DAY_IN_MS),
      }),
    ]);

    /*
     * 27 days later both have gone quiet: alice's last finding was 27 days
     * ago, so she is kept at 0 with her history; web-01's 32 days ago, so it
     * is forgotten.
     */
    jest.setSystemTime(new Date(NOW.getTime() + 27 * DAY_IN_MS));
    await SecurityEntityRiskRecorder.refreshDue();

    expect(rowOf("alice@corp.example")).toMatchObject({
      riskScore: 0,
      contributorCount: 0,
    });
    expect(rowOf("alice@corp.example")!["riskExpiresAt"]).toBeNull();
    expect(rowOf("alice@corp.example")!["lastRiskAt"]).toEqual(
      ago(HOUR_IN_MS),
    );
    expect(rowOf("web-01")).toBeUndefined();

    jest.setSystemTime(new Date(NOW.getTime() + 40 * DAY_IN_MS));
    await SecurityEntityRiskRecorder.refreshDue();

    expect(world.rows).toHaveLength(0);
    expect(world.spies.ingest).not.toHaveBeenCalled();
  });
});
