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
 * Floor for recurring rescans. A discovery sweep is heavy (up to
 * ScanTargetUtil.MAX_SCAN_HOSTS addresses, one probe at a time), so anything
 * tighter than this would keep the probe permanently busy. Lower stored
 * intervals are clamped, not rejected — the scan still recurs, just no faster
 * than this.
 */
const MINIMUM_RESCAN_INTERVAL_IN_MINUTES: number = 15;

/*
 * NetworkDeviceDiscoveryScan.statusMessage is a varchar(500). The probe's
 * summary now carries diagnostics (the ICMP-filtered fallback, the most common
 * SNMP error verbatim) and the clamp note below is appended on top of it, so
 * the combined string is no longer trivially short. An over-long value does
 * not truncate in Postgres — it throws, which would fail this whole write and
 * leave a finished scan sitting In Progress until the reaper picks it up. Cut
 * it here instead: a clipped explanation beats a lost result.
 */
const MAX_STATUS_MESSAGE_LENGTH: number = 500;

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
        /*
         * Claim via the hook-free single-statement write: the model has no
         * workflow, realtime, or audit decorators, and the service's only
         * update hook validates the scan target (`cidr`) — a column this
         * payload does not touch. So the full updateOneById pipeline
         * (permission pre-fetch SELECT + row re-fetch + save() transaction)
         * is pure overhead — three extra pool round-trips on a route the
         * probe polls every minute and whose response it synchronously
         * waits on. Keep the payload disjoint from `cidr`; the disjointness
         * is pinned by Common/Tests/Server/Services/
         * DiscoveryScanClaimHookFreeSafety.test.ts.
         *
         * Plain object, NOT a model instance: a `new
         * NetworkDeviceDiscoveryScan()` payload carries non-column base
         * props (isPermissionIf) that made every update here throw, so no
         * scan ever left Pending. Cast: the model's JSON column makes
         * DeepPartial recursion blow up.
         */
        await NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks({
          id: scan.id!,
          data: {
            status: "In Progress",
            startedAt: OneUptimeDate.getCurrentDate(),
            /*
             * Clear the "nobody has picked this scan up" note the worker
             * writes onto a long-unclaimed Pending scan
             * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts).
             * A probe claiming the scan is precisely the thing that note said
             * was not happening, so leaving it would have the row explain, for
             * the whole sweep, why it had not started.
             */
            statusMessage: null,
          } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
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
 * suggestions. Nothing is auto-created HERE — the probe synchronously waits
 * on this response, and importing can be minutes of work — but storing the
 * results clears the scan's autoImportProcessedAt marker, and the
 * ProcessAutoImportRules worker then imports whatever the project's
 * auto-import rules claim (Workers/Jobs/NetworkDeviceDiscovery/).
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
            // Needed to reject a result for a run that is no longer current.
            status: true,
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

      /*
       * The result belongs to a run that has already been superseded.
       *
       * A sweep can outlive its own claim: the stale-In-Progress reaper marks
       * a scan Failed after 2 hours and, if it recurs, the requeue pass then
       * flips it back to Pending for a fresh run
       * (Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts). A
       * probe that finally reports the ABANDONED run would land on that row
       * and stamp it Completed — retiring a run that was queued and never
       * happened, and replacing the new run's empty result set with results
       * from hours ago.
       *
       * Only Pending is refused. A late result for a scan the reaper marked
       * Failed is still the truth about that same run, and overwriting the
       * reaper's guess with the probe's actual findings is the right outcome —
       * which is why this is a status check and not a claim token.
       */
      if (scan.status === "Pending") {
        logger.warn(
          `Discarding a discovery scan result for ${scanId}: the scan is queued for a new run, so this result is from a run that was already abandoned.`,
        );

        return Response.sendJsonObjectResponse(req, res, {
          result: "discarded",
        });
      }

      const discoveredDevices: Array<JSONObject> =
        (req.body["discoveredDevices"] as Array<JSONObject>) || [];

      /*
       * Flag hosts that already have a NetworkDevice at that IP.
       *
       * Paged, because this used to be a single findBy at LIMIT_MAX (10,000)
       * with no paging and no sort. A project with more devices than that got
       * an arbitrary 10,000 of them, so every device past the cap was reported
       * to the dashboard as NOT registered, and the reviewer's "import"
       * re-created devices that already existed. A truncated answer here is
       * worse than a slow one: it produces duplicates in the inventory.
       */
      const existingHostnames: Set<string> = new Set<string>();

      for (let skip: number = 0; ; skip += LIMIT_MAX) {
        const existing: Array<NetworkDevice> =
          await NetworkDeviceService.findBy({
            query: {
              projectId: scan.projectId!,
            },
            select: {
              hostname: true,
            },
            /*
             * Sorted, so paging is stable. Without an explicit order Postgres
             * makes no promise across the two queries, and a row could be
             * returned twice — or skipped entirely — between pages.
             */
            sort: {
              createdAt: SortOrder.Ascending,
            },
            limit: LIMIT_MAX,
            skip: skip,
            props: {
              isRoot: true,
            },
          });

        for (const device of existing) {
          existingHostnames.add(device.hostname || "");
        }

        if (existing.length < LIMIT_MAX) {
          break;
        }
      }

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
        /*
         * New results, so the auto-import worker's bookkeeping starts over:
         * a NULL marker is its "the results now on this row have not been
         * processed" signal (Workers/Jobs/NetworkDeviceDiscovery/
         * ProcessAutoImportRules.ts). Cleared on Failed writes too — the
         * worker only processes Completed scans, but a late result can
         * overwrite a reaper-Failed row and uniformity here costs nothing.
         */
        autoImportProcessedAt: null,
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

      // Last stop before the write — every append above has happened by now.
      const statusMessage: string | undefined = completed["statusMessage"] as
        | string
        | undefined;
      if (statusMessage && statusMessage.length > MAX_STATUS_MESSAGE_LENGTH) {
        completed["statusMessage"] = statusMessage.substring(
          0,
          MAX_STATUS_MESSAGE_LENGTH,
        );
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
