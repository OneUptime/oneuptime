import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * No new migration may build an index or validate a foreign key on a table
 * that already exists while blocking that table's writers.
 *
 * WHY
 *
 * A migration holds every lock it takes until it commits, and what
 * `npm run generate-postgres-migration` writes for an existing table holds
 * strong ones for as long as the statement scans it:
 *
 *   CREATE INDEX ... ON "Monitor"           SHARE on "Monitor", for the build
 *   ALTER TABLE "Monitor" ADD CONSTRAINT    SHARE ROW EXCLUSIVE on "Monitor"
 *     ... FOREIGN KEY ... REFERENCES "User" and "User", while every row of
 *                                           "Monitor" is checked
 *
 * 1797200000000-AddArchiveToMoreResources (14.0.13) did both, on "Monitor"
 * and four more tables, inside one transaction that also held ACCESS
 * EXCLUSIVE on all five - on the table every probe result, heartbeat and
 * cron tick writes. SchemaMigrationRunner now bounds how long a migration
 * WAITS for its locks; nothing but the migration itself can bound how long it
 * HOLDS them.
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
 *     adds it NOT VALID and validates it separately.
 *
 * Neither blocks reads or writes. A table created in the same migration is
 * empty, so building on it is instant and needs nothing of this.
 *
 * HOW IT IS CHECKED
 *
 * Statically: every SQL string literal in a migration's up() (and in the
 * helpers up() calls - everything in the file but down()) is read, except
 * the ones handed to OnlineDdl, and the two shapes above are flagged when
 * their table is not CREATEd earlier in the same file. Migrations registered
 * up to NEWEST_MIGRATION_BEFORE_THE_RULE are history, not checked; the cases
 * at the bottom show what the rule would have said about some of them.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

/*
 * The newest migration registered when this rule was added. Everything up to
 * it has shipped, or is about to, as written.
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

/* The SQL literals of a migration file, minus down() and OnlineDdl's own. */
function readSqlLiterals(source: string): Array<string> {
  const file: ts.SourceFile = ts.createSourceFile(
    "migration.ts",
    source,
    ts.ScriptTarget.Latest,
    true,
  );
  const literals: Array<string> = [];

  function visit(node: ts.Node): void {
    if (ts.isMethodDeclaration(node) && node.name.getText(file) === "down") {
      return;
    }

    if (
      ts.isCallExpression(node) &&
      ONLINE_DDL_CALLS.includes(node.expression.getText(file))
    ) {
      // Its statements run online; whatever else the call holds does not.
      node.arguments.forEach((argument: ts.Expression) => {
        if (!isSqlLiteral(argument)) {
          visit(argument);
        }
      });
      return;
    }

    if (isSqlLiteral(node)) {
      literals.push(literalText(node));
      return;
    }

    ts.forEachChild(node, visit);
  }

  visit(file);

  return literals;
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

const TABLE: string = `((?:"[^"]+"\\.)?"[^"]+"|\\$\\{\\.\\.\\.\\})`;

const NOT_VALID: RegExp = /\bNOT VALID\b/i;

/* "Monitor" for "Monitor" and "public"."Monitor". */
function tableName(quoted: string): string {
  const segments: Array<string> = quoted.split(".");
  return segments[segments.length - 1]!.replace(/"/g, "");
}

function findBlockingDdl(source: string): Array<BlockingDdl> {
  const statements: Array<string> = readSqlLiterals(source)
    .flatMap((literal: string): Array<string> => {
      return literal.split(";");
    })
    .map((statement: string): string => {
      return statement.replace(/\s+/g, " ").trim();
    })
    .filter(Boolean);

  const created: Set<string> = new Set();

  for (const statement of statements) {
    const match: RegExpMatchArray | null = statement.match(
      new RegExp(`^CREATE TABLE (?:IF NOT EXISTS )?${TABLE}`, "i"),
    );
    if (match && match[1]) {
      created.add(tableName(match[1]));
    }
  }

  const found: Array<BlockingDdl> = [];

  for (const statement of statements) {
    const index: RegExpMatchArray | null = statement.match(
      new RegExp(
        `^CREATE (?:UNIQUE )?INDEX (CONCURRENTLY )?(?:IF NOT EXISTS )?(?:"[^"]+" )?ON (?:ONLY )?${TABLE}`,
        "i",
      ),
    );

    if (index && !index[1] && index[2] && !created.has(tableName(index[2]))) {
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
      !created.has(tableName(foreignKey[1]))
    ) {
      found.push({
        statement,
        problem: `adds a foreign key to ${foreignKey[1]}, which already exists, checking every row of it while holding SHARE ROW EXCLUSIVE on it and on ${foreignKey[2]} - no writes to either. Use OnlineDdl.addForeignKey in a migration with transaction = false.`,
      });
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
  const files: Array<string> = fs
    .readdirSync(MIGRATION_DIRECTORY)
    .filter((file: string): boolean => {
      return file.startsWith(`${timestamp}-`) && file.endsWith(".ts");
    });

  for (const file of files) {
    const source: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, file),
      "utf8",
    );
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

describe("New schema migrations keep existing tables writable", () => {
  test("no new migration builds an index or validates a foreign key on an existing table while blocking it", () => {
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
      expect(
        found.map((blocking: BlockingDdl): string => {
          return blocking.statement;
        }),
      ).toEqual(
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
});
