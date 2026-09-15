import { DatabaseBaseModelType } from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RuleRunRegistry, {
  RuleRunDefinition,
} from "../../../../../Server/Utils/Rules/RuleRun/RuleRunRegistry";
import {
  RuleRunAction,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../../../Types/Rules/RuleRun";
import { describe, expect, it } from "@jest/globals";

/*
 * Contract under test - every runnable rule is wired to the right pieces.
 *
 * An entry is only wiring, and wrong wiring does not throw: a label rule wired
 * to the owner engine, or to another resource's service, runs "successfully"
 * against the wrong table. So every piece of every entry is checked against
 * the rule type it is registered under, by name.
 */

const RESOURCE_RULE_TYPES: Array<RuleRunType> = Object.values(
  RuleRunType,
).filter((ruleType: RuleRunType): boolean => {
  return ruleType !== RuleRunType.StatusPageMonitorRule;
});

function resourceName(ruleType: RuleRunType): string {
  return ruleType.replace(/(Label|Owner|Privacy)Rule$/, "");
}

function getDefinition(ruleType: RuleRunType): RuleRunDefinition {
  const definition: RuleRunDefinition | null =
    RuleRunRegistry.getDefinition(ruleType);

  if (!definition) {
    throw new Error(`${ruleType} has no rule run definition`);
  }

  return definition;
}

describe("RuleRunRegistry", () => {
  it.each(RESOURCE_RULE_TYPES)(
    "%s is wired to its own rule model and service",
    (ruleType: RuleRunType) => {
      const definition: RuleRunDefinition = getDefinition(ruleType);

      expect(new definition.ruleModelType().tableName).toBe(ruleType);
      expect(definition.ruleService.getModel().tableName).toBe(ruleType);
    },
  );

  it.each(RESOURCE_RULE_TYPES)(
    "%s is wired to the resource it is named after",
    (ruleType: RuleRunType) => {
      const definition: RuleRunDefinition = getDefinition(ruleType);

      expect(new definition.resourceModelType().tableName).toBe(
        resourceName(ruleType),
      );
      expect(definition.resourceService.getModel().tableName).toBe(
        resourceName(ruleType),
      );
    },
  );

  it.each(RESOURCE_RULE_TYPES)(
    "%s has an engine that implements the run contract",
    (ruleType: RuleRunType) => {
      const definition: RuleRunDefinition = getDefinition(ruleType);
      const ruleSelect: Record<string, unknown> = definition.engine
        .ruleSelect as Record<string, unknown>;

      expect(typeof definition.engine.applyRulesToExistingResource).toBe(
        "function",
      );
      expect(ruleSelect["criteria"]).toBe(true);
      expect(definition.engine.resourceSelectForRuleRun).toBeDefined();

      const action: RuleRunAction = RuleRunTypeUtil.getAction(ruleType);

      if (action === RuleRunAction.AddLabels) {
        expect(ruleSelect["labelsToAdd"]).toBeDefined();
      }

      if (action === RuleRunAction.AddOwners) {
        expect(ruleSelect["ownerUsers"]).toBeDefined();
        expect(ruleSelect["ownerTeams"]).toBeDefined();
        expect(ruleSelect["notifyOwners"]).toBe(true);
      }

      if (action === RuleRunAction.MarkPrivate) {
        const resourceSelect: Record<string, unknown> = definition.engine
          .resourceSelectForRuleRun as Record<string, unknown>;
        expect(resourceSelect["isPrivate"]).toBe(true);
      }
    },
  );

  /*
   * Running an owner rule creates owner rows, so the caller must be allowed
   * to create exactly those rows - and nothing is created by a label or
   * privacy rule.
   */
  it.each(RESOURCE_RULE_TYPES)(
    "%s declares the owner rows it creates, and only owner rules do",
    (ruleType: RuleRunType) => {
      const definition: RuleRunDefinition = getDefinition(ruleType);
      const ownerTables: Array<string> = (definition.ownerModelTypes || [])
        .map((modelType: DatabaseBaseModelType): string => {
          return new modelType().tableName || "";
        })
        .sort();

      if (RuleRunTypeUtil.getAction(ruleType) === RuleRunAction.AddOwners) {
        expect(ownerTables).toEqual(
          [
            `${resourceName(ruleType)}OwnerTeam`,
            `${resourceName(ruleType)}OwnerUser`,
          ].sort(),
        );
      } else {
        expect(ownerTables).toEqual([]);
      }
    },
  );

  it("has no definition for a status page monitor rule, which re-syncs instead", () => {
    expect(
      RuleRunRegistry.getDefinition(RuleRunType.StatusPageMonitorRule),
    ).toBeNull();
  });
});
