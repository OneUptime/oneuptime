import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorOwnerRule from "../../Models/DatabaseModels/MonitorOwnerRule";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import MonitorFeedService from "./MonitorFeedService";
import MonitorOwnerRuleService from "./MonitorOwnerRuleService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorService from "./MonitorService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import { MonitorFeedEventType } from "../../Models/DatabaseModels/MonitorFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Select from "../Types/Database/Select";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

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
      });
    } catch (error) {
      logger.error(`Error running monitor owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        monitorId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    monitor: Monitor;
    rules: Array<MonitorOwnerRule>;
    allowOwnerNotification: boolean;
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

    const addedUserIds: Array<string> = [];
    const addedTeamIds: Array<string> = [];

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
        { isRoot: true },
      );

      addedUserIds.push(...userIds);
      addedTeamIds.push(...teamIds);
    }

    const ownersAdded: number = addedUserIds.length + addedTeamIds.length;

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `MonitorOwnerRuleEngine added owners to monitor ${monitor.id}`,
      { projectId: monitor.projectId.toString() } as LogAttributes,
    );

    await this.createRuleExecutedFeedItem({
      monitor,
      matchedRules,
      userIds: addedUserIds,
      teamIds: addedTeamIds,
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    monitor: Monitor;
    matchedRules: Array<MonitorOwnerRule>;
    userIds: Array<string>;
    teamIds: Array<string>;
  }): Promise<void> {
    const { monitor, matchedRules, userIds, teamIds } = data;
    if (
      !monitor.id ||
      !monitor.projectId ||
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
        .map((r: MonitorOwnerRule) => {
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

      const feedInfoInMarkdown: string = `🛡️ **Monitor Owner Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAssigned the following owner${
        userLines.length + teamLines.length === 1 ? "" : "s"
      } to the monitor:${ownersPart}`;

      await MonitorFeedService.createMonitorFeedItem({
        monitorId: monitor.id,
        projectId: monitor.projectId,
        monitorFeedEventType: MonitorFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
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
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in monitor owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new MonitorOwnerRuleEngineServiceClass();
