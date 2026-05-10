import Alert from "../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../Models/DatabaseModels/AlertOwnerRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import Host from "../../Models/DatabaseModels/Host";
import HostOwnerTeam from "../../Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "../../Models/DatabaseModels/HostOwnerUser";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../Models/DatabaseModels/MonitorOwnerUser";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import AlertFeedService from "./AlertFeedService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertService from "./AlertService";
import HostOwnerTeamService from "./HostOwnerTeamService";
import HostOwnerUserService from "./HostOwnerUserService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorService from "./MonitorService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class AlertOwnerRuleEngineServiceClass {
  /**
   * Evaluates AlertOwnerRule rows for the given alert and adds matched
   * owner users / teams via AlertService.addOwners.
   */
  @CaptureSpan()
  public async applyRulesToAlert(alert: Alert): Promise<void> {
    if (!alert.id || !alert.projectId) {
      return;
    }

    try {
      const rules: Array<AlertOwnerRule> = await AlertOwnerRuleService.findBy({
        query: {
          projectId: alert.projectId,
          isEnabled: true,
        },
        props: { isRoot: true },
        select: {
          _id: true,
          name: true,
          notifyOwners: true,
          monitors: { _id: true },
          alertSeverities: { _id: true },
          alertLabels: { _id: true },
          monitorLabels: { _id: true },
          alertTitlePattern: true,
          alertDescriptionPattern: true,
          monitorNamePattern: true,
          monitorDescriptionPattern: true,
          ownerUsers: { _id: true },
          ownerTeams: { _id: true },
          inheritOwnersFromMonitors: true,
          inheritOwnersFromHosts: true,
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

      const matchedRules: Array<AlertOwnerRule> = [];
      const allUserIds: Set<string> = new Set();
      const allTeamIds: Set<string> = new Set();
      let inheritFromMonitors: boolean = false;
      let inheritFromHosts: boolean = false;
      const inheritNotifyMode: { value: boolean | null } = { value: null };

      for (const rule of rules) {
        const matches: boolean = await this.doesAlertMatchRule(alert, rule);
        if (!matches) {
          continue;
        }
        let ruleAddedAny: boolean = false;
        const notify: boolean = rule.notifyOwners !== false;
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
        if (rule.inheritOwnersFromMonitors) {
          inheritFromMonitors = true;
          ruleAddedAny = true;
          inheritNotifyMode.value =
            inheritNotifyMode.value === true ? true : notify;
        }
        if (rule.inheritOwnersFromHosts) {
          inheritFromHosts = true;
          ruleAddedAny = true;
          inheritNotifyMode.value =
            inheritNotifyMode.value === true ? true : notify;
        }
        if (ruleAddedAny) {
          matchedRules.push(rule);
        }
      }

      const inheritedFromMonitorUserIds: Set<string> = new Set();
      const inheritedFromMonitorTeamIds: Set<string> = new Set();
      const inheritedFromHostUserIds: Set<string> = new Set();
      const inheritedFromHostTeamIds: Set<string> = new Set();

      if (inheritFromMonitors && alert.monitorId) {
        const [monitorOwnerUsers, monitorOwnerTeams]: [
          Array<MonitorOwnerUser>,
          Array<MonitorOwnerTeam>,
        ] = await Promise.all([
          MonitorOwnerUserService.findBy({
            query: { monitorId: alert.monitorId },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          MonitorOwnerTeamService.findBy({
            query: { monitorId: alert.monitorId },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);
        for (const ownerUser of monitorOwnerUsers) {
          if (ownerUser.userId) {
            inheritedFromMonitorUserIds.add(ownerUser.userId.toString());
          }
        }
        for (const ownerTeam of monitorOwnerTeams) {
          if (ownerTeam.teamId) {
            inheritedFromMonitorTeamIds.add(ownerTeam.teamId.toString());
          }
        }
      }

      if (inheritFromHosts && alert.hosts?.length) {
        const hostIds: Array<ObjectID> = alert.hosts
          .map((h: Host) => {
            return h.id;
          })
          .filter((id: ObjectID | null | undefined): id is ObjectID => {
            return Boolean(id);
          });
        if (hostIds.length > 0) {
          const [hostOwnerUsers, hostOwnerTeams]: [
            Array<HostOwnerUser>,
            Array<HostOwnerTeam>,
          ] = await Promise.all([
            HostOwnerUserService.findBy({
              query: { hostId: QueryHelper.any(hostIds) },
              select: { userId: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            }),
            HostOwnerTeamService.findBy({
              query: { hostId: QueryHelper.any(hostIds) },
              select: { teamId: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            }),
          ]);
          for (const ownerUser of hostOwnerUsers) {
            if (ownerUser.userId) {
              inheritedFromHostUserIds.add(ownerUser.userId.toString());
            }
          }
          for (const ownerTeam of hostOwnerTeams) {
            if (ownerTeam.teamId) {
              inheritedFromHostTeamIds.add(ownerTeam.teamId.toString());
            }
          }
        }
      }

      const inheritedUserIds: Set<string> = new Set([
        ...inheritedFromMonitorUserIds,
        ...inheritedFromHostUserIds,
      ]);
      const inheritedTeamIds: Set<string> = new Set([
        ...inheritedFromMonitorTeamIds,
        ...inheritedFromHostTeamIds,
      ]);

      if (inheritedUserIds.size > 0 || inheritedTeamIds.size > 0) {
        const inheritNotify: boolean = inheritNotifyMode.value === true;
        for (const id of inheritedUserIds) {
          usersByNotify.get(inheritNotify)!.add(id);
          allUserIds.add(id);
        }
        for (const id of inheritedTeamIds) {
          teamsByNotify.get(inheritNotify)!.add(id);
          allTeamIds.add(id);
        }
      }

      if (matchedRules.length === 0) {
        return;
      }

      if (allUserIds.size === 0 && allTeamIds.size === 0) {
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

        await AlertService.addOwners(
          alert.projectId,
          alert.id,
          userIds,
          teamIds,
          notify,
          { isRoot: true },
        );
      }

      logger.debug(`AlertOwnerRuleEngine added owners to alert ${alert.id}`, {
        projectId: alert.projectId.toString(),
      } as LogAttributes);

      await this.createRuleExecutedFeedItem({
        alert,
        matchedRules,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
        inheritedFromMonitors:
          inheritedFromMonitorUserIds.size + inheritedFromMonitorTeamIds.size >
          0,
        inheritedFromHosts:
          inheritedFromHostUserIds.size + inheritedFromHostTeamIds.size > 0,
      });
    } catch (error) {
      logger.error(`Error applying alert owner rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertOwnerRule>;
    userIds: Array<string>;
    teamIds: Array<string>;
    inheritedFromMonitors: boolean;
    inheritedFromHosts: boolean;
  }): Promise<void> {
    const {
      alert,
      matchedRules,
      userIds,
      teamIds,
      inheritedFromMonitors,
      inheritedFromHosts,
    } = data;
    if (
      !alert.id ||
      !alert.projectId ||
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
        .map((r: AlertOwnerRule) => {
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

      const inheritedSources: Array<string> = [];
      if (inheritedFromMonitors) {
        inheritedSources.push("monitor");
      }
      if (inheritedFromHosts) {
        inheritedSources.push("hosts");
      }
      const inheritedNote: string =
        inheritedSources.length > 0
          ? `\n\n_Some owners were inherited from the alert's ${inheritedSources.join(" and ")}._`
          : "";

      const feedInfoInMarkdown: string = `🛡️ **Alert Owner Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAssigned the following owner${
        userLines.length + teamLines.length === 1 ? "" : "s"
      } to the alert:${ownersPart}${inheritedNote}`;

      await AlertFeedService.createAlertFeedItem({
        alertId: alert.id,
        projectId: alert.projectId,
        alertFeedEventType: AlertFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `AlertOwnerRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: alert.projectId?.toString(),
          alertId: alert.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesAlertMatchRule(
    alert: Alert,
    rule: AlertOwnerRule,
  ): Promise<boolean> {
    if (rule.monitors && rule.monitors.length > 0) {
      if (!alert.monitorId) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      if (!ruleMonitorIds.includes(alert.monitorId.toString())) {
        return false;
      }
    }

    if (rule.alertSeverities && rule.alertSeverities.length > 0) {
      if (!alert.alertSeverityId) {
        return false;
      }
      const severityIds: Array<string> = rule.alertSeverities.map(
        (s: AlertSeverity) => {
          return s.id?.toString() || "";
        },
      );
      if (!severityIds.includes(alert.alertSeverityId.toString())) {
        return false;
      }
    }

    if (rule.alertLabels && rule.alertLabels.length > 0) {
      if (!alert.labels || alert.labels.length === 0) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.alertLabels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      const alertLabelIds: Array<string> = alert.labels.map((l: Label) => {
        return l.id?.toString() || "";
      });
      if (
        !ruleLabelIds.some((id: string) => {
          return alertLabelIds.includes(id);
        })
      ) {
        return false;
      }
    }

    const hasMonitorCriteria: boolean = Boolean(
      (rule.monitorLabels && rule.monitorLabels.length > 0) ||
        rule.monitorNamePattern ||
        rule.monitorDescriptionPattern,
    );

    if (hasMonitorCriteria) {
      if (!alert.monitorId) {
        return false;
      }
      const monitor: Monitor | null = await MonitorService.findOneById({
        id: alert.monitorId,
        select: {
          name: true,
          description: true,
          labels: { _id: true },
        },
        props: { isRoot: true },
      });
      if (!monitor) {
        return false;
      }

      if (rule.monitorLabels && rule.monitorLabels.length > 0) {
        if (!monitor.labels || monitor.labels.length === 0) {
          return false;
        }
        const ruleMonitorLabelIds: Array<string> = rule.monitorLabels.map(
          (l: Label) => {
            return l.id?.toString() || "";
          },
        );
        const monitorLabelIds: Array<string> = monitor.labels.map(
          (l: Label) => {
            return l.id?.toString() || "";
          },
        );
        if (
          !ruleMonitorLabelIds.some((id: string) => {
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
    }

    if (
      rule.alertTitlePattern &&
      (!alert.title ||
        !this.testRegex(rule.alertTitlePattern, alert.title, rule))
    ) {
      return false;
    }

    if (
      rule.alertDescriptionPattern &&
      (!alert.description ||
        !this.testRegex(rule.alertDescriptionPattern, alert.description, rule))
    ) {
      return false;
    }

    return true;
  }

  private testRegex(
    pattern: string,
    value: string,
    rule: AlertOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(`Invalid regex in alert owner rule ${rule.id}: ${pattern}`);
      return false;
    }
  }
}

export default new AlertOwnerRuleEngineServiceClass();
