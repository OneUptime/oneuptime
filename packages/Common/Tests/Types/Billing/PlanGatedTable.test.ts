import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import ApiKeyPermission from "../../../Models/DatabaseModels/ApiKeyPermission";
import FormSubmission from "../../../Models/DatabaseModels/FormSubmission";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import MonitorGroup from "../../../Models/DatabaseModels/MonitorGroup";
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
  canDeletePlanGatedTableBelowPlan,
  canReadPlanGatedTableBelowPlan,
  getPlanGatedTableSwitchColumn,
  isPlanGatedTableSwitchOff,
} from "../../../Types/Billing/PlanGatedTable";
import { TableColumnMetadata } from "../../../Types/Database/TableColumn";
import TableColumnType from "../../../Types/Database/TableColumnType";
import { describe, expect, test } from "@jest/globals";

/*
 * What a project below a table's plan may still do with the records it
 * already has (Types/Billing/PlanGatedTable): delete them - unless deleting
 * one gives more than the plan allows - switch one off, and read them where
 * they are configuration that keeps working after a downgrade. These pin
 * the rule's answers against the models' real metadata, and against
 * made-up models for the edges. The server's billing check and the
 * dashboard's below-plan views both ask these, so they agree.
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

  /*
   * A request body whose "__proto__" set the object's prototype carries
   * columns no own-key check lists, yet a write that reads columns by name
   * still writes them. Only a plain object - or one with no prototype -
   * counts.
   */
  test("columns carried on a prototype make it no switch-off", () => {
    const carried: Record<string, unknown> = Object.create({
      teams: ["6c000000-0000-4000-8000-000000000001"],
    }) as Record<string, unknown>;
    carried["isEnabled"] = false;

    expect(Object.keys(carried)).toEqual(["isEnabled"]);
    expect(isPlanGatedTableSwitchOff(provider, carried)).toBe(false);

    const parsed: Record<string, unknown> = Object.assign(
      {},
      JSON.parse('{"isEnabled": false}'),
    ) as Record<string, unknown>;
    Object.setPrototypeOf(parsed, { name: "Renamed" });

    expect(isPlanGatedTableSwitchOff(provider, parsed)).toBe(false);

    /*
     * A model is not a plain object either: its columns are judged once
     * they are the columns it writes (DatabaseService.sanitizeUpdateData).
     */
    const model: ProjectSso = new ProjectSso();
    model.isEnabled = false;

    expect(isPlanGatedTableSwitchOff(provider, model)).toBe(false);
  });

  test("an object with no prototype at all is judged on its columns", () => {
    const bare: Record<string, unknown> = Object.create(null) as Record<
      string,
      unknown
    >;
    bare["isEnabled"] = false;

    expect(isPlanGatedTableSwitchOff(provider, bare)).toBe(true);

    bare["name"] = "Renamed";

    expect(isPlanGatedTableSwitchOff(provider, bare)).toBe(false);
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
  test("is allowed for configuration that keeps working after a downgrade: providers, connections, keys, rules, schedules", () => {
    for (const model of [
      new ProjectSso(),
      new ProjectOidc(),
      new ProjectSCIM(),
      new StatusPageSso(),
      new ApiKey(),
      new ApiKeyPermission(),
      new WorkspaceNotificationRule(),
      new WorkspaceNotificationSummary(),
      new OnCallDutyPolicySchedule(),
    ]) {
      expect([
        model.constructor.name,
        model.readableBelowPlan,
        canReadPlanGatedTableBelowPlan(model),
      ]).toEqual([model.constructor.name, true, true]);
    }
  });

  /*
   * Features read their configuration with the caller's permissions: a
   * template applied, a monitor group's status worked out, custom fields
   * filled in. A read allowed below the plan would be the feature working
   * below it. Logs and submissions are what the feature produced.
   */
  test("keeps the plan everywhere else: templates, custom fields, monitor groups, logs, submissions", () => {
    for (const model of [
      new IncidentTemplate(),
      new IncidentCustomField(),
      new MonitorGroup(),
      new OnCallDutyPolicyExecutionLog(),
      new FormSubmission(),
    ]) {
      expect([
        model.constructor.name,
        canReadPlanGatedTableBelowPlan(model),
      ]).toEqual([model.constructor.name, false]);
    }
  });

  test("a table that does not say so keeps its read plan", () => {
    expect(canReadPlanGatedTableBelowPlan(modelWithSwitchOfType(null))).toBe(
      false,
    );
    expect(
      canReadPlanGatedTableBelowPlan({
        ...modelWithSwitchOfType(null),
        readableBelowPlan: false,
      }),
    ).toBe(false);
    expect(
      canReadPlanGatedTableBelowPlan({
        ...modelWithSwitchOfType(null),
        readableBelowPlan: true,
      }),
    ).toBe(true);
  });
});

describe("deleting the records a project already has, below the plan", () => {
  test("is allowed on plan-gated tables: removing configuration takes nothing away from the plan", () => {
    for (const model of [
      new ProjectSso(),
      new ProjectSCIM(),
      new ApiKey(),
      new WorkspaceNotificationRule(),
      new OnCallDutyPolicySchedule(),
      new IncidentTemplate(),
      new MonitorGroup(),
      new FormSubmission(),
    ]) {
      expect([
        model.constructor.name,
        canDeletePlanGatedTableBelowPlan(model),
      ]).toEqual([model.constructor.name, true]);
    }
  });

  /*
   * A block permission restricts an API key: deleting one gives the key
   * more, which is a change the plan gates. The key itself can still be
   * deleted, and its permissions go with it.
   */
  test("keeps the plan for an API key's permissions, whose block rows restrict the key", () => {
    const permission: ApiKeyPermission = new ApiKeyPermission();

    expect(permission.deleteStaysGated).toBe(true);
    expect(canDeletePlanGatedTableBelowPlan(permission)).toBe(false);
    expect(canDeletePlanGatedTableBelowPlan(new ApiKey())).toBe(true);
  });

  test("a table that does not say so can be deleted from", () => {
    expect(canDeletePlanGatedTableBelowPlan(modelWithSwitchOfType(null))).toBe(
      true,
    );
    expect(
      canDeletePlanGatedTableBelowPlan({
        ...modelWithSwitchOfType(null),
        deleteStaysGated: true,
      }),
    ).toBe(false);
  });
});
