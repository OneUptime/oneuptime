import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import CloudAccount from "../../../Models/DatabaseModels/CloudAccount";
import CloudConnection from "../../../Models/DatabaseModels/CloudConnection";
import CloudCostRecommendation from "../../../Models/DatabaseModels/CloudCostRecommendation";
import CloudSavingsAction from "../../../Models/DatabaseModels/CloudSavingsAction";
import Project from "../../../Models/DatabaseModels/Project";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import IsNull from "../../../Types/BaseDatabase/IsNull";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import {
  CLOUD_SAVINGS_AI_REASON_SENTENCES,
  CLOUD_SAVINGS_AI_SAVINGS_PER_READ,
  CloudSavingsAiAutonomy,
  CloudSavingsAiDecision,
  CloudSavingsAiRuleFacts,
  decideCloudSavingsAi,
} from "../../../Types/Cloud/CloudSavingsAi";
import {
  CloudSavingsActionOrigin,
  CloudSavingsActionPlan,
  CloudSavingsActionStatus,
  getCloudSavingsActionUndo,
} from "../../../Types/Cloud/CloudSavingsAction";
import { CloudSavingsConnectionState } from "../../../Types/Cloud/CloudSavingsApiTypes";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import AutoRemediationRuleService from "../../Services/AutoRemediationRuleService";
import CloudCostRecommendationService from "../../Services/CloudCostRecommendationService";
import CloudSavingsActionService from "../../Services/CloudSavingsActionService";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";
import CloudSavingsActions, { CloudSavingContext } from "./CloudSavingsActions";

/*
 * ONEUPTIME AI ON A PROJECT'S SAVINGS (#11010): after each read of an
 * account's savings (CloudConnectionLanes' savings lane), every saving it
 * could act on is decided by the project's AI rules for savings
 * (Types/Cloud/CloudSavingsAi): proposed to an owner of the resource, made
 * without asking, or left alone. With no rule, every one is proposed.
 *
 * Only what OneUptime could make goes through: a saving whose change is
 * one step (CloudSavingsAction), through a connection whose Savings
 * actions allow it. A saving already waiting or under way is not asked
 * again, nor one a person dismissed in the last 30 days. A proposal of a
 * saving the recommender stopped making expires.
 *
 * With Enable AI off, nothing is proposed or made on its own; Apply still
 * works. A change made without asking is never made here: it is created
 * Applying, and the worker takes it through its steps
 * (CloudSavingsActionRunner), so a read never waits on a cloud's change.
 */

/*
 * A saving a person said no to - dismissed, or undone - is not proposed or
 * made again for this long; nor one whose change failed, so a refusal is
 * not asked again every read.
 */
export const CLOUD_SAVINGS_AI_DISMISSED_QUIET_DAYS: number = 30;

// The statuses a saving is not proposed again in: open, in effect, or said no to lately.
const NOT_AGAIN: Array<CloudSavingsActionStatus> = [
  CloudSavingsActionStatus.Proposed,
  CloudSavingsActionStatus.Applying,
  CloudSavingsActionStatus.Undoing,
  CloudSavingsActionStatus.Applied,
  CloudSavingsActionStatus.AppliedWithoutAsking,
  CloudSavingsActionStatus.Dismissed,
  CloudSavingsActionStatus.Undone,
  CloudSavingsActionStatus.Failed,
];

// When a change that keeps its saving quiet ended: dismissed, undone or failed.
export function getCloudSavingsQuietSince(
  action: CloudSavingsAction,
): Date | null {
  const at: Date | undefined =
    action.status === CloudSavingsActionStatus.Dismissed
      ? action.dismissedAt
      : action.status === CloudSavingsActionStatus.Undone
        ? action.undoneAt
        : action.status === CloudSavingsActionStatus.Failed
          ? action.failedAt
          : undefined;

  return at ? new Date(at) : null;
}

/*
 * Whether a saving with these earlier changes is left alone this time: one
 * is open or stands, or one was said no to (or failed) in the quiet days.
 */
export function isCloudSavingQuiet(data: {
  earlier: Array<CloudSavingsAction>;
  now: Date;
}): boolean {
  const quietSince: Date = OneUptimeDate.addRemoveDays(
    data.now,
    -CLOUD_SAVINGS_AI_DISMISSED_QUIET_DAYS,
  );

  return data.earlier.some((action: CloudSavingsAction): boolean => {
    if (
      action.status !== CloudSavingsActionStatus.Dismissed &&
      action.status !== CloudSavingsActionStatus.Undone &&
      action.status !== CloudSavingsActionStatus.Failed
    ) {
      return true;
    }

    const endedAt: Date | null = getCloudSavingsQuietSince(action);

    // One with no date is read as just now: never asked again by mistake.
    return !endedAt || endedAt.getTime() >= quietSince.getTime();
  });
}

export interface CloudSavingsAiOutcome {
  proposed: number;
  madeWithoutAsking: number;
  expired: number;
}

export default class CloudSavingsAiEngine {
  // The project's enabled AI rules for savings, or null when they could not be read.
  public static async readRules(
    projectId: ObjectID,
  ): Promise<Array<CloudSavingsAiRuleFacts> | null> {
    try {
      const rules: Array<AutoRemediationRule> =
        await AutoRemediationRuleService.findBy({
          query: {
            projectId,
            isEnabled: true,
            triggerEntityType: AutoRemediationTriggerEntity.CloudSaving,
          },
          select: {
            _id: true,
            name: true,
            cloudSavingAutonomy: true,
            cloudSavingActionGroups: true,
            cloudSavingEnvironments: true,
            cloudSavingProviders: true,
            cloudSavingMonthlyLimit: true,
          },
          sort: { name: SortOrder.Ascending },
          skip: 0,
          limit: 100,
          props: { isRoot: true },
        });

      return rules.map((rule: AutoRemediationRule): CloudSavingsAiRuleFacts => {
        return {
          _id: rule.id?.toString(),
          name: rule.name,
          cloudSavingAutonomy: rule.cloudSavingAutonomy,
          cloudSavingActionGroups: rule.cloudSavingActionGroups,
          cloudSavingEnvironments: rule.cloudSavingEnvironments,
          cloudSavingProviders: rule.cloudSavingProviders,
          cloudSavingMonthlyLimit: rule.cloudSavingMonthlyLimit,
        };
      });
    } catch (error) {
      logger.error(
        `Cloud savings AI: the rules of project ${projectId.toString()} could not be read: ${error}`,
      );
      return null;
    }
  }

  // Changes OneUptime AI made without asking in the project in the last hour.
  public static async countChangesWithoutAskingThisHour(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<number> {
    return (
      await CloudSavingsActionService.countBy({
        query: {
          projectId: data.projectId,
          origin: CloudSavingsActionOrigin.Rule,
          approvedByUserId: new IsNull(),
          status: new Includes([
            CloudSavingsActionStatus.Applying,
            CloudSavingsActionStatus.AppliedWithoutAsking,
            CloudSavingsActionStatus.Failed,
            CloudSavingsActionStatus.Undoing,
            CloudSavingsActionStatus.Undone,
          ]),
          createdAt: new GreaterThanOrEqual(
            OneUptimeDate.addRemoveHours(data.now, -1),
          ),
        },
        props: { isRoot: true },
      })
    ).toNumber();
  }

  /*
   * The savings of the accounts a read just kept, decided. Never throws:
   * the read is kept either way.
   */
  public static async evaluateAccounts(data: {
    projectId: ObjectID;
    cloudAccountIds: Array<ObjectID>;
    now: Date;
  }): Promise<CloudSavingsAiOutcome> {
    const outcome: CloudSavingsAiOutcome = {
      proposed: 0,
      madeWithoutAsking: 0,
      expired: 0,
    };

    if (data.cloudAccountIds.length === 0) {
      return outcome;
    }

    try {
      const recommendations: Array<CloudCostRecommendation> =
        await CloudCostRecommendationService.findBy({
          query: {
            projectId: data.projectId,
            cloudAccountId: new Includes(data.cloudAccountIds),
          },
          select: {
            _id: true,
            projectId: true,
            cloudAccountId: true,
            cloudResourceId: true,
            provider: true,
            recommendationId: true,
            region: true,
            resourceId: true,
            resourceType: true,
            resourceName: true,
            kind: true,
            action: true,
            currentConfiguration: true,
            recommendedConfiguration: true,
            monthlySavings: true,
            currency: true,
          },
          sort: { monthlySavings: SortOrder.Descending },
          skip: 0,
          limit: LIMIT_MAX,
          props: { isRoot: true },
        });

      outcome.expired = await CloudSavingsActions.expireGone({
        projectId: data.projectId,
        cloudAccountIds: data.cloudAccountIds,
        currentRecommendationIds: new Set<string>(
          recommendations
            .map((recommendation: CloudCostRecommendation): string => {
              return recommendation.recommendationId || "";
            })
            .filter(Boolean),
        ),
        now: data.now,
      });

      const project: Project | null = await ProjectService.findOneById({
        id: data.projectId,
        select: { enableAi: true },
        props: { isRoot: true },
      });

      if (!project?.enableAi) {
        return outcome;
      }

      const rules: Array<CloudSavingsAiRuleFacts> | null =
        await CloudSavingsAiEngine.readRules(data.projectId);

      // Rules that could not be read decide nothing: no rule may be kept out.
      if (rules === null) {
        return outcome;
      }

      await CloudSavingsAiEngine.decideEach({
        projectId: data.projectId,
        recommendations,
        rules,
        now: data.now,
        outcome,
      });
    } catch (error) {
      logger.error(
        `Cloud savings AI: the savings of project ${data.projectId.toString()} could not be decided: ${error}`,
      );
    }

    return outcome;
  }

  private static async decideEach(data: {
    projectId: ObjectID;
    recommendations: Array<CloudCostRecommendation>;
    rules: Array<CloudSavingsAiRuleFacts>;
    now: Date;
    outcome: CloudSavingsAiOutcome;
  }): Promise<void> {
    const accounts: Map<string, CloudAccount> = new Map();
    const connections: Map<string, CloudConnection | null> = new Map();
    let changesThisHour: number =
      await CloudSavingsAiEngine.countChangesWithoutAskingThisHour({
        projectId: data.projectId,
        now: data.now,
      });
    let decided: number = 0;

    for (const recommendation of data.recommendations) {
      if (decided >= CLOUD_SAVINGS_AI_SAVINGS_PER_READ) {
        return;
      }

      if (!recommendation.recommendationId || !recommendation.cloudAccountId) {
        continue;
      }

      const saving: CloudSavingContext = await CloudSavingsActions.readSavingOf(
        {
          projectId: data.projectId,
          recommendation,
          accounts,
          connections,
        },
      );
      const plan: CloudSavingsActionPlan | undefined = saving.planResult.plan;

      if (
        !plan ||
        saving.connectionState !== CloudSavingsConnectionState.Ready
      ) {
        continue;
      }

      const earlier: Array<CloudSavingsAction> =
        await CloudSavingsActionService.findBy({
          query: {
            projectId: data.projectId,
            cloudAccountId: recommendation.cloudAccountId,
            recommendationId: recommendation.recommendationId,
            status: new Includes(NOT_AGAIN),
          },
          select: {
            _id: true,
            status: true,
            dismissedAt: true,
            undoneAt: true,
            failedAt: true,
          },
          // The latest: an old no never hides a newer change.
          sort: { createdAt: SortOrder.Descending },
          skip: 0,
          limit: 5,
          props: { isRoot: true },
        });

      if (isCloudSavingQuiet({ earlier, now: data.now })) {
        continue;
      }

      decided++;

      const decision: CloudSavingsAiDecision = decideCloudSavingsAi({
        rules: data.rules,
        saving: {
          provider: recommendation.provider || "",
          kind: plan.kind,
          environment: saving.environment.environment,
          monthlySavings: Number(recommendation.monthlySavings) || 0,
          // A rule's delete of a disk always takes its final snapshot first.
          undo: getCloudSavingsActionUndo({
            kind: plan.kind,
            finalSnapshot: true,
          }),
        },
        changesWithoutAskingThisHour: changesThisHour,
      });
      const rule: { id?: string | undefined; name?: string | undefined } = {
        id: decision.ruleId,
        name: decision.ruleName,
      };

      if (decision.autonomy === CloudSavingsAiAutonomy.Suggest) {
        await CloudSavingsActions.propose({
          projectId: data.projectId,
          saving,
          rule,
          reason: CLOUD_SAVINGS_AI_REASON_SENTENCES[decision.reason],
        });
        data.outcome.proposed++;
      } else if (decision.autonomy === CloudSavingsAiAutonomy.WithoutAsking) {
        await CloudSavingsActions.makeWithoutAsking({
          projectId: data.projectId,
          saving,
          rule,
          now: data.now,
        });
        data.outcome.madeWithoutAsking++;
        changesThisHour++;
      }
    }
  }
}
