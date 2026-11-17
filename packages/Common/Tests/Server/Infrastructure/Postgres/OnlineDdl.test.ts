import OnlineDdl, {
  OnlineDdlLimits,
  OnlineForeignKey,
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import logger from "../../../../Server/Utils/Logger";
import Sleep from "../../../../Types/Sleep";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { QueryRunner } from "typeorm";

/*
 * OnlineDdl, statement by statement, against a stand-in query runner.
 *
 * The helpers take what `npm run generate-postgres-migration` wrote and run
 * the online form of it: CREATE INDEX CONCURRENTLY instead of CREATE INDEX,
 * ADD CONSTRAINT ... NOT VALID and a separate VALIDATE instead of ADD
 * CONSTRAINT. These cases pin the exact statements, in order, for every state
 * the catalog can be in when a migration runs - or runs again, since a
 * migration without a transaction is not rolled back and the schema
 * migration runner retries one that runs out of lock wait:
 *
 *   index      missing / valid / INVALID (a stopped build) / being built
 *   constraint missing / added NOT VALID / validated
 *
 * and what happens when the long step fails: the leftover is cleaned up and
 * the error is the migration's. Against a real Postgres, with writes running
 * beside the build, see SchemaMigrationLockRetryPostgres.test.ts.
 */

const LIMITS: OnlineDdlLimits = {
  statementTimeoutInMs: 600_000,
  lockTimeoutInMs: 120_000,
  clientTimeoutMarginInMs: 60_000,
  buildPollIntervalInMs: 5_000,
};

const GENERATED_INDEX: string = `CREATE INDEX "IDX_cdc971b41d78e4bed90a1d611b" ON "Monitor" ("projectId", "isArchived") `;

const ONLINE_INDEX: string = `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_cdc971b41d78e4bed90a1d611b" ON "Monitor" ("projectId", "isArchived")`;

const GENERATED_FOREIGN_KEY: string = `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`;

const SET_LIMITS: Array<string> = [
  "SET statement_timeout = 600000",
  "SET lock_timeout = 120000",
];

const RESTORE: Array<string> = [
  "SET statement_timeout = DEFAULT",
  "SET lock_timeout = DEFAULT",
];

type IndexRow = { isValid: boolean; isBuilding: boolean; regclass: string };

const VALID: Array<IndexRow> = [
  {
    isValid: true,
    isBuilding: false,
    regclass: '"IDX_cdc971b41d78e4bed90a1d611b"',
  },
];
const INVALID: Array<IndexRow> = [
  {
    isValid: false,
    isBuilding: false,
    regclass: '"IDX_cdc971b41d78e4bed90a1d611b"',
  },
];
const BUILDING: Array<IndexRow> = [
  {
    isValid: false,
    isBuilding: true,
    regclass: '"IDX_cdc971b41d78e4bed90a1d611b"',
  },
];
const MISSING: Array<IndexRow> = [];

interface Fake {
  queryRunner: QueryRunner;
  /*
   * Everything that ran, in order. Catalog reads show as "<index state>" /
   * "<foreign key state>"; what went through the raw client (the statements
   * with their own client timeout) as "client: ... (timeout)".
   */
  log: Array<string>;
}

/*
 * A foreign key as the catalog read answers: validated or not, and - for
 * replaceForeignKey - what it does on a delete and an update, and whether
 * it references the table the statement names.
 */
type ForeignKeyRow = {
  isValidated: boolean;
  onDelete?: string;
  onUpdate?: string;
  isSameTarget?: boolean;
};

function fake(options: {
  inTransaction?: boolean;
  /* Answers of the index catalog read, in order; the last one repeats. */
  index?: Array<Array<IndexRow>>;
  /* Answers of the foreign key catalog read, in order; the last repeats. */
  foreignKey?: Array<Array<ForeignKeyRow>>;
  /* Makes a raw-client statement fail. */
  clientError?: (text: string) => Error | null;
  /* What node-postgres answers for a raw-client statement ([] by default). */
  clientResult?: (text: string) => unknown;
}): Fake {
  const log: Array<string> = [];
  const index: Array<Array<IndexRow>> = [...(options.index || [MISSING])];
  const foreignKey: Array<Array<ForeignKeyRow>> = [
    ...(options.foreignKey || [[]]),
  ];

  function next<T>(answers: Array<T>): T {
    return answers.length > 1 ? answers.shift()! : answers[0]!;
  }

  const queryRunner: QueryRunner = {
    isTransactionActive: options.inTransaction === true,
    query: async (sql: string): Promise<unknown> => {
      if (sql.includes("FROM pg_index x")) {
        log.push("<index state>");
        return next(index);
      }
      if (sql.includes("FROM pg_constraint con")) {
        log.push("<foreign key state>");
        return next(foreignKey);
      }
      log.push(sql);
      return [];
    },
    connect: async (): Promise<unknown> => {
      return {
        query: async (config: {
          text: string;
          values?: Array<unknown>;
          query_timeout: number;
        }): Promise<unknown> => {
          log.push(
            config.values
              ? `client: ${config.text} ${JSON.stringify(config.values)} (${config.query_timeout})`
              : `client: ${config.text} (${config.query_timeout})`,
          );
          const error: Error | null = options.clientError
            ? options.clientError(config.text)
            : null;
          if (error) {
            throw error;
          }
          return options.clientResult ? options.clientResult(config.text) : [];
        },
      };
    },
  } as unknown as QueryRunner;

  return { queryRunner, log };
}

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("OnlineDdl", () => {
  beforeEach(() => {
    for (const level of ["debug", "info", "warn"] as const) {
      jest.spyOn(logger, level).mockImplementation(() => {
        return undefined as never;
      });
    }
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("reading a generated CREATE INDEX", () => {
    test("as the generator writes it, trailing space and all", () => {
      const index: OnlineIndex = OnlineDdl.parseCreateIndex(GENERATED_INDEX);

      expect(index).toEqual({
        quotedName: '"IDX_cdc971b41d78e4bed90a1d611b"',
        quotedTable: '"Monitor"',
        name: "IDX_cdc971b41d78e4bed90a1d611b",
        build: ONLINE_INDEX,
      });
    });

    test.each([
      [
        "a unique index",
        `CREATE UNIQUE INDEX "IDX_a" ON "Probe" ("key") `,
        `CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "IDX_a" ON "Probe" ("key")`,
      ],
      [
        "a partial index",
        `CREATE INDEX "IDX_b" ON "Monitor" ("projectId") WHERE "deletedAt" IS NULL`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_b" ON "Monitor" ("projectId") WHERE "deletedAt" IS NULL`,
      ],
      [
        "a schema-qualified table",
        `CREATE INDEX "IDX_c" ON "public"."Monitor" ("projectId")`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_c" ON "public"."Monitor" ("projectId")`,
      ],
      [
        "one already written online",
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_d" ON "Monitor" ("projectId");`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_d" ON "Monitor" ("projectId")`,
      ],
      [
        "a quoted quote in a name",
        `CREATE INDEX "IDX_""e" ON "Monitor" ("projectId")`,
        `CREATE INDEX CONCURRENTLY IF NOT EXISTS "IDX_""e" ON "Monitor" ("projectId")`,
      ],
    ])("%s", (_label: string, generated: string, online: string) => {
      expect(OnlineDdl.parseCreateIndex(generated).build).toBe(online);
    });

    test("names the index as the catalog does", () => {
      expect(
        OnlineDdl.parseCreateIndex(`CREATE INDEX "IDX_""e" ON "Monitor" ("x")`)
          .name,
      ).toBe('IDX_"e');
    });

    test.each([
      [`ALTER TABLE "Monitor" ADD "x" boolean`],
      [`CREATE INDEX ON "Monitor" ("projectId")`],
      [`DROP INDEX "public"."IDX_x"`],
    ])("refuses anything else: %s", (statement: string) => {
      expect(() => {
        return OnlineDdl.parseCreateIndex(statement);
      }).toThrow("expects a CREATE INDEX statement as the generator writes it");
    });
  });

  describe("reading a generated foreign key", () => {
    test("as the generator writes it", () => {
      const foreignKey: OnlineForeignKey = OnlineDdl.parseAddForeignKey(
        GENERATED_FOREIGN_KEY,
      );

      expect(foreignKey).toEqual({
        quotedTable: '"Monitor"',
        quotedName: '"FK_3e1a5a33af8c38b49ff26a08688"',
        name: "FK_3e1a5a33af8c38b49ff26a08688",
        addNotValid: `${GENERATED_FOREIGN_KEY} NOT VALID`,
        replaceNotValid: `ALTER TABLE "Monitor" DROP CONSTRAINT IF EXISTS "FK_3e1a5a33af8c38b49ff26a08688", ADD CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID`,
        validate: `ALTER TABLE "Monitor" VALIDATE CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688"`,
        quotedReferencedTable: '"User"',
        onDelete: "n",
        onUpdate: "a",
      });
    });

    test.each([
      ["ON DELETE CASCADE", "c", "a"],
      ["ON DELETE SET NULL ON UPDATE NO ACTION", "n", "a"],
      ["ON DELETE SET DEFAULT ON UPDATE CASCADE", "d", "c"],
      ["ON DELETE RESTRICT", "r", "a"],
      ["ON DELETE NO ACTION ON UPDATE SET NULL", "a", "n"],
      ["", "a", "a"],
      ["on delete set   null", "n", "a"],
    ])(
      "what it does on a delete and an update, as pg_constraint spells it: %s",
      (actions: string, onDelete: string, onUpdate: string) => {
        const foreignKey: OnlineForeignKey = OnlineDdl.parseAddForeignKey(
          `ALTER TABLE "Monitor" ADD CONSTRAINT "FK_x" FOREIGN KEY ("fooId") REFERENCES "public"."Foo"("_id") ${actions}`,
        );

        expect({
          onDelete: foreignKey.onDelete,
          onUpdate: foreignKey.onUpdate,
          quotedReferencedTable: foreignKey.quotedReferencedTable,
        }).toEqual({
          onDelete,
          onUpdate,
          quotedReferencedTable: '"public"."Foo"',
        });
      },
    );

    test("one already NOT VALID is not marked twice", () => {
      expect(
        OnlineDdl.parseAddForeignKey(`${GENERATED_FOREIGN_KEY} NOT VALID;`)
          .addNotValid,
      ).toBe(`${GENERATED_FOREIGN_KEY} NOT VALID`);
    });

    test.each([
      [`ALTER TABLE "Monitor" ADD CONSTRAINT "UQ_x" UNIQUE ("slug")`],
      [`ALTER TABLE "Monitor" ADD "x" uuid`],
      [GENERATED_INDEX],
    ])("refuses anything else: %s", (statement: string) => {
      expect(() => {
        return OnlineDdl.parseAddForeignKey(statement);
      }).toThrow("expects an ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY");
    });
  });

  describe("createIndex", () => {
    test("refuses to run inside a transaction, before touching anything", async () => {
      const f: Fake = fake({ inTransaction: true });

      await expect(
        OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS),
      ).rejects.toThrow("public transaction: boolean = false;");
      expect(f.log).toEqual([]);
    });

    test("builds a missing index online, within its own bounds, then gives the connection its settings back", async () => {
      const f: Fake = fake({ index: [MISSING, VALID] });

      await OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS);

      expect(f.log).toEqual([
        "<index state>",
        ...SET_LIMITS,
        // The client waits past the server's own timeout, so Postgres ends it.
        `client: ${ONLINE_INDEX} (660000)`,
        ...RESTORE,
        "<index state>",
      ]);
    });

    test("leaves an index that is already valid alone", async () => {
      const f: Fake = fake({ index: [VALID] });

      await OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS);

      expect(f.log).toEqual(["<index state>"]);
    });

    test("drops the INVALID copy a stopped build left, then builds it again", async () => {
      const f: Fake = fake({ index: [INVALID, INVALID, VALID] });

      await OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS);

      expect(f.log).toEqual([
        "<index state>",
        "<index state>",
        ...SET_LIMITS,
        `client: DROP INDEX CONCURRENTLY IF EXISTS "IDX_cdc971b41d78e4bed90a1d611b" (660000)`,
        ...RESTORE,
        ...SET_LIMITS,
        `client: ${ONLINE_INDEX} (660000)`,
        ...RESTORE,
        "<index state>",
      ]);
    });

    /*
     * A migrate pod stopped mid-build leaves its build running on the
     * server. Dropping that index would only queue behind the build.
     */
    test("waits for a build still running elsewhere, and builds nothing if it finished", async () => {
      const sleeps: Array<number> = [];
      jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
        sleeps.push(ms);
      });
      const f: Fake = fake({ index: [BUILDING, BUILDING, VALID] });

      await OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS);

      expect(sleeps).toEqual([5000, 5000]);
      expect(f.log).toEqual([
        "<index state>",
        "<index state>",
        "<index state>",
      ]);
    });

    test("stops waiting for that build after its own statement timeout", async () => {
      let now: number = 0;
      jest.spyOn(Date, "now").mockImplementation((): number => {
        return now;
      });
      jest.spyOn(Sleep, "sleep").mockImplementation(async (ms: number) => {
        now += ms;
      });
      const f: Fake = fake({ index: [BUILDING] });

      await expect(
        OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS),
      ).rejects.toThrow("was still being built by another session after 600 s");
    });

    test("a build that fails leaves no INVALID index behind, and fails the migration with its own error", async () => {
      const failure: Error = pgError(
        "canceling statement due to lock timeout",
        "55P03",
      );
      const f: Fake = fake({
        index: [MISSING, INVALID, INVALID, MISSING],
        clientError: (text: string): Error | null => {
          return text.startsWith("CREATE INDEX") ? failure : null;
        },
      });

      await expect(
        OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS),
      ).rejects.toBe(failure);

      expect(f.log).toEqual([
        "<index state>",
        ...SET_LIMITS,
        `client: ${ONLINE_INDEX} (660000)`,
        // Settings come back even though the build threw.
        ...RESTORE,
        "<index state>",
        "<index state>",
        ...SET_LIMITS,
        `client: DROP INDEX CONCURRENTLY IF EXISTS "IDX_cdc971b41d78e4bed90a1d611b" (660000)`,
        ...RESTORE,
      ]);
    });

    test("a build the client stopped waiting for, but that finished, is a success", async () => {
      const f: Fake = fake({
        index: [MISSING, VALID],
        clientError: (text: string): Error | null => {
          return text.startsWith("CREATE INDEX")
            ? new Error("Query read timeout")
            : null;
        },
      });

      await expect(
        OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS),
      ).resolves.toBeUndefined();
    });

    test("an index of the same name on another table is not taken for this one", async () => {
      // IF NOT EXISTS skips the build; the table still has no such index.
      const f: Fake = fake({ index: [MISSING, MISSING] });

      await expect(
        OnlineDdl.createIndex(f.queryRunner, GENERATED_INDEX, LIMITS),
      ).rejects.toThrow('"Monitor" has no valid index');
    });
  });

  describe("dropIndex", () => {
    test("drops online outside a transaction", async () => {
      const f: Fake = fake({});

      await OnlineDdl.dropIndex(
        f.queryRunner,
        `DROP INDEX "public"."IDX_cdc971b41d78e4bed90a1d611b"`,
        LIMITS,
      );

      expect(f.log).toEqual([
        ...SET_LIMITS,
        `client: DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_cdc971b41d78e4bed90a1d611b" (660000)`,
        ...RESTORE,
      ]);
    });

    /* TypeORM reverts every migration inside a transaction. */
    test("inside the transaction TypeORM reverts in, drops at once, waiting at most the migration lock wait", async () => {
      const f: Fake = fake({ inTransaction: true });

      await OnlineDdl.dropIndex(
        f.queryRunner,
        `DROP INDEX "public"."IDX_cdc971b41d78e4bed90a1d611b"`,
        LIMITS,
      );

      expect(f.log).toEqual([
        "SET LOCAL lock_timeout = 2000",
        `DROP INDEX IF EXISTS "public"."IDX_cdc971b41d78e4bed90a1d611b"`,
      ]);
    });

    test("refuses anything else", async () => {
      await expect(
        OnlineDdl.dropIndex(fake({}).queryRunner, GENERATED_INDEX, LIMITS),
      ).rejects.toThrow("expects a DROP INDEX statement");
    });
  });

  /*
   * A statement that may take long but blocks no read or write of the
   * app's: a DELETE of a "User" row, which Postgres checks against over a
   * thousand referencing columns by scanning them - about 12 s a user on
   * OneUptime Cloud, so a handful of users in one statement ran out of the
   * 30 s statement timeout and failed the release's migrate Job.
   */
  describe("runLongStatement", () => {
    const DELETE_PERSON: string = `DELETE FROM "User" WHERE "_id" = $1 AND "sampleProjectId" IS NOT NULL`;
    const PERSON: string = "c2a86c90-3fe0-4452-b59b-6e3f0e5a9803";

    test("runs within its own bounds, with its parameters, then gives the connection its settings back", async () => {
      const f: Fake = fake({
        clientResult: () => {
          return { rowCount: 1, rows: [] };
        },
      });

      const changed: number = await OnlineDdl.runLongStatement(
        f.queryRunner,
        DELETE_PERSON,
        [PERSON],
        LIMITS,
      );

      expect(changed).toBe(1);
      expect(f.log).toEqual([
        ...SET_LIMITS,
        `client: ${DELETE_PERSON} ["${PERSON}"] (660000)`,
        ...RESTORE,
      ]);
    });

    test("the client waits past the statement timeout, so Postgres - not the client - ends an overlong statement", async () => {
      const f: Fake = fake({});

      await OnlineDdl.runLongStatement(
        f.queryRunner,
        DELETE_PERSON,
        [PERSON],
        LIMITS,
      );

      const clientTimeout: number = Number(
        f.log
          .find((line: string): boolean => {
            return line.startsWith("client:");
          })!
          .match(/\((\d+)\)$/)![1],
      );

      expect(clientTimeout).toBe(
        LIMITS.statementTimeoutInMs + LIMITS.clientTimeoutMarginInMs,
      );
      expect(clientTimeout).toBeGreaterThan(LIMITS.statementTimeoutInMs);
    });

    test("long enough by default for a delete that scans every table referencing a user", async () => {
      const f: Fake = fake({});

      await OnlineDdl.runLongStatement(f.queryRunner, DELETE_PERSON, [PERSON]);

      // ONLINE_DDL_LIMITS: half an hour, far past the 30 s pool timeout.
      expect(f.log[0]).toBe("SET statement_timeout = 1800000");
      expect(f.log).toContain(
        `client: ${DELETE_PERSON} ["${PERSON}"] (1860000)`,
      );
      expect(f.log.slice(-2)).toEqual(RESTORE);
    });

    test("a statement without parameters is sent without any", async () => {
      const f: Fake = fake({});

      await OnlineDdl.runLongStatement(
        f.queryRunner,
        `DELETE FROM "Project" WHERE "isSampleProject" = true`,
        [],
        LIMITS,
      );

      expect(f.log).toContain(
        `client: DELETE FROM "Project" WHERE "isSampleProject" = true (660000)`,
      );
    });

    test("refuses to run inside a transaction, before touching anything: the transaction would keep its locks until it commits", async () => {
      const f: Fake = fake({ inTransaction: true });

      await expect(
        OnlineDdl.runLongStatement(
          f.queryRunner,
          DELETE_PERSON,
          [PERSON],
          LIMITS,
        ),
      ).rejects.toThrow("public transaction: boolean = false;");
      expect(f.log).toEqual([]);
    });

    test("a statement that fails still gives the connection its settings back, and the failure is the caller's", async () => {
      const f: Fake = fake({
        clientError: () => {
          return pgError(
            "canceling statement due to statement timeout",
            "57014",
          );
        },
      });

      await expect(
        OnlineDdl.runLongStatement(
          f.queryRunner,
          DELETE_PERSON,
          [PERSON],
          LIMITS,
        ),
      ).rejects.toThrow("canceling statement due to statement timeout");
      expect(f.log.slice(-2)).toEqual(RESTORE);
    });

    test("answers how many rows changed, and none when the driver says nothing about it", async () => {
      const deleted: Fake = fake({
        clientResult: () => {
          return { rowCount: 3 };
        },
      });
      const unknown: Fake = fake({
        clientResult: () => {
          return undefined;
        },
      });

      expect(
        await OnlineDdl.runLongStatement(
          deleted.queryRunner,
          DELETE_PERSON,
          [PERSON],
          LIMITS,
        ),
      ).toBe(3);
      expect(
        await OnlineDdl.runLongStatement(
          unknown.queryRunner,
          DELETE_PERSON,
          [PERSON],
          LIMITS,
        ),
      ).toBe(0);
    });
  });

  describe("addForeignKey", () => {
    const VALIDATE: string = `ALTER TABLE "Monitor" VALIDATE CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688"`;

    test("refuses to run inside a transaction: the scan would run under the ADD's lock", async () => {
      const f: Fake = fake({ inTransaction: true });

      await expect(
        OnlineDdl.addForeignKey(f.queryRunner, GENERATED_FOREIGN_KEY, LIMITS),
      ).rejects.toThrow("public transaction: boolean = false;");
      expect(f.log).toEqual([]);
    });

    test("adds it NOT VALID, then validates it in a statement of its own, within its own bounds", async () => {
      const f: Fake = fake({ foreignKey: [[]] });

      await OnlineDdl.addForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual([
        "<foreign key state>",
        `${GENERATED_FOREIGN_KEY} NOT VALID`,
        ...SET_LIMITS,
        `client: ${VALIDATE} (660000)`,
        ...RESTORE,
      ]);
    });

    test("validates one an earlier run added NOT VALID", async () => {
      const f: Fake = fake({ foreignKey: [[{ isValidated: false }]] });

      await OnlineDdl.addForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual([
        "<foreign key state>",
        ...SET_LIMITS,
        `client: ${VALIDATE} (660000)`,
        ...RESTORE,
      ]);
    });

    test("leaves a validated one alone", async () => {
      const f: Fake = fake({ foreignKey: [[{ isValidated: true }]] });

      await OnlineDdl.addForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual(["<foreign key state>"]);
    });

    test("rows that violate it: the constraint goes again, and the migration fails saying so", async () => {
      const f: Fake = fake({
        foreignKey: [[]],
        clientError: (text: string): Error | null => {
          return text === VALIDATE
            ? pgError(
                'insert or update on table "Monitor" violates foreign key constraint "FK_3e1a5a33af8c38b49ff26a08688"',
                "23503",
              )
            : null;
        },
      });

      await expect(
        OnlineDdl.addForeignKey(f.queryRunner, GENERATED_FOREIGN_KEY, LIMITS),
      ).rejects.toThrow(
        'Rows of "Monitor" violate "FK_3e1a5a33af8c38b49ff26a08688", so it was not added',
      );
      expect(f.log.slice(-1)).toEqual([
        `ALTER TABLE "Monitor" DROP CONSTRAINT IF EXISTS "FK_3e1a5a33af8c38b49ff26a08688"`,
      ]);
    });

    test("a validation that ran out of lock wait keeps the NOT VALID constraint for the retry", async () => {
      const failure: Error = pgError(
        "canceling statement due to lock timeout",
        "55P03",
      );
      const f: Fake = fake({
        foreignKey: [[]],
        clientError: (text: string): Error | null => {
          return text === VALIDATE ? failure : null;
        },
      });

      await expect(
        OnlineDdl.addForeignKey(f.queryRunner, GENERATED_FOREIGN_KEY, LIMITS),
      ).rejects.toBe(failure);
      expect(f.log).not.toContainEqual(
        expect.stringContaining("DROP CONSTRAINT"),
      );
      expect(f.log.slice(-2)).toEqual(RESTORE);
    });
  });

  /*
   * A key whose ON DELETE changes (issue #9036): what the generator wrote
   * as a DROP and an ADD of the same constraint, swapped in one statement
   * NOT VALID - so the table is never without it - then validated online.
   */
  describe("replaceForeignKey", () => {
    // What the key on "Monitor" was: deleting the person deleted the monitor.
    const CASCADE_ROW: Array<{
      isValidated: boolean;
      onDelete: string;
      onUpdate: string;
      isSameTarget: boolean;
    }> = [
      { isValidated: true, onDelete: "c", onUpdate: "a", isSameTarget: true },
    ];

    const SWAP: string = `ALTER TABLE "Monitor" DROP CONSTRAINT IF EXISTS "FK_3e1a5a33af8c38b49ff26a08688", ADD CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION NOT VALID`;
    const VALIDATE: string = `ALTER TABLE "Monitor" VALIDATE CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688"`;

    test("refuses to run inside a transaction, before touching anything", async () => {
      const f: Fake = fake({ inTransaction: true });

      await expect(
        OnlineDdl.replaceForeignKey(
          f.queryRunner,
          GENERATED_FOREIGN_KEY,
          LIMITS,
        ),
      ).rejects.toThrow("public transaction: boolean = false;");
      expect(f.log).toEqual([]);
    });

    test("swaps the old key for the new in one statement, NOT VALID, then validates it within its own bounds", async () => {
      const f: Fake = fake({ foreignKey: [CASCADE_ROW] });

      await OnlineDdl.replaceForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual([
        "<foreign key state>",
        SWAP,
        ...SET_LIMITS,
        `client: ${VALIDATE} (660000)`,
        ...RESTORE,
      ]);
      // Never a DROP on its own: the table is never without the key.
      expect(
        f.log.filter((statement: string): boolean => {
          return statement.startsWith('ALTER TABLE "Monitor" DROP CONSTRAINT');
        }),
      ).toEqual([SWAP]);
    });

    test("adds one that is not there at all, in the same one statement", async () => {
      const f: Fake = fake({ foreignKey: [[]] });

      await OnlineDdl.replaceForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual([
        "<foreign key state>",
        SWAP,
        ...SET_LIMITS,
        `client: ${VALIDATE} (660000)`,
        ...RESTORE,
      ]);
    });

    test("run again, leaves a key already replaced and validated alone", async () => {
      const f: Fake = fake({
        foreignKey: [
          [
            {
              isValidated: true,
              onDelete: "n",
              onUpdate: "a",
              isSameTarget: true,
            },
          ],
        ],
      });

      await OnlineDdl.replaceForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual(["<foreign key state>"]);
    });

    test("run again after a stop before its validation, validates the key it swapped in without swapping again", async () => {
      const f: Fake = fake({
        foreignKey: [
          [
            {
              isValidated: false,
              onDelete: "n",
              onUpdate: "a",
              isSameTarget: true,
            },
          ],
        ],
      });

      await OnlineDdl.replaceForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(f.log).toEqual([
        "<foreign key state>",
        ...SET_LIMITS,
        `client: ${VALIDATE} (660000)`,
        ...RESTORE,
      ]);
    });

    test.each([
      [
        "it still cascades",
        { onDelete: "c", onUpdate: "a", isSameTarget: true },
      ],
      [
        "its ON UPDATE differs",
        { onDelete: "n", onUpdate: "c", isSameTarget: true },
      ],
      [
        "it references another table",
        { onDelete: "n", onUpdate: "a", isSameTarget: false },
      ],
    ])(
      "swaps a key of that name when %s",
      async (
        _label: string,
        row: { onDelete: string; onUpdate: string; isSameTarget: boolean },
      ) => {
        const f: Fake = fake({
          foreignKey: [[{ isValidated: true, ...row }]],
        });

        await OnlineDdl.replaceForeignKey(
          f.queryRunner,
          GENERATED_FOREIGN_KEY,
          LIMITS,
        );

        expect(f.log).toContain(SWAP);
      },
    );

    test("asks the catalog for the key on its own table, and for the table it references", async () => {
      const reads: Array<Array<unknown>> = [];
      const f: Fake = fake({ foreignKey: [CASCADE_ROW] });
      const query: QueryRunner["query"] = f.queryRunner.query;

      f.queryRunner.query = (async (
        sql: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        if (sql.includes("FROM pg_constraint con")) {
          reads.push(parameters || []);
          expect(sql).toContain("con.confdeltype");
          expect(sql).toContain("con.confupdtype");
        }

        return query(sql, parameters);
      }) as QueryRunner["query"];

      await OnlineDdl.replaceForeignKey(
        f.queryRunner,
        GENERATED_FOREIGN_KEY,
        LIMITS,
      );

      expect(reads).toEqual([
        ['"Monitor"', "FK_3e1a5a33af8c38b49ff26a08688", '"User"'],
      ]);
    });

    test("rows that violate it fail the migration, and the key stays as swapped - the table is never left without one", async () => {
      const f: Fake = fake({
        foreignKey: [CASCADE_ROW],
        clientError: (text: string): Error | null => {
          return text === VALIDATE
            ? pgError(
                'insert or update on table "Monitor" violates foreign key constraint "FK_3e1a5a33af8c38b49ff26a08688"',
                "23503",
              )
            : null;
        },
      });

      await expect(
        OnlineDdl.replaceForeignKey(
          f.queryRunner,
          GENERATED_FOREIGN_KEY,
          LIMITS,
        ),
      ).rejects.toThrow(
        'Rows of "Monitor" violate "FK_3e1a5a33af8c38b49ff26a08688", so it could not be validated. It stays NOT VALID',
      );
      expect(
        f.log.filter((statement: string): boolean => {
          return statement.includes("DROP CONSTRAINT");
        }),
      ).toEqual([SWAP]);
      expect(f.log.slice(-2)).toEqual(RESTORE);
    });

    test("a validation that ran out of lock wait keeps the swapped key for the retry", async () => {
      const failure: Error = pgError(
        "canceling statement due to lock timeout",
        "55P03",
      );
      const f: Fake = fake({
        foreignKey: [CASCADE_ROW],
        clientError: (text: string): Error | null => {
          return text === VALIDATE ? failure : null;
        },
      });

      await expect(
        OnlineDdl.replaceForeignKey(
          f.queryRunner,
          GENERATED_FOREIGN_KEY,
          LIMITS,
        ),
      ).rejects.toBe(failure);
      expect(f.log).toEqual([
        "<foreign key state>",
        SWAP,
        ...SET_LIMITS,
        `client: ${VALIDATE} (660000)`,
        ...RESTORE,
      ]);
    });

    test("refuses anything but a generated foreign key", async () => {
      const f: Fake = fake({});

      await expect(
        OnlineDdl.replaceForeignKey(
          f.queryRunner,
          `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688"`,
          LIMITS,
        ),
      ).rejects.toThrow(
        "expects an ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY",
      );
      expect(f.log).toEqual([]);
    });
  });
});
