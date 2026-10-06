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

function fake(options: {
  inTransaction?: boolean;
  /* Answers of the index catalog read, in order; the last one repeats. */
  index?: Array<Array<IndexRow>>;
  /* Answers of the foreign key catalog read, in order; the last repeats. */
  foreignKey?: Array<Array<{ isValidated: boolean }>>;
  /* Makes a raw-client statement fail. */
  clientError?: (text: string) => Error | null;
}): Fake {
  const log: Array<string> = [];
  const index: Array<Array<IndexRow>> = [...(options.index || [MISSING])];
  const foreignKey: Array<Array<{ isValidated: boolean }>> = [
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
          query_timeout: number;
        }): Promise<unknown> => {
          log.push(`client: ${config.text} (${config.query_timeout})`);
          const error: Error | null = options.clientError
            ? options.clientError(config.text)
            : null;
          if (error) {
            throw error;
          }
          return [];
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
        validate: `ALTER TABLE "Monitor" VALIDATE CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688"`,
      });
    });

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
});
