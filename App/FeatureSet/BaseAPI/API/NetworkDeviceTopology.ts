import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
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
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkInterfaceService from "Common/Server/Services/NetworkInterfaceService";
import NetworkInterface from "Common/Models/DatabaseModels/NetworkInterface";
import NetworkEndpointService from "Common/Server/Services/NetworkEndpointService";
import NetworkEndpoint from "Common/Models/DatabaseModels/NetworkEndpoint";
import NetworkTopologyUtil, {
  TopologyBuildResult,
  TopologyDeviceInput,
  TopologyEndpointInput,
  TopologyInterfaceInput,
} from "Common/Utils/Monitor/NetworkTopologyUtil";

/*
 * Computes the LLDP+CDP-derived network topology graph for the requesting
 * user's project. Read-only and permission-scoped through the standard
 * props helper, so a user only sees devices they can read. Edges carry the
 * operational state of the interface at each end (up/down, utilization,
 * rates) resolved from NetworkInterface rows — fetched in one query and
 * matched in memory, never per-device. Discovered endpoints (ARP/FDB
 * attachments) ride along the same way: one batch query for the selected
 * devices, attached in the builder.
 */

// Hard cap on endpoint rows fed to the builder — beyond this the map is noise.
const MAX_TOPOLOGY_ENDPOINTS: number = 2000;

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

          const body: JSONObject = (req.body || {}) as JSONObject;
          const siteIdRaw: unknown = body["siteId"];
          if (
            siteIdRaw !== undefined &&
            siteIdRaw !== null &&
            typeof siteIdRaw !== "string"
          ) {
            throw new BadDataException("siteId must be a string");
          }
          const siteId: string | null =
            typeof siteIdRaw === "string" && siteIdRaw ? siteIdRaw : null;

          /*
           * Archived devices never belong on the map — they are hidden
           * from lists but keep collecting telemetry, so without this
           * filter they would linger as ghost nodes.
           */
          const deviceQuery: Query<NetworkDevice> = {
            projectId: props.tenantId,
            isArchived: false,
          };
          if (siteId) {
            /*
             * Exact-match site scoping only for now — scoping to the
             * site's whole descendant subtree is a follow-up.
             */
            deviceQuery.siteId = new ObjectID(siteId);
          }

          const devices: Array<NetworkDevice> =
            await NetworkDeviceService.findBy({
              query: deviceQuery,
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

          const deviceIds: Set<string> = new Set<string>(
            devices.map((device: NetworkDevice) => {
              return device.id!.toString();
            }),
          );

          /*
           * Interface rows for the devices in THIS graph in ONE query; the
           * builder matches them to edge endpoints in memory. Scoping to
           * deviceIds matters: a project-wide query would spend its row cap
           * on devices that are not on the map, so a site-scoped request
           * could come back with none of its own interfaces and lose every
           * edge's up/down state, port name and utilization.
           */
          let interfaceRows: Array<NetworkInterface> = [];
          if (deviceIds.size > 0) {
            interfaceRows = await NetworkInterfaceService.findBy({
              query: {
                projectId: props.tenantId,
                networkDeviceId: QueryHelper.any(Array.from(deviceIds)),
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
          }

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

          /*
           * Discovered endpoints (from ARP/FDB) attached to the selected
           * devices, in one batch query. Capped hard: beyond a couple
           * thousand leaf nodes the graph is unreadable anyway, and the
           * cap is surfaced to the UI below.
           */
          let endpointRows: Array<NetworkEndpoint> = [];
          if (deviceIds.size > 0) {
            endpointRows = await NetworkEndpointService.findBy({
              query: {
                projectId: props.tenantId,
                attachedNetworkDeviceId: QueryHelper.any(Array.from(deviceIds)),
              },
              select: {
                _id: true,
                macAddress: true,
                ipAddress: true,
                vendor: true,
                classification: true,
                attachedNetworkDeviceId: true,
                attachedInterfaceIndex: true,
                attachedPortName: true,
                lastSeenAt: true,
              },
              sort: {
                macAddress: SortOrder.Ascending,
              },
              limit: MAX_TOPOLOGY_ENDPOINTS,
              skip: 0,
              props: props,
            });
          }

          const endpointInput: Array<TopologyEndpointInput> = [];
          for (const endpoint of endpointRows) {
            if (!endpoint._id || !endpoint.macAddress) {
              continue;
            }
            endpointInput.push({
              id: endpoint._id.toString(),
              macAddress: endpoint.macAddress,
              ipAddress: endpoint.ipAddress,
              vendor: endpoint.vendor,
              classification: endpoint.classification,
              attachedNetworkDeviceId:
                endpoint.attachedNetworkDeviceId?.toString(),
              attachedInterfaceIndex: endpoint.attachedInterfaceIndex,
              attachedPortName: endpoint.attachedPortName,
              lastSeenAt: endpoint.lastSeenAt,
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

          const topology: TopologyBuildResult =
            NetworkTopologyUtil.buildTopology(
              topologyInput,
              OneUptimeDate.getCurrentDate(),
              interfaceInput,
              endpointInput,
            );

          /*
           * Surface truncation so the UI can warn that the map is partial.
           * isTruncated means "devices are missing from the graph" — that is
           * what the UI's "only part of it is shown, use search to narrow it
           * down" banner tells the user, and narrowing genuinely helps. The
           * interface cap is a different kind of loss (every node and edge is
           * present, only their state is missing) and search cannot fix it,
           * so it gets its own flag rather than lying in this one.
           */
          topology.isTruncated = devices.length >= LIMIT_PER_PROJECT;

          /*
           * The builder reports endpoints it dropped internally; OR in
           * the query-level cap so either source of loss is visible.
           */
          if (endpointRows.length >= MAX_TOPOLOGY_ENDPOINTS) {
            topology.endpointsTruncated = true;
          }

          /*
           * Not part of TopologyBuildResult — it describes the query, not
           * the graph — so it is attached to the response payload directly.
           */
          const responseBody: JSONObject = {
            ...(topology as unknown as JSONObject),
            interfacesTruncated: interfaceRows.length >= LIMIT_PER_PROJECT,
          };

          return Response.sendJsonObjectResponse(req, res, responseBody);
        } catch (err) {
          return next(err);
        }
      },
    );

    return router;
  }
}
