import CephResource from "../../Models/DatabaseModels/CephResource";
import CephCluster from "../../Models/DatabaseModels/CephCluster";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import CephResourceService, {
  CephInventorySummary,
  Service as CephResourceServiceType,
} from "../Services/CephResourceService";
import CephClusterService from "../Services/CephClusterService";
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
 * CephResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the Ceph layout/overview pages use to fetch sidebar badge
 * counts in one round-trip:
 *
 *   POST /ceph-resource/inventory-summary/:clusterId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through CephResourceService as root.
 * ------------------------------------------------------------------
 */
export default class CephResourceAPI extends BaseAPI<
  CephResource,
  CephResourceServiceType
> {
  public constructor() {
    super(CephResource, CephResourceService);

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

  /*
   * Cluster + auth resolution for the cluster-scoped sub-route.
   * Returns the (projectId, cephClusterId) tuple after enforcing the
   * standard ACL chain. Throws NotFound when the cluster is missing
   * or the caller lacks read access (indistinguishable on purpose).
   */
  private async resolveClusterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    cephClusterId: ObjectID;
  }> {
    const clusterIdParam: string | undefined = req.params["clusterId"];
    if (!clusterIdParam) {
      throw new BadDataException("Cluster ID is required");
    }

    let cephClusterId: ObjectID;
    try {
      cephClusterId = new ObjectID(clusterIdParam);
    } catch {
      throw new BadDataException("Invalid Cluster ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cluster: CephCluster | null = await CephClusterService.findOneById({
      id: cephClusterId,
      select: {
        _id: true,
        projectId: true,
      },
      props,
    });

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException("Ceph Cluster not found");
    }

    return {
      projectId: cluster.projectId,
      cephClusterId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, cephClusterId } =
      await this.resolveClusterForRequest(req);

    const summary: CephInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        cephClusterId,
      });

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      // Convenience fields so the UI doesn't have to repeat COALESCE:
      osdCount: summary.countsByKind["Osd"] || 0,
      poolCount: summary.countsByKind["Pool"] || 0,
      monCount: summary.countsByKind["Mon"] || 0,
      mgrCount: summary.countsByKind["Mgr"] || 0,
      mdsCount: summary.countsByKind["Mds"] || 0,
      rgwCount: summary.countsByKind["Rgw"] || 0,
      osdUpCount: summary.osdUpCount,
      osdInCount: summary.osdInCount,
      monInQuorumCount: summary.monInQuorumCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
