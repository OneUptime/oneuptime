import Models from "../../../Models/DatabaseModels/Index";
import StatusPageMonitorRule from "../../../Models/DatabaseModels/StatusPageMonitorRule";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * Schema-level guarantees behind status page monitor rules. Each of these is
 * something the engine's own tests cannot see: they pass just as happily
 * against a model that is unreachable over the API or writable by the wrong
 * person.
 */

describe("StatusPageMonitorRule model", () => {
  const model: StatusPageMonitorRule = new StatusPageMonitorRule();

  it("is registered in the model index, so its table is created and its API is mounted", () => {
    const isRegistered: boolean = Models.some(
      (registered: { new (): BaseModel }) => {
        return registered === StatusPageMonitorRule;
      },
    );

    expect(isRegistered).toBe(true);
  });

  it("is scoped to a project, so one tenant's rules cannot read another's", () => {
    expect(model.getTenantColumn()).toBe("projectId");
  });

  it("is served from its own CRUD endpoint", () => {
    expect(model.getCrudApiPath()?.toString()).toBe(
      "/status-page-monitor-rule",
    );
  });

  it("declares every field the rule form writes", () => {
    const columns: Array<string> = model.getTableColumns().columns;

    for (const column of [
      "statusPageId",
      "statusPageGroupId",
      "isEnabled",
      "monitorLabels",
      "monitorNamePattern",
      "monitorDescriptionPattern",
      "showCurrentStatus",
      "showUptimePercent",
      "uptimePercentPrecision",
      "showStatusHistoryChart",
    ]) {
      expect(columns).toContain(column);
    }
  });

  /*
   * The rule decides what shows up on a public page, so it is gated behind
   * the status page permissions rather than the generic project ones.
   */
  it("requires a status page permission to create", () => {
    const create: Array<Permission> = model.getCreatePermissions();

    expect(create).toContain(Permission.CreateStatusPageMonitorRule);
    expect(create).toContain(Permission.StatusPageAdmin);
  });

  it("requires a status page permission to delete", () => {
    expect(model.getDeletePermissions()).toContain(
      Permission.DeleteStatusPageMonitorRule,
    );
  });

  it("does not let a plain viewer edit a rule", () => {
    expect(model.getUpdatePermissions()).not.toContain(Permission.Viewer);
  });
});

describe("StatusPageResource.statusPageMonitorRuleId - the ownership marker", () => {
  const accessControl: Record<string, ColumnAccessControl> =
    new StatusPageResource().getColumnAccessControlForAllColumns();

  it("exists on the resource, so a rule can tell its own work apart from a human's", () => {
    expect(new StatusPageResource().getTableColumns().columns).toContain(
      "statusPageMonitorRuleId",
    );
  });

  /*
   * This is the load-bearing one. If the column were writable over the API,
   * anyone could stamp a rule onto a hand-made resource and that resource
   * would then be deleted the next time the rule stopped matching - silently
   * losing configuration the rule never created. The engine writes it as
   * root, which bypasses column ACLs, so an empty list costs nothing.
   */
  it("cannot be set through the API on create", () => {
    expect(accessControl["statusPageMonitorRuleId"]?.create).toEqual([]);
  });

  it("cannot be reassigned through the API on update", () => {
    expect(accessControl["statusPageMonitorRuleId"]?.update).toEqual([]);
  });

  it("is readable, so the dashboard can tell which resources a rule owns", () => {
    expect(accessControl["statusPageMonitorRuleId"]?.read).toContain(
      Permission.ReadStatusPageResource,
    );
  });
});

describe("Status page monitor rule permissions", () => {
  it("are described in the permission catalogue, so they can be granted to a role", () => {
    for (const permission of [
      Permission.CreateStatusPageMonitorRule,
      Permission.ReadStatusPageMonitorRule,
      Permission.EditStatusPageMonitorRule,
      Permission.DeleteStatusPageMonitorRule,
    ]) {
      expect(Permission[permission as keyof typeof Permission]).toBeDefined();
    }
  });
});
