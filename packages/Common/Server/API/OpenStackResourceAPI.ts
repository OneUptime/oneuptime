import OpenStackResource from "../../Models/DatabaseModels/OpenStackResource";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackDomainSummary,
  OpenStackInventorySummary,
  OpenStackProjectOverview,
  OpenStackProjectSummary,
  OpenStackTopologyRead,
  Service as OpenStackResourceServiceType,
} from "../Services/OpenStackResourceService";
import OpenStackCloudService from "../Services/OpenStackCloudService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import { OpenStackBlastRadius } from "../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackRegionSummary,
  OpenStackTopConsumers,
} from "../../Types/OpenStack/OpenStackOverview";
import {
  OpenStackCountBy,
  OpenStackCountRow,
  isOpenStackCountable,
} from "../../Types/OpenStack/OpenStackCounts";
import {
  OPENSTACK_CEPH_STATUS_FACT,
  OpenStackLinkedHost,
  OpenStackLinkedKubernetesNode,
  OpenStackLinkedService,
  OpenStackPlacement,
  OpenStackReachAcrossProducts,
  getOpenStackCephStatusFact,
} from "../../Types/OpenStack/OpenStackLinks";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import ServiceModel from "../../Models/DatabaseModels/Service";
import DatabaseService from "../Services/DatabaseService";
import CephClusterService from "../Services/CephClusterService";
import HostService from "../Services/HostService";
import KubernetesClusterService from "../Services/KubernetesClusterService";
import ServiceService from "../Services/ServiceService";
import ModelPermission from "../Types/Database/Permissions/Index";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "../Utils/Logger";
import OpenStackAcrossProducts from "../Utils/OpenStack/OpenStackAcrossProducts";

/*
 * ------------------------------------------------------------------
 * OpenStackResourceAPI
 *
 * Augments the auto-generated CRUD router with its custom endpoints:
 *
 *   POST /openstack-resource/inventory-summary/:cloudId   { regionName? }
 *     The cloud's or a region's counts for its layout and Overview pages, in one round
 *     trip, read from the same rows the lists read. Needs read access to the cloud.
 *
 *   POST /openstack-resource/needs-attention/:cloudId   { regionName? }
 *     The rows that may need someone, for the Overview's Needs attention and health
 *     pill (OpenStackHealth has the last word on each). One indexed read per kind, so
 *     a cloud of any size answers quickly. Needs read access to the cloud.
 *
 *   POST /openstack-resource/region-summaries/:cloudId
 *     What each region holds, for the Overview's Regions card.
 *
 *   POST /openstack-resource/top-consumers/:cloudId   { regionName? }
 *     The projects holding the most, for the Overview.
 *
 *   POST /openstack-resource/blast-radius/:cloudId   { kind, externalId }
 *     What a failed part takes with it, by count and by project. Needs read access to
 *     the cloud, and only ever reads that cloud's rows.
 *
 *   POST /openstack-resource/counts/:cloudId   { kind, by }
 *     How many of a kind there are by what they hold, on the server, from a closed list
 *     of what can be counted (OpenStackCounts). Needs read access to the cloud.
 *
 *   POST /openstack-resource/rows/:cloudId   { kind, afterExternalId?, regionName?, status?, limit? }
 *     A kind's rows in order of their IDs, from after the last one read, at most a thousand at
 *     a time, for what walks a whole kind: the last page costs what the first does.
 *
 *   POST /openstack-resource/project-summaries/:cloudId   { projectIds }
 *     What each of a page of projects runs, and which of their parts may need someone.
 *
 *   POST /openstack-resource/project-overview/:cloudId   { projectId }
 *     One project's page: the same, the hosts down under it, and its labels.
 *
 *   POST /openstack-resource/domain-summaries/:cloudId
 *   POST /openstack-resource/domain-projects/:cloudId   { domainId }
 *     How many projects each domain holds, and the IDs a filter by domain narrows to.
 *
 *   POST /openstack-resource/topology/:cloudId
 *     What the cloud's map is drawn from, bounded however large the cloud is.
 *
 *   POST /openstack-resource/reach-of-instance/:cloudId   { instanceId }
 *     What an instance is elsewhere in OneUptime: its host, its Kubernetes node, its services.
 *
 *   POST /openstack-resource/host-of-machine/:projectId   { machineName }
 *     The host that is a hypervisor or a control plane machine, when exactly one could be.
 *
 *   POST /openstack-resource/placement-of-host/:hostId
 *   POST /openstack-resource/placement-of-service/:serviceId
 *   POST /openstack-resource/placement-of-kubernetes-node/:clusterId   { nodeName }
 *     Which part of which cloud a thing in another product is, for its own page. Needs read
 *     access to that thing and to the cloud, and says nothing at all without both.
 *
 *   POST /openstack-resource/storage-pool-ceph/:cloudId   { externalId }
 *   POST /openstack-resource/storage-pool-ceph-confirm/:cloudId
 *     { externalId, cephClusterId | isNotCeph }
 *     What can be said about a Cinder pool and Ceph, and what an operator answered, which
 *     needs permission to change the cloud.
 *
 * The standard CRUD endpoints (list / get) are still registered by BaseAPI, and
 * the UI uses them through ModelAPI, with the filters on the indexed columns.
 * Write endpoints reject (@TableAccessControl create/update/delete = []): ingest
 * writes go through OpenStackResourceService as root.
 * ------------------------------------------------------------------
 */
export default class OpenStackResourceAPI extends BaseAPI<
  OpenStackResource,
  OpenStackResourceServiceType
> {
  public constructor() {
    super(OpenStackResource, OpenStackResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getInventorySummary(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/needs-attention/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getNeedsAttention(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/blast-radius/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getBlastRadius(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/rows/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getRows(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/counts/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getCounts(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.registerCloudRead(
      "region-summaries",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getRegionSummaries(req, res);
      },
    );
    this.registerCloudRead(
      "top-consumers",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getTopConsumers(req, res);
      },
    );
    this.registerCloudRead(
      "project-summaries",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getProjectSummaries(req, res);
      },
    );
    this.registerCloudRead(
      "project-overview",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getProjectOverview(req, res);
      },
    );
    this.registerCloudRead(
      "domain-summaries",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getDomainSummaries(req, res);
      },
    );
    this.registerCloudRead(
      "domain-projects",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getDomainProjects(req, res);
      },
    );
    this.registerCloudRead(
      "topology",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getTopology(req, res);
      },
    );
    this.registerCloudRead(
      "reach-of-instance",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getReachOfInstance(req, res);
      },
    );
    this.registerCloudRead(
      "storage-pool-ceph",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getStoragePoolCeph(req, res);
      },
    );
    this.registerCloudRead(
      "storage-pool-ceph-confirm",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.confirmStoragePoolCeph(req, res);
      },
    );
    this.registerPlacementRead(
      "host-of-machine",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getHostOfMachine(req, res);
      },
    );
    this.registerPlacementRead(
      "placement-of-host",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getPlacementOfHost(req, res);
      },
    );
    this.registerPlacementRead(
      "placement-of-service",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getPlacementOfService(req, res);
      },
    );
    this.registerPlacementRead(
      "placement-of-kubernetes-node",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getPlacementOfKubernetesNode(req, res);
      },
    );
  }

  private registerPlacementRead(
    path: string,
    read: (req: ExpressRequest, res: ExpressResponse) => Promise<void>,
  ): void {
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/${path}/:resourceId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await read(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private readResourceIdParam(req: ExpressRequest): ObjectID {
    const value: string | undefined = req.params["resourceId"];
    if (!value || !ObjectID.isValidUUID(value)) {
      throw new BadDataException("That is not an ID");
    }
    return new ObjectID(value);
  }

  /*
   * A placement names a cloud, an instance and whose it is, so the caller has to be able to
   * read that cloud. Someone who can read the host and not the cloud is told nothing, which
   * reads the same as a host on no cloud at all.
   */
  private async keepPlacementsCallerMayRead<
    T extends { placement: OpenStackPlacement },
  >(data: {
    placements: Array<T>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<T>> {
    const kept: Array<T> = [];
    const readable: Map<string, boolean> = new Map();
    for (const one of data.placements) {
      const cloudId: string = one.placement.openStackCloudId;
      if (!readable.has(cloudId)) {
        let canRead: boolean = false;
        try {
          canRead = Boolean(
            await OpenStackCloudService.findOneById({
              id: new ObjectID(cloudId),
              select: { _id: true },
              props: data.props,
            }),
          );
        } catch {
          canRead = false;
        }
        readable.set(cloudId, canRead);
      }
      if (readable.get(cloudId)) {
        kept.push(one);
      }
    }
    return kept;
  }

  /*
   * Which host a machine is takes every host and hypervisor in the project to say, so it is
   * worked out on all of them, and only the answer is read as the caller: someone who can't
   * read that host, or that project, is told nothing, as if no host were there.
   */
  private async getHostOfMachine(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const projectId: ObjectID = this.readResourceIdParam(req);
    const found: Host | null = await OpenStackAcrossProducts.getHostOfMachine({
      projectId,
      machineName: this.readString(req, "machineName"),
    });
    let host: Host | null = null;
    if (found?.id) {
      try {
        host = await HostService.findOneById({
          id: found.id,
          select: { _id: true, name: true, hostIdentifier: true },
          props,
        });
      } catch {
        host = null;
      }
    }
    return Response.sendJsonObjectResponse(req, res, {
      host: host
        ? {
            _id: host.id!.toString(),
            name: host.name || null,
            hostIdentifier: host.hostIdentifier || null,
          }
        : null,
    });
  }

  private async getPlacementOfHost(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const hostId: ObjectID = this.readResourceIdParam(req);
    const host: Host | null = await HostService.findOneById({
      id: hostId,
      select: { _id: true, projectId: true },
      props,
    });
    if (!host?.projectId) {
      throw new NotFoundException("Host not found");
    }
    const placement: OpenStackPlacement | null =
      await OpenStackAcrossProducts.getPlacementOfHost({
        projectId: host.projectId,
        hostId,
      });
    const kept: Array<{ placement: OpenStackPlacement }> =
      await this.keepPlacementsCallerMayRead({
        placements: placement ? [{ placement }] : [],
        props,
      });
    return Response.sendJsonObjectResponse(req, res, {
      placement: kept[0]?.placement || null,
    } as unknown as JSONObject);
  }

  private async getPlacementOfService(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const service: ServiceModel | null = await ServiceService.findOneById({
      id: this.readResourceIdParam(req),
      select: { _id: true, projectId: true, name: true },
      props,
    });
    if (!service?.projectId || !service.name) {
      throw new NotFoundException("Service not found");
    }
    const placements: Array<{
      hostName: string;
      hostId: string | null;
      placement: OpenStackPlacement;
    }> = await this.keepPlacementsCallerMayRead({
      placements: await OpenStackAcrossProducts.getPlacementsOfService({
        projectId: service.projectId,
        serviceName: service.name,
      }),
      props,
    });
    return Response.sendJsonObjectResponse(req, res, {
      placements,
    } as unknown as JSONObject);
  }

  private async getPlacementOfKubernetesNode(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const clusterId: ObjectID = this.readResourceIdParam(req);
    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneById({
        id: clusterId,
        select: { _id: true, projectId: true },
        props,
      });
    if (!cluster?.projectId) {
      throw new NotFoundException("Kubernetes cluster not found");
    }
    const placement: OpenStackPlacement | null =
      await OpenStackAcrossProducts.getPlacementOfKubernetesNode({
        projectId: cluster.projectId,
        kubernetesClusterId: clusterId,
        nodeName: this.readString(req, "nodeName"),
      });
    const kept: Array<{ placement: OpenStackPlacement }> =
      await this.keepPlacementsCallerMayRead({
        placements: placement ? [{ placement }] : [],
        props,
      });
    return Response.sendJsonObjectResponse(req, res, {
      placement: kept[0]?.placement || null,
    } as unknown as JSONObject);
  }

  private async getReachOfInstance(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const reach: OpenStackReachAcrossProducts =
      await OpenStackAcrossProducts.getReachOfInstance({
        projectId,
        openStackCloudId,
        instanceId: this.readString(req, "instanceId"),
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      (await this.keepReachCallerMayRead({
        reach,
        props,
      })) as unknown as JSONObject,
    );
  }

  /*
   * Which of these another product would show the caller, asked as the caller. A product they
   * can't read at all answers with nothing, rather than failing the card that asked.
   */
  private async readIdsCallerMayRead<T extends BaseModel>(data: {
    service: DatabaseService<T>;
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    if (data.ids.length === 0) {
      return new Set();
    }
    try {
      const rows: Array<T> = await data.service.findBy({
        query: { _id: QueryHelper.any(data.ids) } as never,
        select: { _id: true } as never,
        limit: data.ids.length,
        skip: 0,
        props: data.props,
      });
      return new Set(
        rows.map((row: T): string => {
          return row.id?.toString() || "";
        }),
      );
    } catch {
      return new Set();
    }
  }

  /*
   * A person who may read a cloud may not be able to read a host or a service on it. Each
   * list is narrowed by asking its own product for the same IDs as the caller, so what
   * they see of another product here is what they would see there.
   */
  private async keepReachCallerMayRead(data: {
    reach: OpenStackReachAcrossProducts;
    props: DatabaseCommonInteractionProps;
  }): Promise<OpenStackReachAcrossProducts> {
    const reach: OpenStackReachAcrossProducts = data.reach;
    const hosts: Set<string> = await this.readIdsCallerMayRead({
      service: HostService,
      ids: reach.hosts.map((host: OpenStackLinkedHost): string => {
        return host.id;
      }),
      props: data.props,
    });
    const services: Set<string> = await this.readIdsCallerMayRead({
      service: ServiceService,
      ids: reach.services.map((service: OpenStackLinkedService): string => {
        return service.id;
      }),
      props: data.props,
    });
    const clusters: Set<string> = await this.readIdsCallerMayRead({
      service: KubernetesClusterService,
      ids: reach.kubernetesClusters.map((cluster: { id: string }): string => {
        return cluster.id;
      }),
      props: data.props,
    });

    const keptHosts: Array<OpenStackLinkedHost> = reach.hosts.filter(
      (host: OpenStackLinkedHost): boolean => {
        return hosts.has(host.id);
      },
    );
    const keptServices: Array<OpenStackLinkedService> = reach.services.filter(
      (service: OpenStackLinkedService): boolean => {
        return services.has(service.id);
      },
    );
    const keptNodes: Array<OpenStackLinkedKubernetesNode> =
      reach.kubernetesNodes.filter(
        (node: OpenStackLinkedKubernetesNode): boolean => {
          return clusters.has(node.clusterId);
        },
      );
    const keptClusters: OpenStackReachAcrossProducts["kubernetesClusters"] =
      reach.kubernetesClusters.filter((cluster: { id: string }): boolean => {
        return clusters.has(cluster.id);
      });

    return {
      hostCount: reach.hostCount - (reach.hosts.length - keptHosts.length),
      hosts: keptHosts,
      kubernetesNodeCount: keptClusters.reduce(
        (total: number, cluster: { nodeCount: number }): number => {
          return total + cluster.nodeCount;
        },
        0,
      ),
      kubernetesNodes: keptNodes,
      kubernetesClusters: keptClusters,
      serviceCount:
        reach.serviceCount - (reach.services.length - keptServices.length),
      services: keptServices,
    };
  }

  private async getStoragePoolCeph(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const answer: Awaited<
      ReturnType<typeof OpenStackAcrossProducts.getStoragePoolCephLink>
    > = await OpenStackAcrossProducts.getStoragePoolCephLink({
      projectId,
      openStackCloudId,
      externalId: this.readString(req, "externalId"),
    });
    if (!answer) {
      throw new NotFoundException("That pool is not in this cloud's inventory");
    }

    // What a Ceph cluster is called and how healthy it is are Ceph's to show, or not to.
    const visible: Set<string> = await this.readIdsCallerMayRead({
      service: CephClusterService,
      ids: answer.clusters.map((cluster: { id: string }): string => {
        return cluster.id;
      }),
      props,
    });
    const isLinkVisible: boolean =
      !answer.link.clusterId || visible.has(answer.link.clusterId);
    return Response.sendJsonObjectResponse(req, res, {
      link: isLinkVisible
        ? answer.link
        : {
            state: visible.size > 0 ? "unknown" : "no-clusters",
            clusterId: null,
            clusterName: null,
            cephPoolName: null,
          },
      clusters: answer.clusters.filter((cluster: { id: string }): boolean => {
        return visible.has(cluster.id);
      }),
      health: isLinkVisible ? answer.health : null,
      capacityUsedPercent: isLinkVisible ? answer.capacityUsedPercent : null,
    } as unknown as JSONObject);
  }

  // A pool's trouble is only Ceph's to name for someone who can read that Ceph cluster.
  private async keepCephStatusCallerMayRead(data: {
    rows: Array<JSONObject>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const clusterOf: (row: JSONObject) => string | null = (
      row: JSONObject,
    ): string | null => {
      return (
        getOpenStackCephStatusFact(row["facts"] as JSONObject | undefined)
          ?.clusterId || null
      );
    };
    const ids: Array<string> = Array.from(
      new Set(
        data.rows.map(clusterOf).filter((id: string | null): id is string => {
          return Boolean(id);
        }),
      ),
    );
    const visible: Set<string> = await this.readIdsCallerMayRead({
      service: CephClusterService,
      ids,
      props: data.props,
    });
    for (const row of data.rows) {
      const clusterId: string | null = clusterOf(row);
      if (clusterId && !visible.has(clusterId)) {
        const facts: JSONObject = { ...(row["facts"] as JSONObject) };
        delete facts[OPENSTACK_CEPH_STATUS_FACT];
        row["facts"] = facts;
      }
    }
  }

  /*
   * An answer about what a cloud is built on, kept for everyone: it takes the permission to
   * change the cloud, not only to read it.
   */
  private async confirmStoragePoolCeph(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    await ModelPermission.checkUpdateQueryPermissions(
      OpenStackCloud,
      { _id: openStackCloudId.toString(), projectId } as never,
      {},
      props,
    );

    const body: JSONObject = (req.body || {}) as JSONObject;
    const isNotCeph: boolean = body["isNotCeph"] === true;
    const cephClusterId: unknown = body["cephClusterId"];
    if (
      !isNotCeph &&
      (typeof cephClusterId !== "string" ||
        !ObjectID.isValidUUID(cephClusterId))
    ) {
      throw new BadDataException(
        "Choose a Ceph cluster, or say it isn't on Ceph",
      );
    }

    const saved: boolean =
      await OpenStackAcrossProducts.confirmStoragePoolCephLink({
        projectId,
        openStackCloudId,
        externalId: this.readString(req, "externalId"),
        cephClusterId: isNotCeph ? null : new ObjectID(cephClusterId as string),
        isNotCeph,
      });
    if (!saved) {
      throw new NotFoundException(
        "That pool or that Ceph cluster is not in this project",
      );
    }
    return Response.sendEmptySuccessResponse(req, res);
  }

  private registerCloudRead(
    path: string,
    read: (req: ExpressRequest, res: ExpressResponse) => Promise<void>,
  ): void {
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/${path}/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await read(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private readStringList(req: ExpressRequest, key: string): Array<string> {
    const value: unknown = ((req.body || {}) as JSONObject)[key];
    if (
      !Array.isArray(value) ||
      value.some((item: unknown): boolean => {
        return typeof item !== "string" || !item;
      })
    ) {
      throw new BadDataException(`${key} must be a list of IDs`);
    }
    return value as Array<string>;
  }

  private readString(req: ExpressRequest, key: string): string {
    const value: unknown = ((req.body || {}) as JSONObject)[key];
    if (typeof value !== "string" || !value) {
      throw new BadDataException(`${key} is required`);
    }
    return value;
  }

  // A region to read, when the body names one. Nothing named reads the whole cloud.
  private readRegionName(req: ExpressRequest): string | undefined {
    const value: unknown = ((req.body || {}) as JSONObject)["regionName"];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (typeof value !== "string") {
      throw new BadDataException("regionName must be a string");
    }
    return value;
  }

  private async getRegionSummaries(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const regions: Array<OpenStackRegionSummary> =
      await this.service.getRegionSummaries({ projectId, openStackCloudId });

    return Response.sendJsonObjectResponse(req, res, {
      regions,
    } as unknown as JSONObject);
  }

  private async getTopConsumers(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const consumers: OpenStackTopConsumers = await this.service.getTopConsumers(
      {
        projectId,
        openStackCloudId,
        regionName: this.readRegionName(req),
      },
    );

    return Response.sendJsonObjectResponse(
      req,
      res,
      consumers as unknown as JSONObject,
    );
  }

  private async getProjectSummaries(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);
    const openStackProjectIds: Array<string> = this.readStringList(
      req,
      "projectIds",
    );

    const [summaries, attention]: [
      Array<OpenStackProjectSummary>,
      OpenStackAttentionRows,
    ] = await Promise.all([
      this.service.getProjectSummaries({
        projectId,
        openStackCloudId,
        openStackProjectIds,
      }),
      this.service.getAttentionRows({
        projectId,
        openStackCloudId,
        now: OneUptimeDate.getCurrentDate(),
        openStackProjectIds,
        rowsPerKind: 500,
      }),
    ]);

    return Response.sendJsonObjectResponse(req, res, {
      summaries,
      attention,
    } as unknown as JSONObject);
  }

  private async getProjectOverview(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const overview: OpenStackProjectOverview =
      await this.service.getProjectOverview({
        projectId,
        openStackCloudId,
        openStackProjectId: this.readString(req, "projectId"),
        now: OneUptimeDate.getCurrentDate(),
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      overview as unknown as JSONObject,
    );
  }

  private async getDomainSummaries(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const summaries: Array<OpenStackDomainSummary> =
      await this.service.getDomainSummaries({ projectId, openStackCloudId });

    return Response.sendJsonObjectResponse(req, res, {
      summaries,
    } as unknown as JSONObject);
  }

  private async getDomainProjects(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    return Response.sendJsonObjectResponse(
      req,
      res,
      (await this.service.getProjectIdsOfDomain({
        projectId,
        openStackCloudId,
        domainId: this.readString(req, "domainId"),
      })) as unknown as JSONObject,
    );
  }

  private async getTopology(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const topology: OpenStackTopologyRead = await this.service.getTopologyRead({
      projectId,
      openStackCloudId,
      now: OneUptimeDate.getCurrentDate(),
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      topology as unknown as JSONObject,
    );
  }

  private async getRows(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const body: JSONObject = (req.body || {}) as JSONObject;
    const kind: unknown = body["kind"];

    if (
      typeof kind !== "string" ||
      !Object.values(OpenStackResourceKind).includes(
        kind as OpenStackResourceKind,
      )
    ) {
      throw new BadDataException("That is not a kind of OpenStack resource");
    }

    const textOf: (key: string) => string | undefined = (
      key: string,
    ): string | undefined => {
      const value: unknown = body[key];
      return typeof value === "string" && value ? value : undefined;
    };

    const limit: unknown = body["limit"];

    const page: { rows: Array<JSONObject>; nextExternalId: string | null } =
      await this.service.getRowsAfter({
        projectId,
        openStackCloudId,
        kind: kind as OpenStackResourceKind,
        afterExternalId: textOf("afterExternalId"),
        regionName: textOf("regionName"),
        status: textOf("status"),
        limit: typeof limit === "number" ? limit : undefined,
      });

    return Response.sendJsonObjectResponse(req, res, {
      rows: page.rows as unknown as JSONObject,
      nextExternalId: page.nextExternalId,
    });
  }

  private async getCounts(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const body: JSONObject = (req.body || {}) as JSONObject;
    const kind: unknown = body["kind"];
    const by: unknown = body["by"];
    if (!isOpenStackCountable(kind, by)) {
      throw new BadDataException("That kind can not be counted by that");
    }

    const rows: Array<OpenStackCountRow> = await this.service.getCounts({
      projectId,
      openStackCloudId,
      kind,
      by: by as OpenStackCountBy,
    });

    return Response.sendJsonObjectResponse(req, res, {
      rows: rows as unknown as JSONObject,
    });
  }

  private async getBlastRadius(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const body: JSONObject = (req.body || {}) as JSONObject;
    const kind: unknown = body["kind"];
    const externalId: unknown = body["externalId"];
    if (
      typeof kind !== "string" ||
      !Object.values(OpenStackResourceKind).includes(
        kind as OpenStackResourceKind,
      ) ||
      typeof externalId !== "string" ||
      !externalId
    ) {
      throw new BadDataException("kind and externalId are required");
    }

    const part: OpenStackResource | null = await this.service.findOneBy({
      query: {
        projectId,
        openStackCloudId,
        kind,
        externalId,
      },
      select: {
        kind: true,
        name: true,
        regionName: true,
        hypervisorName: true,
        externalId: true,
        facts: true,
      },
      props: { isRoot: true },
    });
    if (!part) {
      throw new NotFoundException("That part is not in this cloud's inventory");
    }

    const result: OpenStackBlastRadius = await this.service.getBlastRadius({
      projectId,
      openStackCloudId,
      part: {
        kind: part.kind as OpenStackResourceKind,
        name: part.name,
        regionName: part.regionName,
        hypervisorName: part.hypervisorName,
        externalId: part.externalId,
        facts: part.facts,
      },
    });

    /*
     * What it reaches beyond the cloud, on its own: a Kubernetes or Host read that fails
     * leaves the card with what the cloud itself said.
     */
    try {
      const reach: OpenStackReachAcrossProducts | null =
        await OpenStackAcrossProducts.getReachOfPart({
          projectId,
          openStackCloudId,
          part: {
            kind: part.kind as OpenStackResourceKind,
            name: part.name,
            regionName: part.regionName,
            hypervisorName: part.hypervisorName,
            facts: part.facts,
          },
        });
      if (reach) {
        result.acrossProducts = await this.keepReachCallerMayRead({
          reach,
          props: await CommonAPI.getDatabaseCommonInteractionProps(req),
        });
      }
    } catch (err) {
      logger.warn(
        `Could not read what an OpenStack part reaches beyond the cloud: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  private async getNeedsAttention(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const result: OpenStackAttentionRows = await this.service.getAttentionRows({
      projectId,
      openStackCloudId,
      now: OneUptimeDate.getCurrentDate(),
      regionName: this.readRegionName(req),
    });

    // Ceph's trouble is the cloud's too, for the pools someone linked. One more thing to know.
    try {
      await OpenStackAcrossProducts.addCephStatusToPools({
        projectId,
        rows: result.rows,
      });
      await this.keepCephStatusCallerMayRead({
        rows: result.rows,
        props: await CommonAPI.getDatabaseCommonInteractionProps(req),
      });
    } catch (err) {
      logger.warn(
        `Could not read the Ceph clusters behind an OpenStack cloud's pools: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  private readCloudIdParam(req: ExpressRequest): ObjectID {
    const cloudIdParam: string | undefined = req.params["cloudId"];
    if (!cloudIdParam) {
      throw new BadDataException("Cloud ID is required");
    }

    try {
      return new ObjectID(cloudIdParam);
    } catch {
      throw new BadDataException("Invalid Cloud ID");
    }
  }

  /*
   * Throws NotFound when the cloud is missing or the caller lacks read access,
   * indistinguishable on purpose.
   */
  private async resolveCloudForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }> {
    const openStackCloudId: ObjectID = this.readCloudIdParam(req);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cloud: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: openStackCloudId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!cloud || !cloud.projectId) {
      throw new NotFoundException("OpenStack Cloud not found");
    }

    return {
      projectId: cloud.projectId,
      openStackCloudId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const summary: OpenStackInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        openStackCloudId,
        regionName: this.readRegionName(req),
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      summary as unknown as JSONObject,
    );
  }
}
