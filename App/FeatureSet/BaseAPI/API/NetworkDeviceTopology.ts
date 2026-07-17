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
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import NetworkTopologyUtil, {
  TopologyDeviceInput,
  TopologyInterfaceInput,
} from "Common/Utils/Monitor/NetworkTopologyUtil";
import NetworkTopology from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";

/*
 * Computes the LLDP+CDP-derived network topology graph for the requesting
 * user's project. Read-only and permission-scoped through the standard
 * props helper, so a user only sees devices they can read. Edges carry the
 * operational state of the interface at each end (up/down, utilization,
 * rates) resolved from NetworkInterface rows — fetched in one query and
 * matched in memory, never per-device.
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
                vendor: true,
                deviceModel: true,
                lldpNeighbors: true,
                cdpNeighbors: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          /*
           * All interface rows for the project in ONE query; the builder
           * matches them to edge endpoints in memory. Rows for devices
           * outside the graph are filtered below.
           */
          const interfaceRows: Array<NetworkInterface> =
            await NetworkInterfaceService.findBy({
              query: {
                projectId: props.tenantId,
              },
              select: {
                _id: true,
                networkDeviceId: true,
                interfaceIndex: true,
                name: true,
                isOperationallyUp: true,
                isAdministrativelyUp: true,
                utilizationPercent: true,
                inRateMbps: true,
                outRateMbps: true,
                errorsPerSecond: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: props,
            });

          const deviceIds: Set<string> = new Set<string>(
            devices.map((device: NetworkDevice) => {
              return device.id!.toString();
            }),
          );

          const interfaceInput: Array<TopologyInterfaceInput> = [];
          for (const row of interfaceRows) {
            const deviceId: string | undefined =
              row.networkDeviceId?.toString();
            if (
              !deviceId ||
              row.interfaceIndex === undefined ||
              !deviceIds.has(deviceId)
            ) {
              continue;
            }
            interfaceInput.push({
              networkDeviceId: deviceId,
              interfaceIndex: row.interfaceIndex,
              name: row.name,
              isOperationallyUp: row.isOperationallyUp,
              isAdministrativelyUp: row.isAdministrativelyUp,
              utilizationPercent: row.utilizationPercent,
              inRateMbps: row.inRateMbps,
              outRateMbps: row.outRateMbps,
              errorsPerSecond: row.errorsPerSecond,
            });
          }

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
                vendor: device.vendor,
                deviceModel: device.deviceModel,
                lldpNeighbors: device.lldpNeighbors,
                cdpNeighbors: device.cdpNeighbors,
              };
            },
          );

          const topology: NetworkTopology = NetworkTopologyUtil.buildTopology(
            topologyInput,
            OneUptimeDate.getCurrentDate(),
            interfaceInput,
          );

          // Surface truncation so the UI can warn that the map is partial.
          topology.isTruncated = devices.length >= LIMIT_PER_PROJECT;

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
