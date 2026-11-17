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

// How a reader of many records reads who owns their resources (InheritedOwnersCache).
export interface InheritedOwnersReader {
  read(data: {
    sources: Set<OwnerRuleInheritSource>;
    resources: InheritableResources;
  }): Promise<Map<OwnerRuleInheritSource, OwnerIdSets>>;
}

// A row of a resource's owner table, read with the resource it is of.
type ResourceOwnerRow = Record<string, unknown>;

// One kind of resource's owner tables, and its resources' column.
interface ResourceOwnerTables {
  source: OwnerRuleInheritSource;
  column: string;
  resources: (resources: InheritableResources) => Array<ObjectID>;
  readUsers: (ids: Array<ObjectID>) => Promise<Array<ResourceOwnerRow>>;
  readTeams: (ids: Array<ObjectID>) => Promise<Array<ResourceOwnerRow>>;
}

/*
 * Each resource's owner tables, read with the resource's id: every row of
 * them, in pages (findAllBy), as one read of many records' resources can
 * hold more than a page.
 */
function ownerTables(): Array<ResourceOwnerTables> {
  const reader: (
    service: {
      findAllBy: (args: never) => Promise<Array<unknown>>;
    },
    column: string,
    ownerColumn: "userId" | "teamId",
  ) => (ids: Array<ObjectID>) => Promise<Array<ResourceOwnerRow>> = (
    service: {
      findAllBy: (args: never) => Promise<Array<unknown>>;
    },
    column: string,
    ownerColumn: "userId" | "teamId",
  ): ((ids: Array<ObjectID>) => Promise<Array<ResourceOwnerRow>>) => {
    return async (ids: Array<ObjectID>): Promise<Array<ResourceOwnerRow>> => {
      return (await service.findAllBy({
        query: { [column]: QueryHelper.any(ids) },
        select: { [column]: true, [ownerColumn]: true },
        props: { isRoot: true },
      } as never)) as Array<ResourceOwnerRow>;
    };
  };

  const tables: Array<{
    source: OwnerRuleInheritSource;
    column: string;
    resources: (resources: InheritableResources) => Array<ObjectID>;
    users: { findAllBy: (args: never) => Promise<Array<unknown>> };
    teams: { findAllBy: (args: never) => Promise<Array<unknown>> };
  }> = [
    {
      source: "monitors",
      column: "monitorId",
      resources: (resources: InheritableResources): Array<ObjectID> => {
        return resources.monitorIds;
      },
      users: MonitorOwnerUserService as never,
      teams: MonitorOwnerTeamService as never,
    },
    {
      source: "hosts",
      column: "hostId",
      resources: (resources: InheritableResources): Array<ObjectID> => {
        return resources.hostIds;
      },
      users: HostOwnerUserService as never,
      teams: HostOwnerTeamService as never,
    },
    {
      source: "kubernetesClusters",
      column: "kubernetesClusterId",
      resources: (resources: InheritableResources): Array<ObjectID> => {
        return resources.kubernetesClusterIds;
      },
      users: KubernetesClusterOwnerUserService as never,
      teams: KubernetesClusterOwnerTeamService as never,
    },
    {
      source: "dockerHosts",
      column: "dockerHostId",
      resources: (resources: InheritableResources): Array<ObjectID> => {
        return resources.dockerHostIds;
      },
      users: DockerHostOwnerUserService as never,
      teams: DockerHostOwnerTeamService as never,
    },
    {
      source: "podmanHosts",
      column: "podmanHostId",
      resources: (resources: InheritableResources): Array<ObjectID> => {
        return resources.podmanHostIds;
      },
      users: PodmanHostOwnerUserService as never,
      teams: PodmanHostOwnerTeamService as never,
    },
    {
      source: "services",
      column: "serviceId",
      resources: (resources: InheritableResources): Array<ObjectID> => {
        return resources.serviceIds;
      },
      users: ServiceOwnerUserService as never,
      teams: ServiceOwnerTeamService as never,
    },
  ];

  return tables.map(
    (table: {
      source: OwnerRuleInheritSource;
      column: string;
      resources: (resources: InheritableResources) => Array<ObjectID>;
      users: { findAllBy: (args: never) => Promise<Array<unknown>> };
      teams: { findAllBy: (args: never) => Promise<Array<unknown>> };
    }): ResourceOwnerTables => {
      return {
        source: table.source,
        column: table.column,
        resources: table.resources,
        readUsers: reader(table.users, table.column, "userId"),
        readTeams: reader(table.teams, table.column, "teamId"),
      };
    },
  );
}

// An id a row holds, as text in lower case; "" for none.
function rowId(row: ResourceOwnerRow, column: string): string {
  const value: unknown = row[column];

  return value ? String(value).trim().toLowerCase() : "";
}

/*
 * WHO OWNS THE RESOURCES OF MANY RECORDS OF ONE PROJECT, read once each
 * (#9407, #9371): "When this goes down" of every monitor at once (Setup
 * health, WhoIsToldService.resolveProject) plans each incident's and
 * alert's owner rules, and a rule that inherits from a monitor would read
 * that monitor's owners once per record. This reads each resource's owners
 * the first time a record names it - every monitor's at once, with
 * preload - and hands each record the owners of its own, as
 * InheritedOwners.read reads them: a source a matched rule inherits from
 * and the record has resources of, its owners the union of theirs.
 */
export class InheritedOwnersCache implements InheritedOwnersReader {
  // Each resource's owners, by its source and id (lower case).
  private readonly owners: Map<string, OwnerIdSets> = new Map();
  private readonly tables: Array<ResourceOwnerTables> = ownerTables();

  // Reads these resources' owners now, in one read of each table.
  public async preload(data: {
    source: OwnerRuleInheritSource;
    resourceIds: Array<ObjectID>;
  }): Promise<void> {
    const table: ResourceOwnerTables | undefined = this.tables.find(
      (item: ResourceOwnerTables): boolean => {
        return item.source === data.source;
      },
    );

    if (table) {
      await this.readMissing(table, data.resourceIds);
    }
  }

  // Everyone who owns a resource read so far: whom a record may inherit.
  public getAllHeld(): OwnerIdSets {
    const all: OwnerIdSets = {
      userIds: new Set<string>(),
      teamIds: new Set<string>(),
    };

    for (const owners of this.owners.values()) {
      for (const userId of owners.userIds) {
        all.userIds.add(userId);
      }

      for (const teamId of owners.teamIds) {
        all.teamIds.add(teamId);
      }
    }

    return all;
  }

  public async read(data: {
    sources: Set<OwnerRuleInheritSource>;
    resources: InheritableResources;
  }): Promise<Map<OwnerRuleInheritSource, OwnerIdSets>> {
    const inherited: Map<OwnerRuleInheritSource, OwnerIdSets> = new Map();

    for (const table of this.tables) {
      const resourceIds: Array<ObjectID> = table.resources(data.resources);

      if (!data.sources.has(table.source) || resourceIds.length === 0) {
        continue;
      }

      await this.readMissing(table, resourceIds);

      const owners: OwnerIdSets = {
        userIds: new Set<string>(),
        teamIds: new Set<string>(),
      };

      for (const resourceId of resourceIds) {
        const held: OwnerIdSets | undefined = this.owners.get(
          this.key(table.source, resourceId),
        );

        for (const userId of held?.userIds || []) {
          owners.userIds.add(userId);
        }

        for (const teamId of held?.teamIds || []) {
          owners.teamIds.add(teamId);
        }
      }

      inherited.set(table.source, owners);
    }

    return inherited;
  }

  private key(source: OwnerRuleInheritSource, id: ObjectID | string): string {
    return `${source}|${id.toString().trim().toLowerCase()}`;
  }

  private async readMissing(
    table: ResourceOwnerTables,
    resourceIds: Array<ObjectID>,
  ): Promise<void> {
    const missing: Array<ObjectID> = [];
    const asked: Set<string> = new Set<string>();

    for (const id of resourceIds) {
      const key: string = this.key(table.source, id);

      if (!this.owners.has(key) && !asked.has(key)) {
        asked.add(key);
        missing.push(id);
      }
    }

    if (missing.length === 0) {
      return;
    }

    const [users, teams]: [Array<ResourceOwnerRow>, Array<ResourceOwnerRow>] =
      await Promise.all([table.readUsers(missing), table.readTeams(missing)]);

    for (const id of missing) {
      this.owners.set(this.key(table.source, id), {
        userIds: new Set<string>(),
        teamIds: new Set<string>(),
      });
    }

    for (const row of users) {
      const owners: OwnerIdSets | undefined = this.owners.get(
        this.key(table.source, rowId(row, table.column)),
      );
      const value: unknown = row["userId"];

      if (owners && value) {
        owners.userIds.add(String(value));
      }
    }

    for (const row of teams) {
      const owners: OwnerIdSets | undefined = this.owners.get(
        this.key(table.source, rowId(row, table.column)),
      );
      const value: unknown = row["teamId"];

      if (owners && value) {
        owners.teamIds.add(String(value));
      }
    }
  }
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
