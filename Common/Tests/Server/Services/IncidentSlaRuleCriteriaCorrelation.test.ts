import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSlaRule from "../../../Models/DatabaseModels/IncidentSlaRule";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import IncidentSlaRuleService from "../../../Server/Services/IncidentSlaRuleService";
import MonitorService from "../../../Server/Services/MonitorService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);
const LABEL_A_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const LABEL_B_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

function label(id: ObjectID): Label {
  return { id: id, _id: id.toString() } as Label;
}

function incident(): Incident {
  return {
    monitors: [
      { id: MONITOR_A_ID } as Monitor,
      { id: MONITOR_B_ID } as Monitor,
    ],
  } as Incident;
}

function rule(): IncidentSlaRule {
  return {
    criteria: {
      schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
      filterCondition: FilterCondition.All,
      filters: [
        {
          field: "monitorLabels",
          operator: RuleCriteriaOperator.HasAllOf,
          value: [LABEL_A_ID.toString(), LABEL_B_ID.toString()],
        },
      ],
    },
  } as IncidentSlaRule;
}

describe("Incident SLA rule monitor correlation", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("does not combine labels across monitors and reads each monitor once", async () => {
    const findOneById: SpyInstance<typeof MonitorService.findOneById> = jest
      .spyOn(MonitorService, "findOneById")
      .mockImplementation(
        async (
          data: Parameters<typeof MonitorService.findOneById>[0],
        ): Promise<Monitor> => {
          return {
            id: data.id,
            labels:
              data.id.toString() === MONITOR_A_ID.toString()
                ? [label(LABEL_A_ID)]
                : [label(LABEL_B_ID)],
          } as Monitor;
        },
      );

    await expect(
      IncidentSlaRuleService.doesIncidentMatchRule(incident(), rule()),
    ).resolves.toBe(false);
    expect(findOneById).toHaveBeenCalledTimes(2);
  });

  it("short-circuits on one matching monitor with one read", async () => {
    const findOneById: SpyInstance<typeof MonitorService.findOneById> = jest
      .spyOn(MonitorService, "findOneById")
      .mockResolvedValue({
        id: MONITOR_A_ID,
        labels: [label(LABEL_A_ID), label(LABEL_B_ID)],
      } as Monitor);

    await expect(
      IncidentSlaRuleService.doesIncidentMatchRule(incident(), rule()),
    ).resolves.toBe(true);
    expect(findOneById).toHaveBeenCalledTimes(1);
  });
});
