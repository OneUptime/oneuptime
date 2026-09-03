import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import ProbeStatusReport from "Common/Types/Probe/ProbeStatusReport";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import MailService from "Common/Server/Services/MailService";
import ProbeService from "Common/Server/Services/ProbeService";
import ProjectService from "Common/Server/Services/ProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
} from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import GlobalConfig from "Common/Models/DatabaseModels/GlobalConfig";
import Probe from "Common/Models/DatabaseModels/Probe";
import User from "Common/Models/DatabaseModels/User";
import TelemetryQueueService from "../../Services/Queue/TelemetryQueueService";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import PositiveNumber from "Common/Types/PositiveNumber";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OneUptimeDate from "Common/Types/Date";
import MonitorService from "Common/Server/Services/MonitorService";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";

const router: ExpressRouter = Express.getRouter();

/*
 * Namespace for the 24h "we already told you this probe is offline" claim.
 *
 * Probe/Services/Register.ts calls reportIfOffline() once at EVERY probe
 * process start on any host where ICMP is blocked - which is most cloud VMs -
 * so on a self-hosted install every deploy, restart or replica scale-up used
 * to mail every project owner once per probe, with no dedupe of any kind.
 */
const PROBE_OFFLINE_THROTTLE_NAMESPACE: string = "probe-offline-notification";

router.post(
  "/alive",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      /*
       * The auth middleware has already verified this probe AND scheduled
       * the lastAlive stamp (it does so for every authenticated probe
       * request — a request that authenticates IS proof of liveness).
       * Awaiting a second updateLastAlive here would re-couple the
       * heartbeat's response time to Postgres write latency, which is the
       * exact coupling that let a slow database mark healthy probes
       * Disconnected while they were successfully running their checks.
       */
      return Response.sendEmptySuccessResponse(req, res);
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/status-report/offline",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body;

      const statusReport: ProbeStatusReport = JSONFunctions.deserialize(
        (data as JSONObject)["statusReport"] as any,
      ) as any;

      if (!statusReport) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("StatusReport not found"),
        );
      }

      // process status report here.

      let isWebsiteCheckOffline: boolean = false;
      let isPingCheckOffline: boolean = false;
      let isPortCheckOffline: boolean = false;

      if (statusReport["isWebsiteCheckOffline"]) {
        isWebsiteCheckOffline = statusReport[
          "isWebsiteCheckOffline"
        ] as boolean;
      }

      if (statusReport["isPingCheckOffline"]) {
        isPingCheckOffline = statusReport["isPingCheckOffline"] as boolean;
      }

      if (statusReport["isPortCheckOffline"]) {
        isPortCheckOffline = statusReport["isPortCheckOffline"] as boolean;
      }

      if (isWebsiteCheckOffline || isPingCheckOffline || isPortCheckOffline) {
        // email probe owner.
        const probeId: ObjectID = new ObjectID(data["probeId"] as string);

        const probe: Probe | null = await ProbeService.findOneBy({
          query: {
            _id: probeId.toString(),
          },
          select: {
            _id: true,
            projectId: true,
            name: true,
            description: true,
          },
          props: {
            isRoot: true,
          },
        });

        if (!probe) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid Probe ID or Probe Key"),
          );
        }

        /*
         * If global probe offline? If yes, then email master-admin.
         * If not a global probe then them email project owners.
         */

        const isGlobalProbe: boolean = !probe.projectId;
        const emailsToNotify: Email[] = [];
        // Map recipient email -> platform userId (when known)
        const emailToUserIdMap: Map<string, ObjectID> = new Map();

        let emailReason: string = "";

        if (isGlobalProbe) {
          // email master-admin

          const globalConfig: GlobalConfig | null =
            await GlobalConfigService.findOneBy({
              query: {},
              select: {
                _id: true,
                adminNotificationEmail: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!globalConfig) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Global config not found"),
            );
          }

          const adminNotificationEmail: Email | undefined =
            globalConfig.adminNotificationEmail;

          if (adminNotificationEmail) {
            // email adminNotificationEmail
            emailsToNotify.push(adminNotificationEmail);

            emailReason =
              "This email is sent to you becuse you have listed this email as a notification email in the Admin Dashobard. To change this email, please visit the Admin Dashboard > Settings > Email.";
          }
        } else {
          if (!probe.projectId) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid Project ID"),
            );
          }

          // email project owners.
          const owners: Array<User> = await ProjectService.getOwners(
            probe.projectId!,
          );

          for (const owner of owners) {
            if (owner.email) {
              emailsToNotify.push(owner.email);
              // Track mapping for attribution when sending email
              if (owner.id) {
                emailToUserIdMap.set(owner.email.toString(), owner.id);
              }
            }
          }

          emailReason =
            "This email is sent to you because you are listed as an owner of the project that this probe is associated with. To change this email, please visit the Project Dashboard > Settings > Teams and Members > Owners.";
        }

        let issue: string = "";

        if (isWebsiteCheckOffline) {
          issue += "This probe cannot reach out to monitor websites.";
        }

        if (isPingCheckOffline) {
          issue +=
            " This probe cannot reach out to ping other servers / hostnames or IP addresses. ";
        }

        if (!isWebsiteCheckOffline && isPingCheckOffline) {
          issue +=
            "Looks like ICMP is blocked. We will fallback to port monitoring (on default port 80) to monitor the uptime of resources.";
        }

        if (isPortCheckOffline) {
          issue += " This probe cannot reach out to monitor ports.";
        }

        /*
         * now send an email to all the emailsToNotify
         * Skip sending email if billing is enabled
         */
        if (!IsBillingEnabled) {
          /*
           * A project probe gets its own window, keyed on its probe id, so a
           * probe that restart-loops cannot silence a different probe's first
           * notice. A global probe has no projectId and every global probe
           * notifies the SAME single instance-wide adminNotificationEmail, so
           * they deliberately share one window keyed on the literal "global" -
           * per-probe windows there would still land one mail per replica in
           * one admin's inbox on every restart, which is the complaint.
           */
          let throttleKey: string = "global";

          if (!isGlobalProbe && probe.id) {
            throttleKey = probe.id.toString();
          }

          /*
           * Take the 24h window atomically and across every replica. SET NX
           * rather than GET-then-SET because several probe replicas starting
           * together is the normal case here, not the edge one: a
           * check-then-act would let all of them observe "not notified yet"
           * and all of them mail every owner, which is the exact duplicate
           * this exists to prevent.
           */
          let shouldSend: boolean = true;

          try {
            shouldSend = await GlobalCache.setStringIfNotExists(
              PROBE_OFFLINE_THROTTLE_NAMESPACE,
              throttleKey,
              ObjectID.generate().toString(),
              {
                expiresInSeconds: OneUptimeDate.getSecondsInDays(1),
              },
            );
          } catch (err) {
            /*
             * setStringIfNotExists throws when Redis is unreachable. shouldSend
             * is deliberately left TRUE - this FAILS OPEN. A cache outage then
             * degrades the throttle to exactly the behaviour that shipped
             * before it, which is the correct direction: failing closed would
             * silently swallow a genuine "your probe cannot reach the
             * internet" notice for as long as Redis is down, and that notice is
             * the only warning an operator gets that their monitoring is blind.
             */
            logger.warn(
              "Probe offline notification: the shared cache is unavailable, so the 24h throttle cannot be claimed. Sending the notification anyway.",
            );
            logger.warn(err);
          }

          if (shouldSend) {
            for (const email of emailsToNotify) {
              MailService.sendMail(
                {
                  toEmail: email,
                  templateType: EmailTemplateType.ProbeOffline,
                  subject: "ACTION REQUIRED: Probe Offline Notification",
                  vars: {
                    probeName: probe.name || "",
                    probeDescription: probe.description || "",
                    projectId: probe.projectId?.toString() || "",
                    probeId: probe.id?.toString() || "",
                    hostname: statusReport["hostname"]?.toString() || "",
                    emailReason: emailReason,
                    issue: issue,
                  },
                },
                {
                  projectId: probe.projectId,
                  // Try to attribute email to a known owner
                  userId: emailToUserIdMap.get(email.toString()) || undefined,
                },
              ).catch((err: Error) => {
                logger.error(err, getLogAttributesFromRequest(req as any));
              });
            }
          } else {
            logger.debug(
              "Probe offline notification already sent for this probe within the last 24 hours, skipping.",
              getLogAttributesFromRequest(req as any),
            );
          }
        } else {
          logger.debug(
            "Billing is enabled, skipping probe offline email notification",
            getLogAttributesFromRequest(req as any),
          );
        }
      }

      return Response.sendJsonObjectResponse(req, res, {
        message: "Status Report received",
      });
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/response/ingest",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.body["probeMonitorResponse"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeMonitorResponse not found"),
        );
      }

      // Return response immediately
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      // Add to queue for asynchronous processing
      await TelemetryQueueService.addProbeIngestJob({
        probeMonitorResponse: req.body,
        jobType: "probe-response",
      });

      return;
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/snmp-trap",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      if (!req.body["snmpTrap"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("snmpTrap not found in request body"),
        );
      }

      // Return response immediately — trap fan-out happens in the worker.
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      await TelemetryQueueService.addSnmpTrapIngestJob({
        snmpTrapRequestBody: req.body,
      });

      return;
    } catch (err) {
      return next(err);
    }
  },
);

router.post(
  "/probe/response/monitor-test-ingest/:testId",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const testIdInParams: string | undefined = req.params["testId"];

      if (!testIdInParams) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("TestId not found"),
        );
      }

      if (!req.body["probeMonitorResponse"]) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeMonitorResponse not found"),
        );
      }

      const testId: ObjectID = new ObjectID(testIdInParams);

      // Return response immediately
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await TelemetryQueueService.addProbeIngestJob({
        probeMonitorResponse: req.body,
        jobType: "monitor-test",
        testId: testId.toString(),
      });

      return;
    } catch (err) {
      return next(err);
    }
  },
);

// Queue stats endpoint
router.get(
  "/probe/queue/stats",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const stats: {
        waiting: number;
        active: number;
        completed: number;
        failed: number;
        delayed: number;
        total: number;
      } = await TelemetryQueueService.getQueueStats();
      return Response.sendJsonObjectResponse(req, res, stats);
    } catch (err) {
      return next(err);
    }
  },
);

// Queue size endpoint
router.get(
  "/probe/queue/size",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const size: number = await TelemetryQueueService.getQueueSize();
      return Response.sendJsonObjectResponse(req, res, { size });
    } catch (err) {
      return next(err);
    }
  },
);

// Queue size endpoint for Keda autoscaling (returns pending monitors count for specific probe)
router.post(
  "/metrics/queue-size",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      /*
       * This endpoint returns the number of monitors pending for the specific probe
       * to be used by Keda for autoscaling probe replicas
       */

      // Get the probe ID from the authenticated request
      const data: JSONObject = req.body;
      const probeId: ObjectID = new ObjectID(data["probeId"] as string);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe ID not found"),
        );
      }

      // Get pending monitor count for this specific probe
      const pendingCount: PositiveNumber = await MonitorProbeService.countBy({
        query: {
          probeId: probeId,
          isEnabled: true,
          nextPingAt: QueryHelper.lessThanEqualToOrNull(
            OneUptimeDate.getSomeMinutesAgo(2),
          ),
          monitor: {
            ...MonitorService.getEnabledMonitorQuery(),
          },
          project: {
            ...ProjectService.getActiveProjectStatusQuery(),
          },
        },
        props: {
          isRoot: true,
        },
      });

      return Response.sendJsonObjectResponse(req, res, {
        queueSize: pendingCount.toNumber(),
      });
    } catch (err) {
      return next(err);
    }
  },
);

// Queue failed jobs endpoint
router.get(
  "/probe/queue/failed",
  ClusterKeyAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      // Parse pagination parameters from query string
      const start: number = parseInt(req.query["start"] as string) || 0;
      const end: number = parseInt(req.query["end"] as string) || 100;

      const failedJobs: Array<{
        id: string;
        name: string;
        data: any;
        failedReason: string;
        stackTrace?: string;
        processedOn: Date | null;
        finishedOn: Date | null;
        attemptsMade: number;
      }> = await TelemetryQueueService.getFailedJobs({
        start,
        end,
      });

      return Response.sendJsonObjectResponse(req, res, {
        failedJobs,
        pagination: {
          start,
          end,
          count: failedJobs.length,
        },
      });
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
