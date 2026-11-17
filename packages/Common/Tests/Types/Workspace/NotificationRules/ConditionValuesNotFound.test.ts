import AlertSeverity from "../../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentSeverity from "../../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../../Models/DatabaseModels/IncidentState";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../../Models/DatabaseModels/MonitorStatus";
import OnCallDutyPolicy from "../../../../Models/DatabaseModels/OnCallDutyPolicy";
import ScheduledMaintenanceState from "../../../../Models/DatabaseModels/ScheduledMaintenanceState";
import SecurityCasePriority from "../../../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../../../Models/DatabaseModels/SecurityCaseStatus";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import { DropdownOption } from "../../../../UI/Components/Dropdown/Dropdown";
import {
  FIXED_LIST_CHECK_ONS,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "../../../../Types/Workspace/NotificationRules/NotificationRuleCondition";
import { describe, expect, test } from "@jest/globals";

/*
 * A VALUE A CONDITION HOLDS THAT WAS SINCE DELETED (#7807).
 *
 * A workspace rule's condition holds the ids of the records it picked - a
 * severity, a label, a monitor, an on-call policy. Deleting the record
 * leaves the id in the rule, which matches nothing for it. The rule's card
 * said so for a policy and a person ("No longer in this project") and the
 * Conditions step showed nothing at all: the value was not among the
 * picker's options. Both now ask the same question here - which of the ids
 * name none of the project's records of the condition's field - for every
 * field picked from the project's records.
 */

function row<T extends BaseModel>(model: T, id: string, name: string): T {
  model._id = id;
  (model as unknown as { name: string }).name = name;
  return model;
}

const LISTS: {
  alertSeverities: Array<AlertSeverity>;
  alertStates: Array<AlertState>;
  incidentSeverities: Array<IncidentSeverity>;
  monitorStatus: Array<MonitorStatus>;
  incidentStates: Array<IncidentState>;
  scheduledMaintenanceStates: Array<ScheduledMaintenanceState>;
  labels: Array<Label>;
  monitors: Array<Monitor>;
  securityCasePriorities: Array<SecurityCasePriority>;
  securityCaseStatuses: Array<SecurityCaseStatus>;
  serviceLevelObjectives: Array<ServiceLevelObjective>;
  onCallDutyPolicies: Array<OnCallDutyPolicy>;
} = {
  alertSeverities: [
    row(new AlertSeverity(), "a1000000-0000-4000-8000-000000000001", "High"),
  ],
  alertStates: [
    row(new AlertState(), "a2000000-0000-4000-8000-000000000001", "Open"),
  ],
  incidentSeverities: [
    row(
      new IncidentSeverity(),
      "a3000000-0000-4000-8000-000000000001",
      "Critical",
    ),
  ],
  monitorStatus: [
    row(new MonitorStatus(), "a4000000-0000-4000-8000-000000000001", "Down"),
  ],
  incidentStates: [
    row(
      new IncidentState(),
      "a5000000-0000-4000-8000-000000000001",
      "Resolved",
    ),
  ],
  scheduledMaintenanceStates: [
    row(
      new ScheduledMaintenanceState(),
      "a6000000-0000-4000-8000-000000000001",
      "Ongoing",
    ),
  ],
  labels: [row(new Label(), "a7000000-0000-4000-8000-000000000001", "Prod")],
  monitors: [
    row(new Monitor(), "a8000000-0000-4000-8000-000000000001", "Checkout"),
  ],
  securityCasePriorities: [
    row(
      new SecurityCasePriority(),
      "a9000000-0000-4000-8000-000000000001",
      "P1",
    ),
  ],
  securityCaseStatuses: [
    row(
      new SecurityCaseStatus(),
      "aa000000-0000-4000-8000-000000000001",
      "Triage",
    ),
  ],
  serviceLevelObjectives: [
    row(
      new ServiceLevelObjective(),
      "ab000000-0000-4000-8000-000000000001",
      "Checkout availability",
    ),
  ],
  onCallDutyPolicies: [
    row(
      new OnCallDutyPolicy(),
      "ac000000-0000-4000-8000-000000000001",
      "Primary on-call",
    ),
  ],
};

const DELETED_ID: string = "dead0000-0000-4000-8000-000000000001";

const RECORD_CHECK_ONS: Array<NotificationRuleConditionCheckOn> = Object.values(
  NotificationRuleConditionCheckOn,
).filter((checkOn: NotificationRuleConditionCheckOn): boolean => {
  return NotificationRuleConditionUtil.isRecordValueField(checkOn);
});

describe("which fields hold records of the project", () => {
  test("every picked field but a fixed list's", () => {
    const picked: Array<NotificationRuleConditionCheckOn> = Object.values(
      NotificationRuleConditionCheckOn,
    ).filter((checkOn: NotificationRuleConditionCheckOn): boolean => {
      return NotificationRuleConditionUtil.isDropdownValueField({
        checkOn: checkOn,
        conditionType:
          NotificationRuleConditionUtil.getConditionTypeByCheckOn(checkOn)[0],
      });
    });

    expect(RECORD_CHECK_ONS.length).toBeGreaterThan(20);
    expect([...RECORD_CHECK_ONS, ...FIXED_LIST_CHECK_ONS].sort()).toEqual(
      [...picked].sort(),
    );
  });

  test("a monitor's type, a case's source and an error budget's change are fixed lists", () => {
    for (const checkOn of FIXED_LIST_CHECK_ONS) {
      expect(NotificationRuleConditionUtil.isRecordValueField(checkOn)).toBe(
        false,
      );
      expect(
        NotificationRuleConditionUtil.getRecordsByCheckOn({
          ...LISTS,
          checkOn,
        }),
      ).toBeUndefined();
    }
  });

  test("text and owners are not records picked from a list", () => {
    for (const checkOn of [
      NotificationRuleConditionCheckOn.IncidentTitle,
      NotificationRuleConditionCheckOn.OnCallDutyPolicyName,
      NotificationRuleConditionCheckOn.IncidentOwners,
      undefined,
    ]) {
      expect(NotificationRuleConditionUtil.isRecordValueField(checkOn)).toBe(
        false,
      );
    }
  });
});

describe("the records each field's values are picked from", () => {
  test("are the very lists its value dropdown is built from, for every record field", () => {
    for (const checkOn of RECORD_CHECK_ONS) {
      const records: Array<BaseModel> | undefined =
        NotificationRuleConditionUtil.getRecordsByCheckOn({
          ...LISTS,
          checkOn,
        });

      const options: Array<DropdownOption> =
        NotificationRuleConditionUtil.getDropdownOptionsByCheckOn({
          ...LISTS,
          checkOn,
        });

      expect({
        checkOn,
        ids: (records || []).map((record: BaseModel): string => {
          return record._id!.toString();
        }),
      }).toEqual({
        checkOn,
        ids: options.map((option: DropdownOption): string => {
          return option.value.toString();
        }),
      });
      expect(records?.length).toBe(1);
    }
  });

  test("a list the page could not read is not known", () => {
    expect(
      NotificationRuleConditionUtil.getRecordsByCheckOn({
        ...LISTS,
        onCallDutyPolicies: undefined,
        checkOn: NotificationRuleConditionCheckOn.OnCallDutyPolicies,
      }),
    ).toBeUndefined();
  });
});

describe("the values a condition holds that name no record now", () => {
  test("a deleted value, of every field picked from the project's records", () => {
    for (const checkOn of RECORD_CHECK_ONS) {
      const records: Array<BaseModel> =
        NotificationRuleConditionUtil.getRecordsByCheckOn({
          ...LISTS,
          checkOn,
        })!;

      expect({
        checkOn,
        notFound: NotificationRuleConditionUtil.getIdsNotFound({
          ids: [records[0]!._id!.toString(), DELETED_ID],
          records: records,
        }),
      }).toEqual({ checkOn, notFound: [DELETED_ID] });
    }
  });

  test("an id is found whatever its letter case, and a gone one is said once", () => {
    const policies: Array<BaseModel> = LISTS.onCallDutyPolicies;

    expect(
      NotificationRuleConditionUtil.getIdsNotFound({
        ids: [
          policies[0]!._id!.toString().toUpperCase(),
          DELETED_ID,
          DELETED_ID.toUpperCase(),
        ],
        records: policies,
      }),
    ).toEqual([DELETED_ID]);
  });

  test("an archived value is not gone: it is still the project's", () => {
    const archived: Label = row(
      new Label(),
      "a7000000-0000-4000-8000-000000000002",
      "Old",
    );
    archived.isArchived = true;

    expect(
      NotificationRuleConditionUtil.getIdsNotFound({
        ids: [archived._id!.toString()],
        records: [...LISTS.labels, archived],
      }),
    ).toEqual([]);
  });

  test("nothing is gone from a list that was not read", () => {
    expect(
      NotificationRuleConditionUtil.getIdsNotFound({
        ids: [DELETED_ID],
        records: undefined,
      }),
    ).toEqual([]);
  });
});
