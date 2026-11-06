import { describe, expect, test } from "@jest/globals";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MigrationName1765580181582 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1765580181582-MigrationName";
import { MigrationName1766774689743 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1766774689743-MigrationName";
import { WidenGitBranchNameColumns1808994780000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808994780000-WidenGitBranchNameColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import {
  CODE_TASK_LIMITS,
  CodeTaskBranchName,
} from "../../../Types/AI/CodeTask";
import ColumnLength, {
  getMaxLengthFromTableColumnType,
} from "../../../Types/Database/ColumnLength";
import ColumnType from "../../../Types/Database/ColumnType";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import type { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A BRANCH NAME IS STORED WHOLE, IN A COLUMN THAT HOLDS ANY BRANCH GITHUB
 * TAKES.
 *
 * AIAgentTaskPullRequest.headRefName and baseRefName, and
 * CodeRepository.mainBranchName, were ShortText: 100 characters. Each is
 * copied in as the host names it - by CodeFixPullRequestRecord, by the chat's
 * open-pull-request tool, by the repository connectors - so a longer one
 * failed DatabaseService.checkMaxLengthOfFields: a base branch a person
 * picked for a code task (up to CODE_TASK_LIMITS.maxBranchNameLength, 255),
 * or a long default branch. /ai-agent-data/record-pull-request failed, the
 * Completed report's fallback logged that and went on, and the pull request
 * was never recorded: the open-PR cap never counted it and the PR state sync
 * never tracked it. A repository with a longer default branch could not be
 * connected at all.
 *
 * Cutting a name to fit is no fix - a cut branch name is another branch - so
 * the three columns are LongText now, 500 characters. GitHub takes a ref of
 * at most 255 bytes, and a name never has more characters than bytes, in
 * JavaScript's count (which the check uses) or in Postgres's, so every
 * branch GitHub takes fits, in any script.
 *
 * TypeORM generates the change as DROP COLUMN + ADD, which drops every
 * recorded branch and puts every repository back on "main", the column's
 * default. WidenGitBranchNameColumns1808994780000 is ALTER COLUMN ... TYPE:
 * the same schema (the drift check passes), every name kept. Pure metadata,
 * the real length check and recorded SQL here - no Postgres.
 */

// The most GitHub takes in a ref, refs/heads/ and all.
const GITHUB_MAX_REF_BYTES: number = 255;

// The width the three columns had, which a longer branch overflowed.
const OLD_WIDTH: number = ColumnLength.ShortText;

/*
 * Branch names as long as GitHub takes, in scripts whose characters take
 * one to four bytes. Each is a name git takes.
 */
const LONGEST_BRANCH_NAMES: Array<{ script: string; name: string }> = [
  // 255 characters, 255 bytes.
  { script: "ASCII", name: `release/${"a".repeat(247)}` },
  // 127 characters, 254 bytes.
  { script: "accented Latin", name: "é".repeat(127) },
  // 85 characters, 255 bytes.
  { script: "Chinese", name: `${"分支".repeat(42)}分` },
  // 63 characters, 126 in JavaScript's count, 252 bytes.
  { script: "emoji", name: "🚀".repeat(63) },
];

interface BranchColumn {
  label: string;
  table: string;
  target: unknown;
  propertyName: string;
  newInstance: () => DatabaseBaseModel;
  /*
   * Runs the length check DatabaseService runs on every create and update
   * over a row whose branch is `name`.
   */
  check: (name: string) => void;
  // The migration that created the column, and how it wrote it.
  createdBy: () => MigrationInterface;
  createdByName: string;
  createdAs: string;
}

const BRANCH_COLUMNS: Array<BranchColumn> = [
  {
    label: "AIAgentTaskPullRequest.headRefName",
    table: "AIAgentTaskPullRequest",
    target: AIAgentTaskPullRequest,
    propertyName: "headRefName",
    newInstance: (): DatabaseBaseModel => {
      return new AIAgentTaskPullRequest();
    },
    check: (name: string): void => {
      const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
      pullRequest.headRefName = name;
      AIAgentTaskPullRequestService["checkMaxLengthOfFields"](pullRequest);
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1766774689743();
    },
    createdByName: "MigrationName1766774689743",
    createdAs: `"headRefName" character varying(100),`,
  },
  {
    label: "AIAgentTaskPullRequest.baseRefName",
    table: "AIAgentTaskPullRequest",
    target: AIAgentTaskPullRequest,
    propertyName: "baseRefName",
    newInstance: (): DatabaseBaseModel => {
      return new AIAgentTaskPullRequest();
    },
    check: (name: string): void => {
      const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
      pullRequest.baseRefName = name;
      AIAgentTaskPullRequestService["checkMaxLengthOfFields"](pullRequest);
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1766774689743();
    },
    createdByName: "MigrationName1766774689743",
    createdAs: `"baseRefName" character varying(100),`,
  },
  {
    label: "CodeRepository.mainBranchName",
    table: "CodeRepository",
    target: CodeRepository,
    propertyName: "mainBranchName",
    newInstance: (): DatabaseBaseModel => {
      return new CodeRepository();
    },
    check: (name: string): void => {
      const repository: CodeRepository = new CodeRepository();
      repository.mainBranchName = name;
      CodeRepositoryService["checkMaxLengthOfFields"](repository);
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1765580181582();
    },
    createdByName: "MigrationName1765580181582",
    createdAs: `"mainBranchName" character varying(100) DEFAULT 'main',`,
  },
];

function columnArgs(column: BranchColumn): ColumnMetadataArgs {
  const args: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
    .columns.filter((candidate: ColumnMetadataArgs) => {
      return candidate.target === column.target;
    })
    .find((candidate: ColumnMetadataArgs) => {
      return candidate.propertyName === column.propertyName;
    });

  if (!args) {
    throw new Error(`${column.label} has no TypeORM @Column metadata`);
  }

  return args;
}

function tableColumn(column: BranchColumn): TableColumnMetadata {
  return column.newInstance().getTableColumnMetadata(column.propertyName);
}

function recordQueries(): {
  runner: QueryRunner;
  sql: () => Array<string>;
} {
  const query: jest.Mock = jest.fn(async (): Promise<void> => {
    return undefined;
  });

  return {
    runner: { query } as unknown as QueryRunner,
    sql: (): Array<string> => {
      return query.mock.calls.map((call: Array<unknown>): string => {
        return String(call[0]);
      });
    },
  };
}

describe("The branch name columns", () => {
  test.each(BRANCH_COLUMNS)(
    "$label is LongText: varchar(500), optional, read on relations",
    (column: BranchColumn) => {
      const metadata: TableColumnMetadata = tableColumn(column);
      const args: ColumnMetadataArgs = columnArgs(column);

      expect(metadata.type).toBe(TableColumnType.LongText);
      expect(metadata.required).toBe(false);
      expect(metadata.canReadOnRelationQuery).toBe(true);
      expect(args.options.type).toBe(ColumnType.LongText);
      expect(args.options.length).toBe(ColumnLength.LongText);
      expect(args.options.nullable).toBe(true);
    },
  );

  test.each(BRANCH_COLUMNS)(
    "$label holds any branch GitHub takes, and the check, the form and the database agree on its width",
    (column: BranchColumn) => {
      // DatabaseService.checkMaxLengthOfFields and ModelForm read it from the type.
      const checkedWidth: number | undefined = getMaxLengthFromTableColumnType(
        tableColumn(column).type,
      );

      expect(checkedWidth).toBe(500);
      expect(columnArgs(column).options.length).toBe(checkedWidth);
      expect(checkedWidth!).toBeGreaterThanOrEqual(GITHUB_MAX_REF_BYTES);
      expect(checkedWidth!).toBeGreaterThanOrEqual(
        CODE_TASK_LIMITS.maxBranchNameLength,
      );
    },
  );

  test.each(BRANCH_COLUMNS)(
    "$label is no longer the 100-character ShortText it was",
    (column: BranchColumn) => {
      expect(getMaxLengthFromTableColumnType(TableColumnType.ShortText)).toBe(
        OLD_WIDTH,
      );
      expect(tableColumn(column).type).not.toBe(TableColumnType.ShortText);
    },
  );

  test("CodeRepository.mainBranchName still starts as main", () => {
    const mainBranch: BranchColumn | undefined = BRANCH_COLUMNS.find(
      (column: BranchColumn) => {
        return column.propertyName === "mainBranchName";
      },
    );

    expect(columnArgs(mainBranch!).options.default).toBe("main");
  });
});

describe("A branch name in a branch column", () => {
  for (const column of BRANCH_COLUMNS) {
    test.each(LONGEST_BRANCH_NAMES)(
      `${column.label} takes a branch as long as GitHub takes, in $script, whole`,
      ({ name }: { name: string }) => {
        // A name git and GitHub take, and one a person could pick for a task.
        expect(Buffer.byteLength(name, "utf8")).toBeLessThanOrEqual(
          GITHUB_MAX_REF_BYTES,
        );
        expect(CodeTaskBranchName.isValid(name)).toBe(true);

        // Never more characters than bytes.
        expect(name.length).toBeLessThanOrEqual(GITHUB_MAX_REF_BYTES);

        expect(() => {
          return column.check(name);
        }).not.toThrow();
      },
    );
  }

  test.each(BRANCH_COLUMNS)(
    "$label takes the longest branch a person can pick for a code task, and one of 200 characters",
    (column: BranchColumn) => {
      const longestPicked: string = "p".repeat(
        CODE_TASK_LIMITS.maxBranchNameLength,
      );
      const twoHundred: string = `feature/${"b".repeat(192)}`;

      expect(CodeTaskBranchName.isValid(longestPicked)).toBe(true);
      expect(twoHundred).toHaveLength(200);

      expect(() => {
        return column.check(longestPicked);
      }).not.toThrow();
      expect(() => {
        return column.check(twoHundred);
      }).not.toThrow();
    },
  );

  test.each(BRANCH_COLUMNS)(
    "$label still refuses what no host names a branch, so the check is real",
    (column: BranchColumn) => {
      expect(() => {
        return column.check("x".repeat(ColumnLength.LongText + 1));
      }).toThrow(
        `${column.propertyName} length cannot be more than ${ColumnLength.LongText} characters`,
      );
    },
  );
});

describe("WidenGitBranchNameColumns1808994780000", () => {
  const migration: WidenGitBranchNameColumns1808994780000 =
    new WidenGitBranchNameColumns1808994780000();

  test("up() widens each column in place, keeping every name", async () => {
    const { runner, sql } = recordQueries();
    await migration.up(runner);

    expect(sql()).toEqual([
      `ALTER TABLE "CodeRepository" ALTER COLUMN "mainBranchName" TYPE character varying(500)`,
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "headRefName" TYPE character varying(500)`,
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "baseRefName" TYPE character varying(500)`,
    ]);

    for (const statement of sql()) {
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DELETE");
    }
  });

  test("down() empties a branch too long for the old width rather than cut it, then narrows", async () => {
    const { runner, sql } = recordQueries();
    await migration.down(runner);

    expect(sql()).toEqual([
      `UPDATE "AIAgentTaskPullRequest" SET "baseRefName" = NULL WHERE LENGTH("baseRefName") > 100`,
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "baseRefName" TYPE character varying(100)`,
      `UPDATE "AIAgentTaskPullRequest" SET "headRefName" = NULL WHERE LENGTH("headRefName") > 100`,
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "headRefName" TYPE character varying(100)`,
      `UPDATE "CodeRepository" SET "mainBranchName" = NULL WHERE LENGTH("mainBranchName") > 100`,
      `ALTER TABLE "CodeRepository" ALTER COLUMN "mainBranchName" TYPE character varying(100)`,
    ]);

    for (const statement of sql()) {
      expect(statement).not.toContain("LEFT(");
      expect(statement).not.toContain("SUBSTRING");
      expect(statement).not.toContain("DROP");
    }
  });

  test.each(BRANCH_COLUMNS)(
    "down() gives $label back exactly the width its table was created with",
    async (column: BranchColumn) => {
      const created: { runner: QueryRunner; sql: () => Array<string> } =
        recordQueries();
      await column.createdBy().up(created.runner);

      const createTable: string | undefined = created
        .sql()
        .find((statement: string) => {
          return statement.startsWith(`CREATE TABLE "${column.table}" (`);
        });

      expect(createTable).toBeDefined();
      expect(createTable).toContain(column.createdAs);

      const reverted: { runner: QueryRunner; sql: () => Array<string> } =
        recordQueries();
      await migration.down(reverted.runner);

      expect(reverted.sql()).toContain(
        `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(${OLD_WIDTH})`,
      );
    },
  );

  test.each(BRANCH_COLUMNS)(
    "is registered, after the migration that created $label",
    (column: BranchColumn) => {
      const names: Array<string> = SchemaMigrations.map(
        (migrationClass: new () => MigrationInterface): string => {
          return migrationClass.name;
        },
      );
      const widened: number = names.indexOf(
        "WidenGitBranchNameColumns1808994780000",
      );
      const created: number = names.indexOf(column.createdByName);

      expect(widened).toBeGreaterThan(-1);
      expect(created).toBeGreaterThan(-1);
      expect(widened).toBeGreaterThan(created);
    },
  );

  test("its name carries its timestamp, as its file's does", () => {
    expect(migration.name).toBe("WidenGitBranchNameColumns1808994780000");
  });
});
