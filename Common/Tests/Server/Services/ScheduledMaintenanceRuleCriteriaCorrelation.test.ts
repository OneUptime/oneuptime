import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import MonitorService from "../../../Server/Services/MonitorService";
import ScheduledMaintenanceLabelRuleEngineService from "../../../Server/Services/ScheduledMaintenanceLabelRuleEngineService";
import ScheduledMaintenanceOwnerRuleEngineService from "../../../Server/Services/ScheduledMaintenanceOwnerRuleEngineService";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import ObjectID from "../../../Types/ObjectID";
import RuleCriteria, {
  RULE_CRITERIA_SCHEMA_VERSION,
  RuleCriteriaOperator,
} from "../../../Types/Rules/RuleCriteria";
import { afterEach, describe, expect, it, jest } from "@jest/globals";

const MONITOR_A_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);
const MONITOR_B_ID: ObjectID = new ObjectID(
  "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
);

interface ScheduledMaintenanceRuleMatchFields {
  criteria?: RuleCriteria | null | undefined;
}

interface ScheduledMaintenanceRuleMatcher {
  doesScheduledMaintenanceMatchRule: (
    scheduledMaintenance: ScheduledMaintenance,
    rule: ScheduledMaintenanceRuleMatchFields,
  ) => Promise<boolean>;
}

function criteria(filters: RuleCriteria["filters"]): RuleCriteria {
  return {
    schemaVersion: RULE_CRITERIA_SCHEMA_VERSION,
    filterCondition: FilterCondition.All,
    filters,
  };
}

function scheduledMaintenanceWithTwoMonitors(): ScheduledMaintenance {
  return {
    title: "Database maintenance",
    monitors: [
      { id: MONITOR_A_ID } as Monitor,
      { id: MONITOR_B_ID } as Monitor,
    ],
  } as unknown as ScheduledMaintenance;
}

const matchers: Array<{
  name: string;
  matcher: ScheduledMaintenanceRuleMatcher;
}> = [
  {
    name: "scheduled maintenance label rules",
    matcher:
      ScheduledMaintenanceLabelRuleEngineService as unknown as ScheduledMaintenanceRuleMatcher,
  },
  {
    name: "scheduled maintenance owner rules",
    matcher:
      ScheduledMaintenanceOwnerRuleEngineService as unknown as ScheduledMaintenanceRuleMatcher,
  },
];

describe.each(matchers)(
  "$name same-monitor correlation",
  ({ matcher }: { matcher: ScheduledMaintenanceRuleMatcher }) => {
    afterEach(() => {
      jest.restoreAllMocks();
    });

    it("does not combine match-all details from different monitors", async () => {
      const monitorA: Monitor = {
        id: MONITOR_A_ID,
        name: "production-api",
        description: "internal service",
        labels: [],
      } as unknown as Monitor;
      const monitorB: Monitor = {
        id: MONITOR_B_ID,
        name: "background-worker",
        description: "customer checkout",
        labels: [],
      } as unknown as Monitor;
      const findOneById: jest.SpiedFunction<typeof MonitorService.findOneById> =
        jest
          .spyOn(MonitorService, "findOneById")
          .mockImplementation(
            async (
              data: Parameters<typeof MonitorService.findOneById>[0],
            ): Promise<Monitor> => {
              return data.id.toString() === MONITOR_A_ID.toString()
                ? monitorA
                : monitorB;
            },
          );

      await expect(
        matcher.doesScheduledMaintenanceMatchRule(
          scheduledMaintenanceWithTwoMonitors(),
          {
            criteria: criteria([
              {
                field: "monitorNamePattern",
                operator: RuleCriteriaOperator.Contains,
                value: "api",
              },
              {
                field: "monitorDescriptionPattern",
                operator: RuleCriteriaOperator.Contains,
                value: "customer",
              },
            ]),
          },
        ),
      ).resolves.toBe(false);
      expect(findOneById).toHaveBeenCalledTimes(2);
    });

    it("matches when the same monitor satisfies all details", async () => {
      const monitorA: Monitor = {
        id: MONITOR_A_ID,
        name: "checkout-api",
        description: "customer checkout",
        labels: [],
      } as unknown as Monitor;
      const findOneById: jest.SpiedFunction<typeof MonitorService.findOneById> =
        jest.spyOn(MonitorService, "findOneById").mockResolvedValue(monitorA);

      await expect(
        matcher.doesScheduledMaintenanceMatchRule(
          scheduledMaintenanceWithTwoMonitors(),
          {
            criteria: criteria([
              {
                field: "monitorNamePattern",
                operator: RuleCriteriaOperator.Contains,
                value: "api",
              },
              {
                field: "monitorDescriptionPattern",
                operator: RuleCriteriaOperator.Contains,
                value: "customer",
              },
            ]),
          },
        ),
      ).resolves.toBe(true);
      expect(findOneById).toHaveBeenCalledTimes(1);
    });
  },
);
