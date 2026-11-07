import { describe, expect, test } from "@jest/globals";
import AIAgentTaskPullRequest from "../../../Models/DatabaseModels/AIAgentTaskPullRequest";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { MigrationName1765580181582 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1765580181582-MigrationName";
import { MigrationName1766774689743 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1766774689743-MigrationName";
import { WidenCodeRepositoryOwnerColumns1808995240000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1808995240000-WidenCodeRepositoryOwnerColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import AIAgentTaskPullRequestService from "../../../Server/Services/AIAgentTaskPullRequestService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import {
  CodeHostUrl,
  CodeHostUrlError,
  GitRemoteAddress,
  MAX_CODE_HOST_URL_LENGTH,
} from "../../../Types/CodeRepository/CodeHost";
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
 * A REPOSITORY'S OWNER IS STORED WHOLE, IN A COLUMN THAT HOLDS ANY GITLAB
 * GROUP'S FULL PATH.
 *
 * CodeRepository.organizationName, and AIAgentTaskPullRequest.repoOrganizationName
 * copied from it, were ShortText: 100 characters. The owner is the host's own
 * name for it - a GitLab group's full path (namespace.full_path), the path
 * before the name in a Git address - and is part of the repository's address,
 * so a cut one is another group. Past 100, the connector skipped a GitLab
 * project in a deeply nested group and refused a Git address with a long
 * path.
 *
 * GitLab nests a group under at most 20 others
 * (Namespace::NUMBER_OF_ANCESTORS_ALLOWED) and takes a path of at most 255
 * characters (Namespace::URL_MAX_LENGTH), so a group's full path runs to 21
 * paths and the 20 slashes between them: 5,375 characters, past every
 * varchar width OneUptime has. Both columns are VeryLongText now, Postgres
 * text: no width for the check, the form or the database to disagree on.
 *
 * TypeORM generates the change as DROP COLUMN + ADD, which drops every owner
 * - and the ADD of a NOT NULL column with no default fails outright on a
 * table holding a row. WidenCodeRepositoryOwnerColumns1808995240000 is ALTER
 * COLUMN ... TYPE: the same schema (the drift check passes), every owner
 * kept. Pure metadata, the real length check and recorded SQL here - no
 * Postgres.
 */

// GitLab's limits, from app/models/namespace.rb.
const GITLAB_MAX_PATH_LENGTH: number = 255;
const GITLAB_MAX_ANCESTORS: number = 20;

/*
 * The full path of a group as deeply nested as GitLab allows, each group's
 * path as long as GitLab allows. A path is letters, digits, "_", "-" and
 * ".", so its characters are its bytes.
 */
const DEEPEST_GITLAB_GROUP_PATH: string = Array.from(
  { length: GITLAB_MAX_ANCESTORS + 1 },
  (_: unknown, index: number): string => {
    return String.fromCharCode(97 + index).repeat(GITLAB_MAX_PATH_LENGTH);
  },
).join("/");

// The width the two columns had, which a longer owner overflowed.
const OLD_WIDTH: number = ColumnLength.ShortText;

interface OwnerColumn {
  label: string;
  table: string;
  target: unknown;
  propertyName: string;
  required: boolean;
  nullable: boolean;
  newInstance: () => DatabaseBaseModel;
  /*
   * Runs the length check DatabaseService runs on every create and update
   * over a row whose owner is `owner`.
   */
  check: (owner: string) => void;
  // The migration that created the column, and how it wrote it.
  createdBy: () => MigrationInterface;
  createdByName: string;
  createdAs: string;
}

const OWNER_COLUMNS: Array<OwnerColumn> = [
  {
    label: "CodeRepository.organizationName",
    table: "CodeRepository",
    target: CodeRepository,
    propertyName: "organizationName",
    required: true,
    nullable: false,
    newInstance: (): DatabaseBaseModel => {
      return new CodeRepository();
    },
    check: (owner: string): void => {
      const repository: CodeRepository = new CodeRepository();
      repository.organizationName = owner;
      CodeRepositoryService["checkMaxLengthOfFields"](repository);
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1765580181582();
    },
    createdByName: "MigrationName1765580181582",
    createdAs: `"organizationName" character varying(100) NOT NULL,`,
  },
  {
    label: "AIAgentTaskPullRequest.repoOrganizationName",
    table: "AIAgentTaskPullRequest",
    target: AIAgentTaskPullRequest,
    propertyName: "repoOrganizationName",
    required: false,
    nullable: true,
    newInstance: (): DatabaseBaseModel => {
      return new AIAgentTaskPullRequest();
    },
    check: (owner: string): void => {
      const pullRequest: AIAgentTaskPullRequest = new AIAgentTaskPullRequest();
      pullRequest.repoOrganizationName = owner;
      AIAgentTaskPullRequestService["checkMaxLengthOfFields"](pullRequest);
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1766774689743();
    },
    createdByName: "MigrationName1766774689743",
    createdAs: `"repoOrganizationName" character varying(100),`,
  },
];

function columnArgs(column: OwnerColumn): ColumnMetadataArgs {
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

function tableColumn(column: OwnerColumn): TableColumnMetadata {
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

describe("The owner columns", () => {
  test.each(OWNER_COLUMNS)(
    "$label is VeryLongText: text, read on relations, as required as it was",
    (column: OwnerColumn) => {
      const metadata: TableColumnMetadata = tableColumn(column);
      const args: ColumnMetadataArgs = columnArgs(column);

      expect(metadata.type).toBe(TableColumnType.VeryLongText);
      expect(metadata.required).toBe(column.required);
      expect(metadata.canReadOnRelationQuery).toBe(true);
      expect(args.options.type).toBe(ColumnType.VeryLongText);
      expect(args.options.type).toBe("text");
      expect(args.options.nullable).toBe(column.nullable);
    },
  );

  test.each(OWNER_COLUMNS)(
    "$label has no width for the check, the form and the database to disagree on",
    (column: OwnerColumn) => {
      // DatabaseService.checkMaxLengthOfFields and ModelForm read it from the type.
      expect(
        getMaxLengthFromTableColumnType(tableColumn(column).type),
      ).toBeUndefined();
      expect(columnArgs(column).options.length).toBeUndefined();
    },
  );

  test.each(OWNER_COLUMNS)(
    "$label is no longer the 100-character ShortText it was",
    (column: OwnerColumn) => {
      expect(getMaxLengthFromTableColumnType(TableColumnType.ShortText)).toBe(
        OLD_WIDTH,
      );
      expect(tableColumn(column).type).not.toBe(TableColumnType.ShortText);
    },
  );
});

describe("An owner in an owner column", () => {
  test("the deepest GitLab group path is 21 paths of 255 characters: 5,375 in all", () => {
    const paths: Array<string> = DEEPEST_GITLAB_GROUP_PATH.split("/");

    expect(paths).toHaveLength(GITLAB_MAX_ANCESTORS + 1);

    for (const path of paths) {
      expect(path).toHaveLength(GITLAB_MAX_PATH_LENGTH);
    }

    expect(DEEPEST_GITLAB_GROUP_PATH).toHaveLength(5375);
    expect(Buffer.byteLength(DEEPEST_GITLAB_GROUP_PATH, "utf8")).toBe(5375);
  });

  test.each(OWNER_COLUMNS)(
    "$label takes the full path of a group as deeply nested as GitLab allows, whole",
    (column: OwnerColumn) => {
      expect(() => {
        return column.check(DEEPEST_GITLAB_GROUP_PATH);
      }).not.toThrow();
    },
  );

  test.each(OWNER_COLUMNS)(
    "$label takes a group path just past the old width",
    (column: OwnerColumn) => {
      const groupPath: string = `acme/${"platform-".repeat(10)}${"x".repeat(6)}`;

      expect(groupPath).toHaveLength(OLD_WIDTH + 1);
      expect(() => {
        return column.check(groupPath);
      }).not.toThrow();
    },
  );

  test.each(OWNER_COLUMNS)(
    "$label takes the path before the name in the longest Git address OneUptime takes",
    (column: OwnerColumn) => {
      // 41 groups, the first one character longer: a 2,000-character address.
      const groupPath: string = Array.from(
        { length: 41 },
        (_: unknown, index: number): string => {
          return `${index === 0 ? "h" : ""}${"g".repeat(47)}`;
        },
      ).join("/");
      const url: string = `https://git.example.com/${groupPath}/app.git`;

      expect(url).toHaveLength(MAX_CODE_HOST_URL_LENGTH);

      const address: GitRemoteAddress = CodeHostUrl.readGitRemoteUrl(url);

      expect(address.organizationName).toBe(groupPath);
      expect(address.repositoryName).toBe("app");

      // One character more is an address OneUptime does not take.
      expect(() => {
        return CodeHostUrl.readGitRemoteUrl(
          `https://git.example.com/${groupPath}/apps.git`,
        );
      }).toThrow(CodeHostUrlError);

      expect(() => {
        return column.check(address.organizationName);
      }).not.toThrow();
    },
  );
});

describe("WidenCodeRepositoryOwnerColumns1808995240000", () => {
  const migration: WidenCodeRepositoryOwnerColumns1808995240000 =
    new WidenCodeRepositoryOwnerColumns1808995240000();

  test("up() widens each column in place, keeping every owner", async () => {
    const { runner, sql } = recordQueries();
    await migration.up(runner);

    expect(sql()).toEqual([
      `ALTER TABLE "CodeRepository" ALTER COLUMN "organizationName" TYPE text`,
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "repoOrganizationName" TYPE text`,
    ]);

    for (const statement of sql()) {
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DELETE");
    }
  });

  test("down() empties a pull request's copy too long for the old width rather than cut it, and never cuts or empties a repository's owner", async () => {
    const { runner, sql } = recordQueries();
    await migration.down(runner);

    expect(sql()).toEqual([
      `UPDATE "AIAgentTaskPullRequest" SET "repoOrganizationName" = NULL WHERE LENGTH("repoOrganizationName") > 100`,
      `ALTER TABLE "AIAgentTaskPullRequest" ALTER COLUMN "repoOrganizationName" TYPE character varying(100)`,
      `ALTER TABLE "CodeRepository" ALTER COLUMN "organizationName" TYPE character varying(100)`,
    ]);

    for (const statement of sql()) {
      expect(statement).not.toContain("LEFT(");
      expect(statement).not.toContain("SUBSTRING");
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain(`SET "organizationName"`);
      expect(statement).not.toContain("DELETE");
    }
  });

  test.each(OWNER_COLUMNS)(
    "down() gives $label back exactly the width its table was created with",
    async (column: OwnerColumn) => {
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

  test.each(OWNER_COLUMNS)(
    "is registered, after the migration that created $label",
    (column: OwnerColumn) => {
      const names: Array<string> = SchemaMigrations.map(
        (migrationClass: new () => MigrationInterface): string => {
          return migrationClass.name;
        },
      );
      const widened: number = names.indexOf(
        "WidenCodeRepositoryOwnerColumns1808995240000",
      );
      const created: number = names.indexOf(column.createdByName);

      expect(widened).toBeGreaterThan(-1);
      expect(created).toBeGreaterThan(-1);
      expect(widened).toBeGreaterThan(created);
    },
  );

  test("its name carries its timestamp, as its file's does", () => {
    expect(migration.name).toBe("WidenCodeRepositoryOwnerColumns1808995240000");
  });
});
