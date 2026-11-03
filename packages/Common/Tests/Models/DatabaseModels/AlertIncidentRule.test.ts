import Alert from "../../../Models/DatabaseModels/Alert";
import AlertIncidentRule from "../../../Models/DatabaseModels/AlertIncidentRule";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import RuleBaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/RuleBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import Permission from "../../../Types/Permission";
import { getRuleCriteriaFieldsForModel } from "../../../Types/Rules/RuleCriteriaFieldRegistry";
import {
  RuleCriteriaSubject,
  getRuleCriteriaSubjectForModel,
} from "../../../Types/Rules/RuleCriteriaSubject";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";

/*
 * THE ALERT INCIDENT RULE MODEL: who may change a rule, what it stores, and
 * the bookkeeping column it adds to alerts.
 */

const rule: AlertIncidentRule = new AlertIncidentRule();

describe("AlertIncidentRule", () => {
  test("is registered, and a rule model with conditions", () => {
    expect(AllModelTypes).toContain(AlertIncidentRule);
    expect(rule).toBeInstanceOf(RuleBaseModel);
    expect(rule.tableName).toBe("AlertIncidentRule");
    expect(rule.crudApiPath?.toString()).toBe("/alert-incident-rule");
    expect(rule.singularName).toBe("Alert Incident Rule");
    expect(rule.pluralName).toBe("Alert Incident Rules");
  });

  test("declaring incidents is a project owner's or admin's to set up, or a role given its own permission", () => {
    expect(rule.createRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.CreateAlertIncidentRule,
    ]);
    expect(rule.updateRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.EditAlertIncidentRule,
    ]);
    expect(rule.deleteRecordPermissions).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.DeleteAlertIncidentRule,
    ]);

    // Alert members work alerts; they cannot make alerts declare incidents.
    for (const permissions of [
      rule.createRecordPermissions,
      rule.updateRecordPermissions,
      rule.deleteRecordPermissions,
    ]) {
      expect(permissions).not.toContain(Permission.ProjectMember);
      expect(permissions).not.toContain(Permission.AlertAdmin);
      expect(permissions).not.toContain(Permission.AlertMember);
    }
  });

  test("everyone who works alerts may read the rules", () => {
    expect(rule.readRecordPermissions).toEqual(
      expect.arrayContaining([
        Permission.ProjectMember,
        Permission.Viewer,
        Permission.AlertAdmin,
        Permission.AlertMember,
        Permission.AlertViewer,
        Permission.ReadAlertIncidentRule,
      ]),
    );
  });

  test("is a list put in order by dragging: the first rule that matches decides", () => {
    expect(rule.listOrder).toEqual({
      column: "order",
      scopeColumns: ["projectId"],
      sortOrder: "ASC",
    });
    expect(rule.getTableColumnMetadata("order").description).toContain(
      "drag the rows to reorder them",
    );
  });

  test("matches with the conditions every alert rule offers", () => {
    expect(getRuleCriteriaFieldsForModel("AlertIncidentRule")).toEqual([
      "monitors",
      "alertSeverities",
      "alertLabels",
      "monitorLabels",
      "alertTitlePattern",
      "alertDescriptionPattern",
      "monitorNamePattern",
      "monitorDescriptionPattern",
    ]);
    expect(getRuleCriteriaSubjectForModel("AlertIncidentRule")).toBe(
      RuleCriteriaSubject.Alerts,
    );
  });

  test("declares with an optional incident severity, right away by default, shown on status pages by default", () => {
    expect(rule.getTableColumnMetadata("incidentSeverity").type).toBe(
      TableColumnType.Entity,
    );
    expect(rule.getTableColumnMetadata("incidentSeverityId").required).toBe(
      false,
    );

    expect(rule.getTableColumnMetadata("declareAfterInMinutes")).toEqual(
      expect.objectContaining({
        type: TableColumnType.Number,
        required: true,
        defaultValue: 0,
        isDefaultValueColumn: true,
      }),
    );
    expect(rule.getTableColumnMetadata("showIncidentOnStatusPage")).toEqual(
      expect.objectContaining({
        type: TableColumnType.Boolean,
        required: true,
        defaultValue: true,
        isDefaultValueColumn: true,
      }),
    );
  });

  test("the alert's next check is OneUptime's alone to write", () => {
    const alert: Alert = new Alert();
    const access: ColumnAccessControl | undefined =
      alert.getColumnAccessControlForAllColumns()["nextIncidentRuleCheckAt"];

    expect(alert.getTableColumnMetadata("nextIncidentRuleCheckAt").type).toBe(
      TableColumnType.Date,
    );
    expect(access?.create).toEqual([]);
    expect(access?.update).toEqual([]);
    expect(access?.read).toEqual(
      expect.arrayContaining([Permission.ReadAlert, Permission.AlertViewer]),
    );
  });
});
