import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import KubernetesClusterService, {
  KubernetesCostReport,
  ProvisionRecommendedMonitorsResult,
  Service as KubernetesClusterServiceType,
  WorkloadTimelineResult,
} from "../Services/KubernetesClusterService";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

const DEFAULT_COST_REPORT_WINDOW_HOURS: number = 24;
const MIN_COST_REPORT_WINDOW_HOURS: number = 1;
const MAX_COST_REPORT_WINDOW_HOURS: number = 168;

const DEFAULT_TIMELINE_WINDOW_HOURS: number = 24;

/*
 * ------------------------------------------------------------------
 * KubernetesClusterAPI
 *
 * Augments the auto-generated CRUD router with the cluster-scoped
 * endpoints the Kubernetes dashboard pages use:
 *
 *   POST /kubernetes-cluster/provision-recommended-monitors/:clusterId
 *   POST /kubernetes-cluster/cost-report/:clusterId
 *   POST /kubernetes-cluster/workload-timeline/:clusterId
 *
 * The standard CRUD endpoints are still registered by BaseAPI.
 * Handlers stay thin; all computation lives in
 * KubernetesClusterService.
 * ------------------------------------------------------------------
 */
export default class KubernetesClusterAPI extends BaseAPI<
  KubernetesCluster,
  KubernetesClusterServiceType
> {
  public constructor() {
    super(KubernetesCluster, KubernetesClusterService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/provision-recommended-monitors/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.provisionRecommendedMonitors(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/cost-report/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getCostReport(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/workload-timeline/:clusterId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getWorkloadTimeline(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  /*
   * Cluster + auth resolution shared by the cluster-scoped sub-routes.
   * Resolves the cluster with caller-scoped props so the standard ACL
   * chain is enforced. Throws NotFound when the cluster is missing or
   * the caller lacks read access (indistinguishable on purpose).
   */
  private async resolveClusterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    kubernetesClusterId: ObjectID;
    cluster: KubernetesCluster;
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
          name: true,
          clusterIdentifier: true,
          costPerCpuCoreHour: true,
          costPerGbMemoryHour: true,
          currencyCode: true,
        },
        props,
      });

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException("Kubernetes Cluster not found");
    }

    return {
      projectId: cluster.projectId,
      kubernetesClusterId,
      cluster,
    };
  }

  private getClusterIdentifierOrThrow(cluster: KubernetesCluster): string {
    if (!cluster.clusterIdentifier) {
      throw new BadDataException(
        "Kubernetes Cluster has no cluster identifier",
      );
    }
    return cluster.clusterIdentifier;
  }

  private async provisionRecommendedMonitors(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, cluster } = await this.resolveClusterForRequest(req);
    const clusterIdentifier: string = this.getClusterIdentifierOrThrow(cluster);

    const body: JSONObject = (req.body as JSONObject) || {};

    let templateIds: Array<string> | undefined = undefined;
    if (Array.isArray(body["templateIds"])) {
      templateIds = (body["templateIds"] as Array<unknown>).filter(
        (templateId: unknown): templateId is string => {
          return typeof templateId === "string" && templateId.length > 0;
        },
      );
    }

    // Caller props → monitor create-ACLs are enforced by the service.
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const result: ProvisionRecommendedMonitorsResult =
      await this.service.provisionRecommendedMonitors({
        projectId,
        clusterName: cluster.name || clusterIdentifier,
        clusterIdentifier,
        templateIds,
        props,
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  private async getCostReport(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, kubernetesClusterId, cluster } =
      await this.resolveClusterForRequest(req);
    const clusterIdentifier: string = this.getClusterIdentifierOrThrow(cluster);

    const body: JSONObject = (req.body as JSONObject) || {};

    let windowHours: number = DEFAULT_COST_REPORT_WINDOW_HOURS;
    const rawWindowHours: unknown = body["windowHours"];
    if (typeof rawWindowHours === "number" && !isNaN(rawWindowHours)) {
      windowHours = rawWindowHours;
    } else if (typeof rawWindowHours === "string" && rawWindowHours) {
      const parsed: number = parseFloat(rawWindowHours);
      if (!isNaN(parsed)) {
        windowHours = parsed;
      }
    }
    windowHours = Math.min(
      Math.max(Math.round(windowHours), MIN_COST_REPORT_WINDOW_HOURS),
      MAX_COST_REPORT_WINDOW_HOURS,
    );

    const report: KubernetesCostReport = await this.service.getCostReport({
      projectId,
      kubernetesClusterId,
      clusterIdentifier,
      costPerCpuCoreHour: cluster.costPerCpuCoreHour,
      costPerGbMemoryHour: cluster.costPerGbMemoryHour,
      currencyCode: cluster.currencyCode,
      windowHours,
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      report as unknown as JSONObject,
    );
  }

  private async getWorkloadTimeline(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, kubernetesClusterId, cluster } =
      await this.resolveClusterForRequest(req);
    const clusterIdentifier: string = this.getClusterIdentifierOrThrow(cluster);

    const body: JSONObject = (req.body as JSONObject) || {};

    const kind: unknown = body["kind"];
    if (typeof kind !== "string" || !kind) {
      throw new BadDataException("kind is required");
    }

    const name: unknown = body["name"];
    if (typeof name !== "string" || !name) {
      throw new BadDataException("name is required");
    }

    const namespace: string | undefined =
      typeof body["namespace"] === "string" && body["namespace"]
        ? (body["namespace"] as string)
        : undefined;

    const endDate: Date =
      this.parseDateParam(body["endDate"], "endDate") ||
      OneUptimeDate.getCurrentDate();
    const startDate: Date =
      this.parseDateParam(body["startDate"], "startDate") ||
      OneUptimeDate.addRemoveHours(endDate, -DEFAULT_TIMELINE_WINDOW_HOURS);

    if (
      OneUptimeDate.toUnixTimestamp(startDate) >=
      OneUptimeDate.toUnixTimestamp(endDate)
    ) {
      throw new BadDataException("startDate must be before endDate");
    }

    const result: WorkloadTimelineResult =
      await this.service.getWorkloadTimeline({
        projectId,
        kubernetesClusterId,
        clusterIdentifier,
        kind,
        name,
        namespace,
        startDate,
        endDate,
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  // Returns null when the param is absent; throws when present but unparseable.
  private parseDateParam(value: unknown, paramName: string): Date | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }
    if (typeof value !== "string") {
      throw new BadDataException(`Invalid ${paramName}`);
    }
    try {
      const parsed: Date = OneUptimeDate.fromString(value);
      if (isNaN(parsed.getTime())) {
        throw new BadDataException(`Invalid ${paramName}`);
      }
      return parsed;
    } catch {
      throw new BadDataException(`Invalid ${paramName}`);
    }
  }
}
