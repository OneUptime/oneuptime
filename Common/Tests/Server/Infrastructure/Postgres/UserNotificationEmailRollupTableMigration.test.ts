import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddUserNotificationEmailRollup1791000000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1791000000000-AddUserNotificationEmailRollup";
import UserNotificationEmailRollupBatch from "../../../../Models/DatabaseModels/UserNotificationEmailRollupBatch";
import UserNotificationEmailRollupItem from "../../../../Models/DatabaseModels/UserNotificationEmailRollupItem";
import Columns from "../../../../Types/Database/Columns";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migration that creates the two tables behind owner email burst
 * coalescing.
 *
 * The SQL is generated, and the schema-drift job already proves it matches the
 * entities, so this file does not re-check TypeORM's spelling — that would only
 * break on every unrelated regeneration. What it pins is the small set of
 * decisions a regeneration would silently reverse, each of which is a
 * correctness or data-loss change that no functional test would notice:
 *
 *  1. THE UNIQUE INDEX ON THE BATCH TABLE IS THE EXACTLY-ONCE MECHANISM.
 *     (projectId, userId, toEmail, claimEpochStartsAt) being UNIQUE is what
 *     stops two worker replicas both flushing the same recipient's queue and
 *     mailing them twice, and it is what makes "at most twelve rollups an hour"
 *     a database guarantee rather than an aspiration. A conditional UPDATE
 *     cannot replace it: DatabaseService._updateBy resolves its predicate in a
 *     separate find and then writes per row by _id, so it is check-then-act.
 *     Drop the UNIQUE and the feature still appears to work, right up until two
 *     replicas race.
 *
 *  2. EVERY projectId / userId FOREIGN KEY CASCADES. Queued mail about a
 *     deleted project, addressed to a deleted user, must go with them. SET NULL
 *     — the shape a hand adds by reflex, and what the audit-tail columns on
 *     most other models use — would leave orphan rows whose NOT NULL tenant
 *     column cannot be satisfied.
 *
 *  3. rollupBatchId HAS NO FOREIGN KEY AT ALL. It is a stamp, not a relation. A
 *     CASCADE would delete items when their batch is pruned at thirty days
 *     while the items are kept for seven; a SET NULL would un-stamp already
 *     sent items and re-send a month-old rollup to a real inbox.
 *
 *  4. sentAt IS NULLABLE WITH NO DEFAULT, because NULL means "still pending".
 *     That is what makes the tables correct on an upgraded install with no data
 *     migration and no backfill.
 *
 *  5. eventType IS varchar(500), NOT varchar(100). The stored
 *     NotificationSettingEventType values are English prose sentences; at 100
 *     characters DatabaseService.checkMaxLengthOfFields would throw, and on
 *     this code path that throw is swallowed by the write path's fail-open
 *     catch — so the symptom would be "the rollup silently never engages",
 *     which is exactly the kind of bug that ships.
 *
 * The registry-wide ordering guard lives in SchemaMigrationsOrdering.test.ts.
 * What is asserted here is only this migration's own registration and its
 * file/class pairing.
 */

const MIGRATION_FILE_NAME: string =
  "1791000000000-AddUserNotificationEmailRollup.ts";

const MIGRATION_CLASS_NAME: string =
  "AddUserNotificationEmailRollup1791000000000";

const MIGRATION_PATH: string = path.join(
  __dirname,
  `../../../../Server/Infrastructure/Postgres/SchemaMigrations/${MIGRATION_FILE_NAME}`,
);

const SOURCE: string = fs.readFileSync(MIGRATION_PATH, "utf8");

/*
 * The SQL is split into the two halves before anything is asserted about
 * ordering, because "created then dropped" only means something if the drop
 * really is in down() rather than a second statement in up().
 */
function bodyOf(method: "up" | "down"): string {
  const start: number = SOURCE.indexOf(`public async ${method}(`);

  expect(start).toBeGreaterThan(-1);

  const end: number =
    method === "up" ? SOURCE.indexOf("public async down(") : SOURCE.length;

  return SOURCE.slice(start, end);
}

const UP: string = bodyOf("up");
const DOWN: string = bodyOf("down");

function statementsIn(body: string): Array<string> {
  return [...body.matchAll(/`([^`]+)`/g)].map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

const UP_STATEMENTS: Array<string> = statementsIn(UP);
const DOWN_STATEMENTS: Array<string> = statementsIn(DOWN);

function createTableStatement(tableName: string): string {
  const statement: string | undefined = UP_STATEMENTS.find(
    (candidate: string): boolean => {
      return candidate.startsWith(`CREATE TABLE "${tableName}"`);
    },
  );

  expect(statement).toBeDefined();

  return statement as string;
}

/*
 * The column definitions out of a CREATE TABLE, keyed by column name and with
 * the definition kept verbatim so NOT NULL and DEFAULT can both be read off it.
 * The split is on a comma followed by a quoted name or by CONSTRAINT, which is
 * every separator in a generated CREATE TABLE and none of the commas that could
 * appear inside one definition.
 */
function columnDefinitions(createTableSql: string): Map<string, string> {
  const body: string = createTableSql.slice(
    createTableSql.indexOf("(") + 1,
    createTableSql.lastIndexOf(")"),
  );

  const definitions: Map<string, string> = new Map<string, string>();

  for (const part of body.split(/,\s(?=(?:"|CONSTRAINT\s))/)) {
    const match: RegExpMatchArray | null = part.match(/^"(\w+)"\s([\s\S]+)$/);

    if (match) {
      definitions.set(match[1] as string, match[2] as string);
    }
  }

  return definitions;
}

const ITEM_COLUMNS: Map<string, string> = columnDefinitions(
  createTableStatement("UserNotificationEmailRollupItem"),
);

const BATCH_COLUMNS: Map<string, string> = columnDefinitions(
  createTableStatement("UserNotificationEmailRollupBatch"),
);

function definitionOf(
  columns: Map<string, string>,
  columnName: string,
): string {
  const definition: string | undefined = columns.get(columnName);

  expect(definition).toBeDefined();

  return definition as string;
}

function persistedColumnsOf(
  model: UserNotificationEmailRollupItem | UserNotificationEmailRollupBatch,
): Array<string> {
  const declared: Columns = model.getTableColumns();

  return declared.columns.filter((columnName: string): boolean => {
    const type: TableColumnType = model.getTableColumnMetadata(columnName).type;

    return (
      type !== TableColumnType.Entity && type !== TableColumnType.EntityArray
    );
  });
}

describe("registration", () => {
  /*
   * An imported-but-unappended migration is exactly as inert as an unimported
   * one, and the failure mode is silent: the app boots, the tables are simply
   * missing, and the first rollup insert fails into the fail-open catch. The
   * exported array is the only thing the runner reads, so it is the only thing
   * worth asserting.
   */
  test("the migration is registered as the last entry in the array", () => {
    expect(SchemaMigrations).toContain(
      AddUserNotificationEmailRollup1791000000000,
    );
    expect(SchemaMigrations[SchemaMigrations.length - 1]).toBe(
      AddUserNotificationEmailRollup1791000000000,
    );
  });

  /*
   * TypeORM records an applied migration by the value of its `name` field, not
   * by its file name or its class name. If the three ever disagree, the
   * migration re-runs on an already-migrated database and the CREATE TABLE
   * fails the deploy.
   */
  test("the file name, class name and name field all agree", () => {
    expect(AddUserNotificationEmailRollup1791000000000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(SOURCE).toContain(
      `public name: string = "${MIGRATION_CLASS_NAME}";`,
    );
    expect(MIGRATION_FILE_NAME).toBe(
      `${MIGRATION_CLASS_NAME.replace(
        "AddUserNotificationEmailRollup",
        "",
      )}-AddUserNotificationEmailRollup.ts`,
    );
  });
});

describe("the queue table it creates", () => {
  /*
   * Written out as a literal rather than derived from the model, so that adding
   * a column to the entity without a migration for it fails here rather than
   * passing because both sides moved together.
   */
  test("it declares exactly the columns a queued notification is made of", () => {
    expect([...ITEM_COLUMNS.keys()].sort()).toEqual([
      "_id",
      "createdAt",
      "deletedAt",
      "eventType",
      "projectId",
      "rollupBatchId",
      "rollupCategory",
      "sentAt",
      "subject",
      "toEmail",
      "updatedAt",
      "userId",
      "version",
      "viewLink",
    ]);
  });

  /*
   * ...and the other direction. A column the entity persists but the table has
   * no room for is a runtime error on the first insert, not a compile error, so
   * the model is the authority the SQL is held to.
   */
  test("every column the model persists exists in the table", () => {
    const persisted: Array<string> = persistedColumnsOf(
      new UserNotificationEmailRollupItem(),
    );

    expect(persisted.length).toBeGreaterThan(0);

    for (const columnName of persisted) {
      expect(ITEM_COLUMNS.has(columnName)).toBe(true);
    }
  });

  /*
   * The bucket key plus the two fields the rollup email is rendered from. A row
   * missing any of these cannot be counted, cannot be grouped and cannot be
   * turned into a line in an email, so none of them may be nullable.
   */
  test("the bucket key and the renderable fields are all required", () => {
    for (const columnName of [
      "projectId",
      "userId",
      "toEmail",
      "eventType",
      "rollupCategory",
      "subject",
    ]) {
      expect(definitionOf(ITEM_COLUMNS, columnName)).toContain("NOT NULL");
    }
  });

  /*
   * sentAt NULL means "still pending" and viewLink NULL means "this producer
   * set no link var we recognise". Both are correct states, both are the state
   * of a row on the day the table is created, and that is precisely why this
   * migration needs no backfill. A DEFAULT on sentAt would mark every queued
   * row as already delivered.
   */
  test("sentAt, rollupBatchId and viewLink are nullable with no default", () => {
    for (const columnName of ["sentAt", "rollupBatchId", "viewLink"]) {
      const definition: string = definitionOf(ITEM_COLUMNS, columnName);

      expect(definition).not.toContain("NOT NULL");
      expect(definition).not.toContain("DEFAULT");
    }
  });

  /*
   * See note 5 at the top. At varchar(100) the length check throws, the throw
   * is swallowed by the write path's fail-open catch, and the rollup silently
   * never engages while every email still gets delivered — a bug with no
   * symptom other than the feature not existing.
   */
  test("eventType has room for the prose sentences it stores", () => {
    expect(definitionOf(ITEM_COLUMNS, "eventType")).toContain(
      "character varying(500)",
    );
    expect(definitionOf(ITEM_COLUMNS, "eventType")).not.toContain(
      "character varying(100)",
    );
  });

  /*
   * The burst counter reads (projectId, userId, toEmail, rollupCategory) over a
   * ten-minute createdAt window on the hot path of every owner notification,
   * and the sweep reads pending rows oldest-first. Without these two composite
   * indexes both degrade to sequential scans of a table that holds a week of
   * every owner email the install sends.
   */
  test("it indexes the burst counter and the pending sweep", () => {
    const indexes: Array<string> = UP_STATEMENTS.filter(
      (statement: string): boolean => {
        return statement.includes('ON "UserNotificationEmailRollupItem"');
      },
    );

    expect(
      indexes.some((statement: string): boolean => {
        return statement.includes(
          '("projectId", "userId", "toEmail", "rollupCategory", "createdAt")',
        );
      }),
    ).toBe(true);

    expect(
      indexes.some((statement: string): boolean => {
        return statement.includes('("sentAt", "createdAt")');
      }),
    ).toBe(true);

    expect(
      indexes.some((statement: string): boolean => {
        return statement.includes('("rollupBatchId")');
      }),
    ).toBe(true);
  });
});

describe("the batch ledger it creates", () => {
  test("it declares exactly the columns a flush attempt is made of", () => {
    expect([...BATCH_COLUMNS.keys()].sort()).toEqual([
      "_id",
      "claimEpochStartsAt",
      "claimedAt",
      "createdAt",
      "deletedAt",
      "itemCount",
      "projectId",
      "sentAt",
      "status",
      "statusMessage",
      "toEmail",
      "updatedAt",
      "userId",
      "version",
    ]);
  });

  test("every column the model persists exists in the table", () => {
    const persisted: Array<string> = persistedColumnsOf(
      new UserNotificationEmailRollupBatch(),
    );

    expect(persisted.length).toBeGreaterThan(0);

    for (const columnName of persisted) {
      expect(BATCH_COLUMNS.has(columnName)).toBe(true);
    }
  });

  /*
   * See note 1 at the top. This is the single most important assertion in the
   * file: without UNIQUE, two replicas both insert a claim and the recipient
   * gets two copies of the same rollup.
   */
  test("the claim index is UNIQUE over the full four-column key", () => {
    const claimIndex: string | undefined = UP_STATEMENTS.find(
      (statement: string): boolean => {
        return (
          statement.includes('ON "UserNotificationEmailRollupBatch"') &&
          statement.includes('"claimEpochStartsAt"')
        );
      },
    );

    expect(claimIndex).toBeDefined();
    expect(claimIndex as string).toContain("CREATE UNIQUE INDEX");
    expect(claimIndex as string).toContain(
      '("projectId", "userId", "toEmail", "claimEpochStartsAt")',
    );
  });

  test("the claim fields and the status are all required", () => {
    for (const columnName of [
      "projectId",
      "userId",
      "toEmail",
      "claimEpochStartsAt",
      "claimedAt",
      "status",
    ]) {
      expect(definitionOf(BATCH_COLUMNS, columnName)).toContain("NOT NULL");
    }
  });

  /*
   * A batch row exists from the moment it is claimed, before anything is known
   * about how many items it will carry or whether the send will succeed. All
   * three of these are written later, or never.
   */
  test("sentAt, itemCount and statusMessage are nullable with no default", () => {
    for (const columnName of ["sentAt", "itemCount", "statusMessage"]) {
      const definition: string = definitionOf(BATCH_COLUMNS, columnName);

      expect(definition).not.toContain("NOT NULL");
      expect(definition).not.toContain("DEFAULT");
    }
  });
});

describe("foreign keys", () => {
  /*
   * See note 2. Four keys, all cascading; the reflex alternative leaves orphan
   * rows whose NOT NULL tenant column cannot be satisfied.
   */
  test("every tenant and recipient key cascades", () => {
    const foreignKeys: Array<string> = UP_STATEMENTS.filter(
      (statement: string): boolean => {
        return (
          statement.includes("ADD CONSTRAINT") &&
          statement.includes("FOREIGN KEY")
        );
      },
    );

    expect(foreignKeys).toHaveLength(4);

    for (const statement of foreignKeys) {
      expect(statement).toContain("ON DELETE CASCADE");
      expect(statement).not.toContain("ON DELETE SET NULL");
    }

    for (const table of [
      "UserNotificationEmailRollupItem",
      "UserNotificationEmailRollupBatch",
    ]) {
      for (const column of ["projectId", "userId"]) {
        expect(
          foreignKeys.some((statement: string): boolean => {
            return (
              statement.includes(`ALTER TABLE "${table}"`) &&
              statement.includes(`FOREIGN KEY ("${column}")`)
            );
          }),
        ).toBe(true);
      }
    }
  });

  /*
   * See note 3. rollupBatchId is indexed so the flush can read back exactly the
   * rows it stamped, but it is deliberately not a relation — neither CASCADE
   * nor SET NULL has an acceptable meaning once batch rows start being pruned
   * ahead of the items they explain.
   */
  test("rollupBatchId is a bare stamp with no foreign key", () => {
    for (const statement of UP_STATEMENTS) {
      if (statement.includes("FOREIGN KEY")) {
        expect(statement).not.toContain('"rollupBatchId"');
      }
    }
  });
});

describe("down()", () => {
  /*
   * A migration that cannot be rolled back is a migration nobody dares deploy
   * on a Friday. Reverse order matters: dropping a table before the constraint
   * that references it fails, and leaving an index behind makes the re-run of
   * up() fail on a name collision.
   */
  test("it undoes everything up() created, in reverse", () => {
    const created: Array<string> = UP_STATEMENTS.filter(
      (statement: string): boolean => {
        return (
          statement.startsWith("CREATE TABLE") ||
          statement.startsWith("CREATE INDEX") ||
          statement.startsWith("CREATE UNIQUE INDEX") ||
          statement.includes("ADD CONSTRAINT")
        );
      },
    );

    const dropped: Array<string> = DOWN_STATEMENTS.filter(
      (statement: string): boolean => {
        return (
          statement.startsWith("DROP TABLE") ||
          statement.startsWith("DROP INDEX") ||
          statement.includes("DROP CONSTRAINT")
        );
      },
    );

    expect(dropped).toHaveLength(created.length);

    function nameIn(statement: string): string {
      const quoted: Array<string> = [
        ...statement.matchAll(/"([A-Za-z0-9_.]+)"/g),
      ].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      /*
       * Every statement of interest names the object it acts on either first
       * (CREATE TABLE "X", CREATE INDEX "IDX_x", DROP TABLE "X") or, for the
       * constraint pair, second after the table (ALTER TABLE "X" ADD/DROP
       * CONSTRAINT "FK_x"). Taking the FK/IDX/table name is enough to pair them
       * without re-parsing the SQL.
       */
      const constraintOrIndex: string | undefined = quoted.find(
        (candidate: string): boolean => {
          return candidate.startsWith("FK_") || candidate.startsWith("IDX_");
        },
      );

      return constraintOrIndex ?? (quoted[0] as string);
    }

    expect(dropped.map(nameIn)).toEqual([...created].reverse().map(nameIn));
  });
});
