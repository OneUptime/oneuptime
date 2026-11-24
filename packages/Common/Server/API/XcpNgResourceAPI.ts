import XcpNgResource from "../../Models/DatabaseModels/XcpNgResource";
import XcpNgPool from "../../Models/DatabaseModels/XcpNgPool";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import XcpNgResourceService, {
  XcpNgInventorySummary,
  Service as XcpNgResourceServiceType,
} from "../Services/XcpNgResourceService";
import XcpNgPoolService from "../Services/XcpNgPoolService";
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
 * XcpNgResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the XCP-ng pool pages use to fetch their counts (hosts,
 * running hosts, VMs, running VMs, storage repositories, virtual disks
 * and the storage capacity in use) in one round-trip, recounted from
 * the stored inventory:
 *
 *   POST /xcp-ng-resource/inventory-summary/:poolId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through XcpNgResourceService as root.
 * ------------------------------------------------------------------
 */
export default class XcpNgResourceAPI extends BaseAPI<
  XcpNgResource,
  XcpNgResourceServiceType
> {
  public constructor() {
    super(XcpNgResource, XcpNgResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:poolId`,
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
   * Pool + auth resolution for the pool-scoped sub-route. Returns the
   * (projectId, xcpNgPoolId) tuple after enforcing the standard ACL
   * chain (the XcpNgPool model's read permissions,
   * Permission.ReadXcpNgPool et al., with labels and owners narrowing
   * them). Throws NotFound when the pool is missing or the caller lacks
   * read access (indistinguishable on purpose, so an unauthorised
   * caller cannot probe which pool ids exist).
   */
  private async resolvePoolForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    xcpNgPoolId: ObjectID;
  }> {
    const poolIdParam: string | undefined = req.params["poolId"];
    if (!poolIdParam) {
      throw new BadDataException("XCP-ng pool ID is required");
    }

    let xcpNgPoolId: ObjectID;
    try {
      xcpNgPoolId = new ObjectID(poolIdParam);
    } catch {
      throw new BadDataException("Invalid XCP-ng pool ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const pool: XcpNgPool | null = await XcpNgPoolService.findOneById({
      id: xcpNgPoolId,
      select: {
        _id: true,
        projectId: true,
      },
      props,
    });

    if (!pool || !pool.projectId) {
      throw new NotFoundException("XCP-ng pool not found");
    }

    return {
      projectId: pool.projectId,
      xcpNgPoolId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, xcpNgPoolId } = await this.resolvePoolForRequest(req);

    const summary: XcpNgInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        xcpNgPoolId,
      });

    /*
     * The counts the pool's pages show. Control domains are not counted
     * among the VMs, and only the storage repositories that hold VM disks
     * count towards the capacity (XcpNgResourceService.getInventorySummary).
     */
    const responseBody: JSONObject = {
      hostCount: summary.hostCount,
      runningHostCount: summary.runningHostCount,
      disabledHostCount: summary.disabledHostCount,
      vmCount: summary.vmCount,
      runningVmCount: summary.runningVmCount,
      storageRepositoryCount: summary.storageRepositoryCount,
      vdiCount: summary.vdiCount,
      storageCapacityBytes: summary.storageCapacityBytes,
      storageUsedBytes: summary.storageUsedBytes,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
