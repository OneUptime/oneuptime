import AIInvestigationRule from "../../../Models/DatabaseModels/AIInvestigationRule";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import TableColumnType from "../../../Types/Database/TableColumnType";
import Permission from "../../../Types/Permission";
import { describe, expect, it } from "@jest/globals";

/*
 * THE COLUMNS BEHIND AN INVESTIGATION RULE'S WAIT (issue #5074), and who may
 * touch each:
 *
 *   - AIInvestigationRule.onlyIfOpenAfterMinutes - the rule's wait: written
 *     by who may change the project's AI settings (a Project Owner or
 *     Admin, like every other column of the rule), read by every member;
 *   - Incident / Alert.aiInvestigationWaitUntil - when a waiting record's
 *     wait ends: internal, OneUptime's own bookkeeping. No API caller sets
 *     it (that would start or stop an investigation behind the rules' back)
 *     or reads it (the AI card reads the wait through its own endpoint);
 *   - AIRun.ruleWaitMinutes - on a run a rule made wait, the wait: written
 *     only by OneUptime, read like the rest of the run.
 */

const OWNER_OR_ADMIN: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
];

const EVERY_MEMBER: Array<Permission> = [
  Permission.ProjectOwner,
  Permission.ProjectAdmin,
  Permission.ProjectMember,
  Permission.Viewer,
];

function accessOf(model: BaseModel, column: string): ColumnAccessControl {
  const access: ColumnAccessControl | null =
    model.getColumnAccessControlFor(column);

  expect(access).toBeTruthy();
  return access!;
}

describe("AIInvestigationRule.onlyIfOpenAfterMinutes", () => {
  const rule: AIInvestigationRule = new AIInvestigationRule();

  it("is an optional number of minutes, named as the API and Terraform show it", () => {
    const metadata: ReturnType<AIInvestigationRule["getTableColumnMetadata"]> =
      rule.getTableColumnMetadata("onlyIfOpenAfterMinutes");

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Only If Open After (Minutes)");
    expect(metadata.isDefaultValueColumn).toBeFalsy();
    expect(metadata.defaultValue).toBeUndefined();
    expect(metadata.description).toContain(
      "Leave empty to investigate right away.",
    );
    expect(metadata.description).toContain("the shortest wait decides");
    expect(metadata.description).toContain("At most 1440 minutes (a day).");
  });

  it("is written by a Project Owner or Admin, and read by every member", () => {
    const access: ColumnAccessControl = accessOf(
      rule,
      "onlyIfOpenAfterMinutes",
    );

    expect(access.create).toEqual(OWNER_OR_ADMIN);
    expect(access.update).toEqual(OWNER_OR_ADMIN);
    expect(access.read).toEqual(EVERY_MEMBER);
  });

  it("is held to what the rule's other conditions are held to", () => {
    const wait: ColumnAccessControl = accessOf(rule, "onlyIfOpenAfterMinutes");
    const name: ColumnAccessControl = accessOf(rule, "name");

    expect(wait.create).toEqual(name.create);
    expect(wait.update).toEqual(name.update);
  });
});

describe.each([
  ["Incident", new Incident() as BaseModel],
  ["Alert", new Alert() as BaseModel],
])("%s.aiInvestigationWaitUntil", (_name: string, model: BaseModel) => {
  it("is an optional time, internal to OneUptime", () => {
    const metadata: ReturnType<BaseModel["getTableColumnMetadata"]> =
      model.getTableColumnMetadata("aiInvestigationWaitUntil");

    expect(metadata.type).toBe(TableColumnType.Date);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("AI Investigation Waits Until");
    expect(metadata.description).toMatch(/^Internal: /);
  });

  it("no API caller may set it, change it or read it", () => {
    const access: ColumnAccessControl = accessOf(
      model,
      "aiInvestigationWaitUntil",
    );

    expect(access.create).toEqual([]);
    expect(access.read).toEqual([]);
    expect(access.update).toEqual([]);
  });

  it("is kept as the record's AI decision is", () => {
    const wait: ColumnAccessControl = accessOf(
      model,
      "aiInvestigationWaitUntil",
    );
    const decision: ColumnAccessControl = accessOf(
      model,
      "aiInvestigationDecision",
    );

    expect(wait.create).toEqual(decision.create);
    expect(wait.update).toEqual(decision.update);
  });
});

describe("AIRun.ruleWaitMinutes", () => {
  const run: AIRun = new AIRun();

  it("is an optional number of minutes", () => {
    const metadata: ReturnType<AIRun["getTableColumnMetadata"]> =
      run.getTableColumnMetadata("ruleWaitMinutes");

    expect(metadata.type).toBe(TableColumnType.Number);
    expect(metadata.required).toBe(false);
    expect(metadata.title).toBe("Rule Wait (Minutes)");
    expect(metadata.description).toContain("Empty when it started right away.");
  });

  it("is written only by OneUptime, and read like the run it is on", () => {
    const access: ColumnAccessControl = accessOf(run, "ruleWaitMinutes");

    expect(access.create).toEqual([]);
    expect(access.update).toEqual([]);
    expect(access.read).toEqual(EVERY_MEMBER);
    expect(access.read).toEqual(accessOf(run, "followUpForAlertId").read);
  });
});
