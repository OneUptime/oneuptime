import KubernetesResource from "../../Models/DatabaseModels/KubernetesResource";
import KubernetesCluster from "../../Models/DatabaseModels/KubernetesCluster";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import KubernetesResourceService, {
  InventorySummary,
  Service as KubernetesResourceServiceType,
} from "../Services/KubernetesResourceService";
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

/*
 * ------------------------------------------------------------------
 * KubernetesResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the Kubernetes overview page uses to fetch counts and
 * health summaries in one round-trip:
 *
 *   POST /kubernetes-resource/inventory-summary/:clusterId
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
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
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

    /*
     * Authorize: the caller must be able to read the parent cluster.
     * findOneById applies the full ACL chain; a null return means 404
     * (either the cluster doesn't exist or the caller cannot see it —
     * indistinguishable on purpose).
     */
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

    const summary: InventorySummary = await this.service.getInventorySummary({
      projectId: cluster.projectId,
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
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
