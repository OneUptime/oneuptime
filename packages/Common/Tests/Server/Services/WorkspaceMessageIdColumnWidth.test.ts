import { describe, expect, test } from "@jest/globals";
import DatabaseBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import WorkspaceLiveMessage from "../../../Models/DatabaseModels/WorkspaceLiveMessage";
import WorkspaceNotificationLog from "../../../Models/DatabaseModels/WorkspaceNotificationLog";
import WorkspacePublicNoteApprovalMessage from "../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import { MigrationName1754910440587 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1754910440587-MigrationName";
import { AddWorkspaceLiveMessage1801500000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1801500000000-AddWorkspaceLiveMessage";
import { WidenWorkspaceMessageIdColumns1809182970000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182970000-WidenWorkspaceMessageIdColumns";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import WorkspaceLiveMessageService from "../../../Server/Services/WorkspaceLiveMessageService";
import WorkspaceNotificationLogService from "../../../Server/Services/WorkspaceNotificationLogService";
import { WORKSPACE_STORED_ID_MAX_LENGTH } from "../../../Server/Utils/Workspace/WorkspaceStoredValue";
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
 * WHERE A SLACK OR MICROSOFT TEAMS MESSAGE IS, STORED WHOLE (issue #9284).
 *
 * WorkspaceLiveMessage (the messages OneUptime keeps up to date in place)
 * and WorkspaceNotificationLog (Notification Logs) kept the ids of a
 * message's place - channel or chat, team, message, thread - in ShortText
 * columns, 100 characters, and the code cut each id to fit. A Microsoft
 * Teams personal chat's id is 130 characters and more, so it was kept as an
 * id of no chat: a page asked for in a personal chat was never followed
 * there ("This chat is not connected to OneUptime"), and the logs' ids
 * matched nothing that reads them back.
 *
 * The columns are LongText now, 500 characters, as
 * WorkspacePublicNoteApprovalMessage keeps the same ids, and the length
 * check, the model and the database agree on it. TypeORM generates the
 * change as DROP COLUMN + ADD, which drops every kept message and every
 * log's channel; WidenWorkspaceMessageIdColumns1809182970000 is ALTER
 * COLUMN ... TYPE instead: the same schema, every value kept. Pure metadata,
 * the real length check and recorded SQL here - no Postgres.
 */

// A personal chat's id as the Bot Framework gives it: 131 characters.
const PERSONAL_CHAT_ID: string =
  "a:1BfcDQQeKz2oG1CPSFyD5ZD1flTYm2IoCY23DqeeVgq6wyCCFf9P43FAqqDYNLI-pephf2ltim4CcrRj_ti04mQkhsHSJDCY_Wsu7XBF4qh8qmhl2nGt9cSEa704tfJxn";

// The width the columns had, which a personal chat's id overflowed.
const OLD_WIDTH: number = ColumnLength.ShortText;

interface IdColumn {
  label: string;
  table: string;
  target: unknown;
  propertyName: string;
  required: boolean;
  newInstance: () => DatabaseBaseModel;
  // Runs the length check DatabaseService runs on every create and update.
  check: (value: string) => void;
  createdBy: () => MigrationInterface;
  createdByName: string;
  createdAs: string;
}

function liveMessageColumn(
  propertyName: "channelId" | "channelName" | "teamId" | "messageId",
  required: boolean,
): IdColumn {
  return {
    label: `WorkspaceLiveMessage.${propertyName}`,
    table: "WorkspaceLiveMessage",
    target: WorkspaceLiveMessage,
    propertyName: propertyName,
    required: required,
    newInstance: (): DatabaseBaseModel => {
      return new WorkspaceLiveMessage();
    },
    check: (value: string): void => {
      const row: WorkspaceLiveMessage = new WorkspaceLiveMessage();
      row[propertyName] = value;
      WorkspaceLiveMessageService["checkMaxLengthOfFields"](row);
    },
    createdBy: (): MigrationInterface => {
      return new AddWorkspaceLiveMessage1801500000000();
    },
    createdByName: "AddWorkspaceLiveMessage1801500000000",
    createdAs: `"${propertyName}" character varying(100)${required ? " NOT NULL" : ""},`,
  };
}

function notificationLogColumn(
  propertyName: "channelId" | "channelName" | "threadId",
): IdColumn {
  return {
    label: `WorkspaceNotificationLog.${propertyName}`,
    table: "WorkspaceNotificationLog",
    target: WorkspaceNotificationLog,
    propertyName: propertyName,
    required: false,
    newInstance: (): DatabaseBaseModel => {
      return new WorkspaceNotificationLog();
    },
    check: (value: string): void => {
      const row: WorkspaceNotificationLog = new WorkspaceNotificationLog();
      row[propertyName] = value;
      WorkspaceNotificationLogService["checkMaxLengthOfFields"](row);
    },
    createdBy: (): MigrationInterface => {
      return new MigrationName1754910440587();
    },
    createdByName: "MigrationName1754910440587",
    createdAs: `"${propertyName}" character varying(100),`,
  };
}

const WIDENED_COLUMNS: Array<IdColumn> = [
  liveMessageColumn("channelId", true),
  liveMessageColumn("channelName", false),
  liveMessageColumn("teamId", false),
  liveMessageColumn("messageId", true),
  notificationLogColumn("channelId"),
  notificationLogColumn("channelName"),
  notificationLogColumn("threadId"),
];

function columnArgs(column: IdColumn): ColumnMetadataArgs {
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

function tableColumn(column: IdColumn): TableColumnMetadata {
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

describe("The columns that keep where a workspace message is", () => {
  test.each(WIDENED_COLUMNS)(
    "$label is LongText: varchar(500), required as it was",
    (column: IdColumn) => {
      const metadata: TableColumnMetadata = tableColumn(column);
      const args: ColumnMetadataArgs = columnArgs(column);

      expect(metadata.type).toBe(TableColumnType.LongText);
      expect(Boolean(metadata.required)).toBe(column.required);
      expect(args.options.type).toBe(ColumnType.LongText);
      expect(args.options.length).toBe(ColumnLength.LongText);
      expect(args.options.nullable).toBe(!column.required);
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label: the check, the model and the database agree on its width, the width WorkspaceStoredValue keeps ids to",
    (column: IdColumn) => {
      const checkedWidth: number | undefined = getMaxLengthFromTableColumnType(
        tableColumn(column).type,
      );

      expect(checkedWidth).toBe(500);
      expect(columnArgs(column).options.length).toBe(checkedWidth);
      expect(checkedWidth).toBe(WORKSPACE_STORED_ID_MAX_LENGTH);
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label is no longer the 100-character ShortText it was",
    (column: IdColumn) => {
      expect(tableColumn(column).type).not.toBe(TableColumnType.ShortText);
      expect(columnArgs(column).options.length).toBeGreaterThan(OLD_WIDTH);
    },
  );

  test("WorkspaceLiveMessage.channelId is still indexed: kept messages are found by their channel", () => {
    const indexed: boolean = getMetadataArgsStorage().indices.some(
      (index: { target: unknown; columns?: unknown }) => {
        return (
          index.target === WorkspaceLiveMessage &&
          Array.isArray(index.columns) &&
          index.columns.length === 1 &&
          index.columns[0] === "channelId"
        );
      },
    );

    expect(indexed).toBe(true);
  });

  test("they are as wide as WorkspacePublicNoteApprovalMessage's, which keeps the same ids of a personal chat", () => {
    const approval: WorkspacePublicNoteApprovalMessage =
      new WorkspacePublicNoteApprovalMessage();

    for (const propertyName of ["channelId", "messageId"]) {
      expect(approval.getTableColumnMetadata(propertyName).type).toBe(
        TableColumnType.LongText,
      );
    }
  });
});

describe("A Microsoft Teams personal chat's id in those columns", () => {
  test("the fixture is a personal chat id as long as the one in the report", () => {
    expect(PERSONAL_CHAT_ID).toHaveLength(131);
    expect(PERSONAL_CHAT_ID.length).toBeGreaterThan(OLD_WIDTH);
  });

  test.each(WIDENED_COLUMNS)(
    "REGRESSION #9284: $label takes a 131-character personal chat id, whole",
    (column: IdColumn) => {
      expect(() => {
        return column.check(PERSONAL_CHAT_ID);
      }).not.toThrow();
    },
  );

  test.each(WIDENED_COLUMNS)(
    "$label takes an id as long as its column, and refuses a longer one rather than keep a part of it",
    (column: IdColumn) => {
      expect(() => {
        return column.check("i".repeat(ColumnLength.LongText));
      }).not.toThrow();
      expect(() => {
        return column.check("i".repeat(ColumnLength.LongText + 1));
      }).toThrow(
        `${column.propertyName} length cannot be more than ${ColumnLength.LongText} characters`,
      );
    },
  );
});

describe("WidenWorkspaceMessageIdColumns1809182970000", () => {
  const migration: WidenWorkspaceMessageIdColumns1809182970000 =
    new WidenWorkspaceMessageIdColumns1809182970000();

  test("up() widens each column in place, keeping every value", async () => {
    const { runner, sql } = recordQueries();
    await migration.up(runner);

    expect(sql()).toEqual([
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelId" TYPE character varying(500)`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelName" TYPE character varying(500)`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "teamId" TYPE character varying(500)`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "messageId" TYPE character varying(500)`,
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelId" TYPE character varying(500)`,
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelName" TYPE character varying(500)`,
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "threadId" TYPE character varying(500)`,
    ]);

    for (const statement of sql()) {
      expect(statement).not.toContain("DROP");
      expect(statement).not.toContain("ADD");
      expect(statement).not.toContain("DEFAULT");
      expect(statement).not.toContain("UPDATE");
      expect(statement).not.toContain("DELETE");
      expect(statement).not.toContain("INDEX");
    }
  });

  test.each(WIDENED_COLUMNS)(
    "up() widens $label, and only once",
    async (column: IdColumn) => {
      const { runner, sql } = recordQueries();
      await migration.up(runner);

      expect(
        sql().filter((statement: string): boolean => {
          return (
            statement ===
            `ALTER TABLE "${column.table}" ALTER COLUMN "${column.propertyName}" TYPE character varying(500)`
          );
        }),
      ).toHaveLength(1);
    },
  );

  test("down() never cuts an id: a log's is emptied, a kept message whose place is longer is forgotten; a name is cut; then each narrows", async () => {
    const { runner, sql } = recordQueries();
    await migration.down(runner);

    expect(sql()).toEqual([
      `UPDATE "WorkspaceNotificationLog" SET "threadId" = NULL WHERE LENGTH("threadId") > 100`,
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "threadId" TYPE character varying(100)`,
      `UPDATE "WorkspaceNotificationLog" SET "channelName" = LEFT("channelName", 100) WHERE LENGTH("channelName") > 100`,
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelName" TYPE character varying(100)`,
      `UPDATE "WorkspaceNotificationLog" SET "channelId" = NULL WHERE LENGTH("channelId") > 100`,
      `ALTER TABLE "WorkspaceNotificationLog" ALTER COLUMN "channelId" TYPE character varying(100)`,
      `DELETE FROM "WorkspaceLiveMessage" WHERE LENGTH("channelId") > 100 OR LENGTH("teamId") > 100 OR LENGTH("messageId") > 100`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "messageId" TYPE character varying(100)`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "teamId" TYPE character varying(100)`,
      `UPDATE "WorkspaceLiveMessage" SET "channelName" = LEFT("channelName", 100) WHERE LENGTH("channelName") > 100`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelName" TYPE character varying(100)`,
      `ALTER TABLE "WorkspaceLiveMessage" ALTER COLUMN "channelId" TYPE character varying(100)`,
    ]);

    // Only names are ever cut.
    for (const statement of sql()) {
      if (statement.includes("LEFT(")) {
        expect(statement).toContain(`"channelName" = LEFT("channelName", 100)`);
      }

      expect(statement).not.toContain("SUBSTRING");
      expect(statement).not.toContain("DROP");
    }
  });

  test.each(WIDENED_COLUMNS)(
    "down() gives $label back exactly the width its table was created with",
    async (column: IdColumn) => {
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

  test.each(WIDENED_COLUMNS)(
    "is registered once, after the migration that created $label",
    (column: IdColumn) => {
      const names: Array<string> = SchemaMigrations.map(
        (migrationClass: new () => MigrationInterface): string => {
          return migrationClass.name;
        },
      );
      const widened: number = names.indexOf(
        "WidenWorkspaceMessageIdColumns1809182970000",
      );
      const created: number = names.indexOf(column.createdByName);

      expect(
        names.filter((name: string): boolean => {
          return name === "WidenWorkspaceMessageIdColumns1809182970000";
        }),
      ).toHaveLength(1);
      expect(created).toBeGreaterThan(-1);
      expect(widened).toBeGreaterThan(created);
    },
  );

  test("its name carries its timestamp, as its file's does", () => {
    expect(migration.name).toBe("WidenWorkspaceMessageIdColumns1809182970000");
  });
});
