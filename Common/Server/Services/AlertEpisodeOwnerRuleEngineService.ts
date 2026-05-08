import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerRule from "../../Models/DatabaseModels/AlertEpisodeOwnerRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import AlertEpisodeOwnerRuleService from "./AlertEpisodeOwnerRuleService";
import AlertEpisodeService from "./AlertEpisodeService";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertEpisodeOwnerRuleEngineServiceClass {
  /**
   * Evaluates AlertEpisodeOwnerRule rows for the given episode and adds
   * matched owner users / teams via AlertEpisodeService.addOwners. Honors
   * each rule's notifyOwners setting (added owners are notified or silent).
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: AlertEpisode): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    try {
      const rules: Array<AlertEpisodeOwnerRule> =
        await AlertEpisodeOwnerRuleService.findBy({
          query: {
            projectId: episode.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            alertSeverities: { _id: true },
            episodeLabels: { _id: true },
            episodeTitlePattern: true,
            episodeDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
      }

      const usersByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      const teamsByNotify: Map<boolean, Set<string>> = new Map([
        [true, new Set()],
        [false, new Set()],
      ]);
      let matchedAny: boolean = false;

      for (const rule of rules) {
        if (!this.doesEpisodeMatchRule(episode, rule)) {
          continue;
        }
        matchedAny = true;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
          }
        }
      }

      if (!matchedAny) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Array<ObjectID> = Array.from(
          usersByNotify.get(notify)!,
        ).map((id: string) => {
          return new ObjectID(id);
        });
        const teamIds: Array<ObjectID> = Array.from(
          teamsByNotify.get(notify)!,
        ).map((id: string) => {
          return new ObjectID(id);
        });

        if (userIds.length === 0 && teamIds.length === 0) {
          continue;
        }

        await AlertEpisodeService.addOwners(
          episode.projectId,
          episode.id,
          userIds,
          teamIds,
          notify,
          { isRoot: true },
        );
      }

      logger.debug(
        `AlertEpisodeOwnerRuleEngine added owners to episode ${episode.id}`,
        { projectId: episode.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying alert episode owner rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        alertEpisodeId: episode.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesEpisodeMatchRule(
    episode: AlertEpisode,
    rule: AlertEpisodeOwnerRule,
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
    rule: AlertEpisodeOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in alert episode owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertEpisodeOwnerRuleEngineServiceClass();
