import IoTDevice from "../../Models/DatabaseModels/IoTDevice";
import IoTFleet from "../../Models/DatabaseModels/IoTFleet";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import IoTDeviceService, {
  IoTInventorySummary,
  Service as IoTDeviceServiceType,
} from "../Services/IoTDeviceService";
import IoTFleetService from "../Services/IoTFleetService";
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
 * IoTDeviceAPI
 *
 * Augments the auto-generated CRUD router with a single custom
 * endpoint the IoT layout/overview pages use to fetch sidebar
 * badge counts in one round-trip:
 *
 *   POST /iot-device/inventory-summary/:fleetId
 *
 * The standard CRUD endpoints (list / get) are still registered by
 * BaseAPI; the UI uses them via ModelAPI for list/detail reads.
 * Write endpoints reject (@TableAccessControl create/update/delete
 * = []); ingest writes go through IoTDeviceService as root.
 * ------------------------------------------------------------------
 */
export default class IoTDeviceAPI extends BaseAPI<
  IoTDevice,
  IoTDeviceServiceType
> {
  public constructor() {
    super(IoTDevice, IoTDeviceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:fleetId`,
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
   * Fleet + auth resolution for the fleet-scoped sub-route.
   * Returns the (projectId, iotFleetId) tuple after enforcing
   * the standard ACL chain. Throws NotFound when the fleet is
   * missing or the caller lacks read access (indistinguishable on
   * purpose).
   */
  private async resolveFleetForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    iotFleetId: ObjectID;
  }> {
    const fleetIdParam: string | undefined = req.params["fleetId"];
    if (!fleetIdParam) {
      throw new BadDataException("Fleet ID is required");
    }

    let iotFleetId: ObjectID;
    try {
      iotFleetId = new ObjectID(fleetIdParam);
    } catch {
      throw new BadDataException("Invalid Fleet ID");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const fleet: IoTFleet | null = await IoTFleetService.findOneById({
      id: iotFleetId,
      select: {
        _id: true,
        projectId: true,
      },
      props,
    });

    if (!fleet || !fleet.projectId) {
      throw new NotFoundException("IoT Fleet not found");
    }

    return {
      projectId: fleet.projectId,
      iotFleetId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, iotFleetId } = await this.resolveFleetForRequest(req);

    const summary: IoTInventorySummary = await this.service.getInventorySummary(
      {
        projectId,
        iotFleetId,
      },
    );

    const responseBody: JSONObject = {
      countsByKind: summary.countsByKind as unknown as JSONObject,
      // Convenience fields so the UI doesn't have to repeat COALESCE:
      deviceCount: summary.deviceCount,
      onlineDeviceCount: summary.onlineDeviceCount,
    };

    return Response.sendJsonObjectResponse(req, res, responseBody);
  }
}
