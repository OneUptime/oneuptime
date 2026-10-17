import CreateLimit from "../../../../Server/Types/Database/CreateLimit";
import ProjectCountLimit from "../../../../Server/Utils/Database/ProjectCountLimit";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import { EntityManager } from "typeorm";

/*
 * A LIMIT ON HOW MANY ROWS OF A KIND A PROJECT MAY HAVE, DECIDED WITH THE
 * INSERT (Utils/Database/ProjectCountLimit).
 *
 * The Free plan's status pages, subscribers, dashboards and escalation
 * rules are each one count against one number. The CreateLimit built here
 * counts with the manager it is handed - the INSERT's own transaction,
 * holding the limit's lock - and refuses once the count has reached the
 * number allowed. These pin that shape with the manager faked;
 * ProjectPlanLimitsPostgres races real creates.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "7b000000-0000-4000-8000-000000000001",
);

const STATEMENT: string =
  'SELECT COUNT(*)::int AS "count" FROM "Thing" WHERE "projectId" = $1';

interface FakeManager {
  manager: EntityManager;
  statements: Array<{ sql: string; parameters: Array<unknown> }>;
}

// A manager whose COUNT answers `rows`, recording what it was asked.
function managerAnswering(rows: Array<Record<string, unknown>>): FakeManager {
  const fake: FakeManager = {
    manager: {} as EntityManager,
    statements: [],
  };

  fake.manager = {
    query: async (
      sql: string,
      parameters: Array<unknown>,
    ): Promise<Array<Record<string, unknown>>> => {
      fake.statements.push({ sql: sql, parameters: parameters });
      return rows;
    },
  } as unknown as EntityManager;

  return fake;
}

function limitOf(allowed: number): CreateLimit {
  return ProjectCountLimit.getCreateLimit({
    limitName: "things",
    projectId: PROJECT_ID,
    allowed: allowed,
    statement: STATEMENT,
    parameters: [PROJECT_ID.toString()],
    refusal: "This project has all the things its plan allows.",
  });
}

describe("count", () => {
  test("runs the statement with its parameters on the manager it is handed", async () => {
    const fake: FakeManager = managerAnswering([{ count: 3 }]);

    await expect(
      ProjectCountLimit.count({
        manager: fake.manager,
        statement: STATEMENT,
        parameters: [PROJECT_ID.toString()],
      }),
    ).resolves.toBe(3);

    expect(fake.statements).toEqual([
      { sql: STATEMENT, parameters: [PROJECT_ID.toString()] },
    ]);
  });

  test("reads a count Postgres hands back as text", async () => {
    await expect(
      ProjectCountLimit.count({
        manager: managerAnswering([{ count: "12" }]).manager,
        statement: STATEMENT,
        parameters: [],
      }),
    ).resolves.toBe(12);
  });

  test("reads no row, and a null count, as none", async () => {
    for (const rows of [[], [{ count: null }]]) {
      await expect(
        ProjectCountLimit.count({
          manager: managerAnswering(rows).manager,
          statement: STATEMENT,
          parameters: [],
        }),
      ).resolves.toBe(0);
    }
  });
});

describe("getCreateLimit", () => {
  test("names the limit and the project its lock is taken on", () => {
    const limit: CreateLimit = limitOf(1);

    expect(limit.limitName).toBe("things");
    expect(limit.projectId).toBe(PROJECT_ID);
  });

  test("lets the create through while the project has fewer than allowed", async () => {
    for (const count of [0, 1, 4]) {
      const fake: FakeManager = managerAnswering([{ count: count }]);

      await expect(limitOf(5).check(fake.manager)).resolves.toBeUndefined();
      expect(fake.statements).toEqual([
        { sql: STATEMENT, parameters: [PROJECT_ID.toString()] },
      ]);
    }
  });

  test("refuses it in the limit's words once the project has as many as allowed, or more", async () => {
    for (const count of [5, 6, 40]) {
      await expect(
        limitOf(5).check(managerAnswering([{ count: count }]).manager),
      ).rejects.toThrow(
        new BadDataException(
          "This project has all the things its plan allows.",
        ),
      );
    }
  });

  test("a limit of one refuses the second row", async () => {
    await expect(
      limitOf(1).check(managerAnswering([{ count: 0 }]).manager),
    ).resolves.toBeUndefined();
    await expect(
      limitOf(1).check(managerAnswering([{ count: 1 }]).manager),
    ).rejects.toBeInstanceOf(BadDataException);
  });

  test("counts again on every check: a limit is asked once per create, with that create's transaction", async () => {
    const limit: CreateLimit = limitOf(2);
    const first: FakeManager = managerAnswering([{ count: 1 }]);
    const second: FakeManager = managerAnswering([{ count: 2 }]);

    await expect(limit.check(first.manager)).resolves.toBeUndefined();
    await expect(limit.check(second.manager)).rejects.toBeInstanceOf(
      BadDataException,
    );

    expect(first.statements).toHaveLength(1);
    expect(second.statements).toHaveLength(1);
  });
});
