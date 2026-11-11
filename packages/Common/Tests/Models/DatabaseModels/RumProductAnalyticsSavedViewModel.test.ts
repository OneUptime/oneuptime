import { describe, expect, test } from "@jest/globals";
import * as fs from "fs";
import * as path from "path";
import { getMetadataArgsStorage } from "typeorm";
import { IndexMetadataArgs } from "typeorm/metadata-args/IndexMetadataArgs";
import { RelationMetadataArgs } from "typeorm/metadata-args/RelationMetadataArgs";
import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import RumProductAnalyticsSavedView from "../../../Models/DatabaseModels/RumProductAnalyticsSavedView";
import RumSession from "../../../Models/AnalyticsModels/RumSession";
import { AddRumProductAnalyticsSavedViews1809110100000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1809110100000-AddRumProductAnalyticsSavedViews";
import SchemaMigrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import ReadPermission, {
  LabelledReferences,
} from "../../../Server/Types/Database/Permissions/ReadPermission";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../../Types/Dictionary";
import Permission from "../../../Types/Permission";

/*
 * Saved funnels and retention tables (issue #6630): the Postgres side.
 * What a saved one keeps is what its page reads - an application's end
 * users, counted - so who may see and keep them is who may read the
 * funnels and retention tables themselves: the product analytics routes'
 * session list permissions (TelemetryAPI's SESSION_REPLAY_LIST_PERMISSIONS),
 * on the plan the session reads need. A role limited to labels reaches the
 * saved views of the applications carrying them. Each decision here is one
 * a later change could reverse without a build or a manual test noticing.
 */

const model: RumProductAnalyticsSavedView = new RumProductAnalyticsSavedView();

const TELEMETRY_API: string = path.resolve(
  __dirname,
  "../../../Server/API/TelemetryAPI.ts",
);

/* The permissions the product analytics reads are guarded by, as the route file declares them. */
function readSessionListPermissions(): Array<string> {
  const source: string = fs.readFileSync(TELEMETRY_API, "utf8");
  const start: number = source.indexOf(
    "const SESSION_REPLAY_LIST_PERMISSIONS: Array<Permission> = [",
  );

  expect(start).toBeGreaterThanOrEqual(0);

  const end: number = source.indexOf("];", start);
  const list: string = source.slice(start, end);

  return Array.from(list.matchAll(/Permission\.([A-Za-z]+)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

function sorted(permissions: Array<Permission>): Array<string> {
  return permissions
    .map((permission: Permission): string => {
      return permission.toString();
    })
    .sort();
}

function findRelation(propertyName: string): RelationMetadataArgs | undefined {
  return getMetadataArgsStorage().relations.find(
    (relation: RelationMetadataArgs): boolean => {
      return (
        relation.target === RumProductAnalyticsSavedView &&
        relation.propertyName === propertyName
      );
    },
  );
}

describe("RumProductAnalyticsSavedView", () => {
  test("is a table of its own, registered, with its own CRUD route, in its project", () => {
    expect(model.tableName).toBe("RumProductAnalyticsSavedView");
    expect(model.singularName).toBe("Saved Product Analytics View");
    expect(model.pluralName).toBe("Saved Product Analytics Views");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/rum-product-analytics-saved-view",
    );
    expect(model.getTenantColumn()).toBe("projectId");

    const names: Array<string> = Models.map(
      (modelType: { new (): BaseModel }): string => {
        return new modelType().tableName || "";
      },
    );

    expect(names).toContain("RumProductAnalyticsSavedView");
  });

  test("is read and kept by whoever may read an application's funnels, and nobody else", () => {
    const sessionList: Array<string> = readSessionListPermissions();

    expect(sessionList.length).toBeGreaterThan(0);

    for (const permissions of [
      model.readRecordPermissions,
      model.createRecordPermissions,
      model.updateRecordPermissions,
      model.deleteRecordPermissions,
    ]) {
      expect(sorted(permissions)).toEqual(
        [...sessionList].sort((left: string, right: string): number => {
          return left < right ? -1 : left > right ? 1 : 0;
        }),
      );

      // A viewer, a member and an application's own readers do not read its people.
      expect(permissions).not.toContain(Permission.Viewer);
      expect(permissions).not.toContain(Permission.ProjectMember);
      expect(permissions).not.toContain(Permission.ReadRumApplication);
      expect(permissions).not.toContain(Permission.Public);
    }

    expect(model.readRecordPermissions).toContain(
      Permission.ReadRumSessionReplay,
    );
  });

  test("is on the plan the session reads need, for every operation", () => {
    const sessionPlan: PlanType | null = new RumSession().getReadBillingPlan();

    expect(sessionPlan).toBe(PlanType.Growth);
    expect(model.getReadBillingPlan()).toBe(sessionPlan);
    expect(model.getCreateBillingPlan()).toBe(sessionPlan);
    expect(model.getUpdateBillingPlan()).toBe(sessionPlan);
    expect(model.getDeleteBillingPlan()).toBe(sessionPlan);
  });

  test("keeps whose it is and what it is: only its name and its definition change", () => {
    const columns: Dictionary<ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    for (const fixed of ["projectId", "rumApplicationId", "viewType"]) {
      expect([fixed, columns[fixed]?.update || []]).toEqual([fixed, []]);
      expect(sorted(columns[fixed]?.create || [])).toEqual(
        sorted(model.createRecordPermissions),
      );
    }

    for (const changeable of ["name", "definition"]) {
      expect(sorted(columns[changeable]?.update || [])).toEqual(
        sorted(model.updateRecordPermissions),
      );
    }

    // Who saved or deleted it is OneUptime's to write, never a request's.
    for (const attribution of [
      "createdByUserId",
      "createdByUser",
      "deletedByUserId",
      "deletedByUser",
    ]) {
      expect([attribution, columns[attribution]?.create || []]).toEqual([
        attribution,
        [],
      ]);
      expect([attribution, columns[attribution]?.update || []]).toEqual([
        attribution,
        [],
      ]);
    }

    // Everything it keeps is read under the same permissions.
    for (const [column, access] of Object.entries(columns)) {
      expect([column, sorted(access.read || [])]).toEqual([
        column,
        sorted(model.readRecordPermissions),
      ]);
    }
  });

  test("goes with its project and its application, and outlives who saved it", () => {
    expect(findRelation("project")?.options.onDelete).toBe("CASCADE");
    expect(findRelation("rumApplication")?.options.onDelete).toBe("CASCADE");
    expect(findRelation("createdByUser")?.options.onDelete).toBe("SET NULL");
    expect(findRelation("deletedByUser")?.options.onDelete).toBe("SET NULL");
  });

  test("is listed by application and kind, as the pages and the widget settings read it", () => {
    const indexes: Array<IndexMetadataArgs> =
      getMetadataArgsStorage().indices.filter(
        (index: IndexMetadataArgs): boolean => {
          return index.target === RumProductAnalyticsSavedView;
        },
      );

    expect(
      indexes.some((index: IndexMetadataArgs): boolean => {
        return (
          JSON.stringify(index.columns) ===
          JSON.stringify(["projectId", "rumApplicationId", "viewType"])
        );
      }),
    ).toBe(true);
  });

  test("a role limited to labels reaches the saved views of the applications carrying them", () => {
    const references: LabelledReferences = ReadPermission.getLabelledReferences(
      RumProductAnalyticsSavedView,
    );
    const application:
      | { column: string; modelTypes: Array<{ new (): BaseModel }> }
      | undefined = references.keys.find((key: { column: string }): boolean => {
      return key.column === "rumApplicationId";
    });

    expect(application?.modelTypes).toContain(RumApplication);
    /*
     * The application carries labels: a grant limited to some keeps the
     * rows naming an application with one of them
     * (ReadPermission.getGrantedLabelsCondition, which reads the join
     * tables off a connected database).
     */
    expect(new RumApplication().getAccessControlColumn()).toBe("labels");
    // No parent read through: the rows are narrowed by the key alone.
    expect(model.canAccessIfCanReadOn).toBeFalsy();
  });
});

describe("the migration that adds it", () => {
  test("is registered with the schema migrations, and names itself", () => {
    const migration: AddRumProductAnalyticsSavedViews1809110100000 =
      new AddRumProductAnalyticsSavedViews1809110100000();

    expect(migration.name).toBe(
      "AddRumProductAnalyticsSavedViews1809110100000",
    );
    expect(SchemaMigrations).toContain(
      AddRumProductAnalyticsSavedViews1809110100000,
    );
  });

  test("creates every column the model keeps, the definition as jsonb, and the list's index", async () => {
    const statements: Array<string> = [];
    const runner: { query: (sql: string) => Promise<void> } = {
      query: async (sql: string): Promise<void> => {
        statements.push(sql);
      },
    };

    await new AddRumProductAnalyticsSavedViews1809110100000().up(
      runner as never,
    );

    const create: string = statements[0] || "";

    expect(create).toContain('CREATE TABLE "RumProductAnalyticsSavedView"');

    for (const column of [
      '"projectId" uuid NOT NULL',
      '"rumApplicationId" uuid NOT NULL',
      '"name" character varying(100) NOT NULL',
      '"viewType" character varying(100) NOT NULL',
      '"definition" jsonb NOT NULL',
      '"createdByUserId" uuid',
      '"deletedByUserId" uuid',
    ]) {
      expect(create).toContain(column);
    }

    expect(statements).toContain(
      'CREATE INDEX "IDX_f57c27b1eb741c6780d9a5a896" ON "RumProductAnalyticsSavedView" ("projectId", "rumApplicationId", "viewType") ',
    );
    expect(
      statements.some((sql: string): boolean => {
        return sql.includes(
          'FOREIGN KEY ("rumApplicationId") REFERENCES "RumApplication"("_id") ON DELETE CASCADE',
        );
      }),
    ).toBe(true);

    const down: Array<string> = [];

    await new AddRumProductAnalyticsSavedViews1809110100000().down({
      query: async (sql: string): Promise<void> => {
        down.push(sql);
      },
    } as never);

    expect(down[down.length - 1]).toBe(
      'DROP TABLE "RumProductAnalyticsSavedView"',
    );
  });
});
