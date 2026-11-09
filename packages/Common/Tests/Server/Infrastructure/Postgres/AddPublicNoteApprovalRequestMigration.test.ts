import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MigrationInterface,
  QueryRunner,
  getMetadataArgsStorage,
} from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import PublicNoteApprovalRequest, {
  PublicNoteApprovalRequestKind,
} from "../../../../Models/DatabaseModels/PublicNoteApprovalRequest";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import User from "../../../../Models/DatabaseModels/User";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddPublicNoteApprovalRequest1809063180000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809063180000-AddPublicNoteApprovalRequest";
import AllServices from "../../../../Server/Services/Index";
import PublicNoteApprovalRequestService from "../../../../Server/Services/PublicNoteApprovalRequestService";
import {
  AUDIT_LOG_EXEMPT_TABLES,
  AuditLogExemptionKind,
} from "../../../../Types/AuditLog/AuditLogCoverage";

/*
 * THE RECORD OF WHOM A PUBLIC NOTE'S APPROVAL ASKED (#6353):
 * PublicNoteApprovalRequest, and the migration that makes it.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. A new, empty table: its own
 * indexes and foreign keys are built in the same migration, at once
 * (SchemaMigrationsOnlineDdl allows that). What matters beyond the SQL:
 *
 *  - one request per note, round, step, kind, message and person: a unique
 *    index over columns none of which may be empty, so the database writes
 *    each request once, and two asks at once ask a person once;
 *  - a row goes with its note - of any of the three kinds - with its project
 *    and with the person it was about: every foreign key is ON DELETE CASCADE;
 *  - only the server reads or writes a row: no permission, no CRUD API, no
 *    audit log entry (OneUptime's working state);
 *  - the migration is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 *
 * (Generated with TypeORM's migration:generate against a database every
 * registered migration had run on; the schema drift check finds nothing left
 * to generate once it has run.)
 */

const MIGRATION_TIMESTAMP: string = "1809063180000";
const MIGRATION_BASE_NAME: string = "AddPublicNoteApprovalRequest";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const TABLE: string = "PublicNoteApprovalRequest";

const UNIQUE_COLUMNS: Array<string> = [
  "noteId",
  "submittedAt",
  "stepId",
  "kind",
  "isFinal",
  "isAskedAgain",
  "userId",
];

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

  await new AddPublicNoteApprovalRequest1809063180000()[step](runner);

  return statements;
}

function relationOf(propertyName: string): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === PublicNoteApprovalRequest &&
        relation.propertyName === propertyName
      );
    },
  );
}

describe("executing it", () => {
  test("up() creates the table, its unique index of requests, an index for every key it is read by, and a foreign key for each record it names", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements[0]).toMatch(new RegExp(`^CREATE TABLE "${TABLE}" \\(`));

    // Every column the model declares, as the model declares it.
    for (const column of [
      `"projectId" uuid NOT NULL`,
      `"userId" uuid NOT NULL`,
      `"noteId" uuid NOT NULL`,
      `"incidentPublicNoteId" uuid,`,
      `"incidentEpisodePublicNoteId" uuid,`,
      `"scheduledMaintenancePublicNoteId" uuid,`,
      `"submittedAt" character varying(100) NOT NULL`,
      `"stepId" character varying(100) NOT NULL`,
      `"kind" character varying(100) NOT NULL`,
      `"isFinal" boolean NOT NULL DEFAULT false`,
      `"isAskedAgain" boolean NOT NULL DEFAULT false`,
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
      ].sort(),
    );

    const unique: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.startsWith("CREATE UNIQUE INDEX");
      },
    );

    expect(unique).toHaveLength(1);
    expect(unique[0]).toContain(
      `ON "${TABLE}" (${UNIQUE_COLUMNS.map((column: string) => {
        return `"${column}"`;
      }).join(", ")})`,
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
      expect(statement).toMatch(new RegExp(`(TABLE|ON) "${TABLE}"`));
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
      new AddPublicNoteApprovalRequest1809063180000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddPublicNoteApprovalRequest1809063180000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the table it makes", () => {
  test("its unique index is the model's: every request is written once", () => {
    const indexes: Array<IndexMetadataArgs> = getMetadataArgsStorage().indices.filter(
      (index: IndexMetadataArgs): boolean => {
        return index.target === PublicNoteApprovalRequest && Boolean(index.unique);
      },
    );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.columns).toEqual(UNIQUE_COLUMNS);
  });

  test("no column of the unique index may be empty: an empty one would let two requests be the same", async () => {
    const create: string = (await statementsOf("up"))[0]!;

    for (const column of UNIQUE_COLUMNS) {
      expect([column, new RegExp(`"${column}" [a-z ()0-9]+ NOT NULL`).test(create)]).toEqual([
        column,
        true,
      ]);
    }
  });

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

  test("a request is asked by notifications or in chat, and nothing else", () => {
    expect(Object.values(PublicNoteApprovalRequestKind).sort()).toEqual([
      "Chat",
      "Notifications",
    ]);
    expect(
      new PublicNoteApprovalRequest().getTableColumnMetadata("kind")
        ?.allowedValues,
    ).toEqual(Object.values(PublicNoteApprovalRequestKind));
  });

  test("only the server reads or writes a row: no permission, no CRUD API, scoped to its project", () => {
    const model: PublicNoteApprovalRequest = new PublicNoteApprovalRequest();

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

      expect([
        column,
        access.create || [],
        access.read || [],
        access.update || [],
      ]).toEqual([column, [], [], []]);
    }
  });

  test("is OneUptime's working state: no audit log entry for each person asked", () => {
    expect(AUDIT_LOG_EXEMPT_TABLES[TABLE]).toBe(
      AuditLogExemptionKind.WorkingState,
    );
  });

  test("its model and its service are registered", () => {
    expect(AllModelTypes).toContain(PublicNoteApprovalRequest);
    expect(Object.values(AllServices)).toContain(
      PublicNoteApprovalRequestService,
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
        return migration === AddPublicNoteApprovalRequest1809063180000;
      }),
    ).toHaveLength(1);
  });

  test("its declared name, its class name and its timestamp agree", () => {
    expect(new AddPublicNoteApprovalRequest1809063180000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(AddPublicNoteApprovalRequest1809063180000.name).toBe(
      MIGRATION_CLASS_NAME,
    );
    expect(
      AddPublicNoteApprovalRequest1809063180000.name.match(CLASS_TIMESTAMP)?.[1],
    ).toBe(MIGRATION_TIMESTAMP);
  });

  test("exactly one file on disk carries its timestamp, and it is this one", () => {
    expect(
      fs.readdirSync(MIGRATION_DIRECTORY).filter((file: string): boolean => {
        return file.startsWith(`${MIGRATION_TIMESTAMP}-`);
      }),
    ).toEqual([MIGRATION_FILE_NAME]);
  });

  test("its timestamp sorts after every migration registered before it", () => {
    const position: number = SchemaMigrations.indexOf(
      AddPublicNoteApprovalRequest1809063180000,
    );

    expect(position).toBeGreaterThan(-1);

    const earlier: Array<number> = SchemaMigrations.slice(0, position)
      .map((migration: unknown): number => {
        return Number(
          (migration as { name: string }).name.match(CLASS_TIMESTAMP)?.[1] || 0,
        );
      })
      .filter((timestamp: number): boolean => {
        return timestamp > 0;
      });

    expect(earlier.length).toBeGreaterThan(100);
    expect(Number(MIGRATION_TIMESTAMP)).toBeGreaterThan(Math.max(...earlier));
  });
});
