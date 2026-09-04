import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import NetworkDeviceDiscoveryScanService from "Common/Server/Services/NetworkDeviceDiscoveryScanService";
import {
  MINIMUM_RESCAN_INTERVAL_IN_MINUTES,
  clampRescanIntervalInMinutes,
} from "Common/Utils/NetworkDiscovery/RescanIntervalUtil";
import ScanModeUtil from "Common/Utils/NetworkDiscovery/ScanModeUtil";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
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
            /*
             * Not used to run the sweep — the probe logs it, so a probe's own
             * log names the scan the way the operator named it rather than by
             * address range alone.
             */
            name: true,
            cidr: true,
            /*
             * The scan's method. Without it the probe cannot tell an ICMP-only
             * scan from an SNMP one and would SNMP-probe both (issue #3445).
             */
            isSnmpEnabled: true,
            /*
             * The ordered credential list the sweep tries, first match wins.
             * The flattened columns below it are still selected and still
             * mirror this list's first entry: an older probe reads only those,
             * and every scan written out of band has only those.
             */
            snmpConfigs: true,
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
          /*
           * Claim ONLY IF everything just handed to the probe is still true.
           *
           * The SELECT above and this UPDATE are two statements, and the
           * UPDATE addresses the row by id alone. A scan's settings became
           * editable in OneUptime issue #3444, so a save landing in between
           * would hand this probe one configuration and stamp the row with
           * another — and, if the probe was reassigned, wedge the scan: the
           * old probe's result is rejected on the probeId scope below, the new
           * probe can never claim a row that is already In Progress, and it
           * sits there until the two-hour reaper calls it a dead probe.
           *
           * Every expected column becomes `IS NOT DISTINCT FROM` in the
           * UPDATE's WHERE, so a mismatch is simply zero rows affected: the
           * scan stays Pending, this sweep's eventual result is discarded by
           * the Pending guard in the result endpoint, and the next poll picks
           * the scan up with its new settings. `name` is deliberately absent —
           * a rename changes nothing about the sweep and must not cost one.
           *
           * The write reports no count, so the probe is still handed the scan
           * and still sweeps it once for nothing when the guard bites. That is
           * the cheap half of the trade: a wasted sweep in a race that needs a
           * save to land inside a single round trip, against a scan wedged
           * In Progress for two hours until the reaper gives up on it.
           */
          expectedData: {
            status: "Pending",
            probeId: probeId,
            cidr: scan.cidr ?? null,
            /*
             * The METHOD, not only the credentials. Turning Check SNMP off
             * between the SELECT above and this UPDATE changes what the sweep
             * asks of every address — it is a sweep column for exactly that
             * reason (SWEEP_COLUMNS in NetworkDeviceDiscoveryScanService) — so
             * a claim that ignored it would hand this probe an SNMP sweep of a
             * scan the operator had just turned into a ping sweep, and stamp
             * the row In Progress against it.
             */
            isSnmpEnabled: scan.isSnmpEnabled ?? null,
            /*
             * Compared as JSON. `IS NOT DISTINCT FROM` on a jsonb column is a
             * value comparison, and the value handed to the probe is the value
             * read out of this same column moments ago, so it round-trips
             * exactly — a re-save that did not change the credentials does not
             * fail the guard.
             */
            snmpConfigs: scan.snmpConfigs ?? null,
            snmpVersion: scan.snmpVersion ?? null,
            snmpCommunityString: scan.snmpCommunityString ?? null,
            snmpPort: scan.snmpPort ?? null,
            snmpV3SecurityLevel: scan.snmpV3SecurityLevel ?? null,
            snmpV3Username: scan.snmpV3Username ?? null,
            snmpV3AuthProtocol: scan.snmpV3AuthProtocol ?? null,
            snmpV3AuthKey: scan.snmpV3AuthKey ?? null,
            snmpV3PrivProtocol: scan.snmpV3PrivProtocol ?? null,
            snmpV3PrivKey: scan.snmpV3PrivKey ?? null,
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
            /*
             * Needed to count what "responded" means for THIS scan — see
             * respondedHostCount below. An ICMP-only sweep reports every host
             * it found as snmpReachable:false, so counting SNMP responders
             * would store a hard zero for a scan that worked perfectly.
             */
            isSnmpEnabled: true,
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

      /*
       * A PARTIAL result: what the sweep has found so far, sent while it is
       * still running (OneUptime issues #3598 and #3599).
       *
       * A sweep used to be atomic — its hosts existed only in the probe's
       * memory until the whole range was covered — so a 15,360-address scan
       * read "0 of 15360" for as long as it ran, a sweep abandoned at the
       * probe's deadline lost every host it had confirmed, and the
       * auto-import worker (which looks for results to import) had nothing to
       * look at until the very end.
       *
       * Refused for a scan that is not In Progress. A partial can only be
       * about the run this row is currently executing: for a Completed or
       * Failed row it is a straggler from a run that has already had its say,
       * and storing it would replace the final result — reverse-DNS names and
       * all — with the snapshot that preceded it.
       */
      const isPartial: boolean = req.body["isPartial"] === true;

      if (isPartial && scan.status !== "In Progress") {
        logger.debug(
          `Discarding a partial discovery scan result for ${scanId}: the scan is "${scan.status}", so its run has already reported a final result.`,
        );

        return Response.sendJsonObjectResponse(req, res, {
          result: "discarded",
        });
      }

      const success: boolean = req.body["success"] !== false;

      /*
       * Whether this report SAYS anything about hosts.
       *
       * A run that finished always does, even when the answer is "nothing" —
       * that is a finding, and the empty list is how it is recorded (a
       * payload with no key at all, from an older probe, means the same
       * thing there).
       *
       * A run that FAILED is the exception, and the reason this distinction
       * exists. Its report used to carry `discoveredDevices: []`, which the
       * server stores; that was harmless while a run's only report was its
       * last one, but a sweep now uploads what it has found every 30 seconds,
       * so a run abandoned at the probe's deadline would have its failure
       * report erase the hundreds of hosts it had already sent — exactly the
       * loss incremental results exist to prevent (OneUptime issue #3598).
       *
       * So a failure report states hosts only when it actually carries a
       * list. The current probe omits the key entirely and the stored hosts
       * are left alone; an older probe still sends `[]` and still gets the
       * behaviour it has always had.
       */
      const hasHostReport: boolean =
        success || Array.isArray(req.body["discoveredDevices"]);

      const discoveredDevices: Array<JSONObject> =
        (req.body["discoveredDevices"] as Array<JSONObject>) || [];

      /*
       * Which of the addresses THIS SCAN found already have a device — asked
       * of the database directly, not worked out from a copy of every
       * hostname in the project.
       *
       * The walk this replaces paged `ORDER BY createdAt`, and a bulk
       * discovery import stamps every device it creates with the same
       * `createdAt`. On a large fleet every row shares one value, so
       * `LIMIT/OFFSET` over that sort key returned an arbitrary slice per
       * call: pages overlapped and skipped, a skipped hostname read as NOT
       * registered, and the reviewer's "import" re-created a device that
       * already existed — the exact duplicate the paging was added to
       * prevent. It also cost eight sequential full-table scans inside the
       * request the probe is synchronously waiting on.
       */
      const existingHostnames: Set<string> =
        await NetworkDeviceService.getRegisteredHostnames({
          projectId: scan.projectId!,
          hostnames: discoveredDevices.map((device: JSONObject): string => {
            return String(device["ipAddress"] || "");
          }),
          props: {
            isRoot: true,
          },
        });

      for (const device of discoveredDevices) {
        device["isAlreadyRegistered"] = existingHostnames.has(
          String(device["ipAddress"] || ""),
        );
      }

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
       * What "responded" means depends on what the scan asked (issue #3445).
       *
       * On an SNMP scan it is the SNMP responders: the ping-only hosts are
       * reported separately, and collapsing them together would hide the very
       * distinction the "+N alive without SNMP" line exists to show.
       *
       * On an ICMP-only scan every host is snmpReachable:false by
       * construction, so that same count is always zero — and the Discovery
       * Scans list would render a perfect sweep of a busy subnet as
       * "0 of 254 hosts", the exact false negative issue #3287 was about. The
       * hosts DID respond; ping was the question. So count them.
       */
      const respondedHostCount: number = ScanModeUtil.isSnmpEnabled(scan)
        ? snmpResponderCount
        : discoveredDevices.length;

      if (isPartial) {
        /*
         * Results ONLY. The run state — status, completedAt, the recurrence
         * schedule — belongs to the run and is written once, by the final
         * result. A partial that touched any of it would end the run early.
         *
         * autoImportProcessedAt is cleared for the same reason the final write
         * clears it: a NULL marker is the auto-import worker's "the results now
         * on this row have not been processed" signal
         * (Workers/Jobs/NetworkDeviceDiscovery/ProcessAutoImportRules.ts). That
         * is what makes each batch of partial results importable within a
         * minute of arriving instead of after the whole sweep (issue #3599).
         */
        const partial: JSONObject = {
          autoImportProcessedAt: null,
        };

        if (hasHostReport) {
          partial["discoveredDevices"] = discoveredDevices;
          partial["respondedHostCount"] = respondedHostCount;
        }

        if (req.body["statusMessage"]) {
          partial["statusMessage"] = String(
            req.body["statusMessage"],
          ).substring(0, MAX_STATUS_MESSAGE_LENGTH);
        }

        /*
         * Addresses swept so far, not the size of the range — the probe's
         * progress message says which of the two the number is.
         */
        if (typeof req.body["scannedHostCount"] === "number") {
          partial["scannedHostCount"] = req.body["scannedHostCount"] as number;
        }

        /*
         * The hook-free single-statement write, for the same reasons the claim
         * endpoint above uses it: this lands every 30 seconds for the whole
         * length of a sweep, the probe waits on the response, and the full
         * updateOneById pipeline (permission pre-fetch SELECT + row re-fetch +
         * save() transaction) is three extra pool round trips for a payload no
         * hook looks at. The service's only update hooks react to the sweep
         * columns (cidr, probe, credentials) and the schedule columns, and this
         * payload touches neither; the disjointness is pinned by
         * Common/Tests/Server/Services/DiscoveryScanClaimHookFreeSafety.test.ts.
         *
         * Guarded on status so a final result landing between the read above
         * and this write wins: the partial simply affects zero rows.
         */
        await NetworkDeviceDiscoveryScanService.updateColumnsByIdWithoutHooks({
          id: scan.id!,
          // Cast: the model's JSON column makes DeepPartial recursion blow up.
          data: partial as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
          expectedData: {
            status: "In Progress",
          } as unknown as QueryDeepPartialEntity<NetworkDeviceDiscoveryScan>,
        });

        logger.debug(
          `Discovery scan ${scanId} progress: ${discoveredDevices.length} alive host(s) so far` +
            (ScanModeUtil.isSnmpEnabled(scan)
              ? `, ${snmpResponderCount} answered SNMP.`
              : " (ICMP-only scan)."),
        );

        return Response.sendJsonObjectResponse(req, res, {
          result: "partial",
        });
      }

      /*
       * Plain object, NOT a model instance: a `new
       * NetworkDeviceDiscoveryScan()` payload carries non-column base props
       * (isPermissionIf) that made the update below throw and lose the
       * probe's results.
       */
      const completed: JSONObject = {
        status: success ? "Completed" : "Failed",
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

      /*
       * The column is a JSON array of host suggestions, stored as-is — and
       * only when this report actually carries one. See hasHostReport: a
       * failure report that mentions no hosts must leave the ones the run had
       * already uploaded exactly where they are.
       */
      if (hasHostReport) {
        completed["discoveredDevices"] = discoveredDevices;
        completed["respondedHostCount"] = respondedHostCount;
      }

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
      const clampedIntervalInMinutes: number | null =
        clampRescanIntervalInMinutes(scan.rescanIntervalInMinutes);

      if (scan.isRecurring && clampedIntervalInMinutes !== null) {
        const intervalInMinutes: number = clampedIntervalInMinutes;

        if (intervalInMinutes !== scan.rescanIntervalInMinutes) {
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

        /*
         * Measured from the completion this write is recording, not from
         * "now", so the column holds exactly what
         * RescanIntervalUtil.getNextScanAt would derive from the finished row.
         * The service re-derives it whenever the schedule is edited, and two
         * clocks a millisecond apart would make every such edit rewrite a
         * value that had not actually changed.
         */
        completed["nextScanAt"] = OneUptimeDate.addRemoveMinutes(
          completed["completedAt"] as Date,
          intervalInMinutes,
        );
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
        `Discovery scan ${scanId} completed: ${discoveredDevices.length} alive host(s)` +
          (ScanModeUtil.isSnmpEnabled(scan)
            ? `, ${snmpResponderCount} answered SNMP.`
            : " (ICMP-only scan)."),
      );

      return Response.sendJsonObjectResponse(req, res, { result: "ok" });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
