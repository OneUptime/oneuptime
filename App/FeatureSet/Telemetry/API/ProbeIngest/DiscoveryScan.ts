import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
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
 * Floor for recurring rescans. A subnet sweep is heavy (up to 4096 hosts,
 * one probe at a time), so anything tighter than this would keep the probe
 * permanently busy. Lower stored intervals are clamped, not rejected — the
 * scan still recurs, just no faster than this.
 */
const MINIMUM_RESCAN_INTERVAL_IN_MINUTES: number = 15;

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
        await NetworkDeviceDiscoveryScanService.updateOneById({
          id: scan.id!,
          /*
           * Plain object, NOT a model instance: a `new
           * NetworkDeviceDiscoveryScan()` payload carries non-column base
           * props (isPermissionIf) that made every update here throw, so no
           * scan ever left Pending. Cast: the model's JSON column makes
           * DeepPartial recursion blow up.
           */
          data: {
            status: "In Progress",
            startedAt: OneUptimeDate.getCurrentDate(),
          } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
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

      const probeId: ObjectID | undefined =
        (req as ProbeExpressRequest).probe?.id || undefined;

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      /*
       * Scope the lookup to the authenticated probe (same scoping as the
       * list endpoint above): the middleware only proves the caller is SOME
       * valid probe, so without this any probe that learned a foreign scanId
       * could overwrite another project's scan results.
       */
      const scan: NetworkDeviceDiscoveryScan | null =
        await NetworkDeviceDiscoveryScanService.findOneBy({
          query: {
            _id: new ObjectID(scanId),
            probeId: probeId,
          },
          select: {
            _id: true,
            projectId: true,
            // Needed to schedule the next run of a recurring scan below.
            isRecurring: true,
            rescanIntervalInMinutes: true,
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

      /*
       * The probe now reports ping-only hosts too, tagged `snmpReachable:
       * false`, so the array length is the count of ALIVE hosts. respondedHostCount
       * is documented (and rendered) as the count of hosts that answered
       * SNMP — i.e. the manageable ones — so it must exclude them. Hosts
       * from an older probe carry no `snmpReachable` key at all and were
       * SNMP responders by construction, hence `!== false`.
       */
      const snmpResponderCount: number = discoveredDevices.filter(
        (device: JSONObject) => {
          return device["snmpReachable"] !== false;
        },
      ).length;

      /*
       * Plain object, NOT a model instance: a `new
       * NetworkDeviceDiscoveryScan()` payload carries non-column base props
       * (isPermissionIf) that made the update below throw and lose the
       * probe's results.
       */
      const completed: JSONObject = {
        // Column is a JSON array of host suggestions, stored as-is.
        status: success ? "Completed" : "Failed",
        discoveredDevices: discoveredDevices,
        respondedHostCount: snmpResponderCount,
        completedAt: OneUptimeDate.getCurrentDate(),
      };
      if (req.body["statusMessage"]) {
        completed["statusMessage"] = req.body["statusMessage"] as string;
      }
      if (typeof req.body["scannedHostCount"] === "number") {
        completed["scannedHostCount"] = req.body["scannedHostCount"] as number;
      }

      /*
       * Recurring scan: schedule the next run whether this one completed or
       * failed — a transient sweep failure should not end the recurrence.
       * The worker job (Workers/Jobs/NetworkDeviceDiscovery/
       * RequeueRecurringScans.ts) resets the scan to Pending once nextScanAt
       * is due.
       */
      if (
        scan.isRecurring &&
        scan.rescanIntervalInMinutes &&
        scan.rescanIntervalInMinutes > 0
      ) {
        let intervalInMinutes: number = scan.rescanIntervalInMinutes;

        if (intervalInMinutes < MINIMUM_RESCAN_INTERVAL_IN_MINUTES) {
          intervalInMinutes = MINIMUM_RESCAN_INTERVAL_IN_MINUTES;
          logger.warn(
            `Discovery scan ${scanId} rescan interval of ${scan.rescanIntervalInMinutes} minute(s) is below the ${MINIMUM_RESCAN_INTERVAL_IN_MINUTES}-minute minimum. Clamping.`,
          );
          // Surface the clamp where the user will actually see it.
          const existingStatusMessage: string =
            (completed["statusMessage"] as string | undefined) || "";
          completed["statusMessage"] =
            (existingStatusMessage ? existingStatusMessage + " " : "") +
            `Rescan interval is below the ${MINIMUM_RESCAN_INTERVAL_IN_MINUTES}-minute minimum; rescanning every ${MINIMUM_RESCAN_INTERVAL_IN_MINUTES} minutes instead.`;
        }

        completed["nextScanAt"] =
          OneUptimeDate.getSomeMinutesAfter(intervalInMinutes);
      }

      await NetworkDeviceDiscoveryScanService.updateOneById({
        id: scan.id!,
        // Cast: the model's JSON column makes DeepPartial recursion blow up.
        data: completed as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
        props: {
          isRoot: true,
        },
      });

      logger.debug(
        `Discovery scan ${scanId} completed: ${discoveredDevices.length} alive host(s), ${snmpResponderCount} answered SNMP.`,
      );

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
