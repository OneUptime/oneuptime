import StorageArrayResource from "../../Models/DatabaseModels/StorageArrayResource";
import StorageArray from "../../Models/DatabaseModels/StorageArray";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import StorageArrayResourceKind from "../../Types/StorageArray/StorageArrayResourceKind";
import StorageArrayResourceService, {
  StorageArrayInventorySummary,
  Service as StorageArrayResourceServiceType,
} from "../Services/StorageArrayResourceService";
import StorageArrayService from "../Services/StorageArrayService";
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
 * StorageArrayResourceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the Storage Array layout/overview pages use to fetch
 * sidebar badge counts (volumes, hosts, pods, hardware, drives,
 * controllers, network interfaces, directories, file systems,
 * buckets) in one round-trip:
 *
 *   POST /storage-array-resource/inventory-summary/:storageArrayId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through StorageArrayResourceService as root.
 * ------------------------------------------------------------------
 */
export default class StorageArrayResourceAPI extends BaseAPI<
  StorageArrayResource,
  StorageArrayResourceServiceType
> {
  public constructor() {
    super(StorageArrayResource, StorageArrayResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:storageArrayId`,
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
   * Array + auth resolution for the array-scoped sub-route.
   * Returns the (projectId, storageArrayId) tuple after enforcing the
   * standard ACL chain (the StorageArray model's read permissions,
   * Permission.ReadStorageArray et al.). Throws NotFound when the
   * array is missing or the caller lacks read access
   * (indistinguishable on purpose, so an unauthorised caller cannot
   * probe which array ids exist).
   */
  private async resolveStorageArrayForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    storageArrayId: ObjectID;
  }> {
    const storageArrayIdParam: string | undefined =
      req.params["storageArrayId"];
    if (!storageArrayIdParam) {
      throw new BadDataException("Storage Array ID is required");
    }

    let storageArrayId: ObjectID;
    try {
      storageArrayId = new ObjectID(storageArrayIdParam);
    } catch {
      throw new BadDataException("Invalid Storage Array ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const storageArray: StorageArray | null =
      await StorageArrayService.findOneById({
        id: storageArrayId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!storageArray || !storageArray.projectId) {
      throw new NotFoundException("Storage Array not found");
    }

    return {
      projectId: storageArray.projectId,
      storageArrayId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, storageArrayId } =
      await this.resolveStorageArrayForRequest(req);

    const summary: StorageArrayInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        storageArrayId,
      });

    const countOf: (kind: StorageArrayResourceKind) => number = (
      kind: StorageArrayResourceKind,
    ): number => {
      return summary.countsByKind[kind] || 0;
    };

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      /*
       * Convenience fields so the UI doesn't have to repeat COALESCE.
       * The kind strings are the PascalCase values ingest writes to
       * StorageArrayResource.kind (StorageArrayResourceKind).
       */
      volumeCount: countOf(StorageArrayResourceKind.Volume),
      hostCount: countOf(StorageArrayResourceKind.Host),
      podCount: countOf(StorageArrayResourceKind.Pod),
      hardwareCount: countOf(StorageArrayResourceKind.Hardware),
      driveCount: countOf(StorageArrayResourceKind.Drive),
      controllerCount: countOf(StorageArrayResourceKind.Controller),
      networkInterfaceCount: countOf(StorageArrayResourceKind.NetworkInterface),
      directoryCount: countOf(StorageArrayResourceKind.Directory),
      fileSystemCount: countOf(StorageArrayResourceKind.FileSystem),
      bucketCount: countOf(StorageArrayResourceKind.Bucket),
      // Hardware components, drives and controllers in a bad state.
      unhealthyHardwareCount: summary.unhealthyHardwareCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
