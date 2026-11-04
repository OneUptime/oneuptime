import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import Host from "../../../Models/DatabaseModels/Host";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Service from "../../../Models/DatabaseModels/Service";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OPENSTACK_REACH_LIST_LIMIT,
  OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT,
  OpenStackCephClusterCandidate,
  OpenStackLinkedHost,
  OpenStackLinkedKubernetesNode,
  OpenStackLinkedService,
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  OpenStackStoragePoolCephLink,
  getOnlyOpenStackMatch,
  getOpenStackStoragePoolCephLink,
  isOpenStackHostNameMatch,
  isOpenStackStoragePoolCephLinked,
} from "../../../Types/OpenStack/OpenStackLinks";
import {
  getOpenStackInstanceIdOfProviderId,
  isOpenStackInstanceId,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { getOpenStackShortHostName } from "../../../Types/OpenStack/OpenStackHealthRules";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../Types/Telemetry/EntityType";
import { keyForHost } from "../../../Utils/Telemetry/EntityKey";
import CephClusterService from "../../Services/CephClusterService";
import CephResourceService from "../../Services/CephResourceService";
import HostService from "../../Services/HostService";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import OpenStackCloudService from "../../Services/OpenStackCloudService";
import OpenStackResourceService from "../../Services/OpenStackResourceService";
import ServiceService from "../../Services/ServiceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import InventoryItem, { ExtractedEntity } from "../Telemetry/TelemetryEntity";
import { reconcileEntityRegistryThrottled } from "../Telemetry/EntityRegistry";

/*
 * THE JOINS BETWEEN A CLOUD AND THE REST OF ONEUPTIME.
 *
 * Every read here is bounded, and most are one indexed statement. These run on a page's load,
 * in an alert's description and in an investigation, on estates with hundreds of thousands
 * of instances. What makes a match a match is OpenStackLinks' to say: this only reads.
 */

// A hypervisor holds a few hundred instances at most. This keeps a mistaken name harmless.
const INSTANCES_PER_REACH: number = 5000;
// How many Kubernetes nodes one project's clouds can hold before a blast radius stops at them.
const OPENSTACK_KUBERNETES_NODES_READ: number = 20000;
// A service is on a host for this long after it last said so. Long enough for one that is slow.
const SERVICE_PLACEMENT_FRESH_DAYS: number = 1;

const PLACEMENT_SELECT: {
  kind: true;
  externalId: true;
  name: true;
  regionName: true;
  availabilityZone: true;
  hypervisorName: true;
  openStackProjectId: true;
  status: true;
  openStackCloudId: true;
} = {
  kind: true,
  externalId: true,
  name: true,
  regionName: true,
  availabilityZone: true,
  hypervisorName: true,
  openStackProjectId: true,
  status: true,
  openStackCloudId: true,
};

function escapeLike(text: string): string {
  return text.replace(/[\\%_]/g, "\\$&");
}

export default class OpenStackAcrossProducts {
  // The clouds a project has: what makes a read by instance UUID a read of a few index probes.
  private static async readCloudsOfProject(
    projectId: ObjectID,
  ): Promise<Array<OpenStackCloud>> {
    return await OpenStackCloudService.findBy({
      query: { projectId },
      select: { _id: true, name: true },
      limit: 200,
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * The instances with this UUID in any of the project's clouds. Two clouds holding one
   * UUID is a restored copy of a cloud, and whichever they are, neither can be chosen.
   */
  private static async readInstancesById(data: {
    projectId: ObjectID;
    instanceId: string;
  }): Promise<Array<OpenStackResource>> {
    const clouds: Array<OpenStackCloud> = await this.readCloudsOfProject(
      data.projectId,
    );
    if (clouds.length === 0) {
      return [];
    }
    return await OpenStackResourceService.findBy({
      query: {
        projectId: data.projectId,
        openStackCloudId: QueryHelper.any(
          clouds.map((cloud: OpenStackCloud): ObjectID => {
            return cloud.id!;
          }),
        ),
        kind: OpenStackResourceKind.Instance,
        externalId: data.instanceId,
      },
      select: PLACEMENT_SELECT,
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async readHypervisorsByHostName(data: {
    projectId: ObjectID;
    hostName: string;
    openStackCloudId?: ObjectID | undefined;
  }): Promise<Array<OpenStackResource>> {
    const lower: string = data.hostName.trim().toLowerCase();
    const short: string = getOpenStackShortHostName(lower);
    if (!lower) {
      return [];
    }
    const rows: Array<{
      _id: string;
    }> = await OpenStackResourceService.getRepository().manager.query(
      `SELECT "_id" FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "kind" = '${OpenStackResourceKind.Hypervisor}'
         AND "deletedAt" IS NULL
         AND ($2::uuid IS NULL OR "openStackCloudId" = $2)
         AND (LOWER("hypervisorName") = $3
           OR LOWER("hypervisorName") = $4
           OR LOWER("hypervisorName") LIKE $5)
       LIMIT 20`,
      [
        data.projectId.toString(),
        data.openStackCloudId?.toString() || null,
        lower,
        short,
        `${escapeLike(short)}.%`,
      ],
    );
    if (rows.length === 0) {
      return [];
    }
    const found: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          _id: QueryHelper.any(
            rows.map((row: { _id: string }): string => {
              return row._id;
            }),
          ) as never,
        },
        select: PLACEMENT_SELECT,
        limit: rows.length,
        skip: 0,
        props: { isRoot: true },
      });
    return found.filter((row: OpenStackResource): boolean => {
      return isOpenStackHostNameMatch(data.hostName, row.hypervisorName);
    });
  }

  private static async toPlacement(
    row: OpenStackResource,
  ): Promise<OpenStackPlacement> {
    const cloud: OpenStackCloud | null = row.openStackCloudId
      ? await OpenStackCloudService.findOneById({
          id: row.openStackCloudId,
          select: { name: true },
          props: { isRoot: true },
        })
      : null;

    let projectName: string | null = null;
    if (row.openStackProjectId && row.openStackCloudId) {
      const project: OpenStackResource | null =
        await OpenStackResourceService.findOneBy({
          query: {
            projectId: row.projectId,
            openStackCloudId: row.openStackCloudId,
            kind: OpenStackResourceKind.Project,
            externalId: row.openStackProjectId,
          },
          select: { name: true },
          props: { isRoot: true },
        });
      projectName = project?.name || null;
    }

    let hypervisorExternalId: string | null = null;
    if (row.kind === OpenStackResourceKind.Hypervisor) {
      hypervisorExternalId = row.externalId || null;
    } else if (row.hypervisorName && row.openStackCloudId) {
      const hypervisor: OpenStackResource | null =
        await OpenStackResourceService.findOneBy({
          query: {
            projectId: row.projectId,
            openStackCloudId: row.openStackCloudId,
            kind: OpenStackResourceKind.Hypervisor,
            hypervisorName: row.hypervisorName,
          },
          select: { externalId: true },
          props: { isRoot: true },
        });
      hypervisorExternalId = hypervisor?.externalId || null;
    }

    return {
      openStackCloudId: row.openStackCloudId?.toString() || "",
      cloudName: cloud?.name || null,
      kind:
        row.kind === OpenStackResourceKind.Hypervisor
          ? "hypervisor"
          : "instance",
      externalId: row.externalId || "",
      name: row.name || null,
      regionName: row.regionName || null,
      availabilityZone: row.availabilityZone || null,
      hypervisorName: row.hypervisorName || null,
      hypervisorExternalId,
      openStackProjectId: row.openStackProjectId || null,
      openStackProjectName: projectName,
      status: row.status || null,
    };
  }

  /*
   * Which part of which cloud a host's own words make it: the instance its `host.id` names,
   * or else the hypervisor its name matches. Instance first, because a UUID can't match by
   * chance, and a guest can be called anything, a hypervisor's name included.
   */
  private static async findPartOfHost(data: {
    projectId: ObjectID;
    hostIdAttribute: string | null | undefined;
    hostIdentifier: string | null | undefined;
    openStackCloudId?: ObjectID | undefined;
  }): Promise<OpenStackResource | null> {
    const instanceId: string | null = isOpenStackInstanceId(
      data.hostIdAttribute,
    )
      ? (data.hostIdAttribute as string).toLowerCase()
      : null;
    if (instanceId) {
      const instance: OpenStackResource | null = getOnlyOpenStackMatch(
        await this.readInstancesById({
          projectId: data.projectId,
          instanceId,
        }),
      );
      if (instance) {
        return instance;
      }
    }
    if (!data.hostIdentifier) {
      return null;
    }
    return getOnlyOpenStackMatch(
      await this.readHypervisorsByHostName({
        projectId: data.projectId,
        hostName: data.hostIdentifier,
        openStackCloudId: data.openStackCloudId,
      }),
    );
  }

  /*
   * The cloud a host belongs to, for the link ingest makes (Host.openStackCloudId). Null is
   * "not yet, or not on a guess": a name in two clouds links to neither.
   */
  public static async findCloudOfHost(data: {
    projectId: ObjectID;
    hostIdAttribute: string | null | undefined;
    hostIdentifier: string | null | undefined;
  }): Promise<ObjectID | null> {
    const part: OpenStackResource | null = await this.findPartOfHost(data);
    return part?.openStackCloudId || null;
  }

  public static async getPlacementOfHost(data: {
    projectId: ObjectID;
    hostId: ObjectID;
  }): Promise<OpenStackPlacement | null> {
    const host: Host | null = await HostService.findOneById({
      id: data.hostId,
      select: { hostId: true, hostIdentifier: true, openStackCloudId: true },
      props: { isRoot: true },
    });
    if (!host?.openStackCloudId) {
      return null;
    }
    const part: OpenStackResource | null = await this.findPartOfHost({
      projectId: data.projectId,
      hostIdAttribute: host.hostId,
      hostIdentifier: host.hostIdentifier,
      openStackCloudId: host.openStackCloudId,
    });
    return part ? await this.toPlacement(part) : null;
  }

  /*
   * The instance a Kubernetes node is, from its spec.providerID. A provider ID isn't a name
   * and can't be mistaken, but a UUID in two clouds still links to neither.
   */
  public static async getPlacementOfKubernetesNode(data: {
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    nodeName: string;
  }): Promise<OpenStackPlacement | null> {
    const rows: Array<{ providerId: string | null }> =
      await KubernetesResourceService.getRepository().manager.query(
        `SELECT "spec"->>'providerID' AS "providerId"
         FROM "KubernetesResource"
         WHERE "projectId" = $1 AND "kubernetesClusterId" = $2
           AND "kind" = 'Node' AND "name" = $3 AND "deletedAt" IS NULL
         LIMIT 2`,
        [
          data.projectId.toString(),
          data.kubernetesClusterId.toString(),
          data.nodeName,
        ],
      );
    const instanceId: string | null = getOpenStackInstanceIdOfProviderId(
      getOnlyOpenStackMatch(rows)?.providerId,
    );
    if (!instanceId) {
      return null;
    }
    const instance: OpenStackResource | null = getOnlyOpenStackMatch(
      await this.readInstancesById({ projectId: data.projectId, instanceId }),
    );
    return instance ? await this.toPlacement(instance) : null;
  }

  /*
   * Where a service runs: each host its telemetry names (the entity graph's hosted-on, from
   * what its own resource said), and each of those that is a part of a cloud. A service on
   * several hosts has several placements, and that is an answer rather than a guess.
   */
  public static async getPlacementsOfService(data: {
    projectId: ObjectID;
    serviceName: string;
  }): Promise<
    Array<{
      hostName: string;
      hostId: string | null;
      placement: OpenStackPlacement;
    }>
  > {
    const rows: Array<{ hostName: string | null; instanceId: string | null }> =
      await HostService.getRepository().manager.query(
        `SELECT DISTINCT host."identifyingAttributes"->>'host.name' AS "hostName",
                host."descriptiveAttributes"->>'host.id' AS "instanceId"
         FROM "InventoryItem" AS service
         JOIN "InventoryItemRelationship" AS rel
           ON rel."projectId" = service."projectId"
          AND rel."fromEntityKey" = service."entityKey"
          AND rel."relationshipType" = '${EntityRelationshipType.HostedOn}'
          AND rel."lastSeenAt" >= $3
          AND rel."deletedAt" IS NULL
         JOIN "InventoryItem" AS host
           ON host."projectId" = rel."projectId"
          AND host."entityKey" = rel."toEntityKey"
          AND host."entityType" = '${EntityType.Host}'
          AND host."deletedAt" IS NULL
         WHERE service."projectId" = $1
           AND service."entityType" = '${EntityType.Service}'
           AND service."identifyingAttributes"->>'service.name' = $2
           AND service."deletedAt" IS NULL
         LIMIT 20`,
        [
          data.projectId.toString(),
          data.serviceName,
          OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -SERVICE_PLACEMENT_FRESH_DAYS,
          ),
        ],
      );

    const placements: Array<{
      hostName: string;
      hostId: string | null;
      placement: OpenStackPlacement;
    }> = [];
    for (const row of rows) {
      if (!row.hostName) {
        continue;
      }
      const host: Host | null = await HostService.findOneBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: QueryHelper.findWithSameText(row.hostName),
        },
        select: { _id: true, hostId: true, hostIdentifier: true },
        props: { isRoot: true },
      });
      const part: OpenStackResource | null = await this.findPartOfHost({
        projectId: data.projectId,
        hostIdAttribute: host?.hostId || row.instanceId,
        hostIdentifier: row.hostName,
      });
      if (part) {
        placements.push({
          hostName: row.hostName,
          hostId: host?.id?.toString() || null,
          placement: await this.toPlacement(part),
        });
      }
    }
    return placements;
  }

  /*
   * The nodes of every Kubernetes cluster in a project that are OpenStack instances, or only
   * the one that is this instance: an instance's page has no reason to read the whole estate.
   */
  public static async readOpenStackKubernetesNodes(
    projectId: ObjectID,
    instanceId?: string | undefined,
  ): Promise<
    Array<{
      clusterId: string;
      clusterName: string;
      nodeName: string;
      instanceId: string;
    }>
  > {
    const rows: Array<{
      clusterId: string;
      clusterName: string | null;
      nodeName: string;
      providerId: string | null;
    }> = await KubernetesResourceService.getRepository().manager.query(
      `SELECT node."kubernetesClusterId" AS "clusterId",
              cluster."name" AS "clusterName",
              node."name" AS "nodeName",
              node."spec"->>'providerID' AS "providerId"
       FROM "KubernetesResource" AS node
       JOIN "KubernetesCluster" AS cluster ON cluster."_id" = node."kubernetesClusterId"
       WHERE node."projectId" = $1 AND node."kind" = 'Node'
         AND node."deletedAt" IS NULL
         AND node."spec"->>'providerID' LIKE $2
       LIMIT ${OPENSTACK_KUBERNETES_NODES_READ}`,
      [
        projectId.toString(),
        instanceId
          ? `openstack://%/${escapeLike(instanceId)}`
          : "openstack://%",
      ],
    );
    const nodes: Array<{
      clusterId: string;
      clusterName: string;
      nodeName: string;
      instanceId: string;
    }> = [];
    for (const row of rows) {
      const instanceId: string | null = getOpenStackInstanceIdOfProviderId(
        row.providerId,
      );
      if (instanceId) {
        nodes.push({
          clusterId: row.clusterId,
          clusterName: row.clusterName || row.clusterId,
          nodeName: row.nodeName,
          instanceId,
        });
      }
    }
    return nodes;
  }

  // The services a set of hosts run, as the entity graph knows from what each service said.
  public static async readServicesOnHosts(data: {
    projectId: ObjectID;
    hostIdentifiers: Array<string>;
  }): Promise<Array<OpenStackLinkedService>> {
    if (data.hostIdentifiers.length === 0) {
      return [];
    }
    const rows: Array<{ name: string | null }> =
      await HostService.getRepository().manager.query(
        `SELECT DISTINCT service."identifyingAttributes"->>'service.name' AS "name"
         FROM "InventoryItemRelationship" AS rel
         JOIN "InventoryItem" AS service
           ON service."projectId" = rel."projectId"
          AND service."entityKey" = rel."fromEntityKey"
          AND service."entityType" = '${EntityType.Service}'
          AND service."deletedAt" IS NULL
         WHERE rel."projectId" = $1
           AND rel."relationshipType" = '${EntityRelationshipType.HostedOn}'
           AND rel."toEntityKey" = ANY($2::text[])
           AND rel."lastSeenAt" >= $3
           AND rel."deletedAt" IS NULL
         LIMIT 500`,
        [
          data.projectId.toString(),
          data.hostIdentifiers.map((identifier: string): string => {
            return keyForHost(data.projectId.toString(), identifier);
          }),
          OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -SERVICE_PLACEMENT_FRESH_DAYS,
          ),
        ],
      );
    const names: Array<string> = rows
      .map((row: { name: string | null }): string => {
        return row.name || "";
      })
      .filter((name: string): boolean => {
        return Boolean(name);
      });
    if (names.length === 0) {
      return [];
    }
    const services: Array<Service> = await ServiceService.findBy({
      query: { projectId: data.projectId, name: QueryHelper.any(names) },
      select: { _id: true, name: true },
      limit: names.length,
      skip: 0,
      props: { isRoot: true },
    });
    return services.map((service: Service): OpenStackLinkedService => {
      return { id: service.id!.toString(), name: service.name || "" };
    });
  }

  private static async readHostsOfInstances(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    instanceIds: Array<string>;
  }): Promise<Array<Host>> {
    if (data.instanceIds.length === 0) {
      return [];
    }
    return await HostService.findBy({
      query: {
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        hostId: QueryHelper.any(data.instanceIds),
        isArchived: false,
      },
      select: { _id: true, name: true, hostIdentifier: true },
      limit: Math.min(data.instanceIds.length, INSTANCES_PER_REACH),
      skip: 0,
      props: { isRoot: true },
    });
  }

  /*
   * What a hypervisor's failure reaches beyond the cloud: the machine itself where
   * OneUptime's agent runs on it, the hosts and Kubernetes nodes its instances are, and the
   * services on those. Counted in full and named up to a limit.
   */
  public static async getReachOfHypervisor(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    hypervisorName: string;
    regionName?: string | null | undefined;
  }): Promise<OpenStackReachAcrossProducts> {
    const instances: Array<{ externalId: string }> =
      await OpenStackResourceService.getRepository().manager.query(
        `SELECT "externalId" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
           AND "hypervisorName" = $3 AND "regionName" IS NOT DISTINCT FROM $4
         LIMIT ${INSTANCES_PER_REACH}`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          data.hypervisorName,
          data.regionName ?? null,
        ],
      );
    const instanceIds: Array<string> = instances.map(
      (row: { externalId: string }): string => {
        return row.externalId;
      },
    );

    const [hypervisorHost, guestHosts, kubernetesNodes]: [
      Host | null,
      Array<Host>,
      Awaited<
        ReturnType<typeof OpenStackAcrossProducts.readOpenStackKubernetesNodes>
      >,
    ] = await Promise.all([
      this.getHostOfMachine({
        projectId: data.projectId,
        machineName: data.hypervisorName,
      }),
      this.readHostsOfInstances({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        instanceIds,
      }),
      this.readOpenStackKubernetesNodes(data.projectId),
    ]);

    return this.buildReach({
      hypervisorHost,
      guestHosts,
      kubernetesNodes: kubernetesNodes.filter(
        (node: { instanceId: string }): boolean => {
          return instanceIds.includes(node.instanceId);
        },
      ),
      services: await this.readServicesOnHosts({
        projectId: data.projectId,
        hostIdentifiers: [
          ...(hypervisorHost ? [hypervisorHost] : []),
          ...guestHosts,
        ]
          .map((host: Host): string => {
            return host.hostIdentifier || "";
          })
          .filter((identifier: string): boolean => {
            return Boolean(identifier);
          }),
      }),
    });
  }

  /*
   * The reach of a part that has one: a hypervisor, or the nova-compute on it. Nova's service
   * knows its host by the short name, and a name matching two hypervisors reaches neither.
   */
  public static async getReachOfPart(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    part: {
      kind: OpenStackResourceKind | string;
      name?: string | null | undefined;
      regionName?: string | null | undefined;
      hypervisorName?: string | null | undefined;
      facts?: JSONObject | null | undefined;
    };
  }): Promise<OpenStackReachAcrossProducts | null> {
    const { part } = data;
    let hypervisorName: string | null = null;
    if (part.kind === OpenStackResourceKind.Hypervisor) {
      hypervisorName = part.hypervisorName || part.name || null;
    } else if (
      part.kind === OpenStackResourceKind.Service &&
      part.name === "nova-compute"
    ) {
      const host: unknown = part.facts?.["host"];
      const hypervisors: Array<OpenStackResource> =
        typeof host === "string" && host
          ? (
              await this.readHypervisorsByHostName({
                projectId: data.projectId,
                hostName: host,
                openStackCloudId: data.openStackCloudId,
              })
            ).filter((row: OpenStackResource): boolean => {
              return (row.regionName || null) === (part.regionName || null);
            })
          : [];
      hypervisorName =
        getOnlyOpenStackMatch(hypervisors)?.hypervisorName || null;
    }
    if (!hypervisorName) {
      return null;
    }
    return await this.getReachOfHypervisor({
      projectId: data.projectId,
      openStackCloudId: data.openStackCloudId,
      hypervisorName,
      regionName: part.regionName,
    });
  }

  // What one instance is elsewhere: its page's links, and what it takes with it.
  public static async getReachOfInstance(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    instanceId: string;
  }): Promise<OpenStackReachAcrossProducts> {
    const [hosts, kubernetesNodes]: [
      Array<Host>,
      Awaited<
        ReturnType<typeof OpenStackAcrossProducts.readOpenStackKubernetesNodes>
      >,
    ] = await Promise.all([
      this.readHostsOfInstances({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        instanceIds: [data.instanceId.toLowerCase()],
      }),
      this.readOpenStackKubernetesNodes(
        data.projectId,
        data.instanceId.toLowerCase(),
      ),
    ]);

    return this.buildReach({
      hypervisorHost: null,
      guestHosts: hosts,
      kubernetesNodes: kubernetesNodes.filter(
        (node: { instanceId: string }): boolean => {
          return node.instanceId === data.instanceId.toLowerCase();
        },
      ),
      services: await this.readServicesOnHosts({
        projectId: data.projectId,
        hostIdentifiers: hosts
          .map((host: Host): string => {
            return host.hostIdentifier || "";
          })
          .filter((identifier: string): boolean => {
            return Boolean(identifier);
          }),
      }),
    });
  }

  /*
   * The hosts this name could be, in any case and either length: the name itself, its short
   * form, or its short form with any domain, because Nova and a machine's own hostname often
   * differ by exactly that. A caller takes one or none: see getOnlyOpenStackMatch.
   */
  public static async readHostsNamed(data: {
    projectId: ObjectID;
    hostName: string;
  }): Promise<Array<Host>> {
    const lower: string = data.hostName.trim().toLowerCase();
    if (!lower) {
      return [];
    }
    const short: string = getOpenStackShortHostName(lower);
    type HostIdentifierQuery = ReturnType<
      typeof QueryHelper.findWithSameTextAnyOf
    >;
    const read: (
      hostIdentifier: HostIdentifierQuery,
    ) => Promise<Array<Host>> = (
      hostIdentifier: HostIdentifierQuery,
    ): Promise<Array<Host>> => {
      return HostService.findBy({
        query: {
          projectId: data.projectId,
          hostIdentifier,
          isArchived: false,
        },
        select: { _id: true, name: true, hostIdentifier: true },
        limit: 10,
        skip: 0,
        props: { isRoot: true },
      });
    };
    const [named, withDomain]: [Array<Host>, Array<Host>] = await Promise.all([
      read(
        QueryHelper.findWithSameTextAnyOf(
          short === lower ? [short] : [short, lower],
        ),
      ),
      read(QueryHelper.startsWithAnyOf([`${short}.`])),
    ]);
    const byIdentifier: Map<string, Host> = new Map();
    for (const host of [...named, ...withDomain]) {
      byIdentifier.set(host.id?.toString() || host.hostIdentifier || "", host);
    }
    return Array.from(byIdentifier.values()).filter((host: Host): boolean => {
      return isOpenStackHostNameMatch(host.hostIdentifier, data.hostName);
    });
  }

  /*
   * The host that is this machine, with no link on a guess in either direction. A name two
   * hosts could be is neither of them, and a host two hypervisors could both be belongs to
   * neither: `compute-01` says nothing about which of compute-01.a and compute-01.b it is.
   */
  public static async getHostOfMachine(data: {
    projectId: ObjectID;
    machineName: string;
  }): Promise<Host | null> {
    const host: Host | null = getOnlyOpenStackMatch(
      await this.readHostsNamed({
        projectId: data.projectId,
        hostName: data.machineName,
      }),
    );
    if (!host?.hostIdentifier) {
      return null;
    }
    const hypervisors: Array<OpenStackResource> =
      await this.readHypervisorsByHostName({
        projectId: data.projectId,
        hostName: host.hostIdentifier,
      });
    return hypervisors.length > 1 ? null : host;
  }

  private static buildReach(data: {
    hypervisorHost: Host | null;
    guestHosts: Array<Host>;
    kubernetesNodes: Array<OpenStackLinkedKubernetesNode>;
    services: Array<OpenStackLinkedService>;
  }): OpenStackReachAcrossProducts {
    const hosts: Array<OpenStackLinkedHost> = [
      ...(data.hypervisorHost
        ? [this.toLinkedHost(data.hypervisorHost, true)]
        : []),
      ...data.guestHosts.map((host: Host): OpenStackLinkedHost => {
        return this.toLinkedHost(host, false);
      }),
    ];

    const clusters: Map<
      string,
      { id: string; name: string; nodeCount: number }
    > = new Map();
    for (const node of data.kubernetesNodes) {
      const cluster: { id: string; name: string; nodeCount: number } =
        clusters.get(node.clusterId) || {
          id: node.clusterId,
          name: node.clusterName,
          nodeCount: 0,
        };
      cluster.nodeCount += 1;
      clusters.set(node.clusterId, cluster);
    }

    return {
      hostCount: hosts.length,
      hosts: hosts.slice(0, OPENSTACK_REACH_LIST_LIMIT),
      kubernetesNodeCount: data.kubernetesNodes.length,
      kubernetesNodes: data.kubernetesNodes.slice(
        0,
        OPENSTACK_REACH_LIST_LIMIT,
      ),
      kubernetesClusters: Array.from(clusters.values()).sort(
        (
          first: { nodeCount: number; name: string },
          second: { nodeCount: number; name: string },
        ): number => {
          return (
            second.nodeCount - first.nodeCount ||
            first.name.localeCompare(second.name)
          );
        },
      ),
      serviceCount: data.services.length,
      services: data.services.slice(0, OPENSTACK_REACH_LIST_LIMIT),
    };
  }

  private static toLinkedHost(
    host: Host,
    isHypervisor: boolean,
  ): OpenStackLinkedHost {
    return {
      id: host.id!.toString(),
      name: host.name || host.hostIdentifier || "",
      isHypervisor,
    };
  }

  /*
   * ---------------------------------------------------------------------------
   * A storage pool and Ceph
   * ---------------------------------------------------------------------------
   */

  // Every Ceph cluster in the project, and its pools' names, which is what can be chosen.
  private static async readCephCandidates(
    projectId: ObjectID,
  ): Promise<Array<OpenStackCephClusterCandidate>> {
    const clusters: Array<CephCluster> = await CephClusterService.findBy({
      query: { projectId },
      select: { _id: true, name: true, fsid: true },
      limit: 100,
      skip: 0,
      props: { isRoot: true },
    });
    if (clusters.length === 0) {
      return [];
    }
    const pools: Array<CephResource> = await CephResourceService.findBy({
      query: {
        projectId,
        cephClusterId: QueryHelper.any(
          clusters.map((cluster: CephCluster): ObjectID => {
            return cluster.id!;
          }),
        ),
        kind: "Pool",
      },
      select: { cephClusterId: true, name: true },
      limit: 2000,
      skip: 0,
      props: { isRoot: true },
    });
    return clusters.map(
      (cluster: CephCluster): OpenStackCephClusterCandidate => {
        return {
          id: cluster.id!.toString(),
          name: cluster.name || "",
          fsid: cluster.fsid || null,
          poolNames: pools
            .filter((pool: CephResource): boolean => {
              return (
                pool.cephClusterId?.toString() === cluster.id!.toString() &&
                Boolean(pool.name)
              );
            })
            .map((pool: CephResource): string => {
              return pool.name as string;
            }),
        };
      },
    );
  }

  public static async getStoragePoolCephLink(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    externalId: string;
  }): Promise<{
    link: OpenStackStoragePoolCephLink;
    clusters: Array<{ id: string; name: string }>;
    health: number | null;
    capacityUsedPercent: number | null;
  } | null> {
    const pool: OpenStackResource | null =
      await OpenStackResourceService.findOneBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: data.openStackCloudId,
          kind: OpenStackResourceKind.StoragePool,
          externalId: data.externalId,
        },
        select: { name: true, facts: true },
        props: { isRoot: true },
      });
    if (!pool) {
      return null;
    }
    const clusters: Array<OpenStackCephClusterCandidate> =
      await this.readCephCandidates(data.projectId);
    const link: OpenStackStoragePoolCephLink = getOpenStackStoragePoolCephLink({
      poolName: pool.name,
      facts: pool.facts as JSONObject | undefined,
      clusters,
    });
    const cluster: CephCluster | null = link.clusterId
      ? await CephClusterService.findOneById({
          id: new ObjectID(link.clusterId),
          select: { healthStatus: true, capacityUsedPercent: true },
          props: { isRoot: true },
        })
      : null;
    return {
      link,
      clusters: clusters.map(
        (
          candidate: OpenStackCephClusterCandidate,
        ): {
          id: string;
          name: string;
        } => {
          return { id: candidate.id, name: candidate.name };
        },
      ),
      health: cluster?.healthStatus ?? null,
      capacityUsedPercent: cluster?.capacityUsedPercent ?? null,
    };
  }

  /*
   * What an operator answered, which sits on the pool's row and outlives every scrape,
   * because a scrape's facts merge key by key. A cluster that isn't in this project is
   * refused: the row is the project's, and the answer has to be too.
   */
  public static async confirmStoragePoolCephLink(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    externalId: string;
    cephClusterId: ObjectID | null;
    isNotCeph: boolean;
  }): Promise<boolean> {
    if (data.cephClusterId) {
      const cluster: CephCluster | null = await CephClusterService.findOneBy({
        query: {
          _id: data.cephClusterId.toString(),
          projectId: data.projectId,
        },
        select: { _id: true },
        props: { isRoot: true },
      });
      if (!cluster) {
        return false;
      }
    }
    const answer: JSONObject = {
      cephClusterId: data.cephClusterId?.toString() || null,
      isNotCeph: data.isNotCeph,
      confirmedAt: OneUptimeDate.getCurrentDate().toISOString(),
    };
    const updated: Array<unknown> =
      await OpenStackResourceService.getRepository().manager.query(
        `UPDATE "OpenStackResource"
         SET "facts" = COALESCE("facts", '{}'::jsonb)
                       || jsonb_build_object('${OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT}', $4::jsonb)
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.StoragePool}'
           AND "externalId" = $3 AND "deletedAt" IS NULL
         RETURNING "_id"`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          data.externalId,
          JSON.stringify(answer),
        ],
      );
    return (updated[0] as Array<unknown> | undefined)?.length !== 0;
  }

  /*
   * Ceph's trouble as a Cinder pool's, on the rows Needs attention reads: it is the Ceph
   * cluster's to know, and it changes without the pool being read again. A pool that has no
   * link gets nothing. A read that fails leaves the rows as they came: what the cloud itself
   * says about them still stands.
   */
  public static async addCephStatusToPools(data: {
    projectId: ObjectID;
    rows: Array<JSONObject>;
  }): Promise<void> {
    const pools: Array<JSONObject> = data.rows.filter(
      (row: JSONObject): boolean => {
        return row["kind"] === OpenStackResourceKind.StoragePool;
      },
    );
    if (pools.length === 0) {
      return;
    }
    const clusters: Array<OpenStackCephClusterCandidate> =
      await this.readCephCandidates(data.projectId);
    if (clusters.length === 0) {
      return;
    }
    const health: Array<CephCluster> = await CephClusterService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          clusters.map((cluster: OpenStackCephClusterCandidate): string => {
            return cluster.id;
          }),
        ) as never,
      },
      select: { _id: true, healthStatus: true },
      limit: clusters.length,
      skip: 0,
      props: { isRoot: true },
    });
    for (const pool of pools) {
      const facts: JSONObject = (pool["facts"] as JSONObject | undefined) || {};
      const link: OpenStackStoragePoolCephLink =
        getOpenStackStoragePoolCephLink({
          poolName: pool["name"] as string | null | undefined,
          facts,
          clusters,
        });
      if (!isOpenStackStoragePoolCephLinked(link) || !link.clusterId) {
        continue;
      }
      const cluster: CephCluster | undefined = health.find(
        (one: CephCluster): boolean => {
          return one.id?.toString() === link.clusterId;
        },
      );
      pool["facts"] = {
        ...facts,
        [OPENSTACK_CEPH_STATUS_FACT]: {
          clusterId: link.clusterId,
          clusterName: link.clusterName || "",
          healthStatus: cluster?.healthStatus ?? null,
        },
      };
    }
  }

  /*
   * ---------------------------------------------------------------------------
   * Topology's Infrastructure view
   * ---------------------------------------------------------------------------
   */

  /*
   * What a resource would have said had it been able to: the entity graph learns what runs
   * where from attributes seen together on one resource, and no resource can say which
   * hypervisor an instance is on, or which instance a guest's services run on. So once a host
   * is linked this says it for them, through the same reconcile and the same fence as ingest.
   * Pure, for its tests: the rows it makes are the rows a real resource would.
   */
  public static getPlacementEntities(data: {
    projectId: ObjectID;
    placement: OpenStackPlacement;
    serviceName?: string | undefined;
  }): Array<ExtractedEntity> {
    const attributes: Record<string, string> = {};
    if (data.placement.cloudName) {
      attributes["openstack.cloud.name"] = data.placement.cloudName;
    }
    if (data.placement.hypervisorName) {
      attributes["openstack.hypervisor.name"] = data.placement.hypervisorName;
    }
    if (data.placement.kind === "instance") {
      attributes["openstack.instance.id"] = data.placement.externalId;
      if (data.placement.name) {
        attributes["openstack.instance.name"] = data.placement.name;
      }
    }
    if (data.serviceName) {
      attributes["service.name"] = data.serviceName;
    }
    return InventoryItem.extractEntities({
      projectId: data.projectId.toString(),
      attributes,
    });
  }

  public static async reconcilePlacementInTopology(data: {
    projectId: ObjectID;
    host: { hostIdentifier: string };
    placement: OpenStackPlacement;
  }): Promise<void> {
    const services: Array<OpenStackLinkedService> =
      await this.readServicesOnHosts({
        projectId: data.projectId,
        hostIdentifiers: [data.host.hostIdentifier],
      });
    const names: Array<string | undefined> =
      services.length > 0
        ? services.map((service: OpenStackLinkedService): string => {
            return service.name;
          })
        : [undefined];
    for (const serviceName of names) {
      await reconcileEntityRegistryThrottled({
        projectId: data.projectId,
        entities: this.getPlacementEntities({
          projectId: data.projectId,
          placement: data.placement,
          serviceName,
        }),
      });
    }
  }
}
