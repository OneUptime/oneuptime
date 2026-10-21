import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import ProjectLimitLock from "../../../../Server/Utils/Database/ProjectLimitLock";
import DatabaseNotConnectedException from "../../../../Types/Exception/DatabaseNotConnectedException";
import ObjectID from "../../../../Types/ObjectID";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { DataSource, EntityManager } from "typeorm";

/*
 * ONE LIMIT, ONE PROJECT, ONE WRITE AT A TIME (Utils/Database/ProjectLimitLock).
 *
 * A limit on how many of something a project may have is a count and a
 * write decided together, in one transaction that first takes an advisory
 * lock named after the limit and the project. These pin the shape every
 * limit relies on - the lock is the transaction's first statement, the
 * work runs on that same transaction, a refusal ends it - with the
 * transaction faked; ActiveMonitorLimitPostgres shows what Postgres makes
 * of it when creates race.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000001",
);
const PROJECT_B: ObjectID = new ObjectID(
  "6a000000-0000-4000-8000-000000000002",
);

interface FakeTransaction {
  statements: Array<{ sql: string; parameters: Array<unknown> }>;
  manager: EntityManager;
  committed: boolean;
  rolledBack: boolean;
}

// A data source whose transaction records its statements and how it ended.
function useFakeDataSource(): FakeTransaction {
  const transaction: FakeTransaction = {
    statements: [],
    manager: {} as EntityManager,
    committed: false,
    rolledBack: false,
  };

  transaction.manager = {
    query: async (sql: string, parameters: Array<unknown>): Promise<[]> => {
      transaction.statements.push({ sql: sql, parameters: parameters });
      return [];
    },
  } as unknown as EntityManager;

  jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
  jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue({
    transaction: async (
      run: (manager: EntityManager) => Promise<unknown>,
    ): Promise<unknown> => {
      try {
        const result: unknown = await run(transaction.manager);
        transaction.committed = true;
        return result;
      } catch (error) {
        transaction.rolledBack = true;
        throw error;
      }
    },
  } as unknown as DataSource);

  return transaction;
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the lock's name", () => {
  test("is the limit's and the project's", () => {
    expect(
      ProjectLimitLock.getLockKey({
        limitName: "active-monitors",
        projectId: PROJECT_A,
      }),
    ).toBe(`project-limit:active-monitors:${PROJECT_A.toString()}`);
  });

  test("differs for another project and for another limit, so neither waits for the other", () => {
    const keys: Set<string> = new Set([
      ProjectLimitLock.getLockKey({
        limitName: "active-monitors",
        projectId: PROJECT_A,
      }),
      ProjectLimitLock.getLockKey({
        limitName: "active-monitors",
        projectId: PROJECT_B,
      }),
      ProjectLimitLock.getLockKey({ limitName: "seats", projectId: PROJECT_A }),
    ]);

    expect(keys.size).toBe(3);
  });

  test("is taken for the transaction, on a 64-bit hash of the name", () => {
    expect(ProjectLimitLock.LOCK_STATEMENT).toBe(
      "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    );
  });

  test("names the project by its uuid, not by how a request spelled it", () => {
    /*
     * Postgres reads a uuid in upper or mixed case, in braces, without
     * hyphens or with a hyphen after any four of its digits as the same
     * uuid, and so does every count a limit makes. The lock must name one
     * project, however the request that reaches it spelled its id - a lock
     * per spelling would let creates that name the project differently
     * count side by side again.
     */
    const canonical: string = PROJECT_A.toString().toLowerCase();
    const digits: string = canonical.split("-").join("");
    const everyFour: string = (digits.match(/[0-9a-f]{4}/g) || []).join("-");

    const spellings: Array<string> = [
      canonical,
      canonical.toUpperCase(),
      `{${canonical}}`,
      `{${canonical.toUpperCase()}}`,
      digits,
      digits.toUpperCase(),
      everyFour,
      `{${digits}}`,
    ];

    const keys: Set<string> = new Set(
      spellings.map((spelling: string): string => {
        return ProjectLimitLock.getLockKey({
          limitName: "seats",
          projectId: new ObjectID(spelling),
        });
      }),
    );

    expect(keys.size).toBe(1);
    expect(Array.from(keys)[0]).toBe(`project-limit:seats:${canonical}`);
  });

  test("refuses an id that is no uuid, so nothing is ever locked under a bad key", () => {
    expect(() => {
      return ProjectLimitLock.getLockKey({
        limitName: "seats",
        projectId: new ObjectID("not-a-uuid"),
      });
    }).toThrow("Invalid project ID");
  });
});

describe("running a write under the lock", () => {
  test("takes the lock first, then runs the work on the same transaction, and hands back what it returns", async () => {
    const transaction: FakeTransaction = useFakeDataSource();

    const result: string = await ProjectLimitLock.run({
      limitName: "active-monitors",
      projectId: PROJECT_A,
      run: async (manager: EntityManager): Promise<string> => {
        expect(manager).toBe(transaction.manager);
        await manager.query("SELECT 1 /* the count */", []);
        await manager.query("INSERT /* the write */", []);
        return "written";
      },
    });

    expect(result).toBe("written");
    expect(transaction.committed).toBe(true);
    expect(transaction.statements).toEqual([
      {
        sql: ProjectLimitLock.LOCK_STATEMENT,
        parameters: [`project-limit:active-monitors:${PROJECT_A.toString()}`],
      },
      { sql: "SELECT 1 /* the count */", parameters: [] },
      { sql: "INSERT /* the write */", parameters: [] },
    ]);
  });

  test("a refusal ends the transaction, rolled back, and reaches the caller as it was thrown", async () => {
    const transaction: FakeTransaction = useFakeDataSource();
    const refusal: Error = new Error("No room.");

    await expect(
      ProjectLimitLock.run({
        limitName: "active-monitors",
        projectId: PROJECT_A,
        run: async (): Promise<void> => {
          throw refusal;
        },
      }),
    ).rejects.toBe(refusal);

    expect(transaction.rolledBack).toBe(true);
    expect(transaction.committed).toBe(false);
  });

  test("with no database, says so and runs nothing", async () => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(false);
    let ran: boolean = false;

    await expect(
      ProjectLimitLock.run({
        limitName: "active-monitors",
        projectId: PROJECT_A,
        run: async (): Promise<void> => {
          ran = true;
        },
      }),
    ).rejects.toBeInstanceOf(DatabaseNotConnectedException);
    expect(ran).toBe(false);
  });
});
