import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkTopologyUtil, {
  TopologyDeviceInput,
} from "Common/Utils/Monitor/NetworkTopologyUtil";
import NetworkTopology from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Computes the LLDP-derived network topology graph for the requesting user's
 * project. Read-only and permission-scoped through the standard props
 * helper, so a user only sees devices they can read.
 */
export default class NetworkDeviceTopologyAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/network-device/topology",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }

          const devices: Array<NetworkDevice> =
            await NetworkDeviceService.findBy({
              query: {
                projectId: props.tenantId,
              },
              select: {
                _id: true,
                name: true,
                hostname: true,
                sysName: true,
                lastSeenAt: true,
                interfacesUp: true,
                interfacesDown: true,
                lldpNeighbors: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          const topologyInput: Array<TopologyDeviceInput> = devices.map(
            (device: NetworkDevice) => {
              return {
                id: device.id!.toString(),
                name: device.name || device.hostname || "Unnamed device",
                hostname: device.hostname,
                sysName: device.sysName,
                lastSeenAt: device.lastSeenAt,
                interfacesUp: device.interfacesUp,
                interfacesDown: device.interfacesDown,
                lldpNeighbors: device.lldpNeighbors,
              };
            },
          );

          const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
            topologyInput,
            OneUptimeDate.getCurrentDate(),
          );

          return Response.sendJsonObjectResponse(
            req,
            res,
            topology as unknown as JSONObject,
          );
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
