import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDeviceHydrationUtil from "Common/Server/Utils/Monitor/NetworkDeviceHydrationUtil";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * How many devices one fetch hands to a probe. The probe polls a batch
 * within its one-minute fetch cycle; claiming advances each device's
 * nextPollAt, so an unfinished batch is simply retried by a later cycle.
 */
const DEVICE_POLL_FETCH_LIMIT: number = 50;

/*
 * Hands the requesting probe the polling-enabled devices assigned to it
 * that are due for an SNMP walk, with each device's stored credentials
 * hydrated into a concrete, probe-executable SNMP config. Claiming is
 * atomic (FOR UPDATE SKIP LOCKED) and advances nextPollAt by the device's
 * own polling interval.
 *
 * This is how devices get polled — monitors play no part in it. Network
 * Device monitors are evaluated server-side when the walk results come
 * back (see NetworkDeviceWalkUtil).
 */
router.post(
  "/probe/network-device/list",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | undefined =
        (req as ProbeExpressRequest).probe?.id || undefined;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const claimedDeviceIds: Array<ObjectID> =
        await NetworkDeviceService.claimDevicesForPolling({
          probeId: probeId,
          limit: DEVICE_POLL_FETCH_LIMIT,
        });

      if (claimedDeviceIds.length === 0) {
        return Response.sendJsonObjectResponse(req, res, { devices: [] });
      }

      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          _id: QueryHelper.any(
            claimedDeviceIds.map((deviceId: ObjectID) => {
              return deviceId.toString();
            }),
          ),
        },
        select: {
          ...NetworkDeviceHydrationUtil.snmpConfigSelect,
          projectId: true,
          walkInterfaces: true,
          collectEndpoints: true,
          snmpOids: true,
        },
        limit: DEVICE_POLL_FETCH_LIMIT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const devicePollConfigs: Array<JSONObject> = [];

      for (const device of devices) {
        if (!device.id || !device.hostname) {
          continue;
        }

        const monitorInterfaces: boolean = device.walkInterfaces !== false;
        let oids: Array<{
          oid: string;
          name?: string | undefined;
          description?: string | undefined;
        }> = device.snmpOids || [];

        /*
         * A device with interface walking off and no health OIDs still
         * needs SOMETHING to poll or the probe would report "No OIDs
         * configured" instead of reachability. sysDescr is the universal
         * fallback — every SNMP agent answers it.
         */
        if (!monitorInterfaces && oids.length === 0) {
          oids = [{ oid: "1.3.6.1.2.1.1.1.0", name: "sysDescr" }];
        }

        devicePollConfigs.push({
          networkDeviceId: device.id.toString(),
          projectId: device.projectId?.toString(),
          collectEndpoints: device.collectEndpoints === true,
          snmpMonitor: NetworkDeviceHydrationUtil.buildSnmpMonitorConfig({
            device: device,
            oids: oids,
            monitorInterfaces: monitorInterfaces,
          }) as unknown as JSONObject,
        });
      }

      logger.debug(
        `Probe ${probeId.toString()} claimed ${devicePollConfigs.length} network device(s) for polling.`,
      );

      return Response.sendJsonObjectResponse(req, res, {
        devices: devicePollConfigs,
      });
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Receives one device's walk result and queues it for processing —
 * inventory sync, device metrics, and evaluation of the monitors alerting
 * on the device. The device⇄probe pairing is re-verified inside the
 * processor (NetworkDeviceWalkUtil), scoped by the authenticated probe id
 * stamped here.
 */
router.post(
  "/probe/network-device/response/ingest",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | undefined =
        (req as ProbeExpressRequest).probe?.id || undefined;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const networkDeviceId: string | undefined = req.body[
        "networkDeviceId"
      ] as string | undefined;

      if (!networkDeviceId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("networkDeviceId not found"),
        );
      }

      const snmpResponse: JSONObject | undefined = req.body["snmpResponse"] as
        | JSONObject
        | undefined;

      if (!snmpResponse) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("snmpResponse not found"),
        );
      }

      /*
       * probeId comes from the authenticated request — never from the
       * body — so a probe can only ever report walks as itself.
       */
      await TelemetryQueueService.addNetworkDeviceWalkJob({
        walkRequestBody: {
          probeId: probeId.toString(),
          networkDeviceId: networkDeviceId,
          snmpResponse: snmpResponse,
          monitoredAt: (req.body["monitoredAt"] as string) || undefined,
        },
      });

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
