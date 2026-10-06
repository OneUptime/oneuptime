import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import ProjectOidc from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSCIM from "../../../Models/DatabaseModels/ProjectSCIM";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import StatusPageSso from "../../../Models/DatabaseModels/StatusPageSso";
import WorkspaceNotificationRule from "../../../Models/DatabaseModels/WorkspaceNotificationRule";
import WorkspaceNotificationSummary from "../../../Models/DatabaseModels/WorkspaceNotificationSummary";
import {
  PLAN_GATED_TABLE_SWITCH_COLUMN,
  PlanGatedTableModel,
  canReadPlanGatedTableBelowPlan,
  getPlanGatedTableSwitchColumn,
  isPlanGatedTableSwitchOff,
} from "../../../Types/Billing/PlanGatedTable";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";

/*
 * What a project below a table's plan may still do with the records it
 * already has (Types/Billing/PlanGatedTable): read them - unless reading
 * them is what the plan sells - and switch one off. These pin the rule's
 * answers against the models' real metadata, and against made-up models for
 * the edges. The server's billing check and the dashboard's below-plan
 * views both ask these, so they agree.
 */

// A made-up model whose isEnabled column has the given type, or none.
const modelWithSwitchOfType: (
  type: TableColumnType | null,
) => PlanGatedTableModel = (
  type: TableColumnType | null,
): PlanGatedTableModel => {
  return {
    getTableColumnMetadata: (columnName: string): TableColumnMetadata => {
      if (type && columnName === PLAN_GATED_TABLE_SWITCH_COLUMN) {
        return { type: type } as TableColumnMetadata;
      }

      return undefined as unknown as TableColumnMetadata;
    },
  };
};

describe("the switch of a plan-gated table", () => {
  test("is its isEnabled column: SSO providers, OIDC providers and workspace summaries have one", () => {
    for (const model of [
      new ProjectSso(),
      new ProjectOidc(),
      new StatusPageSso(),
      new WorkspaceNotificationSummary(),
    ]) {
      expect([
        model.constructor.name,
        getPlanGatedTableSwitchColumn(model),
      ]).toEqual([model.constructor.name, "isEnabled"]);
    }
  });

  test("is missing on tables with no off state - API keys, SCIM, notification rules, schedules - which are stopped by deleting", () => {
    for (const model of [
      new ApiKey(),
      new ProjectSCIM(),
      new WorkspaceNotificationRule(),
      new OnCallDutyPolicySchedule(),
    ]) {
      expect([
        model.constructor.name,
        getPlanGatedTableSwitchColumn(model),
      ]).toEqual([model.constructor.name, null]);
    }
  });

  test("must hold a boolean: an isEnabled column of any other type is not a switch", () => {
    expect(
      getPlanGatedTableSwitchColumn(
        modelWithSwitchOfType(TableColumnType.Boolean),
      ),
    ).toBe("isEnabled");

    for (const type of [
      TableColumnType.ShortText,
      TableColumnType.Number,
      TableColumnType.JSON,
      TableColumnType.Date,
    ]) {
      expect(
        getPlanGatedTableSwitchColumn(modelWithSwitchOfType(type)),
      ).toBeNull();
    }

    expect(
      getPlanGatedTableSwitchColumn(modelWithSwitchOfType(null)),
    ).toBeNull();
  });
});

describe("an update that switches records off", () => {
  const provider: ProjectSso = new ProjectSso();

  test("writes the switch false, and nothing else", () => {
    expect(isPlanGatedTableSwitchOff(provider, { isEnabled: false })).toBe(
      true,
    );
  });

  test("ignores columns that are not written (undefined)", () => {
    expect(
      isPlanGatedTableSwitchOff(provider, {
        isEnabled: false,
        name: undefined,
        teams: undefined,
      }),
    ).toBe(true);
  });

  test("switching on is not switching off", () => {
    expect(isPlanGatedTableSwitchOff(provider, { isEnabled: true })).toBe(
      false,
    );
  });

  test("the comparison is exact: no other value counts as false", () => {
    for (const value of ["false", "", 0, null, "0", [], {}, "off"]) {
      expect([
        value,
        isPlanGatedTableSwitchOff(provider, { isEnabled: value }),
      ]).toEqual([value, false]);
    }
  });

  test("one more column, whatever it holds, makes it an ordinary update", () => {
    for (const extra of [
      { name: "Renamed" },
      { description: null },
      { signOnURL: "https://idp.example.com/sso" },
      { teams: [] },
      { projectId: "6c000000-0000-4000-8000-000000000001" },
      { isTested: false },
    ]) {
      expect([
        extra,
        isPlanGatedTableSwitchOff(provider, { isEnabled: false, ...extra }),
      ]).toEqual([extra, false]);
    }
  });

  test("writing nothing is not a switch-off", () => {
    expect(isPlanGatedTableSwitchOff(provider, {})).toBe(false);
    expect(isPlanGatedTableSwitchOff(provider, { isEnabled: undefined })).toBe(
      false,
    );
  });

  test("anything that is not a plain object of columns is not a switch-off", () => {
    for (const data of [
      undefined,
      null,
      false,
      "isEnabled",
      0,
      [{ isEnabled: false }],
      [],
    ]) {
      expect([data, isPlanGatedTableSwitchOff(provider, data)]).toEqual([
        data,
        false,
      ]);
    }
  });

  test("a table with no switch has no switch-off, even for an isEnabled it does not have", () => {
    for (const model of [
      new ApiKey(),
      new ProjectSCIM(),
      new WorkspaceNotificationRule(),
      new OnCallDutyPolicySchedule(),
    ]) {
      expect([
        model.constructor.name,
        isPlanGatedTableSwitchOff(model, { isEnabled: false }),
      ]).toEqual([model.constructor.name, false]);
    }
  });

  test("a summary's switch-off is the same write, on every table with a switch", () => {
    expect(
      isPlanGatedTableSwitchOff(new WorkspaceNotificationSummary(), {
        isEnabled: false,
      }),
    ).toBe(true);
    expect(
      isPlanGatedTableSwitchOff(new WorkspaceNotificationSummary(), {
        isEnabled: false,
        nextSendAt: new Date(),
      }),
    ).toBe(false);
  });
});

describe("reading the records a project already has, below the plan", () => {
  test("is allowed for configuration: providers, connections, keys, rules, schedules", () => {
    for (const model of [
      new ProjectSso(),
      new ProjectOidc(),
      new ProjectSCIM(),
      new ApiKey(),
      new WorkspaceNotificationRule(),
      new WorkspaceNotificationSummary(),
      new OnCallDutyPolicySchedule(),
    ]) {
      expect([
        model.constructor.name,
        canReadPlanGatedTableBelowPlan(model),
      ]).toEqual([model.constructor.name, true]);
    }
  });

  test("stays gated where reading is what the plan sells: on-call logs, form submissions", () => {
    for (const model of [
      new OnCallDutyPolicyExecutionLog(),
      new FormSubmission(),
    ]) {
      expect(model.readStaysGated).toBe(true);
      expect([
        model.constructor.name,
        canReadPlanGatedTableBelowPlan(model),
      ]).toEqual([model.constructor.name, false]);
    }
  });

  test("a table that does not say otherwise is configuration", () => {
    expect(canReadPlanGatedTableBelowPlan(modelWithSwitchOfType(null))).toBe(
      true,
    );
    expect(
      canReadPlanGatedTableBelowPlan({
        ...modelWithSwitchOfType(null),
        readStaysGated: false,
      }),
    ).toBe(true);
  });
});
