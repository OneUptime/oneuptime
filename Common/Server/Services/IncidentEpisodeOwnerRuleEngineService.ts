import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerRule from "../../Models/DatabaseModels/IncidentEpisodeOwnerRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentEpisodeOwnerRuleService from "./IncidentEpisodeOwnerRuleService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class IncidentEpisodeOwnerRuleEngineServiceClass {
  /**
   * Evaluates IncidentEpisodeOwnerRule rows for the given episode and adds
   * matched owner users / teams via IncidentEpisodeService.addOwners.
   * The episode service's addOwners dedupes against existing owners.
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: IncidentEpisode): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentEpisodeOwnerRule> =
        await IncidentEpisodeOwnerRuleService.findBy({
          query: {
            projectId: episode.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            incidentSeverities: { _id: true },
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

      const userIds: Set<string> = new Set();
      const teamIds: Set<string> = new Set();
      const matchedRules: Array<IncidentEpisodeOwnerRule> = [];

      /*
       * Episode addOwners doesn't take a notify flag — it always adds silently
       * and lets downstream notification code decide. We still respect the
       * per-rule notifyOwners as advisory metadata for future use, but for
       * now we just add owners regardless.
       */
      for (const rule of rules) {
        if (!this.doesEpisodeMatchRule(episode, rule)) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            userIds.add(user.id.toString());
            ruleAddedAny = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamIds.add(team.id.toString());
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      if (
        matchedRules.length === 0 ||
        (userIds.size === 0 && teamIds.size === 0)
      ) {
        return;
      }

      await IncidentEpisodeService.addOwners({
        episodeId: episode.id,
        projectId: episode.projectId,
        userIds: Array.from(userIds).map((id: string) => {
          return new ObjectID(id);
        }),
        teamIds: Array.from(teamIds).map((id: string) => {
          return new ObjectID(id);
        }),
      });

      logger.debug(
        `IncidentEpisodeOwnerRuleEngine added owners to episode ${episode.id}`,
        { projectId: episode.projectId.toString() } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({
        episode,
        matchedRules,
        userIds: Array.from(userIds),
        teamIds: Array.from(teamIds),
      });
    } catch (error) {
      logger.error(`Error applying incident episode owner rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: IncidentEpisode;
    matchedRules: Array<IncidentEpisodeOwnerRule>;
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<void> {
    const { episode, matchedRules, userIds, teamIds } = data;
    if (
      !episode.id ||
      !episode.projectId ||
      matchedRules.length === 0 ||
      (userIds.length === 0 && teamIds.length === 0)
    ) {
      return;
    }

    try {
      const userObjectIds: Array<ObjectID> = userIds.map((id: string) => {
        return new ObjectID(id);
      });
      const teamObjectIds: Array<ObjectID> = teamIds.map((id: string) => {
        return new ObjectID(id);
      });

      const [users, teams]: [Array<User>, Array<Team>] = await Promise.all([
        userObjectIds.length > 0
          ? UserService.findBy({
              query: { _id: QueryHelper.any(userObjectIds) },
              select: { name: true, email: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<User>),
        teamObjectIds.length > 0
          ? TeamService.findBy({
              query: { _id: QueryHelper.any(teamObjectIds) },
              select: { name: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            })
          : Promise.resolve([] as Array<Team>),
      ]);

      const userLines: Array<string> = users.map((u: User) => {
        const display: string =
          u.name?.toString() || u.email?.toString() || "Unknown User";
        return `\n- 👤 ${display}`;
      });
      const teamLines: Array<string> = teams.map((t: Team) => {
        return `\n- 👥 ${t.name?.toString() || "Unnamed Team"}`;
      });

      const ruleNames: Array<string> = matchedRules
        .map((r: IncidentEpisodeOwnerRule) => {
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

      const ownersPart: string =
        userLines.length + teamLines.length > 0
          ? userLines.concat(teamLines).join("")
          : "\n- (no named owners)";

      const feedInfoInMarkdown: string = `🛡️ **Incident Episode Owner Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAssigned the following owner${
        userLines.length + teamLines.length === 1 ? "" : "s"
      } to the episode:${ownersPart}`;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id,
        projectId: episode.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `IncidentEpisodeOwnerRuleEngine: failed to create rule-executed feed item: ${
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
    rule: IncidentEpisodeOwnerRule,
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
    rule: IncidentEpisodeOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in incident episode owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentEpisodeOwnerRuleEngineServiceClass();
