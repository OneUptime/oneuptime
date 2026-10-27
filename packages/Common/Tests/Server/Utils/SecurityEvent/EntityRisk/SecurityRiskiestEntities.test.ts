import ProjectService from "../../../../../Server/Services/ProjectService";
import SecurityEntityRiskService from "../../../../../Server/Services/SecurityEntityRiskService";
import SecurityRiskiestEntitiesReader, {
  toRiskiestEntity,
} from "../../../../../Server/Utils/SecurityEvent/EntityRisk/SecurityRiskiestEntities";
import logger from "../../../../../Server/Utils/Logger";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityEntityRisk from "../../../../../Models/DatabaseModels/SecurityEntityRisk";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../../Types/ObjectID";
import PositiveNumber from "../../../../../Types/PositiveNumber";
import { SecurityEntityType } from "../../../../../Types/SecurityCase/SecurityEntity";
import {
  DEFAULT_ENTITY_RISK_CASE_THRESHOLD,
  ENTITY_RISK_CASE_THRESHOLD_MAX,
  ENTITY_RISK_CASE_THRESHOLD_MIN,
  SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT,
  SecurityRiskiestEntities,
} from "../../../../../Types/SecurityCase/SecurityEntityRisk";
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
 * The Security Overview's Riskiest Entities, as the server reads them: the
 * top of Entity Risk's list - every entity with risk now, the highest score
 * first, as the caller may read them - with the project's threshold, which
 * each score's level is read against, and how many entities have risk. It
 * replaced a ranking by how many findings named a value, which disagreed
 * with Entity Risk about who is riskiest. A read that fails says so with
 * null, and never throws: the rest of the overview is drawn either way.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "24242424-2424-4424-8424-242424242424",
);

const CALLER: DatabaseCommonInteractionProps = {
  userId: new ObjectID("25252525-2525-4525-8525-252525252525"),
  tenantId: PROJECT_ID,
} as DatabaseCommonInteractionProps;

interface FindArgs {
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  skip: number;
  limit: number;
  props: DatabaseCommonInteractionProps;
}

interface CountArgs {
  query: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

interface ProjectArgs {
  id: ObjectID;
  select: Record<string, unknown>;
  props: DatabaseCommonInteractionProps;
}

// A TypeORM Raw condition, as QueryHelper.greaterThan builds one.
interface RawCondition {
  type: string;
  getSql: (alias: string) => string;
  objectLiteralParameters: Record<string, unknown>;
}

function riskRow(data: {
  value: string;
  type?: string | undefined;
  score: number;
}): SecurityEntityRisk {
  const row: SecurityEntityRisk = new SecurityEntityRisk();
  row._id = ObjectID.generate().toString();
  row.entityValue = data.value;

  if (data.type !== undefined) {
    row.entityType = data.type as SecurityEntityType;
  }

  row.riskScore = data.score;

  return row;
}

const RANKED: Array<SecurityEntityRisk> = [
  riskRow({
    value: "k.morgan@acme-commerce.example",
    type: SecurityEntityType.User,
    score: 200,
  }),
  riskRow({
    value: "203.0.113.47",
    type: SecurityEntityType.IpAddress,
    score: 125,
  }),
  riskRow({ value: "fin-ws-112", type: SecurityEntityType.Host, score: 113 }),
];

let rows: Array<SecurityEntityRisk>;
let total: number;
let threshold: unknown;
let findFailure: Error | null;
let countFailure: Error | null;
let projectFailure: Error | null;
let spies: {
  findBy: Spy;
  countBy: Spy;
  project: Spy;
  loggerError: Spy;
};

beforeEach(() => {
  rows = RANKED;
  total = 9;
  threshold = 100;
  findFailure = null;
  countFailure = null;
  projectFailure = null;

  spies = {
    findBy: getJestSpyOn(SecurityEntityRiskService, "findBy").mockImplementation(
      async (): Promise<Array<SecurityEntityRisk>> => {
        if (findFailure) {
          throw findFailure;
        }

        return rows;
      },
    ),
    countBy: getJestSpyOn(
      SecurityEntityRiskService,
      "countBy",
    ).mockImplementation(async (): Promise<PositiveNumber> => {
      if (countFailure) {
        throw countFailure;
      }

      return new PositiveNumber(total);
    }),
    project: getJestSpyOn(ProjectService, "findOneById").mockImplementation(
      async (): Promise<Project | null> => {
        if (projectFailure) {
          throw projectFailure;
        }

        if (threshold === "none") {
          return null;
        }

        const project: Project = new Project();
        project.id = PROJECT_ID;
        project.securityRiskCaseThreshold = threshold as number;

        return project;
      },
    ),
    loggerError: getJestSpyOn(logger, "error").mockImplementation(() => {
      return undefined;
    }),
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function read(
  limit?: number | undefined,
): Promise<SecurityRiskiestEntities | null> {
  return SecurityRiskiestEntitiesReader.read({
    projectId: PROJECT_ID,
    props: CALLER,
    ...(limit !== undefined ? { limit } : {}),
  });
}

function findArgs(): FindArgs {
  return spies.findBy.mock.calls[0]![0] as FindArgs;
}

function countArgs(): CountArgs {
  return spies.countBy.mock.calls[0]![0] as CountArgs;
}

/*
 * What a Raw condition compares a column with, read back: its SQL for the
 * column, each parameter's random name written as :value, and the values.
 */
function describeCondition(condition: unknown): [string, Array<unknown>] {
  const raw: RawCondition = condition as RawCondition;
  let sql: string = raw.getSql("riskScore");

  expect(raw.type).toBe("raw");

  for (const name of Object.keys(raw.objectLiteralParameters)) {
    sql = sql.split(`:${name}`).join(":value");
  }

  return [sql, Object.values(raw.objectLiteralParameters)];
}

describe("the riskiest entities, as Entity Risk ranks them", () => {
  test("the rows the risk table holds, the highest score first, eight of them", async () => {
    await read();

    const args: FindArgs = findArgs();

    expect(SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT).toBe(8);
    expect(args.limit).toBe(SECURITY_OVERVIEW_RISKIEST_ENTITY_LIMIT);
    expect(args.skip).toBe(0);
    // The highest score first; of two at the same score, the one found about last.
    expect(args.sort).toEqual({
      riskScore: SortOrder.Descending,
      lastRiskAt: SortOrder.Descending,
    });
    expect(Object.keys(args.sort)).toEqual(["riskScore", "lastRiskAt"]);
    expect(args.select).toEqual({
      _id: true,
      entityValue: true,
      entityType: true,
      riskScore: true,
    });
  });

  test("only entities with risk now, in the caller's project: one whose sources went quiet is kept for its history, never ranked", async () => {
    await read();

    const query: Record<string, unknown> = findArgs().query;

    expect(Object.keys(query).sort()).toEqual(["projectId", "riskScore"]);
    expect(query["projectId"]).toBe(PROJECT_ID);

    expect(describeCondition(query["riskScore"])).toEqual([
      "(riskScore > :value)",
      [0],
    ]);
  });

  test("counts the same entities Entity Risk lists, for the card's way on to all of them", async () => {
    const answer: SecurityRiskiestEntities | null = await read();

    expect(answer!.total).toBe(9);

    const query: Record<string, unknown> = countArgs().query;

    expect(Object.keys(query).sort()).toEqual(["projectId", "riskScore"]);
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(describeCondition(query["riskScore"])).toEqual([
      "(riskScore > :value)",
      [0],
    ]);
  });

  test("reads the rows and the count as the caller: security data the Security tiers read", async () => {
    await read();

    expect(findArgs().props).toBe(CALLER);
    expect(countArgs().props).toBe(CALLER);
  });

  test("reads the project's threshold whatever the role: a setting, not security data", async () => {
    threshold = 250;

    const answer: SecurityRiskiestEntities | null = await read();
    const args: ProjectArgs = spies.project.mock.calls[0]![0] as ProjectArgs;

    expect(answer!.threshold).toBe(250);
    expect(args.id).toBe(PROJECT_ID);
    expect(args.select).toEqual({ securityRiskCaseThreshold: true });
    expect(args.props).toEqual({ isRoot: true });
  });

  test("a threshold the project does not have, or one out of range, reads as the product reads it everywhere", async () => {
    for (const [stored, readAs] of [
      ["none", DEFAULT_ENTITY_RISK_CASE_THRESHOLD],
      [undefined, DEFAULT_ENTITY_RISK_CASE_THRESHOLD],
      [3, ENTITY_RISK_CASE_THRESHOLD_MIN],
      [99999, ENTITY_RISK_CASE_THRESHOLD_MAX],
      [149.6, 150],
    ] as Array<[unknown, number]>) {
      threshold = stored;
      jest.clearAllMocks();

      const answer: SecurityRiskiestEntities | null = await read();

      expect([stored, answer!.threshold]).toEqual([stored, readAs]);
    }
  });

  test("hands over each entity's value, kind and score, in the order the table ranks them", async () => {
    const answer: SecurityRiskiestEntities | null = await read();

    expect(answer).toEqual({
      threshold: 100,
      total: 9,
      entities: [
        {
          value: "k.morgan@acme-commerce.example",
          type: SecurityEntityType.User,
          score: 200,
        },
        {
          value: "203.0.113.47",
          type: SecurityEntityType.IpAddress,
          score: 125,
        },
        { value: "fin-ws-112", type: SecurityEntityType.Host, score: 113 },
      ],
    });
  });

  test("a project with no risk has no entity to rank, and says it has none", async () => {
    rows = [];
    total = 0;

    expect(await read()).toEqual({ threshold: 100, total: 0, entities: [] });
  });

  test("a caller may ask for fewer", async () => {
    await read(3);

    expect(findArgs().limit).toBe(3);
  });
});

describe("a row as the overview hands it over", () => {
  test("keeps a kind the product knows, and names none it does not", () => {
    expect(
      toRiskiestEntity(
        riskRow({ value: "web-03", type: SecurityEntityType.Host, score: 50 }),
      ).type,
    ).toBe(SecurityEntityType.Host);
    expect(
      toRiskiestEntity(riskRow({ value: "web-03", type: "Robot", score: 50 }))
        .type,
    ).toBeNull();
    expect(toRiskiestEntity(riskRow({ value: "web-03", score: 50 })).type).toBe(
      null,
    );
  });

  test("a score is a whole number, never below nothing", () => {
    expect(
      toRiskiestEntity(riskRow({ value: "a", score: 112.5 })).score,
    ).toBe(113);
    expect(toRiskiestEntity(riskRow({ value: "a", score: -4 })).score).toBe(0);
    expect(
      toRiskiestEntity(riskRow({ value: "a", score: Number.NaN })).score,
    ).toBe(0);
  });

  test("a row without its value reads as an empty one, not a crash", () => {
    const row: SecurityEntityRisk = new SecurityEntityRisk();
    row.riskScore = 30;

    expect(toRiskiestEntity(row)).toEqual({ value: "", type: null, score: 30 });
  });
});

describe("a read that fails", () => {
  test.each([
    ["the rows", "find"],
    ["the count", "count"],
    ["the project's threshold", "project"],
  ])(
    "%s: null - the card says so, the overview is drawn - and the reason is logged",
    async (_what: string, failing: string) => {
      const failure: Error = new Error(`could not read ${failing}`);

      if (failing === "find") {
        findFailure = failure;
      } else if (failing === "count") {
        countFailure = failure;
      } else {
        projectFailure = failure;
      }

      await expect(read()).resolves.toBeNull();
      expect(spies.loggerError).toHaveBeenCalledWith(failure);
      expect(String(spies.loggerError.mock.calls[0]![0])).toContain(
        PROJECT_ID.toString(),
      );
    },
  );
});
