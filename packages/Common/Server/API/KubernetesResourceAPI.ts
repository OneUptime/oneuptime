import KubernetesResource from "../../Models/DatabaseModels/KubernetesResource";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import KubernetesResourceService, {
  InventorySummary,
  KubernetesNeedsAttention,
  KubernetesPart,
  Service as KubernetesResourceServiceType,
} from "../Services/KubernetesResourceService";
import ColumnLength from "../../Types/Database/ColumnLength";
import KubernetesClusterService from "../Services/KubernetesClusterService";
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

// The kinds the inventory holds, and so the only ones a part read asks for.
export const KUBERNETES_PART_KINDS: ReadonlySet<string> = new Set<string>([
  "Pod",
  "Node",
  "Namespace",
  "Deployment",
  "StatefulSet",
  "DaemonSet",
  "Job",
  "CronJob",
  "PersistentVolumeClaim",
  "PersistentVolume",
  "HorizontalPodAutoscaler",
  "VerticalPodAutoscaler",
  "DeploymentConfig",
  "Route",
  "Service",
]);

/*
 * ------------------------------------------------------------------
 * KubernetesResourceAPI
 *
 * Augments the auto-generated CRUD router with the custom endpoints
 * the Kubernetes pages use: counts and health summaries in one
 * round-trip, and what needs attention, the most urgent first:
 *
 *   POST /kubernetes-resource/inventory-summary/:clusterId
 *   POST /kubernetes-resource/needs-attention/:clusterId
 *   POST /kubernetes-resource/part/:clusterId  { kind, name, namespace? }
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for detail-page reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through KubernetesResourceService as root.
 * ------------------------------------------------------------------
 */
export default class KubernetesResourceAPI extends BaseAPI<
  KubernetesResource,
  KubernetesResourceServiceType
> {
  public constructor() {
    super(KubernetesResource, KubernetesResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getInventorySummary(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * What needs attention in the cluster, the most urgent first: the
     * Overview's Needs attention card and its health pill
     * (KubernetesResourceService.getNeedsAttention).
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/needs-attention/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getNeedsAttention(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * One object with what it runs - a workload's pods, a node's pods, a
     * CronJob's Jobs - for its own page: its hero, what needs attention
     * on it and its Pods tab (KubernetesResourceService.getPart).
     */
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/part/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getPart(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Latest CPU+memory aggregated by Pod namespace. Powers the
     * Namespaces list view without a ClickHouse round-trip.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/latest-pod-metrics-by-namespace/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getLatestPodMetricsByNamespace(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Latest CPU+memory aggregated by Pod ownerReferences[].name for
     * a given owner kind. Powers Deployments/StatefulSets/DaemonSets/
     * Jobs/CronJobs/DeploymentConfigs list views.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/latest-pod-metrics-by-owner/:clusterId/:ownerKind`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getLatestPodMetricsByOwner(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Cluster + auth resolution shared by the cluster-scoped sub-routes.
   * Returns the (projectId, kubernetesClusterId) tuple after enforcing
   * the standard ACL chain. Throws NotFound when the cluster is
   * missing or the caller lacks read access (indistinguishable on
   * purpose).
   */
  private async resolveClusterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
  }> {
    const clusterIdParam: string | undefined = req.params["clusterId"];
    if (!clusterIdParam) {
      throw new BadDataException("Cluster ID is required");
    }

    let kubernetesClusterId: ObjectID;
    try {
      kubernetesClusterId = new ObjectID(clusterIdParam);
    } catch {
      throw new BadDataException("Invalid Cluster ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cluster: KubernetesCluster | null =
      await KubernetesClusterService.findOneById({
        id: kubernetesClusterId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException("Kubernetes Cluster not found");
    }

    return {
      projectId: cluster.projectId,
      kubernetesClusterId,
    };
  }

  /*
   * Translate a service-layer Map of aggregates into a JSON dict
   * { name: { cpuPercent, memoryBytes, memoryPercent } } suitable for
   * the wire. memoryBytes is stringified so values past 2 GiB don't
   * overflow client-side number parsing in the JSON path; the UI parses
   * it back to a number for rendering. memoryPercent is the summed
   * per-pod "% of node allocatable memory" (parallel to cpuPercent).
   */
  private mapAggregatesToJson(
    aggregates: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    >,
  ): JSONObject {
    const out: JSONObject = {};
    for (const [name, value] of aggregates.entries()) {
      out[name] = {
        cpuPercent: value.cpuPercent,
        memoryBytes: value.memoryBytes.toString(),
        memoryPercent: value.memoryPercent,
      };
    }
    return out;
  }

  private async getLatestPodMetricsByNamespace(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, kubernetesClusterId } =
      await this.resolveClusterForRequest(req);

    const staleAfter: Date = new Date(Date.now() - 15 * 60 * 1000);
    const aggregates: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    > = await this.service.getLatestMetricsByNamespace({
      projectId,
      kubernetesClusterId,
      staleAfter,
    });

    return Response.sendJsonObjectResponse(req, res, {
      aggregates: this.mapAggregatesToJson(aggregates),
    });
  }

  private async getLatestPodMetricsByOwner(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const ownerKind: string | undefined = req.params["ownerKind"];
    if (!ownerKind) {
      throw new BadDataException("Owner kind is required");
    }
    /*
     * Only a small allow-list of owner kinds makes sense here; reject
     * anything else so the endpoint can't be used to probe arbitrary
     * jsonb_array_elements paths.
     */
    const allowed: Set<string> = new Set([
      "Deployment",
      "StatefulSet",
      "DaemonSet",
      "Job",
      "CronJob",
      "ReplicaSet",
      "DeploymentConfig",
    ]);
    if (!allowed.has(ownerKind)) {
      throw new BadDataException(`Unsupported owner kind: ${ownerKind}`);
    }

    const { projectId, kubernetesClusterId } =
      await this.resolveClusterForRequest(req);

    const staleAfter: Date = new Date(Date.now() - 15 * 60 * 1000);
    const aggregates: Map<
      string,
      { cpuPercent: number; memoryBytes: number; memoryPercent: number }
    > = await this.service.getLatestMetricsByOwner({
      projectId,
      kubernetesClusterId,
      ownerKind,
      staleAfter,
    });

    return Response.sendJsonObjectResponse(req, res, {
      aggregates: this.mapAggregatesToJson(aggregates),
    });
  }

  private async getNeedsAttention(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, kubernetesClusterId } =
      await this.resolveClusterForRequest(req);

    const result: KubernetesNeedsAttention =
      await this.service.getNeedsAttention({
        projectId,
        kubernetesClusterId,
      });

    return Response.sendJsonObjectResponse(req, res, {
      findings: result.findings as unknown as JSONObject,
      isTruncated: result.isTruncated,
    });
  }

  private async getPart(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const body: JSONObject = (req.body as JSONObject) || {};
    const kind: unknown = body["kind"];
    const name: unknown = body["name"];
    const namespace: unknown = body["namespace"];

    // Only the kinds the inventory holds: anything else is no query at all.
    if (typeof kind !== "string" || !KUBERNETES_PART_KINDS.has(kind)) {
      throw new BadDataException("Unsupported kind");
    }
    if (
      typeof name !== "string" ||
      !name.trim() ||
      name.length > ColumnLength.LongText
    ) {
      throw new BadDataException("Name is required");
    }
    if (
      namespace !== undefined &&
      namespace !== null &&
      (typeof namespace !== "string" ||
        namespace.length > ColumnLength.ShortText)
    ) {
      throw new BadDataException("Invalid namespace");
    }

    const { projectId, kubernetesClusterId } =
      await this.resolveClusterForRequest(req);

    const result: KubernetesPart = await this.service.getPart({
      projectId,
      kubernetesClusterId,
      kind,
      name,
      namespace:
        typeof namespace === "string" && namespace ? namespace : undefined,
    });

    return Response.sendJsonObjectResponse(req, res, {
      part: result.part as unknown as JSONObject,
      pods: result.pods as unknown as JSONObject,
      jobs: result.jobs as unknown as JSONObject,
      isPodsTruncated: result.isPodsTruncated,
    });
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, kubernetesClusterId } =
      await this.resolveClusterForRequest(req);

    const summary: InventorySummary = await this.service.getInventorySummary({
      projectId,
      kubernetesClusterId,
    });

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      podPhaseCounts: summary.podPhaseCounts as unknown as JSONObject,
      nodeReadyCounts: summary.nodeReadyCounts as unknown as JSONObject,
      nodePressureCounts: summary.nodePressureCounts as unknown as JSONObject,
      // Convenience fields so the UI doesn't have to repeat COALESCE:
      pvcCount: summary.countsByKind["PersistentVolumeClaim"] || 0,
      pvCount: summary.countsByKind["PersistentVolume"] || 0,
      nodeCount: summary.countsByKind["Node"] || 0,
      podCount: summary.countsByKind["Pod"] || 0,
      namespaceCount: summary.countsByKind["Namespace"] || 0,
      deploymentCount: summary.countsByKind["Deployment"] || 0,
      statefulSetCount: summary.countsByKind["StatefulSet"] || 0,
      daemonSetCount: summary.countsByKind["DaemonSet"] || 0,
      jobCount: summary.countsByKind["Job"] || 0,
      cronJobCount: summary.countsByKind["CronJob"] || 0,
      hpaCount: summary.countsByKind["HorizontalPodAutoscaler"] || 0,
      vpaCount: summary.countsByKind["VerticalPodAutoscaler"] || 0,
      deploymentConfigCount: summary.countsByKind["DeploymentConfig"] || 0,
      routeCount: summary.countsByKind["Route"] || 0,
      serviceCount: summary.countsByKind["Service"] || 0,
      clusterOperatorCount: summary.countsByKind["ClusterOperator"] || 0,
      containerCount: summary.containerCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
