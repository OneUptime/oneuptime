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
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceOwnerRule from "../../Models/DatabaseModels/ScheduledMaintenanceOwnerRule";
import Service from "../../Models/DatabaseModels/Service";
import ServiceOwnerTeam from "../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../Models/DatabaseModels/ServiceOwnerUser";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
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
import ScheduledMaintenanceFeedService from "./ScheduledMaintenanceFeedService";
import ScheduledMaintenanceOwnerRuleService from "./ScheduledMaintenanceOwnerRuleService";
import ScheduledMaintenanceService from "./ScheduledMaintenanceService";
import ServiceOwnerTeamService from "./ServiceOwnerTeamService";
import ServiceOwnerUserService from "./ServiceOwnerUserService";
import TeamService from "./TeamService";
import UserService from "./UserService";
import { ScheduledMaintenanceFeedEventType } from "../../Models/DatabaseModels/ScheduledMaintenanceFeed";
import { Indigo500 } from "../../Types/BrandColors";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

class ScheduledMaintenanceOwnerRuleEngineServiceClass {
  /**
   * Evaluates ScheduledMaintenanceOwnerRule rows for the given event and adds
   * matched owner users / teams via ScheduledMaintenanceService.addOwners.
   * Rules with notifyOwners set notify the added owners; rules with
   * notifyOwners off add silently.
   */
  @CaptureSpan()
  public async applyRulesToScheduledMaintenance(
    scheduledMaintenance: ScheduledMaintenance,
  ): Promise<void> {
    if (!scheduledMaintenance.id || !scheduledMaintenance.projectId) {
      return;
    }

    try {
      const rules: Array<ScheduledMaintenanceOwnerRule> =
        await ScheduledMaintenanceOwnerRuleService.findBy({
          query: {
            projectId: scheduledMaintenance.projectId,
            isEnabled: true,
          },
          props: { isRoot: true },
          select: {
            _id: true,
            name: true,
            notifyOwners: true,
            monitors: { _id: true },
            scheduledMaintenanceLabels: { _id: true },
            monitorLabels: { _id: true },
            titlePattern: true,
            descriptionPattern: true,
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

      const matchedRules: Array<ScheduledMaintenanceOwnerRule> = [];
      const allUserIds: Set<string> = new Set();
      const allTeamIds: Set<string> = new Set();
      let inheritFromMonitors: boolean = false;
      let inheritFromHosts: boolean = false;
      let inheritFromKubernetesClusters: boolean = false;
      let inheritFromDockerHosts: boolean = false;
      let inheritFromPodmanHosts: boolean = false;
      let inheritFromServices: boolean = false;
      const inheritNotifyMode: { value: boolean | null } = { value: null };

      for (const rule of rules) {
        const matches: boolean = await this.doesScheduledMaintenanceMatchRule(
          scheduledMaintenance,
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

      if (inheritFromMonitors && scheduledMaintenance.monitors?.length) {
        const monitorIds: Array<ObjectID> = scheduledMaintenance.monitors
          .map((m: Monitor) => {
            return m.id;
          })
          .filter((id: ObjectID | null | undefined): id is ObjectID => {
            return Boolean(id);
          });
        if (monitorIds.length > 0) {
          const [monitorOwnerUsers, monitorOwnerTeams]: [
            Array<MonitorOwnerUser>,
            Array<MonitorOwnerTeam>,
          ] = await Promise.all([
            MonitorOwnerUserService.findBy({
              query: { monitorId: QueryHelper.any(monitorIds) },
              select: { userId: true },
              props: { isRoot: true },
              limit: LIMIT_MAX,
              skip: 0,
            }),
            MonitorOwnerTeamService.findBy({
              query: { monitorId: QueryHelper.any(monitorIds) },
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
      }

      if (inheritFromHosts && scheduledMaintenance.hosts?.length) {
        const hostIds: Array<ObjectID> = scheduledMaintenance.hosts
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

      if (
        inheritFromKubernetesClusters &&
        scheduledMaintenance.kubernetesClusters?.length
      ) {
        const clusterIds: Array<ObjectID> =
          scheduledMaintenance.kubernetesClusters
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

      if (inheritFromDockerHosts && scheduledMaintenance.dockerHosts?.length) {
        const dockerHostIds: Array<ObjectID> = scheduledMaintenance.dockerHosts
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

      if (
        inheritFromPodmanHosts &&
        scheduledMaintenance.podmanHosts?.length
      ) {
        const podmanHostIds: Array<ObjectID> = scheduledMaintenance.podmanHosts
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

      if (inheritFromServices && scheduledMaintenance.services?.length) {
        const serviceIds: Array<ObjectID> = scheduledMaintenance.services
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

        await ScheduledMaintenanceService.addOwners(
          scheduledMaintenance.projectId,
          scheduledMaintenance.id,
          userIds,
          teamIds,
          notify,
          { isRoot: true },
        );
      }

      logger.debug(
        `ScheduledMaintenanceOwnerRuleEngine added owners to event ${scheduledMaintenance.id}`,
        {
          projectId: scheduledMaintenance.projectId.toString(),
        } as LogAttributes,
      );

      await this.createRuleExecutedFeedItem({
        scheduledMaintenance,
        matchedRules,
        userIds: Array.from(allUserIds),
        teamIds: Array.from(allTeamIds),
        inheritedFromMonitors:
          inheritedFromMonitorUserIds.size + inheritedFromMonitorTeamIds.size >
          0,
        inheritedFromHosts:
          inheritedFromHostUserIds.size + inheritedFromHostTeamIds.size > 0,
        inheritedFromKubernetesClusters:
          inheritedFromKubernetesClusterUserIds.size +
            inheritedFromKubernetesClusterTeamIds.size >
          0,
        inheritedFromDockerHosts:
          inheritedFromDockerHostUserIds.size +
            inheritedFromDockerHostTeamIds.size >
          0,
        inheritedFromPodmanHosts:
          inheritedFromPodmanHostUserIds.size +
            inheritedFromPodmanHostTeamIds.size >
          0,
        inheritedFromServices:
          inheritedFromServiceUserIds.size + inheritedFromServiceTeamIds.size >
          0,
      });
    } catch (error) {
      logger.error(
        `Error applying scheduled maintenance owner rules: ${error}`,
        {
          projectId: scheduledMaintenance.projectId?.toString(),
          scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async createRuleExecutedFeedItem(data: {
    scheduledMaintenance: ScheduledMaintenance;
    matchedRules: Array<ScheduledMaintenanceOwnerRule>;
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
      scheduledMaintenance,
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
      !scheduledMaintenance.id ||
      !scheduledMaintenance.projectId ||
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
        .map((r: ScheduledMaintenanceOwnerRule) => {
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
        inheritedSources.push("monitors");
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
          ? `\n\n_Some owners were inherited from the event's ${inheritedSources.join(", ")}._`
          : "";

      const feedInfoInMarkdown: string = `🛡️ **Scheduled Maintenance Owner Rule${
        matchedRules.length > 1 ? "s" : ""
      } executed:** ${rulesPart}\n\nAssigned the following owner${
        userLines.length + teamLines.length === 1 ? "" : "s"
      } to the event:${ownersPart}${inheritedNote}`;

      await ScheduledMaintenanceFeedService.createScheduledMaintenanceFeedItem({
        scheduledMaintenanceId: scheduledMaintenance.id,
        projectId: scheduledMaintenance.projectId,
        scheduledMaintenanceFeedEventType:
          ScheduledMaintenanceFeedEventType.OwnerRuleExecuted,
        displayColor: Indigo500,
        feedInfoInMarkdown,
      });
    } catch (error) {
      logger.error(
        `ScheduledMaintenanceOwnerRuleEngine: failed to create rule-executed feed item: ${
          error instanceof Error ? error.message : String(error)
        }`,
        {
          projectId: scheduledMaintenance.projectId?.toString(),
          scheduledMaintenanceId: scheduledMaintenance.id?.toString(),
        } as LogAttributes,
      );
    }
  }

  @CaptureSpan()
  private async doesScheduledMaintenanceMatchRule(
    scheduledMaintenance: ScheduledMaintenance,
    rule: ScheduledMaintenanceOwnerRule,
  ): Promise<boolean> {
    if (rule.monitors && rule.monitors.length > 0) {
      if (
        !scheduledMaintenance.monitors ||
        scheduledMaintenance.monitors.length === 0
      ) {
        return false;
      }
      const ruleMonitorIds: Array<string> = rule.monitors.map((m: Monitor) => {
        return m.id?.toString() || "";
      });
      const eventMonitorIds: Array<string> = scheduledMaintenance.monitors.map(
        (m: Monitor) => {
          return m.id?.toString() || "";
        },
      );
      if (
        !ruleMonitorIds.some((id: string) => {
          return eventMonitorIds.includes(id);
        })
      ) {
        return false;
      }
    }

    if (
      rule.scheduledMaintenanceLabels &&
      rule.scheduledMaintenanceLabels.length > 0
    ) {
      if (
        !scheduledMaintenance.labels ||
        scheduledMaintenance.labels.length === 0
      ) {
        return false;
      }
      const ruleLabelIds: Array<string> = rule.scheduledMaintenanceLabels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      const eventLabelIds: Array<string> = scheduledMaintenance.labels.map(
        (l: Label) => {
          return l.id?.toString() || "";
        },
      );
      if (
        !ruleLabelIds.some((id: string) => {
          return eventLabelIds.includes(id);
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
      if (
        !scheduledMaintenance.monitors ||
        scheduledMaintenance.monitors.length === 0
      ) {
        return false;
      }

      let anyMonitorMatches: boolean = false;
      for (const eventMonitor of scheduledMaintenance.monitors) {
        if (!eventMonitor.id) {
          continue;
        }
        const monitor: Monitor | null = await MonitorService.findOneById({
          id: eventMonitor.id,
          select: {
            name: true,
            description: true,
            labels: { _id: true },
          },
          props: { isRoot: true },
        });
        if (!monitor) {
          continue;
        }

        let monitorMatches: boolean = true;

        if (rule.monitorLabels && rule.monitorLabels.length > 0) {
          if (!monitor.labels || monitor.labels.length === 0) {
            monitorMatches = false;
          } else {
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
              monitorMatches = false;
            }
          }
        }

        if (
          monitorMatches &&
          rule.monitorNamePattern &&
          (!monitor.name ||
            !this.testRegex(rule.monitorNamePattern, monitor.name, rule))
        ) {
          monitorMatches = false;
        }

        if (
          monitorMatches &&
          rule.monitorDescriptionPattern &&
          (!monitor.description ||
            !this.testRegex(
              rule.monitorDescriptionPattern,
              monitor.description,
              rule,
            ))
        ) {
          monitorMatches = false;
        }

        if (monitorMatches) {
          anyMonitorMatches = true;
          break;
        }
      }

      if (!anyMonitorMatches) {
        return false;
      }
    }

    if (
      rule.titlePattern &&
      (!scheduledMaintenance.title ||
        !this.testRegex(rule.titlePattern, scheduledMaintenance.title, rule))
    ) {
      return false;
    }

    if (
      rule.descriptionPattern &&
      (!scheduledMaintenance.description ||
        !this.testRegex(
          rule.descriptionPattern,
          scheduledMaintenance.description,
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
    rule: ScheduledMaintenanceOwnerRule,
  ): boolean {
    try {
      const regex: RegExp = new RegExp(pattern, "i");
      return regex.test(value);
    } catch {
      logger.warn(
        `Invalid regex in scheduled maintenance owner rule ${rule.id}: ${pattern}`,
      );
      return false;
    }
  }
}

export default new ScheduledMaintenanceOwnerRuleEngineServiceClass();
