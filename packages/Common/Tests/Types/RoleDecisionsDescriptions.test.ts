import Project from "../../Models/DatabaseModels/Project";
import Workflow from "../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "../../Models/DatabaseModels/WorkflowVariable";
import { ColumnAccessControl } from "../../Types/BaseDatabase/AccessControl";
import Dictionary from "../../Types/Dictionary";
import { ALWAYS_SELECTABLE_COLUMNS } from "../../Types/HeldPermissions";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../Types/Permission";
import { WORKFLOW_RUN_PERMISSIONS } from "../../Types/Workflow/WorkflowRunPermissions";
import { PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL } from "../../Utils/Project/NotificationChannels";
import { PROJECT_BILLING_CONTACT_COLUMNS } from "../../Utils/Project/ProjectBilling";
import { describe, expect, test } from "@jest/globals";

/*
 * What the permission picker says each role does is what the models let it
 * do. Billing Admin's description used to promise "Full control over
 * project billing, invoices, and payment methods" while no billing column
 * named it; Workflow Member's promised create, edit and delete while the
 * workflow's update list left it out. Each description is held here to the
 * lists it describes.
 */

function describeRole(permission: Permission): string {
  const props: PermissionProps | undefined =
    PermissionHelper.getAllPermissionProps().find(
      (candidate: PermissionProps): boolean => {
        return candidate.permission === permission;
      },
    );

  expect(props).toBeDefined();

  return props!.description;
}

describe("Billing Admin", () => {
  const description: string = describeRole(Permission.BillingAdmin);

  /*
   * Since Billing Member and Billing Viewer were given what their
   * descriptions promise (Utils/Project/ProjectBilling), the three billing
   * roles nest like every other role family: Billing Admin does what Billing
   * Member does, and turns the paid channels on and off as well.
   */
  test("says it does what Billing Member does and turns the four paid channels on and off, and what it does not do", () => {
    expect(description).toBe(
      "Does what Billing Member does, and turns the project's SMS, phone call, WhatsApp and Telegram notifications on and off. Changing the plan, payment methods or balances, and paying invoices, takes Project Owner or Manage Billing.",
    );
  });

  /*
   * Leaving out the columns every record has (_id, createdAt, ...): they
   * take the table's lists, no write sets them, and the server never checks
   * them.
   */
  test("which is exactly the Project columns whose update lists name it", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new Project().getColumnAccessControlForAllColumns();

    const named: Array<string> = Object.keys(columns)
      .filter((column: string): boolean => {
        return (
          !ALWAYS_SELECTABLE_COLUMNS.includes(column) &&
          (columns[column]?.update || []).includes(Permission.BillingAdmin)
        );
      })
      .sort();

    expect(named).toEqual(
      [
        ...Object.values(PROJECT_NOTIFICATION_CHANNEL_COLUMN_BY_CHANNEL),
        ...PROJECT_BILLING_CONTACT_COLUMNS,
      ].sort(),
    );
  });

  test("and the plan and the balances name Project Owner and Manage Billing, not it", () => {
    const columns: Dictionary<ColumnAccessControl> =
      new Project().getColumnAccessControlForAllColumns();

    for (const column of [
      "paymentProviderPlanId",
      "enableAutoRechargeSmsOrCallBalance",
      "autoRechargeSmsOrCallByBalanceInUSD",
      "enableAutoRechargeAiBalance",
      "autoAiRechargeByBalanceInUSD",
    ]) {
      const update: Array<Permission> = columns[column]?.update || [];

      expect([column, update.includes(Permission.BillingAdmin)]).toEqual([
        column,
        false,
      ]);
      expect(update).toContain(Permission.ProjectOwner);
      expect(update).toContain(Permission.ManageProjectBilling);
    }
  });
});

describe("Workflow Admin", () => {
  const description: string = describeRole(Permission.WorkflowAdmin);

  test("says it builds workflows", () => {
    expect(description).toBe(
      "Builds workflows: creates, edits, runs and deletes them, manages workflow variables, and reads every run.",
    );
  });

  test("which the workflow's and the variables' lists all let it do", () => {
    for (const model of [new Workflow(), new WorkflowVariable()]) {
      expect(model.getCreatePermissions()).toContain(Permission.WorkflowAdmin);
      expect(model.getUpdatePermissions()).toContain(Permission.WorkflowAdmin);
      expect(model.getDeletePermissions()).toContain(Permission.WorkflowAdmin);
      expect(model.getReadPermissions()).toContain(Permission.WorkflowAdmin);
    }

    expect(WORKFLOW_RUN_PERMISSIONS).toContain(Permission.WorkflowAdmin);
    expect(new WorkflowLog().getReadPermissions()).toContain(
      Permission.WorkflowAdmin,
    );
  });
});

describe("Workflow Member", () => {
  const description: string = describeRole(Permission.WorkflowMember);

  test("says it opens and runs workflows, and changes none", () => {
    expect(description).toBe(
      "Opens workflows and their runs, and runs workflows by hand. Cannot create, change or delete them.",
    );
  });

  test("which the lists hold it to", () => {
    expect(new Workflow().getReadPermissions()).toContain(
      Permission.WorkflowMember,
    );
    expect(new WorkflowLog().getReadPermissions()).toContain(
      Permission.WorkflowMember,
    );
    expect(WORKFLOW_RUN_PERMISSIONS).toContain(Permission.WorkflowMember);

    for (const model of [new Workflow(), new WorkflowVariable()]) {
      expect(model.getCreatePermissions()).not.toContain(
        Permission.WorkflowMember,
      );
      expect(model.getUpdatePermissions()).not.toContain(
        Permission.WorkflowMember,
      );
      expect(model.getDeletePermissions()).not.toContain(
        Permission.WorkflowMember,
      );
    }
  });

  test("and no column of a workflow or a variable lets it create or change anything", () => {
    for (const model of [new Workflow(), new WorkflowVariable()]) {
      const columns: Dictionary<ColumnAccessControl> =
        model.getColumnAccessControlForAllColumns();

      for (const column of Object.keys(columns)) {
        expect([
          model.singularName,
          column,
          (columns[column]?.create || []).includes(Permission.WorkflowMember),
          (columns[column]?.update || []).includes(Permission.WorkflowMember),
        ]).toEqual([model.singularName, column, false, false]);
      }
    }
  });
});
