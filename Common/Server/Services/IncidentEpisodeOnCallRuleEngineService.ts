import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOnCallRule from "../../Models/DatabaseModels/IncidentEpisodeOnCallRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentEpisodeOnCallRuleService from "./IncidentEpisodeOnCallRuleService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncidentEpisodeOnCallRuleEngineServiceClass {
  /**
   * Evaluates IncidentEpisodeOnCallRule rows for the given episode and merges
   * matched rules' on-call policies into the episode's onCallDutyPolicies
   * array (deduped). The episode service's existing on-call fan-out then runs
   * the merged list, so each policy executes at most once per episode.
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: IncidentEpisode): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentEpisodeOnCallRule> =
        await IncidentEpisodeOnCallRuleService.findBy({
          query: {
            projectId: episode.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            incidentSeverities: { _id: true },
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
      const matchedRules: Array<IncidentEpisodeOnCallRule> = [];

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
          await IncidentEpisodeService.getRepository()
            .createQueryBuilder()
            .relation(IncidentEpisode, "onCallDutyPolicies")
            .of(episode.id.toString())
            .add(toAddIds);
        } catch (err) {
          logger.warn(
            `IncidentEpisodeOnCallRuleEngine: failed to persist join rows for episode ${episode.id}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      logger.debug(
        `IncidentEpisodeOnCallRuleEngine merged ${matchedPolicies.size} matched policies into episode ${episode.id}`,
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
      logger.error(`Error applying incident episode on-call rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: IncidentEpisode;
    matchedRules: Array<IncidentEpisodeOnCallRule>;
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
        .map((r: IncidentEpisodeOnCallRule) => {
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

      const feedInfoInMarkdown: string = `📞 **Incident Episode On-Call Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAttached the following on-call ${
        policyNames.length === 1 ? "policy" : "policies"
      } to the episode:${policiesPart}`;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id,
        projectId: episode.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OnCallRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `IncidentEpisodeOnCallRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: episode.projectId?.toString(),
          incidentEpisodeId: episode.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  private doesEpisodeMatchRule(
    episode: IncidentEpisode,
    rule: IncidentEpisodeOnCallRule,
  ): boolean {
    if (rule.incidentSeverities && rule.incidentSeverities.length > 0) {
      if (!episode.incidentSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.incidentSeverities.map(
        (s: IncidentSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(episode.incidentSeverityId.toString())) {
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
    rule: IncidentEpisodeOnCallRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incident episode on-call rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentEpisodeOnCallRuleEngineServiceClass();
