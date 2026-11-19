import IncidentEpisode from "../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeOwnerRule from "../../Models/DatabaseModels/IncidentEpisodeOwnerRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import IncidentEpisodeFeedService from "./IncidentEpisodeFeedService";
import IncidentEpisodeOwnerRuleService from "./IncidentEpisodeOwnerRuleService";
import IncidentEpisodeOwnerTeamService from "./IncidentEpisodeOwnerTeamService";
import IncidentEpisodeOwnerUserService from "./IncidentEpisodeOwnerUserService";
import IncidentEpisodeService from "./IncidentEpisodeService";
import IncidentEpisodeOwnerTeam from "../../Models/DatabaseModels/IncidentEpisodeOwnerTeam";
import IncidentEpisodeOwnerUser from "../../Models/DatabaseModels/IncidentEpisodeOwnerUser";
import { IncidentEpisodeFeedEventType } from "../../Models/DatabaseModels/IncidentEpisodeFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import OwnerRuleAssignment, {
  OwnersAdded,
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import OwnerRuleFeed from "../Utils/Rules/OwnerRuleFeed";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
  RuleRunWriteProps,
} from "../Utils/Rules/RuleRun/RuleApplication";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import RulePatternMatchUtil from "../../Utils/Rules/RulePatternMatchUtil";
import { RuleEvaluation } from "../Utils/PatternWorkScope";
import OwnerRulePlanBuilder, {
  OwnerRulePlan,
  OwnerRulePlanEntry,
} from "../Utils/Rules/OwnerRulePlan";

class IncidentEpisodeOwnerRuleEngineServiceClass
  implements RuleRunEngine<IncidentEpisode, IncidentEpisodeOwnerRule>
{
  public readonly ruleSelect: Select<IncidentEpisodeOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    incidentSeverities: { _id: true },
    episodeLabels: { _id: true },
    episodeTitlePattern: true,
    episodeDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  /*
   * Evaluation matches on the episode it is handed rather than re-reading it,
   * so a run has to load every field matching looks at.
   */
  public readonly resourceSelectForRuleRun: Select<IncidentEpisode> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    incidentSeverityId: true,
    labels: { _id: true },
  };

  /*
   * The project's enabled rules, as every evaluation of a new episode reads
   * them - the create and the create form's preview alike.
   */
  @CaptureSpan()
  public async getEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<IncidentEpisodeOwnerRule>> {
    const rules: Array<IncidentEpisodeOwnerRule> =
      await IncidentEpisodeOwnerRuleService.findBy({
        query: {
          projectId: projectId,
          isEnabled: true,
        },
        props: { isRoot: true },
        select: this.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });

    logIfRuleReadWasTruncated({
      ruleKind: "IncidentEpisodeOwnerRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

  /**
   * Evaluates IncidentEpisodeOwnerRule rows for the given episode and adds
   * matched owner users / teams. Owners from rules with notifyOwners set are
   * added via IncidentEpisodeService.addOwners and notified; owners from
   * rules with notifyOwners off are added silently.
   */
  @CaptureSpan()
  public async applyRulesToEpisode(episode: IncidentEpisode): Promise<void> {
    if (!episode.id || !episode.projectId) {
      return;
    }

    try {
      const rules: Array<IncidentEpisodeOwnerRule> = await this.getEnabledRules(
        episode.projectId,
      );

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        episode: episode,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying incident episode owner rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        incidentEpisodeId: episode.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an episode that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<
      IncidentEpisode,
      IncidentEpisodeOwnerRule
    >,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        episode: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running incident episode owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        incidentEpisodeId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  /*
   * What the project's owner rules would add to an episode that is not
   * created yet - the one the Create Episode form holds - worked out by the
   * plan the create carries out (planRules), and nothing written.
   */
  @CaptureSpan()
  public async previewRules(
    episode: IncidentEpisode,
  ): Promise<Array<OwnerRulePlanEntry<IncidentEpisodeOwnerRule>>> {
    if (!episode.projectId) {
      return [];
    }

    const rules: Array<IncidentEpisodeOwnerRule> = await this.getEnabledRules(
      episode.projectId,
    );

    if (rules.length === 0) {
      return [];
    }

    const plan: OwnerRulePlan<IncidentEpisodeOwnerRule> = this.planRules({
      episode: episode,
      rules: rules,
      allowOwnerNotification: true,
    });

    return plan.entries;
  }

  /*
   * Which of `rules` match the episode, and who each of them brings
   * (OwnerRulePlan) - read, never written. An episode rule names its owners:
   * it inherits none, and has no creator's team.
   */
  @RuleEvaluation()
  public planRules(data: {
    episode: IncidentEpisode;
    rules: Array<IncidentEpisodeOwnerRule>;
    allowOwnerNotification: boolean;
  }): OwnerRulePlan<IncidentEpisodeOwnerRule> {
    const builder: OwnerRulePlanBuilder<IncidentEpisodeOwnerRule> =
      new OwnerRulePlanBuilder<IncidentEpisodeOwnerRule>(
        data.allowOwnerNotification,
      );

    for (const rule of data.rules) {
      if (!this.doesEpisodeMatchRule(data.episode, rule)) {
        continue;
      }

      builder.addMatch({
        rule: rule,
        notifyOwners: rule.notifyOwners,
        userIds: OwnerRulePlanBuilder.idsOf(rule.ownerUsers),
        teamIds: OwnerRulePlanBuilder.idsOf(rule.ownerTeams),
        listsCreatorTeams: false,
        creatorTeamIds: [],
        inheritsFrom: [],
      });
    }

    return builder.build(new Map());
  }

  private async applyRules(data: {
    episode: IncidentEpisode;
    rules: Array<IncidentEpisodeOwnerRule>;
    allowOwnerNotification: boolean;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { episode, rules } = data;

    if (!episode.id || !episode.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: OwnerRulePlan<IncidentEpisodeOwnerRule> = this.planRules(data);

    if (!plan.anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    const {
      matchedRules,
      usersByNotify,
      teamsByNotify,
      allUserIds,
      allTeamIds,
    } = plan;

    if (
      matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    /*
     * IncidentEpisodeService.addOwners skips existing owners itself, but only
     * silently - filtering first is what lets a run tell "added" from
     * "already there".
     */
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: IncidentEpisodeOwnerUserService,
        ownerTeamService: IncidentEpisodeOwnerTeamService,
        resourceIdColumn: "incidentEpisodeId",
        resourceId: episode.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID) => {
        return id.toString();
      }),
    );

    /*
     * What the adds actually did: the owners written, and the ones skipped
     * and why - a user who has left the project, a team that is not one of
     * its teams (#9933). The feed item, the log lines and the count are
     * made from these, never from the ids the rules asked for.
     */
    const outcome: OwnersAdded = OwnerRuleAssignment.noOwnersAdded();

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string) => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string) => {
        return teamIdsToAdd.delete(id);
      });

      if (userIds.length === 0 && teamIds.length === 0) {
        continue;
      }

      if (notify) {
        OwnerRuleAssignment.addUp(
          outcome,
          await IncidentEpisodeService.addOwners({
            episodeId: episode.id,
            projectId: episode.projectId,
            userIds: userIds.map((id: string) => {
              return new ObjectID(id);
            }),
            teamIds: teamIds.map((id: string) => {
              return new ObjectID(id);
            }),
            props: RuleRunWriteProps.get(data.props),
          }),
        );
      } else {
        OwnerRuleAssignment.addUp(
          outcome,
          await this.addOwnersSilently({
            episodeId: episode.id,
            projectId: episode.projectId,
            userIds: userIds,
            teamIds: teamIds,
            props: data.props,
          }),
        );
      }
    }

    if (OwnerRuleFeed.isEmpty(outcome)) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    OwnerRuleFeed.log({
      engine: "IncidentEpisodeOwnerRuleEngine",
      record: `episode ${episode.id.toString()}`,
      outcome: outcome,
      logAttributes: {
        projectId: episode.projectId.toString(),
      } as LogAttributes,
    });

    await this.createRuleExecutedFeedItem({
      episode,
      matchedRules,
      outcome: outcome,
    });

    return OwnerRuleFeed.getResult(outcome);
  }

  /*
   * IncidentEpisodeService.addOwners has no notify flag. It leaves each owner
   * row's isOwnerNotified at the column default (false), and the
   * IncidentEpisodeOwner:SendOwnerAddedEmail job notifies every owner row
   * still at false, then flips it. So an owner added through addOwners is
   * always notified. A silent owner is instead written already marked
   * notified, which that job never picks up. The feed items and workspace
   * channel invites the owner services post on create still happen, exactly
   * as they do for addOwners. Resolves to what was added and what was
   * skipped, as addOwners does.
   */
  private async addOwnersSilently(data: {
    episodeId: ObjectID;
    projectId: ObjectID;
    userIds: Array<string>;
    teamIds: Array<string>;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<OwnersAdded> {
    const outcome: OwnersAdded = OwnerRuleAssignment.noOwnersAdded();

    for (const userId of data.userIds) {
      const owner: IncidentEpisodeOwnerUser = new IncidentEpisodeOwnerUser();
      owner.incidentEpisodeId = data.episodeId;
      owner.projectId = data.projectId;
      owner.userId = new ObjectID(userId);
      owner.isOwnerNotified = true;
      OwnerRuleAssignment.recordOutcome({
        into: outcome,
        ownerColumn: "userId",
        id: owner.userId,
        outcome: await OwnerRuleAssignment.createOwnerWithOutcome({
          ownerService: IncidentEpisodeOwnerUserService,
          owner: owner,
          props: RuleRunWriteProps.get(data.props),
        }),
      });
    }

    for (const teamId of data.teamIds) {
      const owner: IncidentEpisodeOwnerTeam = new IncidentEpisodeOwnerTeam();
      owner.incidentEpisodeId = data.episodeId;
      owner.projectId = data.projectId;
      owner.teamId = new ObjectID(teamId);
      owner.isOwnerNotified = true;
      OwnerRuleAssignment.recordOutcome({
        into: outcome,
        ownerColumn: "teamId",
        id: owner.teamId,
        outcome: await OwnerRuleAssignment.createOwnerWithOutcome({
          ownerService: IncidentEpisodeOwnerTeamService,
          owner: owner,
          props: RuleRunWriteProps.get(data.props),
        }),
      });
    }

    return outcome;
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: IncidentEpisode;
    matchedRules: Array<IncidentEpisodeOwnerRule>;
    // The owners added, and the ones skipped with why.
    outcome: OwnersAdded;
  }): Promise<void> {
    const { episode, matchedRules, outcome } = data;
    if (
      !episode.id ||
      !episode.projectId ||
      matchedRules.length === 0 ||
      OwnerRuleFeed.isEmpty(outcome)
    ) {
      return;
    }

    try {
      const ruleNames: Array<string> = matchedRules
        .map((r: IncidentEpisodeOwnerRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🛡️",
          ruleKind: "Incident Episode Owner Rule",
          ruleNames: ruleNames,
        },
      )}\n\n${await OwnerRuleFeed.readOutcome({
        projectId: episode.projectId,
        recordNoun: "episode",
        outcome: outcome,
      })}`;

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episode.id,
        projectId: episode.projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
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
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "incidentSeverities",
        "episodeLabels",
        "episodeTitlePattern",
        "episodeDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: IncidentEpisodeOwnerRule): boolean => {
        return this.doesEpisodeMatchLegacyRule(episode, legacyRule);
      },
    });
  }

  private doesEpisodeMatchLegacyRule(
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
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in incident episode owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new IncidentEpisodeOwnerRuleEngineServiceClass();
