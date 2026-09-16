/**
 * Project.dataResidency column contract.
 *
 * A free-text label a master admin sets on a SaaS project ("EU (Frankfurt)")
 * and the customer then sees in their Project Settings. The properties worth
 * pinning are the ones that fail quietly:
 *
 *   - NULLABLE, WITH NO DEFAULT. NULL is "not set", which is what every
 *     existing project is and what keeps the row hidden from customers. A
 *     default of "" or NOT NULL would force a value onto every project.
 *   - SHORT TEXT, 100 CHARACTERS, in the entity, in the TypeORM column and in
 *     the migration alike - if they disagree, the schema drift job fails, or
 *     the database refuses a label the API accepted.
 *   - NOT IN THE PUBLIC API DOCS. It is a SaaS-only, staff-set field; the API
 *     reference for self-hosted users should not advertise it.
 *   - NOT PLAN-GATED. Every project, on any plan, shows the residency staff
 *     set on it.
 */

import Project from "../../Models/DatabaseModels/Project";
import { TableColumnMetadata } from "../../Types/Database/TableColumn";
import TableColumnType from "../../Types/Database/TableColumnType";
import ColumnType from "../../Types/Database/ColumnType";
import ColumnLength from "../../Types/Database/ColumnLength";
import Columns from "../../Types/Database/Columns";
import { AddDataResidencyToProject1793300000000 } from "../../Server/Infrastructure/Postgres/SchemaMigrations/1793300000000-AddDataResidencyToProject";
import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

const COLUMN: string = "dataResidency";

function metadata(): TableColumnMetadata {
  return new Project().getTableColumnMetadata(COLUMN);
}

function typeOrmColumn(): ColumnMetadataArgs | undefined {
  return getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
    return args.target === Project && args.propertyName === COLUMN;
  });
}

async function upStatements(): Promise<Array<string>> {
  const statements: Array<string> = [];

  const runner: QueryRunner = {
    query: (sql: string): Promise<undefined> => {
      statements.push(sql);
      return Promise.resolve(undefined);
    },
  } as unknown as QueryRunner;

  await new AddDataResidencyToProject1793300000000().up(runner);

  return statements;
}

describe("Project.dataResidency", () => {
  describe("the entity", () => {
    test("exists as a ShortText column", () => {
      expect(metadata()).toBeDefined();
      expect(metadata().type).toBe(TableColumnType.ShortText);
    });

    test("is a table column the model reports", () => {
      expect(new Project().getTableColumns().columns).toContain(COLUMN);
    });

    test("is titled the way both dashboards label it", () => {
      expect(metadata().title).toBe("Data Residency");
    });

    test("has a description", () => {
      expect(metadata().description).toBeTruthy();
    });

    test("is not required, so creating a project without one still works", () => {
      expect(metadata().required).toBeFalsy();

      const requiredColumns: Columns = new Project().getRequiredColumns();

      expect(requiredColumns.columns).not.toContain(COLUMN);
      // ...and the check is not vacuous: a project's name genuinely is required.
      expect(requiredColumns.columns).toContain("name");
    });

    test("is not a default-value column", () => {
      expect(new Project().isDefaultValueColumn(COLUMN)).toBe(false);
      expect(metadata().defaultValue).toBeUndefined();
    });

    test("is not computed, so a master admin's write is not dropped", () => {
      expect(metadata().computed).toBeFalsy();
    });

    test("is hidden from the API documentation", () => {
      expect(metadata().hideColumnInDocumentation).toBe(true);
    });

    test("is not an encrypted or hashed column", () => {
      expect(metadata().encrypted).toBeFalsy();
      expect(new Project().isHashedStringColumn(COLUMN)).toBe(false);
    });

    test("is not gated on the project's plan", () => {
      expect(new Project().getColumnBillingAccessControl(COLUMN)).toBeFalsy();
    });

    test("starts undefined on a fresh model, like every other column", () => {
      expect(new Project().dataResidency).toBeUndefined();
    });
  });

  describe("the TypeORM column", () => {
    test("is a varchar", () => {
      expect(typeOrmColumn()).toBeDefined();
      expect(typeOrmColumn()?.options.type).toBe(ColumnType.ShortText);
    });

    test("is 100 characters wide", () => {
      expect(typeOrmColumn()?.options.length).toBe(ColumnLength.ShortText);
      expect(ColumnLength.ShortText).toBe(100);
    });

    test("is nullable, because NULL is 'not set'", () => {
      expect(typeOrmColumn()?.options.nullable).toBe(true);
    });

    test("has no database default", () => {
      expect(typeOrmColumn()?.options.default).toBeUndefined();
    });

    test("is not unique - many projects share a region", () => {
      expect(typeOrmColumn()?.options.unique).toBeFalsy();
    });
  });

  describe("the migration agrees with the entity", () => {
    test("adds a varchar(100) column of the same name to the Project table", async () => {
      const [statement] = await upStatements();

      expect(statement).toBe(
        `ALTER TABLE "Project" ADD "dataResidency" character varying(100)`,
      );
    });

    test("adds it nullable and without a default, so existing projects stay unset", async () => {
      const [statement] = await upStatements();

      expect(statement).not.toContain("NOT NULL");
      expect(statement).not.toContain("DEFAULT");
    });
  });
});
