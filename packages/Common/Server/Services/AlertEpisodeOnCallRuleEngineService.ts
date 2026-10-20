import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOnCallRule from "../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import AlertEpisodeOnCallRuleService from "./AlertEpisodeOnCallRuleService";
import AlertEpisodeService from "./AlertEpisodeService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import OnCallRulePolicyScope from "../Utils/Rules/OnCallRulePolicyScope";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";
import {
  ON_CALL_RULE_WHEN_TO_PAGE_SELECT,
  OnCallRulePagingHold,
  OnCallRulePagingHolds,
} from "../Utils/OnCall/OnCallRulePagingHold";

class AlertEpisodeOnCallRuleEngineServiceClass {
  /**
   * Evaluates AlertEpisodeOnCallRule rows for the given episode and merges
   * matched rules' on-call policies into the episode's onCallDutyPolicies
   * array (deduped).
   *
   * Hands back the holds of the policies it added that may not page yet: a
   * rule that pages only during working hours, matched outside them, holds
   * its policies until they begin (OnCallRulePagingHold). The fan-out passes
   * each to executePolicy. A policy with no hold pages right away.
   */
  @CaptureSpan()
  @RuleEvaluation()
  public async applyRulesToEpisode(
    episode: AlertEpisode,
  ): Promise<Map<string, OnCallRulePagingHold>> {
    const noHolds: Map<string, OnCallRulePagingHold> = new Map<
      string,
      OnCallRulePagingHold
    >();

    if (!episode.id || !episode.projectId) {
      return noHolds;
    }

    try {
      const rules: Array<AlertEpisodeOnCallRule> =
        await AlertEpisodeOnCallRuleService.findBy({
          query: {
            projectId: episode.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            criteria: true,
            alertSeverities: { _id: true },
            episodeLabels: { _id: true },
            episodeTitlePattern: true,
            episodeDescriptionPattern: true,
            onCallDutyPolicies: { _id: true },
            ...ON_CALL_RULE_WHEN_TO_PAGE_SELECT,
          },
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "AlertEpisodeOnCallRule",
        projectId: episode.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return noHolds;
      }

      const matchedPolicies: Map<string, OnCallDutyPolicy> = new Map();
      const matchedRules: Array<AlertEpisodeOnCallRule> = [];
      // When each matched rule lets its policies page: right away wins.
      const pagingHolds: OnCallRulePagingHolds = new OnCallRulePagingHolds();

      for (const rule of rules) {
        if (!this.doesEpisodeMatchRule(episode, rule)) {
          continue;
        }

        pagingHolds.addRule(
          rule,
          (rule.onCallDutyPolicies || []).map(
            (policy: OnCallDutyPolicy): string => {
              return policy.id?.toString() || "";
            },
          ),
        );

        let ruleAddedAny: boolean = false;
        for (const policy of rule.onCallDutyPolicies || []) {
          const policyId: string | undefined = policy.id?.toString();
          if (policyId && !matchedPolicies.has(policyId)) {
            matchedPolicies.set(policyId, policy);
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      // Only the project's own policies are ever paged (see OnCallRulePolicyScope).
      await OnCallRulePolicyScope.keepPoliciesInProject({
        projectId: episode.projectId,
        matchedPolicies: matchedPolicies,
        matchedRules: matchedRules,
        ruleKind: "Alert episode on-call",
        logAttributes: {
          projectId: episode.projectId.toString(),
          alertEpisodeId: episode.id.toString(),
        } as LogAttributes,
      });

      if (matchedPolicies.size === 0) {
        return noHolds;
      }

      const existingIds: Set<string> = new Set(
        (episode.onCallDutyPolicies || [])
          .map((p: OnCallDutyPolicy) => {
            return p.id?.toString() || (p as { _id?: string })._id || "";
          })
          .filter((id: string) => {
            return id !== "";
          }),
      );

      const merged: Array<OnCallDutyPolicy> = [
        ...(episode.onCallDutyPolicies || []),
      ];
      const toAddIds: Array<string> = [];
      for (const [policyId, policy] of matchedPolicies) {
        if (!existingIds.has(policyId)) {
          merged.push(policy);
          toAddIds.push(policyId);
        }
      }
      // Update in-memory list so the existing fan-out runs the merged set.
      episode.onCallDutyPolicies = merged;

      // Persist new join rows so the episode detail UI shows them.
      if (toAddIds.length > 0) {
        try {
          await AlertEpisodeService.getRepository()
            .createQueryBuilder()
            .relation(AlertEpisode, "onCallDutyPolicies")
            .of(episode.id.toString())
            .add(toAddIds);
        } catch (err) {
          logger.warn(
            `AlertEpisodeOnCallRuleEngine: failed to persist join rows for episode ${episode.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      logger.debug(
        `AlertEpisodeOnCallRuleEngine merged ${matchedPolicies.size} matched policies into episode ${episode.id}`,
        { projectId: episode.projectId.toString() } as LogAttributes,
      );

      if (toAddIds.length > 0) {
        await this.createRuleExecutedFeedItem({
          episode,
          matchedRules,
          addedPolicyIds: toAddIds,
        });
      }

      // A policy the episode had already pages as it always has: right away.
      return pagingHolds.getHolds(toAddIds);
    } catch (error) {
      logger.error(`Error applying alert episode on-call rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        alertEpisodeId: episode.id?.toString(),
      } as LogAttributes);

      return noHolds;
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: AlertEpisode;
    matchedRules: Array<AlertEpisodeOnCallRule>;
    addedPolicyIds: Array<string>;
  }): Promise<void> {
    const { episode, matchedRules, addedPolicyIds } = data;
    if (
      !episode.id ||
      !episode.projectId ||
      matchedRules.length === 0 ||
      addedPolicyIds.length === 0
    ) {
      return;
    }

    try {
      const policyObjectIds: Array<ObjectID> = addedPolicyIds.map(
        (id: string) => {
          return new ObjectID(id);
        },
      );

      const policies: Array<OnCallDutyPolicy> =
        await OnCallDutyPolicyService.findBy({
          query: {
            _id: QueryHelper.any(policyObjectIds),
          },
          select: { name: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        });

      const policyNames: Array<string> = policies
        .map((p: OnCallDutyPolicy) => {
          return p.name?.toString() || "";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const ruleNames: Array<string> = matchedRules
        .map((r: AlertEpisodeOnCallRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "📞",
          ruleKind: "Alert Episode On-Call Rule",
          ruleNames: ruleNames,
        },
      )}\n\nAttached the following on-call ${
        policyNames.length === 1 ? "policy" : "policies"
      } to the episode:\n${FeedMarkdown.bulletList(policyNames, {
        whenEmpty: "(no named policies)",
      })}`;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id,
        projectId: episode.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OnCallRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertEpisodeOnCallRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: episode.projectId?.toString(),
          alertEpisodeId: episode.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  private doesEpisodeMatchRule(
    episode: AlertEpisode,
    rule: AlertEpisodeOnCallRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "alertSeverities",
        "episodeLabels",
        "episodeTitlePattern",
        "episodeDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: AlertEpisodeOnCallRule): boolean => {
        return this.doesEpisodeMatchLegacyRule(episode, legacyRule);
      },
    });
  }

  private doesEpisodeMatchLegacyRule(
    episode: AlertEpisode,
    rule: AlertEpisodeOnCallRule,
  ): boolean {
    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!episode.alertSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.alertSeverities.map(
        (s: AlertSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(episode.alertSeverityId.toString())) {
        return false;
      }
    }

    if (rule.episodeLabels && rule.episodeLabels.length > 0) {
      if (!episode.labels || episode.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.episodeLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const episodeLabelIds: Array<string> = episode.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return episodeLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.episodeTitlePattern &&
      (!episode.title ||
        !this.testRegex(rule.episodeTitlePattern, episode.title, rule))
    ) {
      return false;
    }

    if (
      rule.episodeDescriptionPattern &&
      (!episode.description ||
        !this.testRegex(
          rule.episodeDescriptionPattern,
          episode.description,
          rule,
        ))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertEpisodeOnCallRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in alert episode on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertEpisodeOnCallRuleEngineServiceClass();
