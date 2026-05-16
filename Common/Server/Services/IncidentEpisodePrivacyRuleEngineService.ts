import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePrivacyRule from "../../Models/DatabaseModels/IncidentEpisodePrivacyRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentEpisodePrivacyRuleService from "./IncidentEpisodePrivacyRuleService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Red500 } from "../../Types/BrandColors";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncidentEpisodePrivacyRuleEngineServiceClass {
  /**
   * Evaluates IncidentEpisodePrivacyRule rows for the given episode. If any
   * enabled rule matches, the episode is marked private (isPrivate=true) and
   * the passed-in episode object is mutated in place so downstream callers
   * see the update.
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: IncidentEpisode): Promise<boolean> {
    if (!episode.id || !episode.projectId) {
      return false;
    }

    if (episode.isPrivate === true) {
      return false;
    }

    try {
      const rules: Array<IncidentEpisodePrivacyRule> =
        await IncidentEpisodePrivacyRuleService.findBy({
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
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return false;
      }

      const matchedRules: Array<IncidentEpisodePrivacyRule> = [];
      for (const rule of rules) {
        if (this.doesEpisodeMatchRule(episode, rule)) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return false;
      }

      await IncidentEpisodeService.updateOneById({
        id: episode.id,
        data: { isPrivate: true },
        props: { isRoot: true },
      });

      episode.isPrivate = true;

      logger.debug(
        `IncidentEpisodePrivacyRuleEngine marked episode ${episode.id} private`,
        { projectId: episode.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({ episode, matchedRules });

      return true;
    } catch (error) {
      logger.error(`Error applying incident episode privacy rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      } as LogAttributes);
      return false;
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: IncidentEpisode;
    matchedRules: Array<IncidentEpisodePrivacyRule>;
  }): Promise<void> {
    const { episode, matchedRules } = data;
    if (!episode.id || !episode.projectId || matchedRules.length === 0) {
      return;
    }

    try {
      const ruleNames: Array<string> = matchedRules
        .map((r: IncidentEpisodePrivacyRule) => {
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

      const feedInfoInMarkdown: string = `🔒 **Incident Episode Privacy Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nEpisode has been marked **private** — visible only to its owners, project admins, and project owners.`;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id,
        projectId: episode.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.PrivacyRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `IncidentEpisodePrivacyRuleEngine: failed to create feed item: ${
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
    rule: IncidentEpisodePrivacyRule,
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
    rule: IncidentEpisodePrivacyRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incident episode privacy rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentEpisodePrivacyRuleEngineServiceClass();
