import Models from "../../../Models/DatabaseModels/Index";
import MarketplaceSubscription from "../../../Models/DatabaseModels/MarketplaceSubscription";
import MarketplaceUsageReport from "../../../Models/DatabaseModels/MarketplaceUsageReport";
import Project from "../../../Models/DatabaseModels/Project";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Migrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { PROJECT_BILLING_READ_COLUMNS } from "../../../Utils/Project/ProjectBilling";
import { describe, expect, it } from "@jest/globals";

/*
 * The two tables behind selling OneUptime Cloud on cloud marketplaces. What
 * they hold - which marketplace account bought what, the claim token's hash,
 * every usage report sent for billing - is for OneUptime staff only: a
 * project member sees the marketplace that bills their project through
 * Project.billingMarketplace, and nothing else.
 */

const BASE_MODEL_COLUMNS: Array<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

const expectMasterAdminOnly: (
  model: BaseModel,
  minimumColumns: number,
) => void = (model: BaseModel, minimumColumns: number): void => {
  expect(model.getCreatePermissions()).toEqual([]);
  expect(model.getReadPermissions()).toEqual([]);
  expect(model.getUpdatePermissions()).toEqual([]);
  expect(model.getDeletePermissions()).toEqual([]);

  const accessControl: Record<string, ColumnAccessControl> =
    model.getColumnAccessControlForAllColumns();

  const declaredColumns: Array<string> = model
    .getTableColumns()
    .columns.filter((columnName: string) => {
      return !BASE_MODEL_COLUMNS.includes(columnName);
    });

  expect(declaredColumns.length).toBeGreaterThanOrEqual(minimumColumns);

  for (const columnName of declaredColumns) {
    const columnAccess: ColumnAccessControl | undefined =
      accessControl[columnName];

    expect([columnName, columnAccess]).toEqual([
      columnName,
      { create: [], read: [], update: [] },
    ]);
  }
};

describe("MarketplaceSubscription model", () => {
  const model: MarketplaceSubscription = new MarketplaceSubscription();

  it("is registered in the model index, so its table is created", () => {
    expect(
      Models.some((registered: { new (): BaseModel }) => {
        return registered === MarketplaceSubscription;
      }),
    ).toBe(true);
  });

  it("uses its own table and CRUD endpoint", () => {
    expect(model.tableName).toBe("MarketplaceSubscription");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/marketplace-subscription",
    );
  });

  it("is a global table: a purchase exists before any project does", () => {
    expect(model.getTenantColumn()).toBeFalsy();
    expect(model.isTenantModel()).toBe(false);
  });

  it("can be read and written by master admins only, column by column", () => {
    expectMasterAdminOnly(model, 20);
  });

  it("keeps the project as a plain ID, so deleting the project keeps the record", () => {
    expect(model.getTableColumnMetadata("projectId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata("projectId").modelType).toBeUndefined();
    expect(model.getTableColumns().columns).not.toContain("project");
    expect(model.getTableColumnMetadata("projectId").required).toBeFalsy();
  });

  it("stores the claim token's hash, never the token", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    expect(columns).toContain("claimTokenHash");
    expect(columns).toContain("claimTokenExpiresAt");
    expect(columns).not.toContain("claimToken");
  });

  it("requires what identifies a purchase and where it stands", () => {
    for (const column of ["marketplace", "externalSubscriptionId", "status"]) {
      expect([column, model.getTableColumnMetadata(column).required]).toEqual([
        column,
        true,
      ]);
    }
  });

  it("has room for an AWS license ARN and a Google entitlement name", () => {
    // ARNs and resource names run past the 100 characters of a short text column.
    expect(model.getTableColumnMetadata("externalSubscriptionId").type).toBe(
      TableColumnType.LongText,
    );
    expect(model.getTableColumnMetadata("externalEntitlementId").type).toBe(
      TableColumnType.LongText,
    );
  });
});

describe("MarketplaceUsageReport model", () => {
  const model: MarketplaceUsageReport = new MarketplaceUsageReport();

  it("is registered in the model index, so its table is created", () => {
    expect(
      Models.some((registered: { new (): BaseModel }) => {
        return registered === MarketplaceUsageReport;
      }),
    ).toBe(true);
  });

  it("uses its own table and CRUD endpoint", () => {
    expect(model.tableName).toBe("MarketplaceUsageReport");
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/marketplace-usage-report",
    );
  });

  it("is a global table, read by master admins only", () => {
    expect(model.isTenantModel()).toBe(false);
    expectMasterAdminOnly(model, 10);
  });

  it("requires the period, quantity and status of every report", () => {
    for (const column of [
      "marketplaceSubscriptionId",
      "projectId",
      "marketplace",
      "periodStart",
      "periodEnd",
      "quantity",
      "status",
    ]) {
      expect([column, model.getTableColumnMetadata(column).required]).toEqual([
        column,
        true,
      ]);
    }
  });
});

describe("Project.billingMarketplace", () => {
  const project: Project = new Project();

  it("is read by whoever reads the project's plan, and written by nobody", () => {
    const accessControl: Record<string, ColumnAccessControl> =
      project.getColumnAccessControlForAllColumns();

    expect(accessControl["billingMarketplace"]?.create).toEqual([]);
    expect(accessControl["billingMarketplace"]?.update).toEqual([]);
    expect(accessControl["billingMarketplace"]?.read).toEqual(
      accessControl["paymentProviderPlanId"]?.read,
    );
  });

  it("is one of the billing columns the billing roles may read", () => {
    expect(PROJECT_BILLING_READ_COLUMNS).toContain("billingMarketplace");
  });

  it("is optional: a project billed by card has none", () => {
    expect(
      project.getTableColumnMetadata("billingMarketplace").required,
    ).toBeFalsy();
  });
});

describe("Marketplace migration", () => {
  it("is registered, so the tables are actually created", () => {
    const registeredNames: Array<string> = (
      Migrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }) => {
      return migration.name;
    });

    expect(registeredNames).toContain(
      "AddMarketplaceSubscriptions1802800000000",
    );
  });
});
