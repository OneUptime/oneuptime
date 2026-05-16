import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodePrivacyRule from "../../Models/DatabaseModels/AlertEpisodePrivacyRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import AlertEpisodePrivacyRuleService from "./AlertEpisodePrivacyRuleService";
import AlertEpisodeService from "./AlertEpisodeService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
import { Red500 } from "../../Types/BrandColors";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertEpisodePrivacyRuleEngineServiceClass {
  /**
   * Evaluates AlertEpisodePrivacyRule rows for the given episode. If any
   * enabled rule matches, the episode is marked private (isPrivate=true).
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: AlertEpisode): Promise<boolean> {
    if (!episode.id || !episode.projectId) {
      return false;
    }

    if (episode.isPrivate === true) {
      return false;
    }

    try {
      const rules: Array<AlertEpisodePrivacyRule> =
        await AlertEpisodePrivacyRuleService.findBy({
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
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return false;
      }

      const matchedRules: Array<AlertEpisodePrivacyRule> = [];
      for (const rule of rules) {
        if (this.doesEpisodeMatchRule(episode, rule)) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return false;
      }

      await AlertEpisodeService.updateOneById({
        id: episode.id,
        data: { isPrivate: true },
        props: { isRoot: true },
      });

      episode.isPrivate = true;

      logger.debug(
        `AlertEpisodePrivacyRuleEngine marked episode ${episode.id} private`,
        { projectId: episode.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({ episode, matchedRules });

      return true;
    } catch (error) {
      logger.error(`Error applying alert episode privacy rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        alertEpisodeId: episode.id?.toString(),
      } as LogAttributes);
      return false;
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: AlertEpisode;
    matchedRules: Array<AlertEpisodePrivacyRule>;
  }): Promise<void> {
    const { episode, matchedRules } = data;
    if (!episode.id || !episode.projectId || matchedRules.length === 0) {
      return;
    }

    try {
      const ruleNames: Array<string> = matchedRules
        .map((r: AlertEpisodePrivacyRule) => {
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

      const feedInfoInMarkdown: string = `🔒 **Alert Episode Privacy Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nEpisode has been marked **private** — visible only to its owners, project admins, and project owners.`;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id,
        projectId: episode.projectId,
        alertEpisodeFeedEventType:
          AlertEpisodeFeedEventType.PrivacyRuleExecuted,
        displayColor: Red500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `AlertEpisodePrivacyRuleEngine: failed to create feed item: ${
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
    rule: AlertEpisodePrivacyRule,
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
    rule: AlertEpisodePrivacyRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in alert episode privacy rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertEpisodePrivacyRuleEngineServiceClass();
