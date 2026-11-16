import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * No new migration may build an index, validate a foreign key or drop an
 * index on a table that already exists while blocking that table's readers
 * or writers.
 *
 * WHY
 *
 * A migration holds every lock it takes until it commits, and what
 * `npm run generate-postgres-migration` writes for an existing table holds
 * strong ones:
 *
 *   CREATE INDEX ... ON "Monitor"           SHARE on "Monitor", for the build
 *   ALTER TABLE "Monitor" ADD CONSTRAINT    SHARE ROW EXCLUSIVE on "Monitor"
 *     ... FOREIGN KEY ... REFERENCES "User" and "User", while every row of
 *                                           "Monitor" is checked
 *   DROP INDEX "public"."IDX_..."           ACCESS EXCLUSIVE on the index's
 *     (what an @Index taken off a model     table - no reads either - from
 *     generates)                            the moment it asks for it
 *
 * 1797200000000-AddArchiveToMoreResources (14.0.13) did the first two, on
 * "Monitor" and four more tables, inside one transaction that also held
 * ACCESS EXCLUSIVE on all five - on the table every probe result, heartbeat
 * and cron tick writes. SchemaMigrationRunner now bounds how long a migration
 * WAITS for its locks; nothing but the migration itself can bound how long it
 * HOLDS them. A plain DROP INDEX is quick once it has its lock, but it waits
 * behind every transaction using the table, every read and write that comes
 * after it queues behind it, and in a migration's transaction it then keeps
 * the table unreadable until the migration commits: through every slow
 * statement after it.
 *
 * WHAT TO DO INSTEAD
 *
 * Move those statements into a migration of their own with
 * `public transaction: boolean = false;`, and pass each, exactly as
 * generated, to OnlineDdl (Server/Infrastructure/Postgres/OnlineDdl.ts):
 *
 *   OnlineDdl.createIndex(queryRunner, `CREATE INDEX ...`)
 *     builds it with CREATE INDEX CONCURRENTLY;
 *   OnlineDdl.addForeignKey(queryRunner, `ALTER TABLE ... FOREIGN KEY ...`)
 *     adds it NOT VALID and validates it separately;
 *   OnlineDdl.dropIndex(queryRunner, `DROP INDEX "public"."IDX_..."`)
 *     drops it with DROP INDEX CONCURRENTLY.
 *
 * None of them blocks reads or writes. A table created in the same migration
 * is empty, so building on it is instant and needs nothing of this. Nor does
 * an index dropped from a table that the same migration's transaction locks
 * ACCESS EXCLUSIVE anyway (an ALTER TABLE of it, as the generator writes when
 * the index goes with its column; DROP TABLE): dropping it online would
 * change nothing.
 *
 * Each of those needs `transaction = false`: createIndex and addForeignKey
 * refuse to run in a transaction, CONCURRENTLY cannot, and dropIndex, which
 * TypeORM's down() needs inside one, drops the index with a plain DROP INDEX
 * there - so a new migration whose up() runs one without it is flagged too.
 *
 * HOW IT IS CHECKED
 *
 * Statically: every SQL string literal in a migration's up() (and in the
 * helpers up() calls - everything in the file but down()) is read, except
 * the ones handed to OnlineDdl, and the shapes above are flagged when their
 * table is not CREATEd in the same file. A DROP INDEX names only its index:
 * its table is the one the CREATE INDEX of that name in any migration file
 * (its own down() included) builds it on, and one that no migration builds is
 * flagged, as is one whose name a template fills in. Migrations registered
 * up to NEWEST_MIGRATION_BEFORE_THE_RULE are history, not checked; the cases
 * at the bottom show what the rule would have said about some of them.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

/*
 * The newest migration registered when this rule was added. Everything up to
 * it has shipped, or is about to, as written. (The DROP INDEX half came
 * later, and flags none of the migrations after this one.)
 */
const NEWEST_MIGRATION_BEFORE_THE_RULE: number = 1798700000000;

/*
 * New migrations allowed to break the rule anyway - say a table that holds a
 * handful of rows on every install - each with the statement it may run and
 * why. Keep it short; an entry that no longer matches anything fails.
 */
interface AllowedBlockingDdl {
  migration: string;
  statement: RegExp;
  reason: string;
}

const ALLOWED: ReadonlyArray<AllowedBlockingDdl> = [];

interface BlockingDdl {
  statement: string;
  problem: string;
}

const ONLINE_DDL_CALLS: ReadonlyArray<string> = [
  "OnlineDdl.createIndex",
  "OnlineDdl.addForeignKey",
  "OnlineDdl.dropIndex",
];

interface MigrationSource {
  /* The SQL literals of up() and its helpers, minus OnlineDdl's own. */
  upLiterals: Array<string>;
  /* Every SQL literal of the file: down() and OnlineDdl's arguments too. */
  everyLiteral: Array<string>;
  /* The OnlineDdl calls of up() and its helpers, as written. */
  onlineDdlCalls: Array<string>;
  /* Whether TypeORM runs its up() in a transaction: no `transaction = false`. */
  runsInTransaction: boolean;
}

function readMigration(source: string): MigrationSource {
  const file: ts.SourceFile = ts.createSourceFile(
    "migration.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const migration: MigrationSource = {
    upLiterals: [],
    everyLiteral: [],
    onlineDdlCalls: [],
    runsInTransaction: true,
  };

  function visit(node: ts.Node, inUp: boolean): void {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "down") {
      ts.forEachChild(node, (child: ts.Node) => {
        visit(child, false);
      });
      return;
    }

    if (
      ts.isPropertyDeclaration(node) &&
      node.name.getText(file) === "transaction" &&
      node.initializer?.kind === ts.SyntaxKind.FalseKeyword
    ) {
      migration.runsInTransaction = false;
    }

    if (
      ts.isCallExpression(node) &&
      ONLINE_DDL_CALLS.includes(node.expression.getText(file))
    ) {
      if (inUp) {
        migration.onlineDdlCalls.push(node.getText(file));
      }
      // Its statements run online; whatever else the call holds does not.
      node.arguments.forEach((argument: ts.Expression) => {
        if (isSqlLiteral(argument)) {
          migration.everyLiteral.push(literalText(argument));
        } else {
          visit(argument, inUp);
        }
      });
      return;
    }

    if (isSqlLiteral(node)) {
      migration.everyLiteral.push(literalText(node));
      if (inUp) {
        migration.upLiterals.push(literalText(node));
      }
      return;
    }

    ts.forEachChild(node, (child: ts.Node) => {
      visit(child, inUp);
    });
  }

  visit(file, true);

  return migration;
}

function isSqlLiteral(node: ts.Node): boolean {
  return (
    ts.isStringLiteral(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isTemplateExpression(node)
  );
}

/* A template's substitutions read as ${...}: their value is not known here. */
function literalText(node: ts.Node): string {
  if (ts.isTemplateExpression(node)) {
    return (
      node.head.text +
      node.templateSpans
        .map((span: ts.TemplateSpan): string => {
          return "${...}" + span.literal.text;
        })
        .join("")
    );
  }

  return (node as ts.StringLiteral | ts.NoSubstitutionTemplateLiteral).text;
}

/* Each statement of the literals, on one line. */
function statementsOf(literals: Array<string>): Array<string> {
  return literals
    .flatMap((literal: string): Array<string> => {
      return literal.split(";");
    })
    .map((statement: string): string => {
      return statement.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);
}

const TABLE: string = `((?:"[^"]+"\\.)?"[^"]+"|\\$\\{\\.\\.\\.\\})`;

/* An index, as a DROP INDEX names it: "IDX_..." or "public"."IDX_...". */
const INDEX: string = `(?:"[^"]+"\\.)?"[^"]+"`;

const NOT_VALID: RegExp = /\bNOT VALID\b/i;

const DROP_INDEX: RegExp = /^DROP INDEX\b/i;

const READABLE_DROP_INDEX: RegExp = new RegExp(
  `^DROP INDEX (CONCURRENTLY )?(?:IF EXISTS )?(${INDEX}(?:, ?${INDEX})*)(?: CASCADE| RESTRICT)?$`,
  "i",
);

const NAMED_CREATE_INDEX: RegExp = new RegExp(
  `^CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?("[^"]+") ON (?:ONLY )?${TABLE}`,
  "i",
);

const ONLINE_STATEMENT: RegExp =
  /^(?:CREATE (?:UNIQUE )?INDEX|DROP INDEX) CONCURRENTLY\b/i;

/*
 * Statements that take ACCESS EXCLUSIVE on their table, which a migration's
 * transaction then keeps until it commits: the ALTER TABLE forms the
 * generator writes for a column or a constraint (ADD "column", DROP COLUMN,
 * ALTER COLUMN, RENAME, DROP CONSTRAINT, ADD CONSTRAINT ... UNIQUE, PRIMARY
 * KEY or CHECK), DROP TABLE and TRUNCATE. Not the forms that take less:
 * ADD CONSTRAINT ... FOREIGN KEY (SHARE ROW EXCLUSIVE), VALIDATE CONSTRAINT,
 * SET STATISTICS, SET (...) and RESET (...) (SHARE UPDATE EXCLUSIVE).
 */
const LOCKS_TABLE: ReadonlyArray<RegExp> = [
  new RegExp(
    `^ALTER TABLE (?:ONLY )?${TABLE} (?:ADD (?:COLUMN )?(?:IF NOT EXISTS )?"|DROP COLUMN |RENAME |DROP CONSTRAINT |ADD CONSTRAINT "[^"]+" (?:UNIQUE|PRIMARY KEY|CHECK)\\b|ALTER COLUMN "[^"]+" (?!SET STATISTICS\\b|SET \\(|RESET \\())`,
    "i",
  ),
  new RegExp(`^DROP TABLE (?:IF EXISTS )?${TABLE}`, "i"),
  new RegExp(`^TRUNCATE (?:TABLE )?(?:ONLY )?${TABLE}`, "i"),
];

/*
 * "Monitor" for "Monitor" and "public"."Monitor"; "IDX_x" for
 * "public"."IDX_x"; ${...} for "${...}" (a template's substitution, whose
 * dots are not a schema's).
 */
function objectName(quoted: string): string {
  const last: RegExpMatchArray | null = quoted.match(/"([^"]+)"$/);
  return last && last[1] ? last[1] : quoted;
}

/* Index name -> the tables a CREATE INDEX of that name builds it on. */
type IndexTables = Map<string, Set<string>>;

function addIndexTables(tables: IndexTables, literals: Array<string>): void {
  for (const statement of statementsOf(literals)) {
    const match: RegExpMatchArray | null = statement.match(NAMED_CREATE_INDEX);

    if (
      !match ||
      !match[1] ||
      !match[2] ||
      match[1].includes("${...}") ||
      match[2].includes("${...}")
    ) {
      continue;
    }

    const name: string = objectName(match[1]);
    const built: Set<string> = tables.get(name) || new Set();
    built.add(objectName(match[2]));
    tables.set(name, built);
  }
}

const MIGRATION_FILE: RegExp = /^\d{13}-.+\.ts$/;

const MIGRATION_FILES: Array<string> = fs
  .readdirSync(MIGRATION_DIRECTORY)
  .filter((file: string): boolean => {
    return MIGRATION_FILE.test(file);
  });

/*
 * Every index any migration file builds, and on which table: what a DROP
 * INDEX of it, which names only the index, drops it from.
 */
const INDEX_TABLES: IndexTables = new Map();

for (const file of MIGRATION_FILES) {
  addIndexTables(INDEX_TABLES, readMigration(sourceOfFile(file)).everyLiteral);
}

function findBlockingDdl(
  source: string,
  indexTables: IndexTables = INDEX_TABLES,
): Array<BlockingDdl> {
  const migration: MigrationSource = readMigration(source);
  const statements: Array<string> = statementsOf(migration.upLiterals);

  const created: Set<string> = new Set();
  const locked: Set<string> = new Set();

  for (const statement of statements) {
    const match: RegExpMatchArray | null = statement.match(
      new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${TABLE}`, "i"),
    );
    if (match && match[1]) {
      created.add(objectName(match[1]));
    }

    for (const locks of LOCKS_TABLE) {
      const lockedTable: RegExpMatchArray | null = statement.match(locks);
      if (lockedTable && lockedTable[1]) {
        locked.add(objectName(lockedTable[1]));
      }
    }
  }

  // This file's own CREATE INDEX statements first: its down() builds again what its up() drops.
  const ownIndexTables: IndexTables = new Map();
  addIndexTables(ownIndexTables, migration.everyLiteral);

  const tablesOfIndex: (name: string) => Set<string> = (
    name: string,
  ): Set<string> => {
    return ownIndexTables.get(name) || indexTables.get(name) || new Set();
  };

  const found: Array<BlockingDdl> = [];

  for (const statement of statements) {
    const index: RegExpMatchArray | null = statement.match(
      new RegExp(
        `^CREATE (?:UNIQUE )?INDEX (CONCURRENTLY )?(?:IF NOT EXISTS )?(?:"[^"]+" )?ON (?:ONLY )?${TABLE}`,
        "i",
      ),
    );

    if (index && !index[1] && index[2] && !created.has(objectName(index[2]))) {
      found.push({
        statement,
        problem: `builds an index on ${index[2]}, which already exists, holding SHARE on it - no writes - for the whole build. Use OnlineDdl.createIndex in a migration with transaction = false.`,
      });
      continue;
    }

    const foreignKey: RegExpMatchArray | null = statement.match(
      new RegExp(
        `^ALTER TABLE (?:ONLY )?${TABLE} ADD CONSTRAINT "[^"]+" FOREIGN KEY .*REFERENCES ${TABLE}`,
        "i",
      ),
    );

    if (
      foreignKey &&
      foreignKey[1] &&
      !NOT_VALID.test(statement) &&
      !created.has(objectName(foreignKey[1]))
    ) {
      found.push({
        statement,
        problem: `adds a foreign key to ${foreignKey[1]}, which already exists, checking every row of it while holding SHARE ROW EXCLUSIVE on it and on ${foreignKey[2]} - no writes to either. Use OnlineDdl.addForeignKey in a migration with transaction = false.`,
      });
      continue;
    }

    if (DROP_INDEX.test(statement)) {
      found.push(
        ...findBlockingDropIndex(statement, {
          created,
          locked,
          runsInTransaction: migration.runsInTransaction,
          tablesOfIndex,
        }),
      );
    }
  }

  if (migration.runsInTransaction) {
    const online: Array<string> = [
      ...migration.onlineDdlCalls,
      ...statements.filter((statement: string): boolean => {
        return ONLINE_STATEMENT.test(statement);
      }),
    ];

    for (const statement of online) {
      found.push({
        statement: statement.replace(/\s+/g, " "),
        problem: `runs this in up() in a transaction: OnlineDdl.createIndex and OnlineDdl.addForeignKey refuse to, CONCURRENTLY cannot, and OnlineDdl.dropIndex drops the index with a plain DROP INDEX there, holding ACCESS EXCLUSIVE on its table until the migration commits. Give the migration \`public transaction: boolean = false;\`.`,
      });
    }
  }

  return found;
}

const USE_DROP_INDEX: string =
  "Use OnlineDdl.dropIndex in a migration with transaction = false: it drops the index CONCURRENTLY.";

function findBlockingDropIndex(
  statement: string,
  migration: {
    created: Set<string>;
    locked: Set<string>;
    runsInTransaction: boolean;
    tablesOfIndex: (name: string) => Set<string>;
  },
): Array<BlockingDdl> {
  const drop: RegExpMatchArray | null = statement.match(READABLE_DROP_INDEX);

  if (!drop || !drop[2]) {
    return [
      {
        statement,
        problem: `drops an index in a form this check cannot read, so it cannot tell whether that blocks a table. Write the statement as the generator does - DROP INDEX "public"."IDX_..." - and ${USE_DROP_INDEX[0]!.toLowerCase()}${USE_DROP_INDEX.slice(1)}`,
      },
    ];
  }

  if (drop[1]) {
    // CONCURRENTLY: online (and outside a transaction, which the check of OnlineDdl's calls asks for).
    return [];
  }

  const found: Array<BlockingDdl> = [];

  for (const quotedIndex of drop[2].match(new RegExp(INDEX, "g")) || []) {
    const name: string = objectName(quotedIndex);

    if (name.includes("${...}")) {
      found.push({
        statement,
        problem: `drops an index whose name a template fills in, so this check cannot tell its table. ${USE_DROP_INDEX}`,
      });
      continue;
    }

    const tables: Set<string> = migration.tablesOfIndex(name);

    if (tables.size === 0) {
      found.push({
        statement,
        problem: `drops ${quotedIndex}, which no migration builds with a CREATE INDEX this check can read, so it cannot tell its table. ${USE_DROP_INDEX}`,
      });
      continue;
    }

    for (const table of tables) {
      const isNew: boolean = migration.created.has(table);
      // The migration's transaction keeps it ACCESS EXCLUSIVE until it commits anyway.
      const isLockedAnyway: boolean =
        migration.runsInTransaction && migration.locked.has(table);

      if (!isNew && !isLockedAnyway) {
        found.push({
          statement,
          problem: `drops ${quotedIndex} from "${table}", which already exists, taking ACCESS EXCLUSIVE on it - no reads or writes - while it waits for the lock, and ${
            migration.runsInTransaction
              ? "then until the migration commits"
              : "while it drops"
          }. ${USE_DROP_INDEX}`,
        });
      }
    }
  }

  return found;
}

function timestampOf(name: string): number {
  const match: RegExpMatchArray | null = name.match(/(\d{13})$/);
  return match ? Number(match[1]) : 0;
}

function sourceOf(className: string): string {
  const timestamp: number = timestampOf(className);
  const files: Array<string> = MIGRATION_FILES.filter(
    (file: string): boolean => {
      return file.startsWith(`${timestamp}-`);
    },
  );

  for (const file of files) {
    const source: string = sourceOfFile(file);
    if (new RegExp(`class ${className}\\b`).test(source)) {
      return source;
    }
  }

  throw new Error(`No file in SchemaMigrations declares ${className}.`);
}

function sourceOfFile(file: string): string {
  return fs.readFileSync(path.join(MIGRATION_DIRECTORY, file), "utf8");
}

const REGISTERED: Array<string> = SchemaMigrations.map(
  (migration: unknown): string => {
    return (migration as { name: string }).name;
  },
);

const NEW_MIGRATIONS: Array<string> = REGISTERED.filter(
  (className: string): boolean => {
    return timestampOf(className) > NEWEST_MIGRATION_BEFORE_THE_RULE;
  },
);

function statementsFound(found: Array<BlockingDdl>): Array<string> {
  return found.map((blocking: BlockingDdl): string => {
    return blocking.statement;
  });
}

describe("New schema migrations keep existing tables writable", () => {
  test("no new migration builds an index, validates a foreign key or drops an index on an existing table while blocking it", () => {
    const violations: Array<string> = [];

    for (const className of NEW_MIGRATIONS) {
      for (const blocking of findBlockingDdl(sourceOf(className))) {
        const allowed: boolean = ALLOWED.some((entry: AllowedBlockingDdl) => {
          return (
            entry.migration === className &&
            entry.statement.test(blocking.statement)
          );
        });

        if (!allowed) {
          violations.push(
            `${className} ${blocking.problem}\n    ${blocking.statement}`,
          );
        }
      }
    }

    expect(violations).toEqual([]);
  });

  test("every allowed exception names a new migration and still matches one of its statements", () => {
    for (const entry of ALLOWED) {
      expect(NEW_MIGRATIONS).toContain(entry.migration);
      expect(entry.reason.trim()).not.toBe("");
      expect(
        findBlockingDdl(sourceOf(entry.migration)).some(
          (blocking: BlockingDdl) => {
            return entry.statement.test(blocking.statement);
          },
        ),
      ).toBe(true);
    }
  });

  test("the line between history and new migrations is a registered migration", () => {
    expect(
      REGISTERED.map((className: string): number => {
        return timestampOf(className);
      }),
    ).toContain(NEWEST_MIGRATION_BEFORE_THE_RULE);
  });

  test("every migration file it reads indexes from holds a migration: the index of their tables is read from all of them", () => {
    expect(MIGRATION_FILES.length).toBeGreaterThan(900);
    expect(MIGRATION_FILES.length).toBeGreaterThanOrEqual(REGISTERED.length);
    // From a generated down(), with the table schema-qualified as it wrote it.
    expect(INDEX_TABLES.get("IDX_fa102ae5073b428e514cc2ceea")).toEqual(
      new Set(["TelemetryException"]),
    );
    // From a statement handed to OnlineDdl.createIndex.
    expect(INDEX_TABLES.get("IDX_ab947ccdac955be166aa2c5a27")).toEqual(
      new Set(["AIAgentTaskPullRequest"]),
    );
  });

  describe("what the rule says", () => {
    /*
     * The migration of the incident: an index and a validated foreign key
     * on each of five tables people and probes write all day.
     */
    test("about 1797200000000-AddArchiveToMoreResources: ten blocking statements, two on Monitor", () => {
      const found: Array<BlockingDdl> = findBlockingDdl(
        sourceOfFile("1797200000000-AddArchiveToMoreResources.ts"),
      );

      expect(found).toHaveLength(10);
      expect(statementsFound(found)).toEqual(
        expect.arrayContaining([
          'CREATE INDEX "IDX_cdc971b41d78e4bed90a1d611b" ON "Monitor" ("projectId", "isArchived")',
          'ALTER TABLE "Monitor" ADD CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION',
        ]),
      );
      expect(found[0]!.problem).toContain("OnlineDdl.createIndex");
    });

    /*
     * Its indexes and foreign keys are all on tables it creates: empty, so
     * instant. (Its foreign key to "Monitor" still takes SHARE ROW EXCLUSIVE
     * on "Monitor" - for an instant, and the wait for it is now bounded.)
     */
    test("about 1797500000000-AddRunbookRuleMatchCriteria: nothing, its tables are new", () => {
      expect(
        findBlockingDdl(
          sourceOfFile("1797500000000-AddRunbookRuleMatchCriteria.ts"),
        ),
      ).toEqual([]);
    });

    test("about 1798300000000-AddLlmLogProjectCreatedAtIndex: nothing, it builds online", () => {
      expect(
        findBlockingDdl(
          sourceOfFile("1798300000000-AddLlmLogProjectCreatedAtIndex.ts"),
        ),
      ).toEqual([]);
    });

    /*
     * An @Index taken off the exceptions table, which every telemetry
     * worker upserts into: its only statement, a plain DROP INDEX in a
     * transaction, queued those upserts behind it while it waited for
     * ACCESS EXCLUSIVE on the table. Its table is named only in its down().
     */
    test("about 1782500000000-OptimizeTelemetryExceptionWritePath: one blocking drop, from TelemetryException", () => {
      const found: Array<BlockingDdl> = findBlockingDdl(
        sourceOfFile("1782500000000-OptimizeTelemetryExceptionWritePath.ts"),
      );

      expect(statementsFound(found)).toEqual([
        'DROP INDEX IF EXISTS "public"."IDX_fa102ae5073b428e514cc2ceea"',
      ]);
      expect(found[0]!.problem).toContain('from "TelemetryException"');
      expect(found[0]!.problem).toContain("until the migration commits");
      expect(found[0]!.problem).toContain("OnlineDdl.dropIndex");
    });

    /*
     * The generator drops an index before it drops or changes the column
     * the index is on, and the ALTER TABLE takes ACCESS EXCLUSIVE on the
     * same table in the same transaction: the drop blocks nothing more.
     */
    test("about 1802850000000-WidenAIAgentTaskPullRequestId: nothing, its transaction recreates the indexed column", () => {
      expect(
        findBlockingDdl(
          sourceOfFile("1802850000000-WidenAIAgentTaskPullRequestId.ts"),
        ),
      ).toEqual([]);
    });

    test("about 1807200000000-AddSecurityCasePrioritiesAndStatuses: nothing, its three drops go with SecurityCase's columns", () => {
      expect(
        findBlockingDdl(
          sourceOfFile("1807200000000-AddSecurityCasePrioritiesAndStatuses.ts"),
        ),
      ).toEqual([]);
    });

    test("about 1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes: nothing, it drops online", () => {
      expect(
        findBlockingDdl(
          sourceOfFile(
            "1809151100000-DropNetworkDeviceLastSeenAtAndProjectIdIndexes.ts",
          ),
        ),
      ).toEqual([]);
    });

    test("about the same statements handed to OnlineDdl: nothing, whatever down() does", () => {
      const source: string = `
        export class AddMonitorFooIndexes1799000000000 implements MigrationInterface {
          public name: string = "AddMonitorFooIndexes1799000000000";
          public transaction: boolean = false;

          public async up(queryRunner: QueryRunner): Promise<void> {
            await OnlineDdl.createIndex(
              queryRunner,
              \`CREATE INDEX "IDX_cdc971b41d78e4bed90a1d611b" ON "Monitor" ("projectId", "isArchived") \`,
            );
            await OnlineDdl.addForeignKey(
              queryRunner,
              \`ALTER TABLE "Monitor" ADD CONSTRAINT "FK_3e1a5a33af8c38b49ff26a08688" FOREIGN KEY ("archivedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION\`,
            );
          }

          public async down(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`CREATE INDEX "IDX_old" ON "Monitor" ("projectId")\`);
            await OnlineDdl.dropIndex(queryRunner, \`DROP INDEX "public"."IDX_cdc971b41d78e4bed90a1d611b"\`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([]);
    });

    test("about a foreign key added NOT VALID: nothing; about its VALIDATE in the same file: nothing either", () => {
      const source: string = `
        export class M1799000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`ALTER TABLE "Monitor" ADD CONSTRAINT "FK_x" FOREIGN KEY ("fooId") REFERENCES "Foo"("_id") NOT VALID\`);
            await queryRunner.query(\`ALTER TABLE "Monitor" VALIDATE CONSTRAINT "FK_x"\`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([]);
    });

    test("about statements built in a helper, or on a table it cannot name: it flags them", () => {
      const source: string = `
        export class M1799000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            for (const table of ["Monitor", "Incident"]) {
              await this.index(queryRunner, table);
            }
          }

          private async index(queryRunner: QueryRunner, table: string): Promise<void> {
            await queryRunner.query(\`CREATE UNIQUE INDEX "IDX_\${table}" ON "\${table}" ("slug")\`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([
        expect.objectContaining({
          statement: 'CREATE UNIQUE INDEX "IDX_${...}" ON "${...}" ("slug")',
        }),
      ]);
    });
  });

  describe("what the rule says about dropping an index", () => {
    /*
     * What the generator writes when an @Index comes off the Monitor model:
     * the drop in up(), the build again in down(), which names the table.
     */
    interface GeneratedDropOptions {
      up?: string;
      transactionFalse?: boolean;
    }

    const generatedDrop: (options: GeneratedDropOptions) => string = (
      options: GeneratedDropOptions,
    ): string => {
      return `
        export class DropMonitorFooIndex1810000000000 implements MigrationInterface {
          public name: string = "DropMonitorFooIndex1810000000000";
          ${options.transactionFalse ? "public transaction: boolean = false;" : ""}

          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"\`);
            ${options.up || ""}
          }

          public async down(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`CREATE INDEX "IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa" ON "Monitor" ("fooId") \`);
          }
        }`;
    };

    test("a plain DROP INDEX of an existing table's index: flagged, naming the table from down()", () => {
      const found: Array<BlockingDdl> = findBlockingDdl(generatedDrop({}));

      expect(found).toEqual([
        {
          statement: 'DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"',
          problem: expect.stringContaining(
            'from "Monitor", which already exists',
          ),
        },
      ]);
      expect(found[0]!.problem).toContain("until the migration commits");
      expect(found[0]!.problem).toContain(
        "Use OnlineDdl.dropIndex in a migration with transaction = false",
      );
    });

    test("the same in a migration without a transaction: still flagged, it queues the table's readers while it waits", () => {
      const found: Array<BlockingDdl> = findBlockingDdl(
        generatedDrop({ transactionFalse: true }),
      );

      expect(statementsFound(found)).toEqual([
        'DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"',
      ]);
      expect(found[0]!.problem).toContain("while it drops");
    });

    test("its table read from another migration's CREATE INDEX when its own down() does not build it", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`DROP INDEX IF EXISTS "IDX_bbbbbbbbbbbbbbbbbbbbbbbbbb"\`);
          }
        }`;
      const elsewhere: IndexTables = new Map([
        ["IDX_bbbbbbbbbbbbbbbbbbbbbbbbbb", new Set(["Incident"])],
      ]);

      expect(findBlockingDdl(source, elsewhere)).toEqual([
        {
          statement: 'DROP INDEX IF EXISTS "IDX_bbbbbbbbbbbbbbbbbbbbbbbbbb"',
          problem: expect.stringContaining('from "Incident"'),
        },
      ]);
    });

    test("handed to OnlineDdl.dropIndex in a migration with transaction = false: nothing", () => {
      const source: string = `
        export class M1810000000000 {
          public transaction: boolean = false;

          public async up(queryRunner: QueryRunner): Promise<void> {
            await OnlineDdl.dropIndex(queryRunner, \`DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"\`);
          }

          public async down(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`CREATE INDEX "IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa" ON "Monitor" ("fooId") \`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([]);
    });

    test("handed to OnlineDdl.dropIndex in a migration that runs in a transaction: flagged, it would drop it with a plain DROP INDEX", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await OnlineDdl.dropIndex(queryRunner, \`DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"\`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([
        {
          statement:
            'OnlineDdl.dropIndex(queryRunner, `DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"`)',
          problem: expect.stringContaining(
            "Give the migration `public transaction: boolean = false;`",
          ),
        },
      ]);
    });

    test("createIndex and addForeignKey in a migration that runs in a transaction: flagged before they refuse to run", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await OnlineDdl.createIndex(queryRunner, \`CREATE INDEX "IDX_c" ON "Monitor" ("fooId")\`);
            await OnlineDdl.addForeignKey(queryRunner, \`ALTER TABLE "Monitor" ADD CONSTRAINT "FK_c" FOREIGN KEY ("fooId") REFERENCES "Foo"("_id")\`);
          }
        }`;

      expect(findBlockingDdl(source)).toHaveLength(2);
    });

    test("DROP INDEX CONCURRENTLY: nothing without a transaction, flagged in one (where Postgres refuses it)", () => {
      const drop: string = `await queryRunner.query(\`DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"\`);`;
      const migration: (transactionFalse: boolean) => string = (
        transactionFalse: boolean,
      ): string => {
        return `
          export class M1810000000000 {
            ${transactionFalse ? "public transaction = false;" : ""}
            public async up(queryRunner: QueryRunner): Promise<void> {
              ${drop}
            }
          }`;
      };

      expect(findBlockingDdl(migration(true))).toEqual([]);
      expect(statementsFound(findBlockingDdl(migration(false)))).toEqual([
        'DROP INDEX CONCURRENTLY IF EXISTS "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"',
      ]);
    });

    test.each([
      `ALTER TABLE "Monitor" DROP COLUMN "fooId"`,
      `ALTER TABLE "Monitor" ADD "fooId" bigint`,
      `ALTER TABLE "public"."Monitor" ALTER COLUMN "fooId" TYPE bigint`,
      `ALTER TABLE "Monitor" ALTER COLUMN "fooId" SET NOT NULL`,
      `ALTER TABLE "Monitor" RENAME COLUMN "fooId" TO "barId"`,
      `ALTER TABLE "Monitor" DROP CONSTRAINT "FK_foo"`,
      `ALTER TABLE "Monitor" ADD CONSTRAINT "UQ_foo" UNIQUE ("fooId")`,
      `DROP TABLE "Monitor"`,
      `TRUNCATE "Monitor"`,
    ])(
      "in a transaction that also runs %s: nothing, the table is ACCESS EXCLUSIVE until it commits anyway",
      (statement: string) => {
        expect(
          findBlockingDdl(
            generatedDrop({
              up: `await queryRunner.query(\`${statement}\`);`,
            }),
          ),
        ).toEqual([]);
      },
    );

    test.each([
      `ALTER TABLE "Monitor" ALTER COLUMN "fooId" SET STATISTICS 500`,
      `ALTER TABLE "Monitor" ALTER COLUMN "fooId" SET (n_distinct = 100)`,
      `ALTER TABLE "Monitor" SET (fillfactor = 90)`,
      `ALTER TABLE "Monitor" VALIDATE CONSTRAINT "FK_foo"`,
      `ALTER TABLE "Incident" DROP COLUMN "fooId"`,
      `COMMENT ON TABLE "Monitor" IS 'Monitors'`,
    ])(
      "in a transaction that also runs %s, which takes less of it or another table: still flagged",
      (statement: string) => {
        expect(
          statementsFound(
            findBlockingDdl(
              generatedDrop({
                up: `await queryRunner.query(\`${statement}\`);`,
              }),
            ),
          ),
        ).toContain('DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"');
      },
    );

    test("a column dropped with its index in a migration without a transaction: flagged, nothing holds the table meanwhile", () => {
      expect(
        statementsFound(
          findBlockingDdl(
            generatedDrop({
              transactionFalse: true,
              up: 'await queryRunner.query(`ALTER TABLE "Monitor" DROP COLUMN "fooId"`);',
            }),
          ),
        ),
      ).toEqual(['DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"']);
    });

    test("an index of a table the same migration creates: nothing", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`CREATE TABLE "Foo" ("_id" uuid NOT NULL, "barId" uuid)\`);
            await queryRunner.query(\`CREATE INDEX "IDX_foo_bar" ON "Foo" ("barId")\`);
            await queryRunner.query(\`DROP INDEX "public"."IDX_foo_bar"\`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([]);
    });

    test("an index no migration builds: flagged, its table cannot be told", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`DROP INDEX "public"."IDX_built_by_nothing"\`);
          }
        }`;

      expect(findBlockingDdl(source, new Map())).toEqual([
        {
          statement: 'DROP INDEX "public"."IDX_built_by_nothing"',
          problem: expect.stringContaining("which no migration builds"),
        },
      ]);
    });

    test("an index a template names, or a drop it cannot read: flagged", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`DROP INDEX IF EXISTS "\${INDEX_NAME}"\`);
            await queryRunner.query("DROP INDEX idx_unquoted");
          }
        }`;
      const found: Array<BlockingDdl> = findBlockingDdl(source);

      expect(statementsFound(found)).toEqual([
        'DROP INDEX IF EXISTS "${...}"',
        "DROP INDEX idx_unquoted",
      ]);
      expect(found[0]!.problem).toContain("a template fills in");
      expect(found[1]!.problem).toContain("cannot read");
    });

    test("several indexes in one DROP INDEX: each is placed on its table", () => {
      const source: string = `
        export class M1810000000000 {
          public async up(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`ALTER TABLE "Monitor" DROP COLUMN "fooId"\`);
            await queryRunner.query(\`DROP INDEX "IDX_on_monitor", "public"."IDX_on_incident"\`);
          }
        }`;
      const elsewhere: IndexTables = new Map([
        ["IDX_on_monitor", new Set(["Monitor"])],
        ["IDX_on_incident", new Set(["Incident"])],
      ]);

      expect(findBlockingDdl(source, elsewhere)).toEqual([
        expect.objectContaining({
          problem: expect.stringContaining(
            'drops "public"."IDX_on_incident" from "Incident"',
          ),
        }),
      ]);
    });

    test("a DROP INDEX in down() only: nothing, TypeORM reverts in a transaction whatever the migration says", () => {
      const source: string = `
        export class M1810000000000 {
          public transaction: boolean = false;

          public async up(queryRunner: QueryRunner): Promise<void> {
            await OnlineDdl.createIndex(queryRunner, \`CREATE INDEX "IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa" ON "Monitor" ("fooId")\`);
          }

          public async down(queryRunner: QueryRunner): Promise<void> {
            await queryRunner.query(\`DROP INDEX "public"."IDX_aaaaaaaaaaaaaaaaaaaaaaaaaa"\`);
          }
        }`;

      expect(findBlockingDdl(source)).toEqual([]);
    });
  });
});
