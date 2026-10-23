import DockerHostOwnerTeam from "../../../Models/DatabaseModels/DockerHostOwnerTeam";
import DockerHostOwnerUser from "../../../Models/DatabaseModels/DockerHostOwnerUser";
import HostOwnerTeam from "../../../Models/DatabaseModels/HostOwnerTeam";
import HostOwnerUser from "../../../Models/DatabaseModels/HostOwnerUser";
import KubernetesClusterOwnerTeam from "../../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import KubernetesClusterOwnerUser from "../../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import MonitorOwnerTeam from "../../../Models/DatabaseModels/MonitorOwnerTeam";
import MonitorOwnerUser from "../../../Models/DatabaseModels/MonitorOwnerUser";
import PodmanHostOwnerTeam from "../../../Models/DatabaseModels/PodmanHostOwnerTeam";
import PodmanHostOwnerUser from "../../../Models/DatabaseModels/PodmanHostOwnerUser";
import ServiceOwnerTeam from "../../../Models/DatabaseModels/ServiceOwnerTeam";
import ServiceOwnerUser from "../../../Models/DatabaseModels/ServiceOwnerUser";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import DockerHostOwnerTeamService from "../../Services/DockerHostOwnerTeamService";
import DockerHostOwnerUserService from "../../Services/DockerHostOwnerUserService";
import HostOwnerTeamService from "../../Services/HostOwnerTeamService";
import HostOwnerUserService from "../../Services/HostOwnerUserService";
import KubernetesClusterOwnerTeamService from "../../Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterOwnerUserService from "../../Services/KubernetesClusterOwnerUserService";
import MonitorOwnerTeamService from "../../Services/MonitorOwnerTeamService";
import MonitorOwnerUserService from "../../Services/MonitorOwnerUserService";
import PodmanHostOwnerTeamService from "../../Services/PodmanHostOwnerTeamService";
import PodmanHostOwnerUserService from "../../Services/PodmanHostOwnerUserService";
import ServiceOwnerTeamService from "../../Services/ServiceOwnerTeamService";
import ServiceOwnerUserService from "../../Services/ServiceOwnerUserService";
import QueryHelper from "../../Types/Database/QueryHelper";
import { OwnerIdSets, OwnerRuleInheritSource } from "./OwnerRulePlan";

/*
 * WHO OWNS AN EVENT'S RESOURCES, FOR THE OWNER RULES THAT INHERIT FROM THEM.
 *
 * An incident or alert owner rule's Inherit Owners switches add every owner
 * of the event's monitors, hosts, Kubernetes clusters, Docker and Podman
 * hosts and services. Both engines read them here, as OneUptime (the rules
 * are the project's own configuration), once per evaluation and only for
 * the sources a matched rule inherits from (OwnerRulePlanBuilder
 * .getSourcesToInherit).
 */

// The ids of an event's resources of each kind.
export interface InheritableResources {
  monitorIds: Array<ObjectID>;
  hostIds: Array<ObjectID>;
  kubernetesClusterIds: Array<ObjectID>;
  dockerHostIds: Array<ObjectID>;
  podmanHostIds: Array<ObjectID>;
  serviceIds: Array<ObjectID>;
}

// An owner row's user or team id, as text.
interface OwnerRow {
  userId?: ObjectID | undefined;
  teamId?: ObjectID | undefined;
}

export default class InheritedOwners {
  // The ids of related rows the event was handed, each once.
  public static idsOf(
    resources:
      | Array<{ id?: ObjectID | null | undefined } | null | undefined>
      | null
      | undefined,
  ): Array<ObjectID> {
    const ids: Array<ObjectID> = [];
    const seen: Set<string> = new Set<string>();

    for (const resource of resources || []) {
      const id: ObjectID | null | undefined = resource?.id;

      if (id && !seen.has(id.toString())) {
        seen.add(id.toString());
        ids.push(id);
      }
    }

    return ids;
  }

  /*
   * The owners of each source in `sources`, by source. A source whose
   * resources are none is left out, as is one nobody asked for.
   */
  public static async read(data: {
    sources: Set<OwnerRuleInheritSource>;
    resources: InheritableResources;
  }): Promise<Map<OwnerRuleInheritSource, OwnerIdSets>> {
    const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> = new Map();

    const add: (
      source: OwnerRuleInheritSource,
      userRows: Array<OwnerRow>,
      teamRows: Array<OwnerRow>,
    ) => void = (
      source: OwnerRuleInheritSource,
      userRows: Array<OwnerRow>,
      teamRows: Array<OwnerRow>,
    ): void => {
      const owners: OwnerIdSets = {
        userIds: new Set<string>(),
        teamIds: new Set<string>(),
      };

      for (const row of userRows) {
        if (row.userId) {
          owners.userIds.add(row.userId.toString());
        }
      }

      for (const row of teamRows) {
        if (row.teamId) {
          owners.teamIds.add(row.teamId.toString());
        }
      }

      inherited.set(source, owners);
    };

    const wants: (
      source: OwnerRuleInheritSource,
      resourceIds: Array<ObjectID>,
    ) => boolean = (
      source: OwnerRuleInheritSource,
      resourceIds: Array<ObjectID>,
    ): boolean => {
      return data.sources.has(source) && resourceIds.length > 0;
    };

    const { resources } = data;

    if (wants("monitors", resources.monitorIds)) {
      const [users, teams]: [Array<MonitorOwnerUser>, Array<MonitorOwnerTeam>] =
        await Promise.all([
          MonitorOwnerUserService.findBy({
            query: { monitorId: QueryHelper.any(resources.monitorIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          MonitorOwnerTeamService.findBy({
            query: { monitorId: QueryHelper.any(resources.monitorIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);

      add("monitors", users, teams);
    }

    if (wants("hosts", resources.hostIds)) {
      const [users, teams]: [Array<HostOwnerUser>, Array<HostOwnerTeam>] =
        await Promise.all([
          HostOwnerUserService.findBy({
            query: { hostId: QueryHelper.any(resources.hostIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          HostOwnerTeamService.findBy({
            query: { hostId: QueryHelper.any(resources.hostIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);

      add("hosts", users, teams);
    }

    if (wants("kubernetesClusters", resources.kubernetesClusterIds)) {
      const [users, teams]: [
        Array<KubernetesClusterOwnerUser>,
        Array<KubernetesClusterOwnerTeam>,
      ] = await Promise.all([
        KubernetesClusterOwnerUserService.findBy({
          query: {
            kubernetesClusterId: QueryHelper.any(
              resources.kubernetesClusterIds,
            ),
          },
          select: { userId: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        }),
        KubernetesClusterOwnerTeamService.findBy({
          query: {
            kubernetesClusterId: QueryHelper.any(
              resources.kubernetesClusterIds,
            ),
          },
          select: { teamId: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        }),
      ]);

      add("kubernetesClusters", users, teams);
    }

    if (wants("dockerHosts", resources.dockerHostIds)) {
      const [users, teams]: [
        Array<DockerHostOwnerUser>,
        Array<DockerHostOwnerTeam>,
      ] = await Promise.all([
        DockerHostOwnerUserService.findBy({
          query: { dockerHostId: QueryHelper.any(resources.dockerHostIds) },
          select: { userId: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        }),
        DockerHostOwnerTeamService.findBy({
          query: { dockerHostId: QueryHelper.any(resources.dockerHostIds) },
          select: { teamId: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        }),
      ]);

      add("dockerHosts", users, teams);
    }

    if (wants("podmanHosts", resources.podmanHostIds)) {
      const [users, teams]: [
        Array<PodmanHostOwnerUser>,
        Array<PodmanHostOwnerTeam>,
      ] = await Promise.all([
        PodmanHostOwnerUserService.findBy({
          query: { podmanHostId: QueryHelper.any(resources.podmanHostIds) },
          select: { userId: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        }),
        PodmanHostOwnerTeamService.findBy({
          query: { podmanHostId: QueryHelper.any(resources.podmanHostIds) },
          select: { teamId: true },
          props: { isRoot: true },
          limit: LIMIT_MAX,
          skip: 0,
        }),
      ]);

      add("podmanHosts", users, teams);
    }

    if (wants("services", resources.serviceIds)) {
      const [users, teams]: [Array<ServiceOwnerUser>, Array<ServiceOwnerTeam>] =
        await Promise.all([
          ServiceOwnerUserService.findBy({
            query: { serviceId: QueryHelper.any(resources.serviceIds) },
            select: { userId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
          ServiceOwnerTeamService.findBy({
            query: { serviceId: QueryHelper.any(resources.serviceIds) },
            select: { teamId: true },
            props: { isRoot: true },
            limit: LIMIT_MAX,
            skip: 0,
          }),
        ]);

      add("services", users, teams);
    }

    return inherited;
  }
}
