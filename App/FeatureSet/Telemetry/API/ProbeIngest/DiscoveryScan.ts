import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceDiscoveryScan, {
  DiscoveredNetworkDevice,
} from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import QueryDeepPartialEntity from "Common/Types/Database/PartialEntity";
import Express, {
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";

const router: ExpressRouter = Express.getRouter();

/*
 * Hands the requesting probe its pending subnet-discovery scans and marks
 * them In Progress so they aren't claimed twice. The probe executes each
 * scan locally (it's inside the target network) and reports back below.
 */
router.post(
  "/probe/discovery-scan/list",
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

      const scans: Array<NetworkDeviceDiscoveryScan> =
        await NetworkDeviceDiscoveryScanService.findBy({
          query: {
            probeId: probeId,
            status: "Pending",
          },
          select: {
            _id: true,
            projectId: true,
            cidr: true,
            snmpVersion: true,
            snmpCommunityString: true,
            snmpPort: true,
            // v3 credentials must be selected here or they never reach the probe.
            snmpV3SecurityLevel: true,
            snmpV3Username: true,
            snmpV3AuthProtocol: true,
            snmpV3AuthKey: true,
            snmpV3PrivProtocol: true,
            snmpV3PrivKey: true,
          },
          sort: {
            createdAt: SortOrder.Ascending,
          },
          // One subnet scan at a time per probe — sweeps are heavy.
          limit: 1,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      for (const scan of scans) {
        const inProgress: NetworkDeviceDiscoveryScan =
          new NetworkDeviceDiscoveryScan();
        inProgress.status = "In Progress";
        inProgress.startedAt = OneUptimeDate.getCurrentDate();

        await NetworkDeviceDiscoveryScanService.updateOneById({
          id: scan.id!,
          // Cast: the model's JSON column makes DeepPartial recursion blow up.
          data: inProgress as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
          props: {
            isRoot: true,
          },
        });
      }

      return Response.sendEntityArrayResponse(
        req,
        res,
        scans,
        scans.length,
        NetworkDeviceDiscoveryScan,
      );
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * Receives the results of a completed scan: the responding hosts and their
 * SNMP system identity. The dashboard turns these into importable device
 * suggestions; nothing is auto-created here.
 */
router.post(
  "/probe/discovery-scan/result",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const scanId: string | undefined = req.body["scanId"] as
        | string
        | undefined;

      if (!scanId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("scanId not found"),
        );
      }

      const scan: NetworkDeviceDiscoveryScan | null =
        await NetworkDeviceDiscoveryScanService.findOneById({
          id: new ObjectID(scanId),
          select: {
            _id: true,
            projectId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!scan) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Discovery scan not found"),
        );
      }

      const discoveredDevices: Array<JSONObject> =
        (req.body["discoveredDevices"] as Array<JSONObject>) || [];

      // Flag hosts that already have a NetworkDevice at that IP.
      const existing: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: scan.projectId!,
        },
        select: {
          hostname: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const existingHostnames: Set<string> = new Set(
        existing.map((device: NetworkDevice) => {
          return device.hostname || "";
        }),
      );

      for (const device of discoveredDevices) {
        device["isAlreadyRegistered"] = existingHostnames.has(
          String(device["ipAddress"] || ""),
        );
      }

      const success: boolean = req.body["success"] !== false;

      const completed: NetworkDeviceDiscoveryScan =
        new NetworkDeviceDiscoveryScan();
      completed.status = success ? "Completed" : "Failed";
      if (req.body["statusMessage"]) {
        completed.statusMessage = req.body["statusMessage"] as string;
      }
      // Column is a JSON array of host suggestions, stored as-is.
      completed.discoveredDevices =
        discoveredDevices as unknown as Array<DiscoveredNetworkDevice>;
      if (typeof req.body["scannedHostCount"] === "number") {
        completed.scannedHostCount = req.body["scannedHostCount"] as number;
      }
      completed.respondedHostCount = discoveredDevices.length;
      completed.completedAt = OneUptimeDate.getCurrentDate();

      await NetworkDeviceDiscoveryScanService.updateOneById({
        id: scan.id!,
        data: completed as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
        props: {
          isRoot: true,
        },
      });

      logger.debug(
        `Discovery scan ${scanId} completed: ${discoveredDevices.length} responding hosts.`,
      );

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
