import Alert from "../../Models/DatabaseModels/Alert";
import AlertOwnerRule from "../../Models/DatabaseModels/AlertOwnerRule";
import AlertSeverity from "../../Models/DatabaseModels/AlertSeverity";
import DockerHost from "../../Models/DatabaseModels/DockerHost";
import DockerHostOwnerTeam from "../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerUser from "../../Models/DatabaseModels/DockerHostOwnerUser";
import Host from "../../Models/DatabaseModels/Host";
import HostOwnerTeam from "../../Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "../../Models/DatabaseModels/HostOwnerUser";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import KubernetesClusterOwnerTeam from "../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import Label from "../../Models/DatabaseModels/Label";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorOwnerTeam from "../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../Models/DatabaseModels/MonitorOwnerUser";
import PodmanHost from "../../Models/DatabaseModels/PodmanHost";
import PodmanHostOwnerTeam from "../../Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "../../Models/DatabaseModels/PodmanHostOwnerUser";
import Service from "../../Models/DatabaseModels/Service";
import ServiceOwnerTeam from "../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../Models/DatabaseModels/ServiceOwnerUser";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import AlertFeedService from "./AlertFeedService";
import AlertOwnerRuleService from "./AlertOwnerRuleService";
import AlertOwnerTeamService from "./AlertOwnerTeamService";
import AlertOwnerUserService from "./AlertOwnerUserService";
import AlertService from "./AlertService";
import DockerHostOwnerTeamService from "./DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "./DockerHostOwnerUserService";
import HostOwnerTeamService from "./HostOwnerTeamService";
import HostOwnerUserService from "./HostOwnerUserService";
import KubernetesClusterOwnerTeamService from "./KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "./KubernetesClusterOwnerUserService";
import MonitorOwnerTeamService from "./MonitorOwnerTeamService";
import MonitorOwnerUserService from "./MonitorOwnerUserService";
import MonitorService from "./MonitorService";
import PodmanHostOwnerTeamService from "./PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "./PodmanHostOwnerUserService";
import ServiceOwnerTeamService from "./ServiceOwnerTeamService";
import ServiceOwnerUserService from "./ServiceOwnerUserService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import { AlertFeedEventType } from "../../Models/DatabaseModels/AlertFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Select from "../Types/Database/Select";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";
import { MAX_RULES_EVALUATED_PER_PROJECT } from "../../Utils/Rules/RuleEngineLimits";
import logIfRuleReadWasTruncated from "../Utils/Rules/RuleEngineRuleRead";
import { RuleCriteriaMatcher } from "../../Utils/Rules/RuleCriteriaMatcher";
import OwnerRuleAssignment, {
  OwnersToAssign,
} from "../Utils/Rules/OwnerRuleAssignment";
import {
  ApplyRulesToExistingResourceData,
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../Utils/Rules/RuleRun/RuleApplication";

/*
 * Whether any owner that was actually added came from one inherited source.
 * The feed note names a source only for owners it lists, and an inherited
 * owner the alert already had is not listed.
 */
function addedAnyInheritedOwner(data: {
  addedUserIds: Set<string>;
  addedTeamIds: Set<string>;
  inheritedUserIds: Set<string>;
  inheritedTeamIds: Set<string>;
}): boolean {
  for (const id of data.inheritedUserIds) {
    if (data.addedUserIds.has(id)) {
      return true;
    }
  }

  for (const id of data.inheritedTeamIds) {
    if (data.addedTeamIds.has(id)) {
      return true;
    }
  }

  return false;
}

class AlertOwnerRuleEngineServiceClass
  implements RuleRunEngine<Alert, AlertOwnerRule>
{
  public readonly ruleSelect: Select<AlertOwnerRule> = {
    _id: true,
    name: true,
    criteria: true,
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
    inheritOwnersFromKubernetesClusters: true,
    inheritOwnersFromDockerHosts: true,
    inheritOwnersFromPodmanHosts: true,
    inheritOwnersFromServices: true,
  };

  /*
   * Matching and inheritance read all of these straight off the alert they
   * are handed instead of re-reading it, so a run has to load every one: a
   * column left out here is a criterion a run silently never matches on, or
   * a resource it silently never inherits owners from.
   */
  public readonly resourceSelectForRuleRun: Select<Alert> = {
    _id: true,
    projectId: true,
    title: true,
    description: true,
    alertSeverityId: true,
    monitorId: true,
    labels: { _id: true },
    hosts: { _id: true },
    kubernetesClusters: { _id: true },
    dockerHosts: { _id: true },
    podmanHosts: { _id: true },
    services: { _id: true },
  };

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
        select: this.ruleSelect,
        limit: MAX_RULES_EVALUATED_PER_PROJECT,
        skip: 0,
      });

      logIfRuleReadWasTruncated({
        ruleKind: "AlertOwnerRule",
        projectId: alert.projectId,
        rulesRead: rules.length,
      });

      if (rules.length === 0) {
        return;
      }

      await this.applyRules({
        alert: alert,
        rules: rules,
        allowOwnerNotification: true,
      });
    } catch (error) {
      logger.error(`Error applying alert owner rules: ${error}`, {
        projectId: alert.projectId?.toString(),
        alertId: alert.id?.toString(),
      } as LogAttributes);
    }
  }

  /*
   * "Run now": the same evaluation, for an alert that already exists and only
   * the rules being run.
   */
  @CaptureSpan()
  public async applyRulesToExistingResource(
    data: ApplyRulesToExistingResourceData<Alert, AlertOwnerRule>,
  ): Promise<RuleApplicationResult> {
    try {
      return await this.applyRules({
        alert: data.resource,
        rules: data.rules,
        allowOwnerNotification: data.allowOwnerNotification,
      });
    } catch (error) {
      logger.error(`Error running alert owner rules: ${error}`, {
        projectId: data.resource.projectId?.toString(),
        alertId: data.resource.id?.toString(),
      } as LogAttributes);

      return RuleApplicationResultUtil.failed();
    }
  }

  private async applyRules(data: {
    alert: Alert;
    rules: Array<AlertOwnerRule>;
    allowOwnerNotification: boolean;
  }): Promise<RuleApplicationResult> {
    const { alert, rules } = data;

    if (!alert.id || !alert.projectId || rules.length === 0) {
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

    const matchedRules: Array<AlertOwnerRule> = [];
    const allUserIds: Set<string> = new Set();
    const allTeamIds: Set<string> = new Set();
    let inheritFromMonitors: boolean = false;
    let inheritFromHosts: boolean = false;
    let inheritFromKubernetesClusters: boolean = false;
    let inheritFromDockerHosts: boolean = false;
    let inheritFromPodmanHosts: boolean = false;
    let inheritFromServices: boolean = false;
    const inheritNotifyMode: { value: boolean | null } = { value: null };
    let anyRuleMatched: boolean = false;

    for (const rule of rules) {
      const matches: boolean = await this.doesAlertMatchRule(alert, rule);
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
      if (rule.inheritOwnersFromKubernetesClusters) {
        inheritFromKubernetesClusters = true;
        ruleAddedAny = true;
        inheritNotifyMode.value =
          inheritNotifyMode.value === true ? true : notify;
      }
      if (rule.inheritOwnersFromDockerHosts) {
        inheritFromDockerHosts = true;
        ruleAddedAny = true;
        inheritNotifyMode.value =
          inheritNotifyMode.value === true ? true : notify;
      }
      if (rule.inheritOwnersFromPodmanHosts) {
        inheritFromPodmanHosts = true;
        ruleAddedAny = true;
        inheritNotifyMode.value =
          inheritNotifyMode.value === true ? true : notify;
      }
      if (rule.inheritOwnersFromServices) {
        inheritFromServices = true;
        ruleAddedAny = true;
        inheritNotifyMode.value =
          inheritNotifyMode.value === true ? true : notify;
      }
      if (ruleAddedAny) {
        matchedRules.push(rule);
      }
    }

    if (!anyRuleMatched) {
      return RuleApplicationResultUtil.noMatch();
    }

    const inheritedFromMonitorUserIds: Set<string> = new Set();
    const inheritedFromMonitorTeamIds: Set<string> = new Set();
    const inheritedFromHostUserIds: Set<string> = new Set();
    const inheritedFromHostTeamIds: Set<string> = new Set();
    const inheritedFromKubernetesClusterUserIds: Set<string> = new Set();
    const inheritedFromKubernetesClusterTeamIds: Set<string> = new Set();
    const inheritedFromDockerHostUserIds: Set<string> = new Set();
    const inheritedFromDockerHostTeamIds: Set<string> = new Set();
    const inheritedFromPodmanHostUserIds: Set<string> = new Set();
    const inheritedFromPodmanHostTeamIds: Set<string> = new Set();
    const inheritedFromServiceUserIds: Set<string> = new Set();
    const inheritedFromServiceTeamIds: Set<string> = new Set();

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

    if (inheritFromKubernetesClusters && alert.kubernetesClusters?.length) {
      const clusterIds: Array<ObjectID> = alert.kubernetesClusters
        .map((c: KubernetesCluster) => {
          return c.id;
        })
        .filter((id: ObjectID | null | undefined): id is ObjectID => {
          return Boolean(id);
        });
      if (clusterIds.length > 0) {
        const [clusterOwnerUsers, clusterOwnerTeams]: [
          Array<KubernetesClusterOwnerUser>,
          Array<KubernetesClusterOwnerTeam>,
        ] = await Promise.all([
          KubernetesClusterOwnerUserService.findBy({
            query: { kubernetesClusterId: QueryHelper.any(clusterIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          KubernetesClusterOwnerTeamService.findBy({
            query: { kubernetesClusterId: QueryHelper.any(clusterIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);
        for (const ownerUser of clusterOwnerUsers) {
          if (ownerUser.userId) {
            inheritedFromKubernetesClusterUserIds.add(
              ownerUser.userId.toString(),
            );
          }
        }
        for (const ownerTeam of clusterOwnerTeams) {
          if (ownerTeam.teamId) {
            inheritedFromKubernetesClusterTeamIds.add(
              ownerTeam.teamId.toString(),
            );
          }
        }
      }
    }

    if (inheritFromDockerHosts && alert.dockerHosts?.length) {
      const dockerHostIds: Array<ObjectID> = alert.dockerHosts
        .map((d: DockerHost) => {
          return d.id;
        })
        .filter((id: ObjectID | null | undefined): id is ObjectID => {
          return Boolean(id);
        });
      if (dockerHostIds.length > 0) {
        const [dockerHostOwnerUsers, dockerHostOwnerTeams]: [
          Array<DockerHostOwnerUser>,
          Array<DockerHostOwnerTeam>,
        ] = await Promise.all([
          DockerHostOwnerUserService.findBy({
            query: { dockerHostId: QueryHelper.any(dockerHostIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          DockerHostOwnerTeamService.findBy({
            query: { dockerHostId: QueryHelper.any(dockerHostIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);
        for (const ownerUser of dockerHostOwnerUsers) {
          if (ownerUser.userId) {
            inheritedFromDockerHostUserIds.add(ownerUser.userId.toString());
          }
        }
        for (const ownerTeam of dockerHostOwnerTeams) {
          if (ownerTeam.teamId) {
            inheritedFromDockerHostTeamIds.add(ownerTeam.teamId.toString());
          }
        }
      }
    }

    if (inheritFromPodmanHosts && alert.podmanHosts?.length) {
      const podmanHostIds: Array<ObjectID> = alert.podmanHosts
        .map((p: PodmanHost) => {
          return p.id;
        })
        .filter((id: ObjectID | null | undefined): id is ObjectID => {
          return Boolean(id);
        });
      if (podmanHostIds.length > 0) {
        const [podmanHostOwnerUsers, podmanHostOwnerTeams]: [
          Array<PodmanHostOwnerUser>,
          Array<PodmanHostOwnerTeam>,
        ] = await Promise.all([
          PodmanHostOwnerUserService.findBy({
            query: { podmanHostId: QueryHelper.any(podmanHostIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          PodmanHostOwnerTeamService.findBy({
            query: { podmanHostId: QueryHelper.any(podmanHostIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);
        for (const ownerUser of podmanHostOwnerUsers) {
          if (ownerUser.userId) {
            inheritedFromPodmanHostUserIds.add(ownerUser.userId.toString());
          }
        }
        for (const ownerTeam of podmanHostOwnerTeams) {
          if (ownerTeam.teamId) {
            inheritedFromPodmanHostTeamIds.add(ownerTeam.teamId.toString());
          }
        }
      }
    }

    if (inheritFromServices && alert.services?.length) {
      const serviceIds: Array<ObjectID> = alert.services
        .map((s: Service) => {
          return s.id;
        })
        .filter((id: ObjectID | null | undefined): id is ObjectID => {
          return Boolean(id);
        });
      if (serviceIds.length > 0) {
        const [serviceOwnerUsers, serviceOwnerTeams]: [
          Array<ServiceOwnerUser>,
          Array<ServiceOwnerTeam>,
        ] = await Promise.all([
          ServiceOwnerUserService.findBy({
            query: { serviceId: QueryHelper.any(serviceIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          ServiceOwnerTeamService.findBy({
            query: { serviceId: QueryHelper.any(serviceIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);
        for (const ownerUser of serviceOwnerUsers) {
          if (ownerUser.userId) {
            inheritedFromServiceUserIds.add(ownerUser.userId.toString());
          }
        }
        for (const ownerTeam of serviceOwnerTeams) {
          if (ownerTeam.teamId) {
            inheritedFromServiceTeamIds.add(ownerTeam.teamId.toString());
          }
        }
      }
    }

    const inheritedUserIds: Set<string> = new Set([
      ...inheritedFromMonitorUserIds,
      ...inheritedFromHostUserIds,
      ...inheritedFromKubernetesClusterUserIds,
      ...inheritedFromDockerHostUserIds,
      ...inheritedFromPodmanHostUserIds,
      ...inheritedFromServiceUserIds,
    ]);
    const inheritedTeamIds: Set<string> = new Set([
      ...inheritedFromMonitorTeamIds,
      ...inheritedFromHostTeamIds,
      ...inheritedFromKubernetesClusterTeamIds,
      ...inheritedFromDockerHostTeamIds,
      ...inheritedFromPodmanHostTeamIds,
      ...inheritedFromServiceTeamIds,
    ]);

    if (inheritedUserIds.size > 0 || inheritedTeamIds.size > 0) {
      // A run that did not opt in to notifications adds inherited owners silently too.
      const inheritNotify: boolean =
        inheritNotifyMode.value === true && data.allowOwnerNotification;
      for (const id of inheritedUserIds) {
        usersByNotify.get(inheritNotify)!.add(id);
        allUserIds.add(id);
      }
      for (const id of inheritedTeamIds) {
        teamsByNotify.get(inheritNotify)!.add(id);
        allTeamIds.add(id);
      }
    }

    if (
      matchedRules.length === 0 ||
      (allUserIds.size === 0 && allTeamIds.size === 0)
    ) {
      return RuleApplicationResultUtil.alreadyApplied();
    }

    // Owners already on the alert are skipped rather than duplicated.
    const notYetAssigned: OwnersToAssign =
      await OwnerRuleAssignment.getOwnersNotYetAssigned({
        ownerUserService: AlertOwnerUserService,
        ownerTeamService: AlertOwnerTeamService,
        resourceIdColumn: "alertId",
        resourceId: alert.id,
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

      await AlertService.addOwners(
        alert.projectId,
        alert.id,
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

    logger.debug(`AlertOwnerRuleEngine added owners to alert ${alert.id}`, {
      projectId: alert.projectId.toString(),
    } as LogAttributes);

    const addedUserIdSet: Set<string> = new Set(addedUserIds);
    const addedTeamIdSet: Set<string> = new Set(addedTeamIds);

    await this.createRuleExecutedFeedItem({
      alert,
      matchedRules,
      userIds: addedUserIds,
      teamIds: addedTeamIds,
      inheritedFromMonitors: addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: inheritedFromMonitorUserIds,
        inheritedTeamIds: inheritedFromMonitorTeamIds,
      }),
      inheritedFromHosts: addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: inheritedFromHostUserIds,
        inheritedTeamIds: inheritedFromHostTeamIds,
      }),
      inheritedFromKubernetesClusters: addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: inheritedFromKubernetesClusterUserIds,
        inheritedTeamIds: inheritedFromKubernetesClusterTeamIds,
      }),
      inheritedFromDockerHosts: addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: inheritedFromDockerHostUserIds,
        inheritedTeamIds: inheritedFromDockerHostTeamIds,
      }),
      inheritedFromPodmanHosts: addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: inheritedFromPodmanHostUserIds,
        inheritedTeamIds: inheritedFromPodmanHostTeamIds,
      }),
      inheritedFromServices: addedAnyInheritedOwner({
        addedUserIds: addedUserIdSet,
        addedTeamIds: addedTeamIdSet,
        inheritedUserIds: inheritedFromServiceUserIds,
        inheritedTeamIds: inheritedFromServiceTeamIds,
      }),
    });

    return RuleApplicationResultUtil.updated(ownersAdded);
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    alert: Alert;
    matchedRules: Array<AlertOwnerRule>;
    userIds: Array<string>;
    teamIds: Array<string>;
    inheritedFromMonitors: boolean;
    inheritedFromHosts: boolean;
    inheritedFromKubernetesClusters: boolean;
    inheritedFromDockerHosts: boolean;
    inheritedFromPodmanHosts: boolean;
    inheritedFromServices: boolean;
  }): Promise<void> {
    const {
      alert,
      matchedRules,
      userIds,
      teamIds,
      inheritedFromMonitors,
      inheritedFromHosts,
      inheritedFromKubernetesClusters,
      inheritedFromDockerHosts,
      inheritedFromPodmanHosts,
      inheritedFromServices,
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
      if (inheritedFromKubernetesClusters) {
        inheritedSources.push("Kubernetes clusters");
      }
      if (inheritedFromDockerHosts) {
        inheritedSources.push("Docker hosts");
      }
      if (inheritedFromPodmanHosts) {
        inheritedSources.push("Podman hosts");
      }
      if (inheritedFromServices) {
        inheritedSources.push("services");
      }
      const inheritedNote: string =
        inheritedSources.length > 0
          ? `\n\n_Some owners were inherited from the alert's ${inheritedSources.join(", ")}._`
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
    return await RuleCriteriaMatcher.matchesWithLegacy({
      rule,
      legacyFields: [
        "monitors",
        "alertSeverities",
        "alertLabels",
        "monitorLabels",
        "alertTitlePattern",
        "alertDescriptionPattern",
        "monitorNamePattern",
        "monitorDescriptionPattern",
      ],
      emptyResult: true,
      matchesLegacyRule: async (
        legacyRule: AlertOwnerRule,
      ): Promise<boolean> => {
        return await this.doesAlertMatchLegacyRule(alert, legacyRule);
      },
    });
  }

  private async doesAlertMatchLegacyRule(
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
