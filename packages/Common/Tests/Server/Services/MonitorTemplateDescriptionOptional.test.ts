import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import DatabaseService from "../../../Server/Services/DatabaseService";
import { MakeMonitorTemplateDescriptionOptional1807730000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1807730000000-MakeMonitorTemplateDescriptionOptional";
import Migrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import PartialEntity from "../../../Types/Database/PartialEntity";
import { describe, expect, it } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * A monitor template can be created without a description - from the
 * Dashboard, the API, Terraform or a workflow - and keeps one it is given.
 * The column was NOT NULL and required, so every create had to invent one.
 */

const templateService: DatabaseService<MonitorTemplate> =
  new DatabaseService<MonitorTemplate>(MonitorTemplate);

function newTemplate(data: {
  templateName?: string | undefined;
  templateDescription?: string | undefined;
}): MonitorTemplate {
  const template: MonitorTemplate = new MonitorTemplate();
  template.projectId = new ObjectID("3f5a6b7c-8d9e-4f01-8a2b-3c4d5e6f7a8b");
  template.monitorType = MonitorType.Website;
  // Computed from the name on create, before this check runs.
  template.slug = "production-api-health";

  if (data.templateName !== undefined) {
    template.templateName = data.templateName;
  }

  if (data.templateDescription !== undefined) {
    template.templateDescription = data.templateDescription;
  }

  return template;
}

describe("a monitor template without a description", () => {
  it("passes the create's required-fields check", () => {
    expect(() => {
      return templateService["checkRequiredFields"](
        newTemplate({ templateName: "Production API Health" }),
      );
    }).not.toThrow();
  });

  it("still needs its name", () => {
    expect(() => {
      return templateService["checkRequiredFields"](newTemplate({}));
    }).toThrow("templateName is required");
  });

  it("keeps a description it is given, and none it is not", async () => {
    const withOne: MonitorTemplate | PartialEntity<MonitorTemplate> =
      await templateService["sanitizeCreateOrUpdate"](
        {
          templateName: "Production API Health",
          templateDescription: "Checks the public API every minute.",
        },
        { isRoot: true },
        false,
      );

    expect(withOne.templateDescription).toBe(
      "Checks the public API every minute.",
    );

    const withNone: MonitorTemplate | PartialEntity<MonitorTemplate> =
      await templateService["sanitizeCreateOrUpdate"](
        { templateName: "Production API Health" },
        { isRoot: true },
        false,
      );

    expect(withNone.templateDescription).toBeUndefined();
  });

  it("is stored in a column that may hold none", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find((args: ColumnMetadataArgs) => {
        return (
          args.target === MonitorTemplate &&
          args.propertyName === "templateDescription"
        );
      });

    expect(column?.options.nullable).toBe(true);
  });
});

describe("the migration that lets a template go without one", () => {
  it("drops NOT NULL from the column, and puts it back on the way down", async () => {
    const statements: Array<string> = [];
    const queryRunner: { query: (sql: string) => Promise<void> } = {
      query: async (sql: string): Promise<void> => {
        statements.push(sql);
      },
    };
    const migration: MakeMonitorTemplateDescriptionOptional1807730000000 =
      new MakeMonitorTemplateDescriptionOptional1807730000000();

    await migration.up(queryRunner as never);
    await migration.down(queryRunner as never);

    expect(statements).toEqual([
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "templateDescription" DROP NOT NULL`,
      `ALTER TABLE "MonitorTemplate" ALTER COLUMN "templateDescription" SET NOT NULL`,
    ]);
    expect(migration.name).toBe(
      "MakeMonitorTemplateDescriptionOptional1807730000000",
    );
  });

  it("is registered, so it runs", () => {
    expect(Migrations).toContain(
      MakeMonitorTemplateDescriptionOptional1807730000000,
    );
  });
});
