import ProxmoxResource from "../../Models/DatabaseModels/ProxmoxResource";
import ProxmoxCluster from "../../Models/DatabaseModels/ProxmoxCluster";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import ProxmoxResourceService, {
  ProxmoxInventorySummary,
  Service as ProxmoxResourceServiceType,
} from "../Services/ProxmoxResourceService";
import ProxmoxClusterService from "../Services/ProxmoxClusterService";
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
 * ProxmoxResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the Proxmox layout/overview pages use to fetch sidebar
 * badge counts in one round-trip:
 *
 *   POST /proxmox-resource/inventory-summary/:clusterId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through ProxmoxResourceService as root.
 * ------------------------------------------------------------------
 */
export default class ProxmoxResourceAPI extends BaseAPI<
  ProxmoxResource,
  ProxmoxResourceServiceType
> {
  public constructor() {
    super(ProxmoxResource, ProxmoxResourceService);

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
   * Returns the (projectId, proxmoxClusterId) tuple after enforcing
   * the standard ACL chain. Throws NotFound when the cluster is
   * missing or the caller lacks read access (indistinguishable on
   * purpose).
   */
  private async resolveClusterForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    proxmoxClusterId: ObjectID;
  }> {
    const clusterIdParam: string | undefined = req.params["clusterId"];
    if (!clusterIdParam) {
      throw new BadDataException("Cluster ID is required");
    }

    let proxmoxClusterId: ObjectID;
    try {
      proxmoxClusterId = new ObjectID(clusterIdParam);
    } catch {
      throw new BadDataException("Invalid Cluster ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cluster: ProxmoxCluster | null =
      await ProxmoxClusterService.findOneById({
        id: proxmoxClusterId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!cluster || !cluster.projectId) {
      throw new NotFoundException("Proxmox Cluster not found");
    }

    return {
      projectId: cluster.projectId,
      proxmoxClusterId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, proxmoxClusterId } =
      await this.resolveClusterForRequest(req);

    const summary: ProxmoxInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        proxmoxClusterId,
      });

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      // Convenience fields so the UI doesn't have to repeat COALESCE:
      nodeCount: summary.countsByKind["Node"] || 0,
      guestCount: summary.countsByKind["Guest"] || 0,
      storageCount: summary.countsByKind["Storage"] || 0,
      nodeOnlineCount: summary.nodeOnlineCount,
      guestRunningCount: summary.guestRunningCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
