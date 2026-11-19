import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorOwnerRule from "../../Models/DatabaseModels/MonitorOwnerRule";
import MonitorFeedService from "./MonitorFeedService";
import MonitorOwnerRuleService from "./MonitorOwnerRuleService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorService from "./MonitorService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import { MarkdownText, mdText } from "../../Utils/Markdown/FeedMarkdown";
import RuleFeedMarkdown from "../Utils/Rules/RuleFeedMarkdown";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
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

class MonitorOwnerRuleEngineServiceClass
  implements RuleRunEngine<Monitor, MonitorOwnerRule>
{
  public readonly ruleSelect: Select<MonitorOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    monitorLabels: { _id: true },
    monitorNamePattern: true,
    monitorDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the monitor, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Monitor> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates MonitorOwnerRule rows for the given monitor and adds matched
   * owner users / teams via MonitorService.addOwners. Rules with notifyOwners
   * set notify the added owners; rules with notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToMonitor(monitor: Monitor): Promise<void> {
    if (!monitor.id || !monitor.projectId) {
      return;
    }

    try {
      const rules: Array<MonitorOwnerRule> =
        await MonitorOwnerRuleService.findBy({
          query: {
            projectId: monitor.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "MonitorOwnerRule",
        projectId: monitor.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        monitor: monitor,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying monitor owner rules: ${error}`, {
        projectId: monitor.projectId?.toString(),
        monitorId: monitor.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a monitor that already exists and
   * only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Monitor, MonitorOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        monitor: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
        props: data.props,
      });
    } catch (error) {
      logger.error(`Error running monitor owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        monitorId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  @RuleEvaluation()
  private async applyRules(data: {
    monitor: Monitor;
    rules: Array<MonitorOwnerRule>;
    allowOwnerNotification: boolean;
    // Who ran the rule (Run now); none for a rule applied on create.
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<RuleApplicationResult> {
    const { monitor, rules } = data;

    if (!monitor.id || !monitor.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const usersByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);
    const teamsByNotify: Map<boolean, Set<string>> = new Map([
      [true, new Set()],
      [false, new Set()],
    ]);

    const matchedRules: Array<MonitorOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();

    const monitorWithDetails: Monitor | null = await MonitorService.findOneById(
      {
        id: monitor.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      },
    );

    if (!monitorWithDetails) {
      return RuleApplicationResultUtil.noMatch();
    }

    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesMonitorMatchRule(
        monitorWithDetails,
        rule,
      );
      if (!matches) {
        continue;
      }
      anyRuleMatched = true;
      let ruleAddedAny: boolean = false;
      const notify: boolean =
        rule.notifyOwners !== false && data.allowOwnerNotification;
      for (const user of rule.ownerUsers || []) {
        if (user.id) {
          usersByNotify.get(notify)!.add(user.id.toString());
          allUserIds.add(user.id.toString());
          ruleAddedAny = true;
        }
      }
      for (const team of rule.ownerTeams || []) {
        if (team.id) {
          teamsByNotify.get(notify)!.add(team.id.toString());
          allTeamIds.add(team.id.toString());
          ruleAddedAny = true;
        }
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    if (
      matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the monitor are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: MonitorOwnerUserService,
        ownerTeamService: MonitorOwnerTeamService,
        resourceIdColumn: "monitorId",
        resourceId: monitor.id,
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
        await MonitorService.addOwners(
          monitor.projectId,
          monitor.id,
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
      engine: "MonitorOwnerRuleEngine",
      record: `monitor ${monitor.id.toString()}`,
      outcome: outcome,
      logAttributes: {
        projectId: monitor.projectId.toString(),
      } as LogAttributes,
    });

    await this.createRuleExecutedFeedItem({
      monitor,
      matchedRules,
      outcome: outcome,
    });

    return OwnerRuleFeed.getResult(outcome);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    monitor: Monitor;
    matchedRules: Array<MonitorOwnerRule>;
    // The owners added, and the ones skipped with why.
    outcome: OwnersAdded;
  }): Promise<void> {
    const { monitor, matchedRules, outcome } = data;
    if (
      !monitor.id ||
      !monitor.projectId ||
      matchedRules.length === 0 ||
      OwnerRuleFeed.isEmpty(outcome)
    ) {
      return;
    }

    try {
      const ruleNames: Array<string> = matchedRules
        .map((r: MonitorOwnerRule) => {
          return r.name?.toString() || "Unnamed Rule";
        })
        .filter((n: string) => {
          return n !== "";
        });

      const feedInfoInMarkdown: MarkdownText = mdText`${RuleFeedMarkdown.executedLine(
        {
          emoji: "🛡️",
          ruleKind: "Monitor Owner Rule",
          ruleNames: ruleNames,
        },
      )}\n\n${await OwnerRuleFeed.readOutcome({
        projectId: monitor.projectId,
        recordNoun: "monitor",
        outcome: outcome,
      })}`;

      await MonitorFeedService.createMonitorFeedItem({
        monitorId: monitor.id,
        projectId: monitor.projectId,
        monitorFeedEventType: MonitorFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown: feedInfoInMarkdown.toString(),
      });
    } catch (error) {
      logger.error(
        `MonitorOwnerRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: monitor.projectId?.toString(),
          monitorId: monitor.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  private doesMonitorMatchRule(
    monitor: Monitor,
    rule: MonitorOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "monitorLabels",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: MonitorOwnerRule): boolean => {
        return this.doesMonitorMatchLegacyRule(monitor, legacyRule);
      },
    });
  }

  private doesMonitorMatchLegacyRule(
    monitor: Monitor,
    rule: MonitorOwnerRule,
  ): boolean {
    if (rule.monitorLabels && rule.monitorLabels.length > 0) {
      if (!monitor.labels || monitor.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.monitorLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const monitorLabelIds: Array<string> = monitor.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return monitorLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.monitorNamePattern &&
      (!monitor.name ||
        !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
    ) {
      return false;
    }

    if (
      rule.monitorDescriptionPattern &&
      (!monitor.description ||
        !this.testRegex(
          rule.monitorDescriptionPattern,
          monitor.description,
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
    rule: MonitorOwnerRule,
  ): boolean {
    try {
      return RulePatternMatchUtil.testRegex(pattern, value);
    } catch {
      logger.warn(`Invalid regex in monitor owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new MonitorOwnerRuleEngineServiceClass();
