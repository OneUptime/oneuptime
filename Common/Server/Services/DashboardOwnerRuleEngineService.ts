import Dashboard from "../../Models/DatabaseModels/Dashboard";
import DashboardOwnerRule from "../../Models/DatabaseModels/DashboardOwnerRule";
import DashboardOwnerTeam from "../../Models/DatabaseModels/DashboardOwnerTeam";
import DashboardOwnerUser from "../../Models/DatabaseModels/DashboardOwnerUser";
import Label from "../../Models/DatabaseModels/Label";
import DashboardOwnerRuleService from "./DashboardOwnerRuleService";
import DashboardOwnerTeamService from "./DashboardOwnerTeamService";
import DashboardOwnerUserService from "./DashboardOwnerUserService";
import DashboardService from "./DashboardService";
import ObjectID from "../../Types/ObjectID";
import Select from "../Types/Database/Select";
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

class DashboardOwnerRuleEngineServiceClass
  implements RuleRunEngine<Dashboard, DashboardOwnerRule>
{
  public readonly ruleSelect: Select<DashboardOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
    notifyOwners: true,
    dashboardLabels: { _id: true },
    dashboardNamePattern: true,
    dashboardDescriptionPattern: true,
    ownerUsers: { _id: true },
    ownerTeams: { _id: true },
  };

  // Evaluation re-reads the dashboard, so a run only has to name it.
  public readonly resourceSelectForRuleRun: Select<Dashboard> = {
    _id: true,
    projectId: true,
  };

  /**
   * Evaluates DashboardOwnerRule rows for the given dashboard and adds matched
   * owner users / teams via DashboardOwnerUserService / DashboardOwnerTeamService.
   * Rules with notifyOwners set notify the added owners; rules with notifyOwners
   * off add silently.
   */
  @CaptureSpan()
  public async applyRulesToDashboard(dashboard: Dashboard): Promise<void> {
    if (!dashboard.id || !dashboard.projectId) {
      return;
    }

    try {
      const rules: Array<DashboardOwnerRule> =
        await DashboardOwnerRuleService.findBy({
          query: {
            projectId: dashboard.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: this.ruleSelect,
          limit: MAX_RULES_EVALUATED_PER_PROJECT,
          skip: 0,
        });

      logIfRuleReadWasTruncated({
        ruleKind: "DashboardOwnerRule",
        projectId: dashboard.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        dashboard: dashboard,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying dashboard owner rules: ${error}`, {
        projectId: dashboard.projectId?.toString(),
        dashboardId: dashboard.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for a dashboard that already exists
   * and only the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Dashboard, DashboardOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        dashboard: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running dashboard owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        dashboardId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    dashboard: Dashboard;
    rules: Array<DashboardOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { dashboard, rules } = data;

    if (!dashboard.id || !dashboard.projectId || rules.length === 0) {
      return RuleApplicationResultUtil.noMatch();
    }

    const dashboardWithDetails: Dashboard | null =
      await DashboardService.findOneById({
        id: dashboard.id,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });

    if (!dashboardWithDetails) {
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

    const matchedRules: Array<DashboardOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = this.doesDashboardMatchRule(
        dashboardWithDetails,
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

    // The rules that matched name no owners, so there is nothing to add.
    if (matchedRules.length === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the dashboard are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: DashboardOwnerUserService,
        ownerTeamService: DashboardOwnerTeamService,
        resourceIdColumn: "dashboardId",
        resourceId: dashboard.id,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
      });

    const userIdsToAdd: Set<string> = new Set(
      notYetAssigned.userIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const teamIdsToAdd: Set<string> = new Set(
      notYetAssigned.teamIds.map((id: ObjectID): string => {
        return id.toString();
      }),
    );

    let ownersAdded: number = 0;

    /*
     * The notifying set goes first, so an owner two matching rules disagree
     * about is added once, and notified.
     */
    for (const notify of [true, false]) {
      const userIds: Array<string> = Array.from(
        usersByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return userIdsToAdd.delete(id);
      });
      const teamIds: Array<string> = Array.from(
        teamsByNotify.get(notify)!,
      ).filter((id: string): boolean => {
        return teamIdsToAdd.delete(id);
      });

      for (const userId of userIds) {
        const owner: DashboardOwnerUser = new DashboardOwnerUser();
        owner.dashboardId = dashboard.id;
        owner.projectId = dashboard.projectId;
        owner.userId = new ObjectID(userId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DashboardOwnerUserService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }

      for (const teamId of teamIds) {
        const owner: DashboardOwnerTeam = new DashboardOwnerTeam();
        owner.dashboardId = dashboard.id;
        owner.projectId = dashboard.projectId;
        owner.teamId = new ObjectID(teamId);
        owner.isOwnerNotified = !notify;
        if (
          await OwnerRuleAssignment.createOwner({
            ownerService: DashboardOwnerTeamService,
            owner: owner,
            props: { isRoot: true },
          })
        ) {
          ownersAdded++;
        }
      }
    }

    if (ownersAdded === 0) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    logger.debug(
      `DashboardOwnerRuleEngine added owners to dashboard ${dashboard.id}`,
      { projectId: dashboard.projectId.toString() } as LogAttributes,
    );

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  private doesDashboardMatchRule(
    dashboard: Dashboard,
    rule: DashboardOwnerRule,
  ): boolean {
    return RuleCriteriaMatcher.matchesWithLegacySync({
      rule,
      legacyFields: [
        "dashboardLabels",
        "dashboardNamePattern",
        "dashboardDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: (legacyRule: DashboardOwnerRule): boolean => {
        return this.doesDashboardMatchLegacyRule(dashboard, legacyRule);
      },
    });
  }

  private doesDashboardMatchLegacyRule(
    dashboard: Dashboard,
    rule: DashboardOwnerRule,
  ): boolean {
    if (rule.dashboardLabels && rule.dashboardLabels.length > 0) {
      if (!dashboard.labels || dashboard.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.dashboardLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const labelIds: Array<string> = dashboard.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return labelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.dashboardNamePattern &&
      (!dashboard.name ||
        !this.testRegex(rule.dashboardNamePattern, dashboard.name, rule))
    ) {
      return false;
    }

    if (
      rule.dashboardDescriptionPattern &&
      (!dashboard.description ||
        !this.testRegex(
          rule.dashboardDescriptionPattern,
          dashboard.description,
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
    rule: DashboardOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in dashboard owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new DashboardOwnerRuleEngineServiceClass();
