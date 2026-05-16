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
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertEpisodeOnCallRuleEngineServiceClass {
  /**
   * Evaluates AlertEpisodeOnCallRule rows for the given episode and merges
   * matched rules' on-call policies into the episode's onCallDutyPolicies
   * array (deduped).
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: AlertEpisode): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
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
            alertSeverities: { _id: true },
            episodeLabels: { _id: true },
            episodeTitlePattern: true,
            episodeDescriptionPattern: true,
            onCallDutyPolicies: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const matchedPolicies: Map<string, OnCallDutyPolicy> = new Map();
      const matchedRules: Array<AlertEpisodeOnCallRule> = [];

      for (const rule of rules) {
        if (!this.doesEpisodeMatchRule(episode, rule)) {
          continue;
        }
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

      if (matchedPolicies.size === 0) {
        return;
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
    } catch (error) {
      logger.error(`Error applying alert episode on-call rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        alertEpisodeId: episode.id?.toString(),
      } as LogAttributes);
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

      const rulesPart: string =
        ruleNames.length === 1
          ? `**${ruleNames[0]}**`
          : ruleNames
              .map((n: string) => {
                return `**${n}**`;
              })
              .join(", ");

      const policiesPart: string =
        policyNames.length > 0
          ? policyNames
              .map((n: string) => {
                return `\n- ${n}`;
              })
              .join("")
          : "\n- (no named policies)";

      const feedInfoInMarkdown: string = `📞 **Alert Episode On-Call Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAttached the following on-call ${
        policyNames.length === 1 ? "policy" : "policies"
      } to the episode:${policiesPart}`;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id,
        projectId: episode.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OnCallRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
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
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in alert episode on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertEpisodeOnCallRuleEngineServiceClass();
