import { afterEach, describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner } from "typeorm";
import OnlineDdl, {
  OnlineIndex,
} from "../../../../Server/Infrastructure/Postgres/OnlineDdl";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AutoRemediationRule from "../../../../Models/DatabaseModels/AutoRemediationRule";
import DataSecurityAiDecision from "../../../../Models/DatabaseModels/DataSecurityAiDecision";
import DataSecurityAiProposal from "../../../../Models/DatabaseModels/DataSecurityAiProposal";
import Project from "../../../../Models/DatabaseModels/Project";
import Migrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddDataSecurityAiRules1809187364000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187364000-AddDataSecurityAiRules";
import { AddAIRunDataSecurityIssueIndex1809187364100 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187364100-AddAIRunDataSecurityIssueIndex";
import { DATA_SECURITY_AI_WORK_COLUMNS } from "../../../../Types/DataSecurity/DataSecurityAi";
import { DATA_SECURITY_AI_RULE_ISSUE_CRITERIA_FIELDS } from "../../../../Types/DataSecurity/DataSecurityAi";
import { TableColumnMetadata } from "../../../../Types/Database/TableColumn";
import TableColumnType from "../../../../Types/Database/TableColumnType";

/*
 * The migrations behind AI rules for Data Security (#10364): the two new
 * tables (proposals, decisions), a Data Security AI rule's columns and the
 * join table of the store labels it matches, the project's switch - off for
 * every project that exists, so an upgrade spends no AI credits unasked -
 * and AIRun's column for the issue a run is about, whose index on the busy
 * AIRun table is built online by a migration of its own. Pinned here
 * without a database: what up() and down() run, where they are registered,
 * and that the models declare what the migrations make; the drift check
 * (Scripts/Postgres/CheckSchemaDrift) holds the two together on Postgres.
 */

const MIGRATIONS_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "Server",
  "Infrastructure",
  "Postgres",
  "SchemaMigrations",
);

const RULES: { name: string; timestamp: number; file: string } = {
  name: "AddDataSecurityAiRules1809187364000",
  timestamp: 1809187364000,
  file: "1809187364000-AddDataSecurityAiRules.ts",
};

const INDEX: { name: string; timestamp: number; file: string } = {
  name: "AddAIRunDataSecurityIssueIndex1809187364100",
  timestamp: 1809187364100,
  file: "1809187364100-AddAIRunDataSecurityIssueIndex.ts",
};

type MigrationClass = { name: string };

const registeredNames: Array<string> = (
  Migrations as unknown as Array<MigrationClass>
).map((migration: MigrationClass): string => {
  return migration.name;
});

const TIMESTAMP_PATTERN: RegExp = /(\d{13})$/;

function timestampOf(name: string): number | null {
  const stamp: RegExpMatchArray | null = name.match(TIMESTAMP_PATTERN);

  return stamp ? Number(stamp[1]) : null;
}

// What up() or down() sends, on a database that answers every read with nothing.
async function recordQueries(
  migration: {
    up: (queryRunner: QueryRunner) => Promise<void>;
    down: (queryRunner: QueryRunner) => Promise<void>;
  },
  direction: "up" | "down",
): Promise<Array<string>> {
  const statements: Array<string> = [];

  const queryRunner: QueryRunner = {
    query: async (statement: string): Promise<Array<unknown>> => {
      statements.push(statement.trim());
      return [];
    },
  } as unknown as QueryRunner;

  await migration[direction](queryRunner);

  return statements;
}

describe("AddDataSecurityAiRules and its online AIRun index: registration", () => {
  test.each([RULES, INDEX])(
    "$name carries its timestamp in its name and its file, which no other file shares",
    (migration: { name: string; timestamp: number; file: string }) => {
      expect(fs.existsSync(path.join(MIGRATIONS_DIR, migration.file))).toBe(
        true,
      );
      expect(
        fs.readdirSync(MIGRATIONS_DIR).filter((file: string): boolean => {
          return file.startsWith(`${migration.timestamp}-`);
        }),
      ).toEqual([migration.file]);
    },
  );

  test("each is registered once, after every migration with an earlier timestamp, the index right after the tables", () => {
    for (const migration of [RULES, INDEX]) {
      expect(
        registeredNames.filter((name: string): boolean => {
          return name === migration.name;
        }),
      ).toEqual([migration.name]);

      const index: number = registeredNames.indexOf(migration.name);

      for (const name of registeredNames.slice(0, index)) {
        const stamp: number | null = timestampOf(name);

        if (stamp !== null) {
          expect([name, stamp < migration.timestamp]).toEqual([name, true]);
        }
      }
    }

    expect(registeredNames.indexOf(INDEX.name)).toBe(
      registeredNames.indexOf(RULES.name) + 1,
    );
    expect(new AddDataSecurityAiRules1809187364000().name).toBe(RULES.name);
    expect(new AddAIRunDataSecurityIssueIndex1809187364100().name).toBe(
      INDEX.name,
    );
  });
});

describe("AddDataSecurityAiRules: what it runs", () => {
  test("up() makes the two tables, the rule's columns, the switch and the run's column - and no index on AIRun", async () => {
    const statements: Array<string> = await recordQueries(
      new AddDataSecurityAiRules1809187364000(),
      "up",
    );

    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith("CREATE TABLE");
      }),
    ).toEqual([
      expect.stringContaining('CREATE TABLE "DataSecurityAiProposal"'),
      expect.stringContaining('CREATE TABLE "DataSecurityAiDecision"'),
      expect.stringContaining('CREATE TABLE "AutoRemediationRuleDataStoreLabel"'),
    ]);
    expect(statements).toContain(
      'ALTER TABLE "Project" ADD "enableAutomaticDataSecurityAi" boolean NOT NULL DEFAULT false',
    );
    expect(statements).toContain(
      'ALTER TABLE "AIRun" ADD "triggeredByDataSecurityIssueId" uuid',
    );

    for (const column of DATA_SECURITY_AI_WORK_COLUMNS) {
      expect(statements).toContain(
        `ALTER TABLE "AutoRemediationRule" ADD "${column}" character varying(100)`,
      );
    }

    for (const field of DATA_SECURITY_AI_RULE_ISSUE_CRITERIA_FIELDS) {
      if (field === "dataStoreLabels") {
        continue;
      }

      expect(statements).toContain(
        `ALTER TABLE "AutoRemediationRule" ADD "${field}" jsonb`,
      );
    }

    // Only the new tables are indexed and keyed here: they are empty.
    for (const statement of statements) {
      if (statement.startsWith("CREATE INDEX")) {
        expect(statement).toMatch(
          /ON "(DataSecurityAiProposal|DataSecurityAiDecision|AutoRemediationRuleDataStoreLabel)"/,
        );
      }

      if (statement.includes("ADD CONSTRAINT")) {
        expect(statement).toMatch(
          /^ALTER TABLE "(DataSecurityAiProposal|DataSecurityAiDecision|AutoRemediationRuleDataStoreLabel)"/,
        );
      }
    }
  });

  test("an existing rule's new columns are all empty, and an existing project's switch is off", async () => {
    const statements: Array<string> = await recordQueries(
      new AddDataSecurityAiRules1809187364000(),
      "up",
    );

    for (const statement of statements) {
      if (statement.startsWith('ALTER TABLE "AutoRemediationRule" ADD')) {
        expect(statement).not.toContain("NOT NULL");
        expect(statement).not.toContain("DEFAULT");
      }
    }
  });

  test("down() takes back everything up() made, in reverse", async () => {
    const statements: Array<string> = await recordQueries(
      new AddDataSecurityAiRules1809187364000(),
      "down",
    );

    expect(statements).toContain('DROP TABLE "DataSecurityAiProposal"');
    expect(statements).toContain('DROP TABLE "DataSecurityAiDecision"');
    expect(statements).toContain('DROP TABLE "AutoRemediationRuleDataStoreLabel"');
    expect(statements).toContain(
      'ALTER TABLE "Project" DROP COLUMN "enableAutomaticDataSecurityAi"',
    );
    expect(statements).toContain(
      'ALTER TABLE "AIRun" DROP COLUMN "triggeredByDataSecurityIssueId"',
    );

    for (const column of DATA_SECURITY_AI_WORK_COLUMNS) {
      expect(statements).toContain(
        `ALTER TABLE "AutoRemediationRule" DROP COLUMN "${column}"`,
      );
    }

    expect(
      statements.some((statement: string): boolean => {
        return statement.includes('"IDX_f3ede3fa4d2734c08bc77e3471"');
      }),
    ).toBe(false);
  });
});

describe("AddAIRunDataSecurityIssueIndex: built online", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  // What the migration hands OnlineDdl, and anything it runs itself.
  async function onlineStatementsOf(
    direction: "up" | "down",
  ): Promise<Array<string>> {
    const statements: Array<string> = [];

    for (const step of ["createIndex", "dropIndex"] as const) {
      jest.spyOn(OnlineDdl, step).mockImplementation((async (
        _runner: QueryRunner,
        statement: string,
      ) => {
        statements.push(`online: ${statement.trim()}`);
      }) as never);
    }

    await new AddAIRunDataSecurityIssueIndex1809187364100()[direction]({
      isTransactionActive: false,
      query: (sql: string): Promise<undefined> => {
        statements.push(sql.trim());
        return Promise.resolve(undefined);
      },
    } as unknown as QueryRunner);

    return statements;
  }

  test("runs outside a transaction, and builds and drops the index the generator wrote, online", async () => {
    expect(new AddAIRunDataSecurityIssueIndex1809187364100().transaction).toBe(
      false,
    );
    expect(await onlineStatementsOf("up")).toEqual([
      'online: CREATE INDEX "IDX_f3ede3fa4d2734c08bc77e3471" ON "AIRun" ("triggeredByDataSecurityIssueId")',
    ]);
    expect(await onlineStatementsOf("down")).toEqual([
      'online: DROP INDEX "public"."IDX_f3ede3fa4d2734c08bc77e3471"',
    ]);
  });

  test("OnlineDdl reads the build as one it can run concurrently", () => {
    const parsed: OnlineIndex = OnlineDdl.parseCreateIndex(
      'CREATE INDEX "IDX_f3ede3fa4d2734c08bc77e3471" ON "AIRun" ("triggeredByDataSecurityIssueId") ',
    );

    expect(parsed.build).toContain("CREATE INDEX CONCURRENTLY");
    expect(parsed.quotedTable).toBe('"AIRun"');
  });
});

describe("the models declare what the migrations make", () => {
  test("the switch is a Boolean, required and off in the column", () => {
    const metadata: TableColumnMetadata | undefined =
      new Project().getTableColumnMetadata("enableAutomaticDataSecurityAi");

    expect(metadata?.type).toBe(TableColumnType.Boolean);
    expect(metadata?.required).toBe(true);
    expect(metadata?.defaultValue).toBe(false);
  });

  test("the run's issue is an indexed id, with no relation", () => {
    const run: AIRun = new AIRun();

    expect(
      run.getTableColumnMetadata("triggeredByDataSecurityIssueId")?.type,
    ).toBe(TableColumnType.ObjectID);
  });

  test("a rule's four kinds of work and its condition columns", () => {
    const rule: AutoRemediationRule = new AutoRemediationRule();

    for (const column of DATA_SECURITY_AI_WORK_COLUMNS) {
      expect(rule.getTableColumnMetadata(column)?.type).toBe(
        TableColumnType.ShortText,
      );
    }

    for (const field of DATA_SECURITY_AI_RULE_ISSUE_CRITERIA_FIELDS) {
      expect(rule.getTableColumnMetadata(field)?.type).toBe(
        field === "dataStoreLabels"
          ? TableColumnType.EntityArray
          : TableColumnType.JSON,
      );
    }
  });

  test("the new tables are the models'", () => {
    expect(new DataSecurityAiProposal().tableName).toBe(
      "DataSecurityAiProposal",
    );
    expect(new DataSecurityAiDecision().tableName).toBe(
      "DataSecurityAiDecision",
    );
  });
});
