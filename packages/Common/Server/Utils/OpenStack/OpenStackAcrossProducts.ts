import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CephResource from "../../../Models/DatabaseModels/CephResource";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../../Models/DatabaseModels/OpenStackResource";
import Service from "../../../Models/DatabaseModels/Service";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OPENSTACK_REACH_LIST_LIMIT,
  OPENSTACK_SERVICE_PLACEMENT_LIMIT,
  OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT,
  OpenStackCephClusterCandidate,
  OpenStackHostNameForms,
  OpenStackLinkedHost,
  OpenStackLinkedInstance,
  OpenStackLinkedKubernetesNode,
  OpenStackLinkedService,
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  OpenStackServicePlacement,
  OpenStackStoragePoolCephLink,
  OpenStackStoragePoolOfProject,
  getOnlyOpenStackMatch,
  getOpenStackCephHealthNow,
  getOpenStackHostNameForms,
  getOpenStackStoragePoolCephLink,
  isOpenStackHostNameMatch,
  isOpenStackStoragePoolCephLinked,
} from "../../../Types/OpenStack/OpenStackLinks";
import {
  getOpenStackInstanceIdOfProviderId,
  isOpenStackInstanceId,
} from "../../../Types/OpenStack/OpenStackInstanceMetrics";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  keyForHost,
  keyForKubernetesNode,
} from "../../../Utils/Telemetry/EntityKey";
import CephClusterService from "../../Services/CephClusterService";
import CephResourceService from "../../Services/CephResourceService";
import HostService from "../../Services/HostService";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import KubernetesClusterService from "../../Services/KubernetesClusterService";
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
// A project's Cinder pools across its clouds, for what else could answer to a Ceph pool's name.
const STORAGE_POOLS_READ: number = 1000;
// How many Kubernetes nodes one read holds before a blast radius stops at them.
const OPENSTACK_KUBERNETES_NODES_READ: number = 20000;
// A service is on a host for this long after it last said so. Long enough for one that is slow.
const SERVICE_PLACEMENT_FRESH_DAYS: number = 1;
// A pod moves between nodes on any day, so where it was yesterday says little about today.
const SERVICE_ON_POD_FRESH_HOURS: number = 1;
// Two hypervisors of a name is already no answer, so a read never needs to hold a third.
const HYPERVISOR_NAME_MATCHES_READ: number = 3;
/*
 * Hosts are read past that, because a guest whose own ID says what it is, or a host someone
 * put in another cloud, doesn't count as a match. A name this many hosts share says nothing.
 */
const HOST_NAME_MATCHES_READ: number = 50;
// A service runs on more hosts than this and its page is no place to list them.
const SERVICE_MACHINES_READ: number = OPENSTACK_SERVICE_PLACEMENT_LIMIT * 2;

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

export interface OpenStackKubernetesNodeRead
  extends OpenStackLinkedKubernetesNode {
  // What the cluster reports itself as: what its telemetry's entities are keyed on.
  clusterIdentifier: string | null;
}

interface ServiceEntityRead {
  name: string | null;
  namespace: string | null;
}

export default class OpenStackAcrossProducts {
  /*
   * The clouds a project has: what makes a read by instance UUID a read of a few index probes.
   * Someone who archived a cloud has said it is no longer where anything runs, so its restored
   * copy's instances are not two of anything.
   */
  private static async readCloudsOfProject(
    projectId: ObjectID,
  ): Promise<Array<OpenStackCloud>> {
    return await OpenStackCloudService.findBy({
      query: { projectId, isArchived: false },
      select: { _id: true, name: true },
      limit: 200,
      skip: 0,
      props: { isRoot: true },
    });
  }

  private static async readCloudIdsToSearch(data: {
    projectId: ObjectID;
    openStackCloudId?: ObjectID | null | undefined;
  }): Promise<Array<ObjectID>> {
    if (data.openStackCloudId) {
      return [data.openStackCloudId];
    }
    return (await this.readCloudsOfProject(data.projectId)).map(
      (cloud: OpenStackCloud): ObjectID => {
        return cloud.id!;
      },
    );
  }

  /*
   * The instances with this UUID, in the host's own cloud when it has one, or in any of the
   * project's. Two clouds holding one UUID is a restored copy of a cloud, and whichever they
   * are, neither can be chosen.
   */
  private static async readInstancesById(data: {
    projectId: ObjectID;
    instanceId: string;
    openStackCloudId?: ObjectID | null | undefined;
  }): Promise<Array<OpenStackResource>> {
    const cloudIds: Array<ObjectID> = await this.readCloudIdsToSearch(data);
    if (cloudIds.length === 0) {
      return [];
    }
    return await OpenStackResourceService.findBy({
      query: {
        projectId: data.projectId,
        openStackCloudId: QueryHelper.any(cloudIds),
        kind: OpenStackResourceKind.Instance,
        externalId: data.instanceId,
      },
      select: PLACEMENT_SELECT,
      limit: 2,
      skip: 0,
      props: { isRoot: true },
    });
  }

  // Which of these UUIDs are instances in the clouds asked about, in one statement.
  private static async readInstanceIdsAmong(data: {
    projectId: ObjectID;
    cloudIds: Array<ObjectID>;
    instanceIds: Array<string>;
  }): Promise<Set<string>> {
    if (data.instanceIds.length === 0 || data.cloudIds.length === 0) {
      return new Set();
    }
    const rows: Array<{ externalId: string }> =
      await OpenStackResourceService.getRepository().manager.query(
        `SELECT DISTINCT "externalId" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = ANY($2::uuid[])
           AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
           AND "externalId" = ANY($3::text[])`,
        [
          data.projectId.toString(),
          data.cloudIds.map((id: ObjectID): string => {
            return id.toString();
          }),
          data.instanceIds,
        ],
      );
    return new Set(
      rows.map((row: { externalId: string }): string => {
        return row.externalId;
      }),
    );
  }

  /*
   * Of an instance's or a hypervisor's instances, those another cloud holds too. Whichever
   * cloud such a UUID is really in can't be told, so a Kubernetes node that names it is on
   * neither, in this direction as in the other.
   */
  private static async readInstanceIdsInAnotherCloud(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    instanceIds: Array<string>;
  }): Promise<Set<string>> {
    if (data.instanceIds.length === 0) {
      return new Set();
    }
    const others: Array<ObjectID> = (
      await this.readCloudIdsToSearch({ projectId: data.projectId })
    ).filter((id: ObjectID): boolean => {
      return id.toString() !== data.openStackCloudId.toString();
    });
    return await this.readInstanceIdsAmong({
      projectId: data.projectId,
      cloudIds: others,
      instanceIds: data.instanceIds,
    });
  }

  private static async readHypervisorsByHostName(data: {
    projectId: ObjectID;
    hostName: string;
    openStackCloudId?: ObjectID | null | undefined;
  }): Promise<Array<OpenStackResource>> {
    const forms: OpenStackHostNameForms = getOpenStackHostNameForms(
      data.hostName,
    );
    if (forms.names.length === 0) {
      return [];
    }
    const cloudIds: Array<ObjectID> = await this.readCloudIdsToSearch(data);
    if (cloudIds.length === 0) {
      return [];
    }
    const rows: Array<{
      _id: string;
    }> = await OpenStackResourceService.getRepository().manager.query(
      `SELECT "_id" FROM "OpenStackResource"
       WHERE "projectId" = $1 AND "kind" = '${OpenStackResourceKind.Hypervisor}'
         AND "deletedAt" IS NULL
         AND "openStackCloudId" = ANY($2::uuid[])
         AND (LOWER("hypervisorName") = ANY($3::text[])
           OR LOWER("hypervisorName") LIKE $4)
       LIMIT ${HYPERVISOR_NAME_MATCHES_READ}`,
      [
        data.projectId.toString(),
        cloudIds.map((id: ObjectID): string => {
          return id.toString();
        }),
        forms.names,
        // A pattern nothing can match when no domain is on offer: `LIKE NULL` is never true.
        forms.anyDomainOf ? `${escapeLike(forms.anyDomainOf)}.%` : null,
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
            // Two regions can each have a compute-01.
            ...(row.regionName ? { regionName: row.regionName } : {}),
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
   *
   * A host's cloud, once it has one, is the only one it is looked for in: that link is an
   * earlier answer or someone's own choice, and it is what says which of two clouds' parts
   * of the same name this is.
   */
  private static async findPartOfHost(data: {
    projectId: ObjectID;
    hostIdAttribute: string | null | undefined;
    hostIdentifier: string | null | undefined;
    openStackCloudId?: ObjectID | null | undefined;
  }): Promise<OpenStackResource | null> {
    const instanceId: string | null = isOpenStackInstanceId(
      data.hostIdAttribute,
    )
      ? (data.hostIdAttribute as string).toLowerCase()
      : null;
    if (instanceId) {
      const instances: Array<OpenStackResource> = await this.readInstancesById({
        projectId: data.projectId,
        instanceId,
        openStackCloudId: data.openStackCloudId,
      });
      /*
       * A UUID two clouds hold still says this is an instance, only not which one. A name
       * can't settle that, however well it fits a hypervisor.
       */
      if (instances.length > 0) {
        return getOnlyOpenStackMatch(instances);
      }
    }
    if (!data.hostIdentifier) {
      return null;
    }
    return await this.findHypervisorOfHost({
      projectId: data.projectId,
      hostIdentifier: data.hostIdentifier,
      openStackCloudId: data.openStackCloudId,
    });
  }

  /*
   * A hypervisor and a host are one machine when each is the only thing the other could be.
   * That is asked from both ends, here and in getHostOfMachine, or one page would link to a
   * host whose own page says nothing, or says something else.
   */
  private static async findHypervisorOfHost(data: {
    projectId: ObjectID;
    hostIdentifier: string;
    openStackCloudId?: ObjectID | null | undefined;
  }): Promise<OpenStackResource | null> {
    const hypervisor: OpenStackResource | null = getOnlyOpenStackMatch(
      await this.readHypervisorsByHostName({
        projectId: data.projectId,
        hostName: data.hostIdentifier,
        openStackCloudId: data.openStackCloudId,
      }),
    );
    if (!hypervisor?.hypervisorName) {
      return null;
    }
    const machines: Array<Host> = await this.readMachinesNamed({
      projectId: data.projectId,
      hostName: hypervisor.hypervisorName,
      openStackCloudId: hypervisor.openStackCloudId,
    });
    const self: string = data.hostIdentifier.trim().toLowerCase();
    return machines.every((machine: Host): boolean => {
      return (machine.hostIdentifier || "").trim().toLowerCase() === self;
    })
      ? hypervisor
      : null;
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
   * what its own resource said) and each Kubernetes node its pods are on, and each of those
   * that is a part of a cloud. A service on several machines has several placements, and that
   * is an answer rather than a guess.
   */
  public static async getPlacementsOfService(data: {
    projectId: ObjectID;
    serviceName: string;
  }): Promise<Array<OpenStackServicePlacement>> {
    const placements: Array<OpenStackServicePlacement> = [
      ...(await this.readPlacementsThroughHosts(data)),
      ...(await this.readPlacementsThroughKubernetesNodes(data)),
    ];
    return placements.slice(0, OPENSTACK_SERVICE_PLACEMENT_LIMIT);
  }

  private static async readPlacementsThroughHosts(data: {
    projectId: ObjectID;
    serviceName: string;
  }): Promise<Array<OpenStackServicePlacement>> {
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
         LIMIT ${SERVICE_MACHINES_READ}`,
        [
          data.projectId.toString(),
          data.serviceName,
          OneUptimeDate.addRemoveDays(
            OneUptimeDate.getCurrentDate(),
            -SERVICE_PLACEMENT_FRESH_DAYS,
          ),
        ],
      );

    const placements: Array<OpenStackServicePlacement> = [];
    for (const row of rows) {
      if (!row.hostName) {
        continue;
      }
      const host: Host | null = await HostService.findOneBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: QueryHelper.findWithSameText(row.hostName),
        },
        select: {
          _id: true,
          hostId: true,
          hostIdentifier: true,
          openStackCloudId: true,
        },
        props: { isRoot: true },
      });
      const part: OpenStackResource | null = await this.findPartOfHost({
        projectId: data.projectId,
        hostIdAttribute: host?.hostId || row.instanceId,
        hostIdentifier: row.hostName,
        openStackCloudId: host?.openStackCloudId,
      });
      if (part) {
        placements.push({
          hostName: row.hostName,
          hostId: host?.id?.toString() || null,
          kubernetesClusterId: null,
          placement: await this.toPlacement(part),
        });
      }
    }
    return placements;
  }

  /*
   * A service in Kubernetes names no host: its pod's own hostname is no machine. Its pods say
   * which node they are on, and a node's spec.providerID says which instance that is.
   */
  private static async readPlacementsThroughKubernetesNodes(data: {
    projectId: ObjectID;
    serviceName: string;
  }): Promise<Array<OpenStackServicePlacement>> {
    const rows: Array<{
      clusterIdentifier: string | null;
      nodeName: string | null;
    }> = await HostService.getRepository().manager.query(
      `SELECT DISTINCT node."identifyingAttributes"->>'k8s.cluster.name' AS "clusterIdentifier",
              node."identifyingAttributes"->>'k8s.node.name' AS "nodeName"
       FROM "InventoryItem" AS service
       JOIN "InventoryItemRelationship" AS "onPod"
         ON "onPod"."projectId" = service."projectId"
        AND "onPod"."fromEntityKey" = service."entityKey"
        AND "onPod"."relationshipType" = '${EntityRelationshipType.RunsOn}'
        AND "onPod"."lastSeenAt" >= $3
        AND "onPod"."deletedAt" IS NULL
       JOIN "InventoryItem" AS pod
         ON pod."projectId" = "onPod"."projectId"
        AND pod."entityKey" = "onPod"."toEntityKey"
        AND pod."entityType" = '${EntityType.KubernetesPod}'
        AND pod."deletedAt" IS NULL
       JOIN "InventoryItemRelationship" AS "onNode"
         ON "onNode"."projectId" = pod."projectId"
        AND "onNode"."fromEntityKey" = pod."entityKey"
        AND "onNode"."relationshipType" = '${EntityRelationshipType.RunsOn}'
        AND "onNode"."lastSeenAt" >= $3
        AND "onNode"."deletedAt" IS NULL
       JOIN "InventoryItem" AS node
         ON node."projectId" = "onNode"."projectId"
        AND node."entityKey" = "onNode"."toEntityKey"
        AND node."entityType" = '${EntityType.KubernetesNode}'
        AND node."deletedAt" IS NULL
       WHERE service."projectId" = $1
         AND service."entityType" = '${EntityType.Service}'
         AND service."identifyingAttributes"->>'service.name' = $2
         AND service."deletedAt" IS NULL
       LIMIT ${SERVICE_MACHINES_READ}`,
      [
        data.projectId.toString(),
        data.serviceName,
        OneUptimeDate.addRemoveHours(
          OneUptimeDate.getCurrentDate(),
          -SERVICE_ON_POD_FRESH_HOURS,
        ),
      ],
    );

    const identifiers: Array<string> = Array.from(
      new Set(
        rows
          .map((row: { clusterIdentifier: string | null }): string => {
            return row.clusterIdentifier || "";
          })
          .filter((identifier: string): boolean => {
            return Boolean(identifier);
          }),
      ),
    );
    if (identifiers.length === 0) {
      return [];
    }
    const clusters: Array<KubernetesCluster> =
      await KubernetesClusterService.findBy({
        query: {
          projectId: data.projectId,
          clusterIdentifier: QueryHelper.findWithSameTextAnyOf(identifiers),
        },
        select: { _id: true, clusterIdentifier: true },
        limit: identifiers.length,
        skip: 0,
        props: { isRoot: true },
      });

    const placements: Array<OpenStackServicePlacement> = [];
    for (const row of rows) {
      const cluster: KubernetesCluster | undefined = clusters.find(
        (candidate: KubernetesCluster): boolean => {
          return (
            (candidate.clusterIdentifier || "").toLowerCase() ===
            (row.clusterIdentifier || "").toLowerCase()
          );
        },
      );
      if (!cluster?.id || !row.nodeName) {
        continue;
      }
      const placement: OpenStackPlacement | null =
        await this.getPlacementOfKubernetesNode({
          projectId: data.projectId,
          kubernetesClusterId: cluster.id,
          nodeName: row.nodeName,
        });
      if (placement) {
        placements.push({
          hostName: row.nodeName,
          hostId: null,
          kubernetesClusterId: cluster.id.toString(),
          placement,
        });
      }
    }
    return placements;
  }

  /*
   * The Kubernetes nodes that are these instances, or that are in this cluster, read in one
   * statement. Starts from the project's clusters, which is what lets it use the index that
   * holds a cluster's nodes rather than walk every pod in the project.
   */
  public static async readOpenStackKubernetesNodes(data: {
    projectId: ObjectID;
    instanceIds?: Array<string> | undefined;
    kubernetesClusterId?: ObjectID | undefined;
    limit?: number | undefined;
  }): Promise<Array<OpenStackKubernetesNodeRead>> {
    if (data.instanceIds && data.instanceIds.length === 0) {
      return [];
    }
    const rows: Array<{
      clusterId: string;
      clusterName: string | null;
      clusterIdentifier: string | null;
      nodeName: string;
      providerId: string | null;
    }> = await KubernetesResourceService.getRepository().manager.query(
      `SELECT node."kubernetesClusterId" AS "clusterId",
              cluster."name" AS "clusterName",
              cluster."clusterIdentifier" AS "clusterIdentifier",
              node."name" AS "nodeName",
              node."spec"->>'providerID' AS "providerId"
       FROM "KubernetesCluster" AS cluster
       JOIN "KubernetesResource" AS node
         ON node."projectId" = cluster."projectId"
        AND node."kubernetesClusterId" = cluster."_id"
        AND node."kind" = 'Node'
        AND node."deletedAt" IS NULL
       WHERE cluster."projectId" = $1
         AND cluster."deletedAt" IS NULL
         AND ($2::uuid IS NULL OR cluster."_id" = $2)
         AND node."spec"->>'providerID' LIKE 'openstack://%'
         AND ($3::text[] IS NULL
           OR LOWER(RIGHT(TRIM(node."spec"->>'providerID'), 36)) = ANY($3::text[]))
       LIMIT ${data.limit || OPENSTACK_KUBERNETES_NODES_READ}`,
      [
        data.projectId.toString(),
        data.kubernetesClusterId?.toString() || null,
        data.instanceIds
          ? data.instanceIds.map((id: string): string => {
              return id.toLowerCase();
            })
          : null,
      ],
    );
    const wanted: Set<string> | null = data.instanceIds
      ? new Set(
          data.instanceIds.map((id: string): string => {
            return id.toLowerCase();
          }),
        )
      : null;
    const nodes: Array<OpenStackKubernetesNodeRead> = [];
    for (const row of rows) {
      // The statement narrows by what a provider ID ends with. This says what it is.
      const instanceId: string | null = getOpenStackInstanceIdOfProviderId(
        row.providerId,
      );
      if (instanceId && (!wanted || wanted.has(instanceId))) {
        nodes.push({
          clusterId: row.clusterId,
          clusterName: row.clusterName || row.clusterId,
          clusterIdentifier: row.clusterIdentifier || null,
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
    return await this.toLinkedServices({
      projectId: data.projectId,
      entities: await this.readServiceEntitiesOnHosts(data),
    });
  }

  private static async readServiceEntitiesOnHosts(data: {
    projectId: ObjectID;
    hostIdentifiers: Array<string>;
  }): Promise<Array<ServiceEntityRead>> {
    if (data.hostIdentifiers.length === 0) {
      return [];
    }
    return await HostService.getRepository().manager.query(
      `SELECT DISTINCT service."identifyingAttributes"->>'service.name' AS "name",
              service."identifyingAttributes"->>'service.namespace' AS "namespace"
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
  }

  /*
   * The services on a set of Kubernetes nodes, through the pods each says it is on. A pod's
   * own hostname says nothing of a machine, so this is the only way to them.
   */
  public static async readServicesOnKubernetesNodes(data: {
    projectId: ObjectID;
    nodes: Array<OpenStackKubernetesNodeRead>;
  }): Promise<Array<OpenStackLinkedService>> {
    if (data.nodes.length === 0) {
      return [];
    }
    const entities: Array<ServiceEntityRead> =
      await HostService.getRepository().manager.query(
        `SELECT DISTINCT service."identifyingAttributes"->>'service.name' AS "name",
                service."identifyingAttributes"->>'service.namespace' AS "namespace"
         FROM "InventoryItemRelationship" AS "onNode"
         JOIN "InventoryItem" AS pod
           ON pod."projectId" = "onNode"."projectId"
          AND pod."entityKey" = "onNode"."fromEntityKey"
          AND pod."entityType" = '${EntityType.KubernetesPod}'
          AND pod."deletedAt" IS NULL
         JOIN "InventoryItemRelationship" AS "onPod"
           ON "onPod"."projectId" = pod."projectId"
          AND "onPod"."toEntityKey" = pod."entityKey"
          AND "onPod"."relationshipType" = '${EntityRelationshipType.RunsOn}'
          AND "onPod"."lastSeenAt" >= $3
          AND "onPod"."deletedAt" IS NULL
         JOIN "InventoryItem" AS service
           ON service."projectId" = "onPod"."projectId"
          AND service."entityKey" = "onPod"."fromEntityKey"
          AND service."entityType" = '${EntityType.Service}'
          AND service."deletedAt" IS NULL
         WHERE "onNode"."projectId" = $1
           AND "onNode"."relationshipType" = '${EntityRelationshipType.RunsOn}'
           AND "onNode"."toEntityKey" = ANY($2::text[])
           AND "onNode"."lastSeenAt" >= $3
           AND "onNode"."deletedAt" IS NULL
         LIMIT 500`,
        [
          data.projectId.toString(),
          data.nodes.map((node: OpenStackKubernetesNodeRead): string => {
            return keyForKubernetesNode(data.projectId.toString(), {
              clusterName: node.clusterIdentifier,
              nodeName: node.nodeName,
            });
          }),
          OneUptimeDate.addRemoveHours(
            OneUptimeDate.getCurrentDate(),
            -SERVICE_ON_POD_FRESH_HOURS,
          ),
        ],
      );
    return await this.toLinkedServices({
      projectId: data.projectId,
      entities,
    });
  }

  private static async toLinkedServices(data: {
    projectId: ObjectID;
    entities: Array<ServiceEntityRead>;
  }): Promise<Array<OpenStackLinkedService>> {
    const names: Array<string> = Array.from(
      new Set(
        data.entities
          .map((entity: ServiceEntityRead): string => {
            return entity.name || "";
          })
          .filter((name: string): boolean => {
            return Boolean(name);
          }),
      ),
    );
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
        // An agent can report its UUID in capitals, and that is still the same instance.
        hostId: QueryHelper.findWithSameTextAnyOf(data.instanceIds),
        isArchived: false,
      },
      select: { _id: true, name: true, hostIdentifier: true },
      limit: INSTANCES_PER_REACH,
      skip: 0,
      props: { isRoot: true },
    });
  }

  // Its instances, the machine itself, the hosts and nodes those are, and what runs on them.
  private static async readReach(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    instances: Array<OpenStackLinkedInstance>;
    hypervisorHost: Host | null;
    instanceCount?: number | undefined;
  }): Promise<OpenStackReachAcrossProducts> {
    const instanceIds: Array<string> = data.instances.map(
      (instance: OpenStackLinkedInstance): string => {
        return instance.id;
      },
    );
    const [guestHosts, nodesOfInstances, inAnotherCloud]: [
      Array<Host>,
      Array<OpenStackKubernetesNodeRead>,
      Set<string>,
    ] = await Promise.all([
      this.readHostsOfInstances({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        instanceIds,
      }),
      this.readOpenStackKubernetesNodes({
        projectId: data.projectId,
        instanceIds,
      }),
      this.readInstanceIdsInAnotherCloud({
        projectId: data.projectId,
        openStackCloudId: data.openStackCloudId,
        instanceIds,
      }),
    ]);
    const kubernetesNodes: Array<OpenStackKubernetesNodeRead> =
      nodesOfInstances.filter((node: OpenStackKubernetesNodeRead): boolean => {
        return !inAnotherCloud.has(node.instanceId);
      });

    const [servicesOnHosts, servicesOnNodes]: [
      Array<OpenStackLinkedService>,
      Array<OpenStackLinkedService>,
    ] = await Promise.all([
      this.readServicesOnHosts({
        projectId: data.projectId,
        hostIdentifiers: [
          ...(data.hypervisorHost ? [data.hypervisorHost] : []),
          ...guestHosts,
        ]
          .map((host: Host): string => {
            return host.hostIdentifier || "";
          })
          .filter((identifier: string): boolean => {
            return Boolean(identifier);
          }),
      }),
      this.readServicesOnKubernetesNodes({
        projectId: data.projectId,
        nodes: kubernetesNodes,
      }),
    ]);
    const services: Map<string, OpenStackLinkedService> = new Map();
    for (const service of [...servicesOnHosts, ...servicesOnNodes]) {
      services.set(service.id, service);
    }

    return this.buildReach({
      hypervisorHost: data.hypervisorHost,
      guestHosts,
      kubernetesNodes,
      services: Array.from(services.values()),
      instances: data.instances,
      instanceCount: data.instanceCount,
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
    const instances: Array<{ externalId: string; name: string | null }> =
      await OpenStackResourceService.getRepository().manager.query(
        `SELECT "externalId", "name" FROM "OpenStackResource"
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.Instance}' AND "deletedAt" IS NULL
           AND "hypervisorName" = $3 AND "regionName" IS NOT DISTINCT FROM $4
         ORDER BY "name", "externalId"
         LIMIT ${INSTANCES_PER_REACH}`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          data.hypervisorName,
          data.regionName ?? null,
        ],
      );

    return await this.readReach({
      projectId: data.projectId,
      openStackCloudId: data.openStackCloudId,
      instances: instances.map(
        (row: {
          externalId: string;
          name: string | null;
        }): OpenStackLinkedInstance => {
          return { id: row.externalId, name: row.name || null };
        },
      ),
      instanceCount: instances.length,
      hypervisorHost: await this.getHostOfMachine({
        projectId: data.projectId,
        machineName: data.hypervisorName,
        openStackCloudId: data.openStackCloudId,
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
    return await this.readReach({
      projectId: data.projectId,
      openStackCloudId: data.openStackCloudId,
      instances: [{ id: data.instanceId.toLowerCase(), name: null }],
      hypervisorHost: null,
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
    const forms: OpenStackHostNameForms = getOpenStackHostNameForms(
      data.hostName,
    );
    if (forms.names.length === 0) {
      return [];
    }
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
        select: {
          _id: true,
          name: true,
          hostIdentifier: true,
          hostId: true,
          openStackCloudId: true,
        },
        limit: HOST_NAME_MATCHES_READ,
        skip: 0,
        props: { isRoot: true },
      });
    };
    const [named, withDomain]: [Array<Host>, Array<Host>] = await Promise.all([
      read(QueryHelper.findWithSameTextAnyOf(forms.names)),
      forms.anyDomainOf
        ? read(QueryHelper.startsWithAnyOf([`${forms.anyDomainOf}.`]))
        : Promise.resolve([]),
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
   * The hosts that could be a machine of this name in this cloud. A host whose own host.id
   * says it is an instance is not a machine anyone can mistake it for, and neither is a host
   * already linked to another cloud.
   */
  private static async readMachinesNamed(data: {
    projectId: ObjectID;
    hostName: string;
    openStackCloudId?: ObjectID | null | undefined;
  }): Promise<Array<Host>> {
    const allNamed: Array<Host> = await this.readHostsNamed({
      projectId: data.projectId,
      hostName: data.hostName,
    });
    // More than a read holds: whoever was left out could be a rival, so all of them are.
    if (allNamed.length >= HOST_NAME_MATCHES_READ) {
      return allNamed;
    }
    const named: Array<Host> = allNamed.filter((host: Host): boolean => {
      return (
        !data.openStackCloudId ||
        !host.openStackCloudId ||
        host.openStackCloudId.toString() === data.openStackCloudId.toString()
      );
    });
    const claimed: Array<string> = named
      .map((host: Host): string => {
        return (host.hostId || "").toLowerCase();
      })
      .filter((id: string): boolean => {
        return isOpenStackInstanceId(id);
      });
    if (claimed.length === 0) {
      return named;
    }
    const instances: Set<string> = await this.readInstanceIdsAmong({
      projectId: data.projectId,
      cloudIds: await this.readCloudIdsToSearch({ projectId: data.projectId }),
      instanceIds: claimed,
    });
    return named.filter((host: Host): boolean => {
      return !instances.has((host.hostId || "").toLowerCase());
    });
  }

  /*
   * The host that is this machine, with no link on a guess in either direction. A name two
   * hosts could be is neither of them, and a host two hypervisors could both be belongs to
   * neither: `compute-01` says nothing about which of compute-01.a and compute-01.b it is.
   * A machine no hypervisor is, which is a controller, still has its host.
   */
  public static async getHostOfMachine(data: {
    projectId: ObjectID;
    machineName: string;
    openStackCloudId: ObjectID;
  }): Promise<Host | null> {
    const host: Host | null = getOnlyOpenStackMatch(
      await this.readMachinesNamed({
        projectId: data.projectId,
        hostName: data.machineName,
        openStackCloudId: data.openStackCloudId,
      }),
    );
    if (!host?.hostIdentifier) {
      return null;
    }
    const hypervisors: Array<OpenStackResource> =
      await this.readHypervisorsByHostName({
        projectId: data.projectId,
        hostName: host.hostIdentifier,
        openStackCloudId: host.openStackCloudId,
      });
    if (hypervisors.length > 1) {
      return null;
    }
    const hypervisor: OpenStackResource | undefined = hypervisors[0];
    /*
     * The one hypervisor this host could be has to be this machine, in this cloud: a host
     * called compute-01.b is not another cloud's compute-01 because the two short names agree.
     */
    return !hypervisor ||
      (isOpenStackHostNameMatch(data.machineName, hypervisor.hypervisorName) &&
        hypervisor.openStackCloudId?.toString() ===
          data.openStackCloudId.toString())
      ? host
      : null;
  }

  private static buildReach(data: {
    hypervisorHost: Host | null;
    guestHosts: Array<Host>;
    kubernetesNodes: Array<OpenStackLinkedKubernetesNode>;
    services: Array<OpenStackLinkedService>;
    instances: Array<OpenStackLinkedInstance>;
    instanceCount?: number | undefined;
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
      ...(data.instanceCount === undefined
        ? {}
        : {
            instanceCount: data.instanceCount,
            instances: data.instances.slice(0, OPENSTACK_REACH_LIST_LIMIT),
          }),
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
        select: { _id: true, name: true, facts: true },
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
      // Only a name needs these, and there is nothing to suggest with no clusters to name.
      otherPools:
        clusters.length > 0
          ? await this.readOtherStoragePools({
              projectId: data.projectId,
              pool,
            })
          : [],
    });
    const cluster: CephCluster | null = link.clusterId
      ? await CephClusterService.findOneById({
          id: new ObjectID(link.clusterId),
          select: {
            healthStatus: true,
            capacityUsedPercent: true,
            lastSeenAt: true,
          },
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
      health: getOpenStackCephHealthNow({
        healthStatus: cluster?.healthStatus,
        lastSeenAt: cluster?.lastSeenAt,
        now: OneUptimeDate.getCurrentDate(),
      }),
      capacityUsedPercent: cluster?.capacityUsedPercent ?? null,
    };
  }

  // Every other Cinder pool in the project, in any of its clouds.
  private static async readOtherStoragePools(data: {
    projectId: ObjectID;
    pool: OpenStackResource;
  }): Promise<Array<OpenStackStoragePoolOfProject>> {
    const cloudIds: Array<ObjectID> = await this.readCloudIdsToSearch({
      projectId: data.projectId,
    });
    if (cloudIds.length === 0) {
      return [];
    }
    const pools: Array<OpenStackResource> =
      await OpenStackResourceService.findBy({
        query: {
          projectId: data.projectId,
          openStackCloudId: QueryHelper.any(cloudIds),
          kind: OpenStackResourceKind.StoragePool,
        },
        select: { _id: true, name: true, facts: true },
        limit: STORAGE_POOLS_READ,
        skip: 0,
        props: { isRoot: true },
      });
    return pools
      .filter((other: OpenStackResource): boolean => {
        return other.id?.toString() !== data.pool.id?.toString();
      })
      .map((other: OpenStackResource): OpenStackStoragePoolOfProject => {
        return {
          poolName: other.name,
          facts: other.facts as JSONObject | undefined,
        };
      });
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
    return ((updated[0] as Array<unknown> | undefined)?.length || 0) > 0;
  }

  // Taking an answer back, so the pool asks again and whatever the driver says counts again.
  public static async forgetStoragePoolCephLink(data: {
    projectId: ObjectID;
    openStackCloudId: ObjectID;
    externalId: string;
  }): Promise<boolean> {
    const updated: Array<unknown> =
      await OpenStackResourceService.getRepository().manager.query(
        `UPDATE "OpenStackResource"
         SET "facts" = COALESCE("facts", '{}'::jsonb) - '${OPENSTACK_STORAGE_POOL_CEPH_LINK_FACT}'
         WHERE "projectId" = $1 AND "openStackCloudId" = $2
           AND "kind" = '${OpenStackResourceKind.StoragePool}'
           AND "externalId" = $3 AND "deletedAt" IS NULL
         RETURNING "_id"`,
        [
          data.projectId.toString(),
          data.openStackCloudId.toString(),
          data.externalId,
        ],
      );
    return ((updated[0] as Array<unknown> | undefined)?.length || 0) > 0;
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
      select: { _id: true, healthStatus: true, lastSeenAt: true },
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
          healthStatus: getOpenStackCephHealthNow({
            healthStatus: cluster?.healthStatus,
            lastSeenAt: cluster?.lastSeenAt,
            now: OneUptimeDate.getCurrentDate(),
          }),
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
    serviceName?: string | null | undefined;
    serviceNamespace?: string | null | undefined;
  }): Array<ExtractedEntity> {
    const attributes: Record<string, string> = {};
    // Every part's identity starts with its cloud's name: without one it would be another part.
    if (!data.placement.cloudName) {
      return [];
    }
    attributes["openstack.cloud.name"] = data.placement.cloudName;
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
      // A namespace is part of a service's identity: leaving it out would draw a second one.
      if (data.serviceNamespace) {
        attributes["service.namespace"] = data.serviceNamespace;
      }
    }
    return InventoryItem.extractEntities({
      projectId: data.projectId.toString(),
      attributes,
    });
  }

  /*
   * A service whose own telemetry says which instance it is on: its `host.id` is that
   * instance's UUID. Nothing else has to report for Topology to draw it there, least of all
   * OneUptime's agent. A UUID two clouds hold draws neither.
   */
  public static async reconcileServiceOnInstance(data: {
    projectId: ObjectID;
    instanceId: string;
    serviceName: string;
    serviceNamespace?: string | null | undefined;
  }): Promise<void> {
    const instance: OpenStackResource | null = getOnlyOpenStackMatch(
      await this.readInstancesById({
        projectId: data.projectId,
        instanceId: data.instanceId.toLowerCase(),
      }),
    );
    if (!instance) {
      return;
    }
    await reconcileEntityRegistryThrottled({
      projectId: data.projectId,
      entities: this.getPlacementEntities({
        projectId: data.projectId,
        placement: await this.toPlacement(instance),
        serviceName: data.serviceName,
        serviceNamespace: data.serviceNamespace,
      }),
    });
  }

  public static async reconcilePlacementInTopology(data: {
    projectId: ObjectID;
    host: { hostIdentifier: string };
    placement: OpenStackPlacement;
  }): Promise<void> {
    const services: Array<ServiceEntityRead> =
      await this.readServiceEntitiesOnHosts({
        projectId: data.projectId,
        hostIdentifiers: [data.host.hostIdentifier],
      });
    for (const service of services.length > 0
      ? services
      : [{ name: null, namespace: null }]) {
      await reconcileEntityRegistryThrottled({
        projectId: data.projectId,
        entities: this.getPlacementEntities({
          projectId: data.projectId,
          placement: data.placement,
          serviceName: service.name,
          serviceNamespace: service.namespace,
        }),
      });
    }
  }
}
