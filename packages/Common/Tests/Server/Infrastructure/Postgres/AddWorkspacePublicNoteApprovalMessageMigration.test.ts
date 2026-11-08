import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import User from "../../../../Models/DatabaseModels/User";
import WorkspacePublicNoteApprovalMessage from "../../../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddWorkspacePublicNoteApprovalMessage1809063170000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809063170000-AddWorkspacePublicNoteApprovalMessage";
import AllServices from "../../../../Server/Services/Index";
import WorkspacePublicNoteApprovalMessageService from "../../../../Server/Services/WorkspacePublicNoteApprovalMessageService";
import {
  AUDIT_LOG_EXEMPT_TABLES,
  AuditLogExemptionKind,
} from "../../../../Types/AuditLog/AuditLogCoverage";
import ColumnLength from "../../../../Types/Database/ColumnLength";

/*
 * THE TABLE OF APPROVAL MESSAGES KEPT UNTIL A PUBLIC NOTE IS DECIDED (#6317):
 * WorkspacePublicNoteApprovalMessage, and the migration that makes it.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. A new, empty table: its own
 * indexes and foreign keys are built in the same migration, at once
 * (SchemaMigrationsOnlineDdl allows that). What matters beyond the SQL:
 *
 *  - a row goes with its note - of any of the three kinds - with its project
 *    and with the person it was sent to: every foreign key is ON DELETE
 *    CASCADE, so no reference outlives its note;
 *  - the columns that hold what a chat names a message by take a Microsoft
 *    Teams personal chat's id, which is longer than 100 characters;
 *  - only the server reads or writes a row: no permission, no CRUD API, no
 *    audit log entry (OneUptime's working state);
 *  - the migration is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 *
 * (Generated with TypeORM's migration:generate against a database every
 * registered migration had run on; the schema drift check finds nothing left
 * to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1809063170000";
const MIGRATION_BASE_NAME: string = "AddWorkspacePublicNoteApprovalMessage";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const TABLE: string = "WorkspacePublicNoteApprovalMessage";

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const CLASS_TIMESTAMP: RegExp = /(\d{13})$/;

async function statementsOf(step: "up" | "down"): Promise<Array<string>> {
  const statements: Array<string> = [];
  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(String(sql));
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddWorkspacePublicNoteApprovalMessage1809063170000()[step](runner);

  return statements;
}

function relationOf(propertyName: string): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === WorkspacePublicNoteApprovalMessage &&
        relation.propertyName === propertyName
      );
    },
  );
}

function columnOf(propertyName: string): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find(
    (column: ColumnMetadataArgs): boolean => {
      return (
        column.target === WorkspacePublicNoteApprovalMessage &&
        column.propertyName === propertyName
      );
    },
  );
}

describe("executing it", () => {
  test("up() creates the table, an index for every key it is read by, and a foreign key for each record it names", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements[0]).toMatch(
      new RegExp(`^CREATE TABLE "${TABLE}" \\(`),
    );

    // Every column the model declares, as the model declares it.
    for (const column of [
      `"projectId" uuid NOT NULL`,
      `"userId" uuid NOT NULL`,
      `"incidentPublicNoteId" uuid,`,
      `"incidentEpisodePublicNoteId" uuid,`,
      `"scheduledMaintenancePublicNoteId" uuid,`,
      `"recordId" uuid NOT NULL`,
      `"workspaceType" character varying(100) NOT NULL`,
      `"workspaceProjectId" character varying(500) NOT NULL`,
      `"channelId" character varying(500) NOT NULL`,
      `"messageId" character varying(500) NOT NULL`,
      `"serviceUrl" character varying(500),`,
      `"submittedAt" character varying(100) NOT NULL`,
      `"stepId" character varying(100) NOT NULL`,
      `"isFinal" boolean NOT NULL DEFAULT false`,
      `"isEdit" boolean NOT NULL DEFAULT false`,
      `"textDigest" character varying(100) NOT NULL`,
    ]) {
      expect(statements[0]).toContain(column);
    }

    const indexed: Array<string> = statements
      .filter((statement: string): boolean => {
        return statement.startsWith("CREATE INDEX");
      })
      .map((statement: string): string => {
        return statement.match(/\("([A-Za-z]+)"\)/)?.[1] || "";
      })
      .sort();

    expect(indexed).toEqual(
      [
        "projectId",
        "userId",
        "incidentPublicNoteId",
        "incidentEpisodePublicNoteId",
        "scheduledMaintenancePublicNoteId",
        "recordId",
      ].sort(),
    );

    const foreignKeys: Array<string> = statements
      .filter((statement: string): boolean => {
        return statement.includes("FOREIGN KEY");
      })
      .map((statement: string): string => {
        const match: RegExpMatchArray | null = statement.match(
          /FOREIGN KEY \("([A-Za-z]+)"\) REFERENCES "([A-Za-z]+)"\("_id"\) ON DELETE CASCADE ON UPDATE NO ACTION$/,
        );

        return match ? `${match[1]}->${match[2]}` : statement;
      })
      .sort();

    expect(foreignKeys).toEqual(
      [
        "projectId->Project",
        "userId->User",
        "incidentPublicNoteId->IncidentPublicNote",
        "incidentEpisodePublicNoteId->IncidentEpisodePublicNote",
        "scheduledMaintenancePublicNoteId->ScheduledMaintenancePublicNote",
      ].sort(),
    );

    // On this table alone: it touches no table that exists already.
    for (const statement of statements) {
      expect(statement).toMatch(
        new RegExp(`(TABLE|ON) "${TABLE}"`),
      );
    }
  });

  test("down() takes it all back, the table last", async () => {
    const statements: Array<string> = await statementsOf("down");

    expect(statements[statements.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
    expect(
      statements.filter((statement: string): boolean => {
        return statement.includes("DROP CONSTRAINT");
      }),
    ).toHaveLength(5);
    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith("DROP INDEX");
      }),
    ).toHaveLength(6);
  });

  test("every statement is a complete, single statement", async () => {
    for (const statement of [
      ...(await statementsOf("up")),
      ...(await statementsOf("down")),
    ]) {
      expect(statement).not.toContain(";");
      expect(statement).not.toContain("\n");
    }
  });

  test("is a MigrationInterface whose two steps are still named up and down", () => {
    const migration: MigrationInterface =
      new AddWorkspacePublicNoteApprovalMessage1809063170000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddWorkspacePublicNoteApprovalMessage1809063170000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the table it makes", () => {
  test.each([
    ["project", Project],
    ["user", User],
    ["incidentPublicNote", IncidentPublicNote],
    ["incidentEpisodePublicNote", IncidentEpisodePublicNote],
    ["scheduledMaintenancePublicNote", ScheduledMaintenancePublicNote],
  ] as Array<[string, unknown]>)(
    "a row goes with its %s: ON DELETE CASCADE",
    (propertyName: string, modelType: unknown) => {
      const relation: RelationMetadataArgs | undefined =
        relationOf(propertyName);

      expect(relation?.relationType).toBe("many-to-one");
      expect(
        (relation?.type as () => unknown | undefined)?.call(undefined),
      ).toBe(modelType);
      expect(relation?.options.onDelete).toBe("CASCADE");
    },
  );

  test("what a chat names a message by fits: a Microsoft Teams personal chat's id is longer than 100 characters", () => {
    for (const propertyName of [
      "workspaceProjectId",
      "channelId",
      "messageId",
      "serviceUrl",
    ]) {
      expect([propertyName, columnOf(propertyName)?.options.length]).toEqual([
        propertyName,
        ColumnLength.LongText,
      ]);
    }

    expect(ColumnLength.LongText).toBeGreaterThanOrEqual(500);
  });

  test("only the server reads or writes a row: no permission, no CRUD API, scoped to its project", () => {
    const model: WorkspacePublicNoteApprovalMessage =
      new WorkspacePublicNoteApprovalMessage();

    expect(model.createRecordPermissions).toEqual([]);
    expect(model.readRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
    expect(model.getCrudApiPath()).toBeFalsy();
    expect(model.getTenantColumn()).toBe("projectId");

    for (const column of model.getTableColumns().columns) {
      const access: {
        create?: Array<unknown>;
        read?: Array<unknown>;
        update?: Array<unknown>;
      } = model.getColumnAccessControlFor(column) || {};

      expect([column, access.create || [], access.read || [], access.update || []]).toEqual([
        column,
        [],
        [],
        [],
      ]);
    }
  });

  test("is OneUptime's working state: no audit log entry for each copy kept and dropped", () => {
    expect(AUDIT_LOG_EXEMPT_TABLES[TABLE]).toBe(
      AuditLogExemptionKind.WorkingState,
    );
  });

  test("its model and its service are registered", () => {
    expect(AllModelTypes).toContain(WorkspacePublicNoteApprovalMessage);
    expect(Object.values(AllServices)).toContain(
      WorkspacePublicNoteApprovalMessageService,
    );
  });
});

describe("the migration runs", () => {
  test("it is imported and listed in Index.ts", () => {
    const index: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import { ${MIGRATION_CLASS_NAME} } from "./${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}";`,
    );
    expect(index).toContain(`  ${MIGRATION_CLASS_NAME},\n`);
  });

  test("it is in the exported migration list, exactly once", () => {
    expect(
      SchemaMigrations.filter((migration: unknown): boolean => {
        return migration === AddWorkspacePublicNoteApprovalMessage1809063170000;
      }),
    ).toHaveLength(1);
  });

  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddWorkspacePublicNoteApprovalMessage1809063170000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddWorkspacePublicNoteApprovalMessage1809063170000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddWorkspacePublicNoteApprovalMessage1809063170000.name.match(
        CLASS_TIMESTAMP,
      )?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs
        .readdirSync(MIGRATION_DIRECTORY)
        .filter((file: string): boolean => {
          return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
        }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddWorkspacePublicNoteApprovalMessage1809063170000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlier: Array<number> = SchemaMigrations.slice(0, position)
      .map((migration: unknown): number => {
        return Number(
          (migration as { name: string }).name.match(CLASS_TIMESTAMP)?.[1] ||
            0,
        );
      })
      .filter((timestamp: number): boolean => {
        return timestamp > 0;
      });

    expect(earlier.length).toBeGreaterThan(100);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(Math.max(...earlier));
  });
});
