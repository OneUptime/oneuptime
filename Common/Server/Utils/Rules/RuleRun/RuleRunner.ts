import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import Select from "../../../Types/Database/Select";
import Sort from "../../../../Types/BaseDatabase/Sort";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  RULE_RUN_RESOURCES_PER_PASS,
  RuleRunAction,
  RuleRunPassResult,
  RuleRunResultUtil,
  RuleRunType,
  RuleRunTypeUtil,
} from "../../../../Types/Rules/RuleRun";
import StatusPageMonitorRuleEngineService, {
  StatusPageMonitorRuleSyncResult,
} from "../../../Services/StatusPageMonitorRuleEngineService";
import StatusPageMonitorRuleService from "../../../Services/StatusPageMonitorRuleService";
import Query from "../../../Types/Database/Query";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
} from "./RuleApplication";
import RuleRunRegistry, { RuleRunDefinition } from "./RuleRunRegistry";

/*
 * One pass of "Run now": ONE rule applied to the next slice of the resources
 * that already exist in its project.
 *
 * Resources are read in _id order and each pass hands back the last id it
 * evaluated as the cursor for the next. Applying a rule never changes a
 * resource's id, so no row can shift between passes and be skipped or
 * evaluated twice - which an offset would not guarantee while the run itself
 * is writing.
 */

export interface RuleRunPassData {
  ruleType: RuleRunType;
  ruleId: ObjectID;
  projectId: ObjectID;
  // The previous pass's nextCursor; null to start from the beginning.
  cursor: ObjectID | null;
  // Owner rules only - see ApplyRulesToExistingResourceData.
  allowOwnerNotification: boolean;
}

function readField(model: BaseModel, key: string): unknown {
  return (model as unknown as Record<string, unknown>)[key];
}

function hasItems(model: BaseModel, key: string): boolean {
  const value: unknown = readField(model, key);
  return Array.isArray(value) && value.length > 0;
}

/*
 * Incident, alert and scheduled maintenance rules can add labels or owners
 * copied from related resources ("inheritLabelsFromMonitors" and friends) with
 * nothing listed explicitly, and such a rule has plenty to do.
 */
function hasInheritFlag(model: BaseModel, prefix: string): boolean {
  return Object.keys(model).some((key: string): boolean => {
    return key.startsWith(prefix) && readField(model, key) === true;
  });
}

export default class RuleRunner {
  @CaptureSpan()
  public static async runPass(
    data: RuleRunPassData,
  ): Promise<RuleRunPassResult> {
    const action: RuleRunAction = RuleRunTypeUtil.getAction(data.ruleType);

    if (action === RuleRunAction.SyncStatusPageMonitors) {
      return await RuleRunner.syncStatusPageMonitorRule(data);
    }

    const definition: RuleRunDefinition | null = RuleRunRegistry.getDefinition(
      data.ruleType,
    );

    if (!definition) {
      throw new BadDataException("This rule cannot be run.");
    }

    // Scoped to the project, so another project's rule id reads as not found.
    const rule: BaseModel = RuleRunner.assertRuleCanRun({
      action: action,
      rule: await definition.ruleService.findOneBy({
        query: {
          _id: data.ruleId,
          projectId: data.projectId,
        } as Query<BaseModel>,
        select: {
          ...definition.engine.ruleSelect,
          _id: true,
          isEnabled: true,
        } as Select<BaseModel>,
        props: { isRoot: true },
      }),
    });

    const query: Record<string, unknown> = {
      projectId: data.projectId,
    };

    if (data.cursor) {
      query["_id"] = QueryHelper.greaterThan(data.cursor);
    }

    const resources: Array<BaseModel> = await definition.resourceService.findBy(
      {
        query: query as Query<BaseModel>,
        select: {
          ...definition.engine.resourceSelectForRuleRun,
          _id: true,
          projectId: true,
        } as Select<BaseModel>,
        sort: { _id: SortOrder.Ascending } as Sort<BaseModel>,
        limit: RULE_RUN_RESOURCES_PER_PASS,
        skip: 0,
        props: { isRoot: true },
      },
    );

    const result: RuleRunPassResult = {
      ...RuleRunResultUtil.emptyCounts(),
      nextCursor: null,
      ownersNotified:
        action === RuleRunAction.AddOwners &&
        data.allowOwnerNotification &&
        readField(rule, "notifyOwners") !== false,
    };

    /*
     * One resource at a time: each application writes, and the engines were
     * written for one resource per call. A pass is bounded, so this bounds the
     * work per request, not the run.
     */
    for (const resource of resources) {
      result.resourcesEvaluated++;

      let outcome: RuleApplicationResult;

      try {
        outcome = await definition.engine.applyRulesToExistingResource({
          resource: resource,
          rules: [rule],
          allowOwnerNotification: data.allowOwnerNotification,
        });
      } catch (error) {
        // The engines log and report their own failures; this is a backstop.
        logger.error(
          `Rule run of ${data.ruleType} ${data.ruleId.toString()} failed on resource ${resource.id?.toString()}: ${error}`,
          { projectId: data.projectId.toString() } as LogAttributes,
        );
        outcome = RuleApplicationResultUtil.failed();
      }

      if (outcome.matched) {
        result.resourcesMatched++;
      }

      if (outcome.failed) {
        result.resourcesFailed++;
        continue;
      }

      if (outcome.updated) {
        result.resourcesUpdated++;
        result.itemsAdded += outcome.itemsAdded;
      }
    }

    /*
     * A short page is proof the project has nothing past it. A full one only
     * suggests more; the next pass settles it by coming back empty, which
     * costs one cheap read rather than a count on every pass.
     */
    const lastResource: BaseModel | undefined = resources[resources.length - 1];

    if (resources.length === RULE_RUN_RESOURCES_PER_PASS && lastResource?.id) {
      result.nextCursor = lastResource.id.toString();
    }

    return result;
  }

  private static assertRuleCanRun(data: {
    rule: BaseModel | null;
    action: RuleRunAction;
  }): BaseModel {
    const { rule, action } = data;

    if (!rule) {
      throw new BadDataException("Rule not found.");
    }

    /*
     * A disabled rule is one somebody switched off; running it by hand would
     * contradict the toggle shown right next to the button.
     */
    if (readField(rule, "isEnabled") !== true) {
      throw new BadDataException(
        "This rule is disabled. Enable it before running it.",
      );
    }

    if (
      action === RuleRunAction.AddLabels &&
      !hasItems(rule, "labelsToAdd") &&
      !hasInheritFlag(rule, "inheritLabelsFrom")
    ) {
      throw new BadDataException(
        "This rule has no labels to add, so running it would do nothing.",
      );
    }

    if (
      action === RuleRunAction.AddOwners &&
      !hasItems(rule, "ownerUsers") &&
      !hasItems(rule, "ownerTeams") &&
      !hasInheritFlag(rule, "inheritOwnersFrom")
    ) {
      throw new BadDataException(
        "This rule has no owners to add, so running it would do nothing.",
      );
    }

    return rule;
  }

  /*
   * A status page monitor rule already re-syncs its page whenever it is saved;
   * running it repeats that sync on demand. It is one page, not a walk over
   * resources, so it always finishes in a single pass.
   */
  private static async syncStatusPageMonitorRule(
    data: RuleRunPassData,
  ): Promise<RuleRunPassResult> {
    const rule: StatusPageMonitorRule | null =
      await StatusPageMonitorRuleService.findOneBy({
        query: {
          _id: data.ruleId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          isEnabled: true,
        },
        props: { isRoot: true },
      });

    RuleRunner.assertRuleCanRun({
      rule: rule,
      action: RuleRunAction.SyncStatusPageMonitors,
    });

    const sync: StatusPageMonitorRuleSyncResult =
      await StatusPageMonitorRuleEngineService.syncResourcesForRule({
        statusPageMonitorRuleId: data.ruleId,
      });

    return {
      ...RuleRunResultUtil.emptyCounts(),
      resourcesUpdated: sync.statusPageResourceIdsUpdated.length,
      itemsAdded: sync.monitorIdsAdded.length,
      itemsRemoved: sync.statusPageResourceIdsRemoved.length,
      nextCursor: null,
      ownersNotified: false,
    };
  }
}
