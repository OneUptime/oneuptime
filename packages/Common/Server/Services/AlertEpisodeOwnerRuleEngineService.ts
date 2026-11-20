import AlertEpisode from "../../Models/DatabaseModels/AlertEpisode";
import AlertEpisodeOwnerRule from "../../Models/DatabaseModels/AlertEpisodeOwnerRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Label from "../../Models/DatabaseModels/Label";
import AlertEpisodeFeedService from "./AlertEpisodeFeedService";
import AlertEpisodeOwnerRuleService from "./AlertEpisodeOwnerRuleService";
import AlertEpisodeOwnerTeamService from "./AlertEpisodeOwnerTeamService";
import AlertEpisodeOwnerUserService from "./AlertEpisodeOwnerUserService";
import AlertEpisodeService from "./AlertEpisodeService";
import { AlertEpisodeFeedEventType } from "../../Models/DatabaseModels/AlertEpisodeFeed";
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

class AlertEpisodeOwnerRuleEngineServiceClass
  implements RuleRunEngine<AlertEpisode, AlertEpisodeOwnerRule>
{
  public readonly ruleSelect: Select<AlertEpisodeOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    alertSeverities: { _id: true },
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
  public readonly resourceSelectForRuleRun: Select<AlertEpisode> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    alertSeverityId: true,
    labels: { _id: true },
  };

  /*
   * The project's enabled rules, as every evaluation of a new episode reads
   * them - the create and the create form's preview alike.
   */
  @CaptureSpan()
  public async getEnabledRules(
    projectId: ObjectID,
  ): Promise<Array<AlertEpisodeOwnerRule>> {
    const rules: Array<AlertEpisodeOwnerRule> =
      await AlertEpisodeOwnerRuleService.findBy({
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
      ruleKind: "AlertEpisodeOwnerRule",
      projectId: projectId,
      rulesRead: rules.length,
    });

    return rules;
  }

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
      const rules: Array<AlertEpisodeOwnerRule> = await this.getEnabledRules(
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
      logger.error(`Error applying alert episode owner rules: ${error}`, {
        projectId: episode.projectId?.toString(),
        alertEpisodeId: episode.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an episode that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<AlertEpisode, AlertEpisodeOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        episode: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running alert episode owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        alertEpisodeId: data.resource.id?.toString(),
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
    episode: AlertEpisode,
  ): Promise<Array<OwnerRulePlanEntry<AlertEpisodeOwnerRule>>> {
    if (!episode.projectId) {
      return [];
    }

    const rules: Array<AlertEpisodeOwnerRule> = await this.getEnabledRules(
      episode.projectId,
    );

    if (rules.length === 0) {
      return [];
    }

    const plan: OwnerRulePlan<AlertEpisodeOwnerRule> = this.planRules({
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
    episode: AlertEpisode;
    rules: Array<AlertEpisodeOwnerRule>;
    allowOwnerNotification: boolean;
  }): OwnerRulePlan<AlertEpisodeOwnerRule> {
    const builder: OwnerRulePlanBuilder<AlertEpisodeOwnerRule> =
      new OwnerRulePlanBuilder<AlertEpisodeOwnerRule>(
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
    episode: AlertEpisode;
    rules: Array<AlertEpisodeOwnerRule>;
    allowOwnerNotification: boolean;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { episode, rules } = data;

    if (!episode.id || !episode.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const plan: OwnerRulePlan<AlertEpisodeOwnerRule> = this.planRules(data);

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
     * AlertEpisodeService.addOwners does not check for existing owners, so
     * owners already on the episode are filtered out here rather than
     * duplicated.
     */
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: AlertEpisodeOwnerUserService,
        ownerTeamService: AlertEpisodeOwnerTeamService,
        resourceIdColumn: "alertEpisodeId",
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
     * What addOwners actually did: the owners it wrote, and the ones it
     * skipped and why - a user who has left the project, a team that is not
     * one of its teams (#9933). The feed item, the log lines and the count
     * are made from these, never from the ids the rules asked for.
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

      OwnerRuleAssignment.addUp(
        outcome,
        await AlertEpisodeService.addOwners(
          episode.projectId,
          episode.id,
          userIds.map((id: string) => {
            return new ObjectID(id);
          }),
          teamIds.map((id: string) => {
            return new ObjectID(id);
          }),
          notify,
          RuleRunWriteProps.get(data.props),
        ),
      );
    }

    if (OwnerRuleFeed.isEmpty(outcome)) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    OwnerRuleFeed.log({
      engine: "AlertEpisodeOwnerRuleEngine",
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

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    episode: AlertEpisode;
    matchedRules: Array<AlertEpisodeOwnerRule>;
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
        .map((r: AlertEpisodeOwnerRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🛡️",
          ruleKind: "Alert Episode Owner Rule",
          ruleNames: ruleNames,
        },
      )}\n\n${await OwnerRuleFeed.readOutcome({
        projectId: episode.projectId,
        recordNoun: "episode",
        outcome: outcome,
      })}`;

      await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
        alertEpisodeId: episode.id,
        projectId: episode.projectId,
        alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `AlertEpisodeOwnerRuleEngine: failed to create rule-executed feed item: ${
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
    rule: AlertEpisodeOwnerRule,
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
      matchesLegacyRule: (legacyRule: AlertEpisodeOwnerRule): boolean => {
        return this.doesEpisodeMatchLegacyRule(episode, legacyRule);
      },
    });
  }

  private doesEpisodeMatchLegacyRule(
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
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(
        `Invalid regex in alert episode owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new AlertEpisodeOwnerRuleEngineServiceClass();
