import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOnCallRule from "../../Models/DatabaseModels/AlertEpisodeOnCallRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import AlertEpisodeOnCallRuleService from "./AlertEpisodeOnCallRuleService";
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

      for (const rule of rules) {
        if (!this.doesEpisodeMatchRule(episode, rule)) {
          continue;
        }
        for (const policy of rule.onCallDutyPolicies || []) {
          const policyId: string | undefined = policy.id?.toString();
          if (policyId && !matchedPolicies.has(policyId)) {
            matchedPolicies.set(policyId, policy);
          }
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
      for (const [policyId, policy] of matchedPolicies) {
        if (!existingIds.has(policyId)) {
          merged.push(policy);
        }
      }
      episode.onCallDutyPolicies = merged;

      logger.debug(
        `AlertEpisodeOnCallRuleEngine merged ${matchedPolicies.size} matched policies into episode ${episode.id}`,
        { projectId: episode.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying alert episode on-call rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        alertEpisodeId: episode.id?.toString(),
      } as LogAttributes);
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
