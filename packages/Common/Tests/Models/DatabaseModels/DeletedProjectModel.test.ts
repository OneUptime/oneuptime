import Models from "../../../Models/DatabaseModels/Index";
import DeletedProject from "../../../Models/DatabaseModels/DeletedProject";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Migrations from "../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * DeletedProject is the only record that a deleted project ever existed -
 * projects are hard deleted, so anything this table does not carry is gone for
 * good. These tests pin the two properties that cannot be observed from the
 * service tests: that the snapshot is genuinely standalone (no relation to the
 * row it describes), and that customer data in it is not reachable by ordinary
 * project users.
 */

describe("DeletedProject model", () => {
  const model: DeletedProject = new DeletedProject();

  it("is registered in the model index, so its table is created", () => {
    const isRegistered: boolean = Models.some(
      (registered: { new (): BaseModel }) => {
        return registered === DeletedProject;
      },
    );

    expect(isRegistered).toBe(true);
  });

  it("is a global table, not scoped to the project it describes", () => {
    /*
     * A tenant column here would be a foreign key to Project, and Postgres
     * would cascade the audit row away with the very project it records.
     */
    expect(model.getTenantColumn()).toBeFalsy();
    expect(model.isTenantModel()).toBe(false);
  });

  it("is served from its own CRUD endpoint", () => {
    expect(model.getCrudApiPath()?.toString()).toBe("/deleted-project");
  });

  it("uses its own table", () => {
    expect(model.tableName).toBe("DeletedProject");
  });

  it("records the project identity, so a deleted project can still be identified", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "projectId",
      "projectName",
      "projectSlug",
      "projectCreatedAt",
      "projectDeletedAt",
    ]) {
      expect(columns).toContain(column);
    }
  });

  it("records who deleted the project and how to reach them", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "projectDeletedByUserId",
      "projectDeletedByUserName",
      "projectDeletedByUserEmail",
      "projectCreatedByUserId",
      "projectCreatedByUserName",
      "projectCreatedByUserEmail",
      "companyName",
      "companyPhoneNumber",
      "companySize",
      "jobRole",
    ]) {
      expect(columns).toContain(column);
    }
  });

  it("records why the customer said they were leaving", () => {
    expect(model.getTableColumns().columns).toContain("deletionReason");
  });

  it("stores the reason as unbounded text, so a long answer is not truncated", () => {
    expect(model.getTableColumnMetadata("deletionReason").type).toBe(
      TableColumnType.VeryLongText,
    );
  });

  it("records what the customer was worth and how much they had built", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "planName",
      "paymentProviderPlanId",
      "paymentProviderCustomerId",
      "paymentProviderSubscriptionId",
      "paymentProviderSubscriptionStatus",
      "paymentProviderSubscriptionSeats",
      "trialEndsAt",
      "activeMonitorCount",
      "wasProjectBlocked",
    ]) {
      expect(columns).toContain(column);
    }
  });

  /*
   * The project row is deleted before this one is written. A relation would
   * have nothing to point at - which is why projectId is a plain uuid and the
   * name, slug and dates are copied rather than joined.
   */
  it("keeps the project id as a plain column, not a relation to Project", () => {
    expect(model.getTableColumnMetadata("projectId").type).toBe(
      TableColumnType.ObjectID,
    );
    expect(model.getTableColumnMetadata("projectId").modelType).toBeUndefined();
    expect(model.getTableColumns().columns).not.toContain("project");
  });

  it("requires the project id, name and deletion time on every row", () => {
    expect(model.getTableColumnMetadata("projectId").required).toBe(true);
    expect(model.getTableColumnMetadata("projectName").required).toBe(true);
    expect(model.getTableColumnMetadata("projectDeletedAt").required).toBe(
      true,
    );
  });

  /*
   * The user relations exist only so staff can jump to the account. They must
   * be nullable and non-cascading: a user who later deletes their account must
   * not take the record of the project deletion with them, which is also why
   * the name and email are copied onto the row.
   */
  it("relates to the users involved without depending on them surviving", () => {
    expect(model.getTableColumnMetadata("projectDeletedByUser").modelType).toBe(
      User,
    );
    expect(model.getTableColumnMetadata("projectCreatedByUser").modelType).toBe(
      User,
    );
    expect(model.getTableColumnMetadata("projectDeletedByUser").required).toBe(
      undefined,
    );
  });

  /*
   * Every column carries names, emails and phone numbers of customers who have
   * already left. Empty permission arrays are how this repo says "master admin
   * only" - no user permission can intersect an empty list, and root and
   * master admin bypass the check entirely.
   */
  it("cannot be read, written or deleted by any project user", () => {
    expect(model.getCreatePermissions()).toEqual([]);
    expect(model.getReadPermissions()).toEqual([]);
    expect(model.getUpdatePermissions()).toEqual([]);
    expect(model.getDeletePermissions()).toEqual([]);
  });

  it("locks down every single column, not just the table", () => {
    const accessControl: Record<string, ColumnAccessControl> =
      model.getColumnAccessControlForAllColumns();

    /*
     * _id and the timestamps come from the base model and carry no column
     * access control of their own. Every column this model declares must have
     * one - a column added without the decorator is the case worth catching,
     * so its absence fails rather than being skipped.
     */
    const baseModelColumns: Array<string> = [
      "_id",
      "createdAt",
      "updatedAt",
      "deletedAt",
      "version",
    ];

    const declaredColumns: Array<string> = model
      .getTableColumns()
      .columns.filter((columnName: string) => {
        return !baseModelColumns.includes(columnName);
      });

    expect(declaredColumns.length).toBeGreaterThan(20);

    for (const columnName of declaredColumns) {
      const columnAccess: ColumnAccessControl | undefined =
        accessControl[columnName];

      expect(columnAccess).toBeDefined();
      expect(columnAccess?.create).toEqual([]);
      expect(columnAccess?.read).toEqual([]);
      expect(columnAccess?.update).toEqual([]);
    }
  });

  it("does not hand a project owner any permission over it", () => {
    expect(model.getReadPermissions()).not.toContain(Permission.ProjectOwner);
    expect(model.getReadPermissions()).not.toContain(Permission.ProjectAdmin);
  });
});

describe("Project model - deletion snapshot source columns", () => {
  const project: Project = new Project();

  /*
   * ProjectService.onBeforeDelete reads these off the project before it is
   * deleted and DeletedProjectService copies them onto the audit row. If one
   * is renamed the snapshot silently loses a field, so pin them here.
   */
  it("still has every column the deletion snapshot copies", () => {
    const columns: Array<string> = project.getTableColumns().columns;

    for (const column of [
      "name",
      "slug",
      "planName",
      "paymentProviderPlanId",
      "paymentProviderCustomerId",
      "paymentProviderSubscriptionId",
      "paymentProviderSubscriptionStatus",
      "paymentProviderSubscriptionSeats",
      "trialEndsAt",
      "currentActiveMonitorsCount",
      "isBlocked",
      "createdByUserId",
    ]) {
      expect(columns).toContain(column);
    }
  });
});

describe("DeletedProject migration", () => {
  /*
   * A migration that is not in this array never runs, so the table simply does
   * not exist in a fresh database and every project delete logs an error.
   */
  it("is registered, so the table is actually created", () => {
    const registeredNames: Array<string> = (
      Migrations as unknown as Array<{ name: string }>
    ).map((migration: { name: string }) => {
      return migration.name;
    });

    expect(registeredNames).toContain("AddDeletedProjectTable1786461136170");
  });
});
