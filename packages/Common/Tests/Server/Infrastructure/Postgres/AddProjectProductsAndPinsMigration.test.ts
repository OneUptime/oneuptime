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
import AllModelTypes from "../../../../Models/DatabaseModels/Index";
import Project from "../../../../Models/DatabaseModels/Project";
import ProjectUserPreference from "../../../../Models/DatabaseModels/ProjectUserPreference";
import User from "../../../../Models/DatabaseModels/User";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { AddProjectProductsAndPins1809122700000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809122700000-AddProjectProductsAndPins";
import {
  AUDIT_LOG_EXEMPT_TABLES,
  AuditLogExemptionKind,
} from "../../../../Types/AuditLog/AuditLogCoverage";

/*
 * PRODUCTS THAT FIT THE PROJECT, AND A PERSON'S PINS (#6814): the migration
 * that adds Project.productSettings and the ProjectUserPreference table.
 *
 * The statements are EXECUTED against a fake QueryRunner rather than read as
 * text, so up() and down() are told apart. What matters beyond the SQL:
 *
 *  - every project that exists keeps showing every product: the column is
 *    nullable with no default, so adding it rewrites no row and null reads
 *    as nothing hidden;
 *  - one row per person and project: a unique index over the two, neither
 *    of which may be empty, so two tabs pinning at once write one row;
 *  - a row goes with its project and its person: ON DELETE CASCADE;
 *  - the table is new and empty, so its index and foreign keys are built in
 *    the same migration, at once (SchemaMigrationsOnlineDdl allows that);
 *  - only the person's own requests read or write a row: no CRUD permission,
 *    and no audit log entry (a person's own preference);
 *  - the migration is registered, named consistently and ordered after every
 *    migration registered before it, or it silently never runs.
 *
 * (Generated with TypeORM's migration:generate against a database every
 * registered migration had run on; the schema drift check found nothing left
 * to generate once it had run.)
 */

const MIGRATION_TIMESTAMP: string = "1809122700000";
const MIGRATION_BASE_NAME: string = "AddProjectProductsAndPins";
const MIGRATION_FILE_NAME: string = `${MIGRATION_TIMESTAMP}-${MIGRATION_BASE_NAME}.ts`;
const MIGRATION_CLASS_NAME: string = `${MIGRATION_BASE_NAME}${MIGRATION_TIMESTAMP}`;
const TABLE: string = "ProjectUserPreference";

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

  await new AddProjectProductsAndPins1809122700000()[step](runner);

  return statements;
}

function relationOf(propertyName: string): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === ProjectUserPreference &&
        relation.propertyName === propertyName
      );
    },
  );
}

describe("executing it", () => {
  test("up() creates the table, its unique index of one row per person and project, the project's column, and a foreign key for each", async () => {
    const statements: Array<string> = await statementsOf("up");

    expect(statements[0]).toMatch(new RegExp(`^CREATE TABLE "${TABLE}" \\(`));
    for (const column of [
      `"projectId" uuid NOT NULL`,
      `"userId" uuid NOT NULL`,
      `"pinnedProducts" jsonb,`,
      `"version" integer NOT NULL`,
    ]) {
      expect(statements[0]).toContain(column);
    }

    const unique: Array<string> = statements.filter(
      (statement: string): boolean => {
        return statement.startsWith("CREATE UNIQUE INDEX");
      },
    );
    expect(unique).toHaveLength(1);
    expect(unique[0]).toContain(`ON "${TABLE}" ("projectId", "userId")`);

    // The project's choice: nullable, no default, so no row is rewritten.
    expect(statements).toContain(
      `ALTER TABLE "Project" ADD "productSettings" jsonb`,
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
    expect(foreignKeys).toEqual(["projectId->Project", "userId->User"]);

    // Beyond the new table, it only adds the project's column.
    for (const statement of statements) {
      expect(statement).toMatch(
        new RegExp(
          `(TABLE|ON) "${TABLE}"|^ALTER TABLE "Project" ADD "productSettings" jsonb$`,
        ),
      );
    }
  });

  test("down() takes it all back, the table last", async () => {
    const statements: Array<string> = await statementsOf("down");

    expect(statements[statements.length - 1]).toBe(`DROP TABLE "${TABLE}"`);
    expect(statements).toContain(
      `ALTER TABLE "Project" DROP COLUMN "productSettings"`,
    );
    expect(
      statements.filter((statement: string): boolean => {
        return statement.includes("DROP CONSTRAINT");
      }),
    ).toHaveLength(2);
    expect(
      statements.filter((statement: string): boolean => {
        return statement.startsWith("DROP INDEX");
      }),
    ).toHaveLength(1);
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
      new AddProjectProductsAndPins1809122700000();

    expect(typeof migration.up).toBe("function");
    expect(typeof migration.down).toBe("function");
    expect(
      Object.getOwnPropertyNames(
        AddProjectProductsAndPins1809122700000.prototype,
      ).sort(),
    ).toEqual(["constructor", "down", "up"]);
  });
});

describe("the table it makes", () => {
  test("its unique index is the model's: one row per project and person", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return (
            index.target === ProjectUserPreference && Boolean(index.unique)
          );
        },
      );

    expect(indexes).toHaveLength(1);
    expect(indexes[0]!.columns).toEqual(["projectId", "userId"]);
  });

  test.each([
    ["project", Project],
    ["user", User],
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

  test("nobody may create, read, change or delete a row through the API, and it is scoped to its project", () => {
    const model: ProjectUserPreference = new ProjectUserPreference();

    expect(model.createRecordPermissions).toEqual([]);
    expect(model.readRecordPermissions).toEqual([]);
    expect(model.updateRecordPermissions).toEqual([]);
    expect(model.deleteRecordPermissions).toEqual([]);
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

  test("the project's column is read by its members, and written by no one through the API", () => {
    const access: {
      create?: Array<unknown>;
      read?: Array<unknown>;
      update?: Array<unknown>;
    } = new Project().getColumnAccessControlFor("productSettings") || {};

    expect(access.create || []).toEqual([]);
    expect(access.update || []).toEqual([]);
    expect((access.read || []).length).toBeGreaterThan(0);
  });

  test("the audit log leaves it out: a person's own preference", () => {
    expect(AUDIT_LOG_EXEMPT_TABLES[TABLE]).toBe(
      AuditLogExemptionKind.PersonalPreference,
    );
    expect(new ProjectUserPreference().enableAuditLogOn).toBeUndefined();
  });

  test("the model is registered", () => {
    expect(AllModelTypes).toContain(ProjectUserPreference);
  });
});

describe("registering it", () => {
  test("the file, the class and its name agree", () => {
    expect(
      fs.existsSync(path.join(MIGRATION_DIRECTORY, MIGRATION_FILE_NAME)),
    ).toBe(true);
    expect(new AddProjectProductsAndPins1809122700000().name).toBe(
      MIGRATION_CLASS_NAME,
    );
  });

  test("it is registered after every migration registered before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: unknown): string => {
        return (migration as { name: string }).name;
      },
    );
    const position: number = names.indexOf(MIGRATION_CLASS_NAME);

    expect(position).toBeGreaterThan(-1);

    for (const earlier of names.slice(0, position)) {
      const timestamp: string | undefined = earlier.match(CLASS_TIMESTAMP)?.[1];

      if (timestamp) {
        expect([
          earlier,
          Number(timestamp) < Number(MIGRATION_TIMESTAMP),
        ]).toEqual([earlier, true]);
      }
    }
  });
});
