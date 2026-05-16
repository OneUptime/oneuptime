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
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class DashboardOwnerRuleEngineServiceClass {
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
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            dashboardLabels: { _id: true },
            dashboardNamePattern: true,
            dashboardDescriptionPattern: true,
            ownerUsers: { _id: true },
            ownerTeams: { _id: true },
          },
          limit: 100,
          skip: 0,
        });

      if (rules.length === 0) {
        return;
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

      const matchedRules: Array<DashboardOwnerRule> = [];

      for (const rule of rules) {
        const matches: boolean = this.doesDashboardMatchRule(
          dashboardWithDetails,
          rule,
        );
        if (!matches) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        const notify: boolean = rule.notifyOwners !== false;
        for (const user of rule.ownerUsers || []) {
          if (user.id) {
            usersByNotify.get(notify)!.add(user.id.toString());
            ruleAddedAny = true;
          }
        }
        for (const team of rule.ownerTeams || []) {
          if (team.id) {
            teamsByNotify.get(notify)!.add(team.id.toString());
            ruleAddedAny = true;
          }
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      if (matchedRules.length === 0) {
        return;
      }

      for (const notify of [true, false]) {
        const userIds: Set<string> = usersByNotify.get(notify)!;
        const teamIds: Set<string> = teamsByNotify.get(notify)!;

        for (const userId of userIds) {
          const owner: DashboardOwnerUser = new DashboardOwnerUser();
          owner.dashboardId = dashboard.id;
          owner.projectId = dashboard.projectId;
          owner.userId = new ObjectID(userId);
          owner.isOwnerNotified = !notify;
          await DashboardOwnerUserService.create({
            data: owner,
            props: { isRoot: true },
          });
        }

        for (const teamId of teamIds) {
          const owner: DashboardOwnerTeam = new DashboardOwnerTeam();
          owner.dashboardId = dashboard.id;
          owner.projectId = dashboard.projectId;
          owner.teamId = new ObjectID(teamId);
          owner.isOwnerNotified = !notify;
          await DashboardOwnerTeamService.create({
            data: owner,
            props: { isRoot: true },
          });
        }
      }

      logger.debug(
        `DashboardOwnerRuleEngine added owners to dashboard ${dashboard.id}`,
        { projectId: dashboard.projectId.toString() } as LogAttributes,
      );
    } catch (error) {
      logger.error(`Error applying dashboard owner rules: ${error}`, {
        projectId: dashboard.projectId?.toString(),
        dashboardId: dashboard.id?.toString(),
      } as LogAttributes);
    }
  }

  private doesDashboardMatchRule(
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
