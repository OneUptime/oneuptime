import ProbeAuthorization from "../../Middleware/ProbeAuthorization";
import { ProbeExpressRequest } from "../../Types/Request";
import ProbeRequest from "../../Utils/ProbeRequest";
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
import PositiveNumber from "Common/Types/PositiveNumber";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OneUptimeDate from "Common/Types/Date";
import MonitorService from "Common/Server/Services/MonitorService";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import ProbeReportIdentity, {
  PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE,
} from "Common/Server/Utils/Probe/ProbeReportIdentity";

const router: ExpressRouter = Express.getRouter();

/*
 * The check result a probe sends, as it sent it - a JSON object, or null
 * when there is none. Never deserialized here: results carry response
 * bodies and screenshots, and the queue worker decodes them once.
 */
function readProbeMonitorResponse(req: ExpressRequest): JSONObject | null {
  const probeMonitorResponse: unknown = req.body?.["probeMonitorResponse"];

  if (
    !probeMonitorResponse ||
    typeof probeMonitorResponse !== "object" ||
    Array.isArray(probeMonitorResponse)
  ) {
    return null;
  }

  return probeMonitorResponse as JSONObject;
}

/*
 * What a probe sends is its own (ProbeReportIdentity): a result that names
 * another probe is refused here, so the probe that sent it hears so, and a
 * result that names none is written down as the sender's. Answers the
 * request and returns null when the result is refused.
 */
function bindResultToSender(data: {
  req: ProbeExpressRequest;
  res: ExpressResponse;
  probeMonitorResponse: JSONObject;
  probeId: ObjectID;
}): JSONObject | null {
  if (
    !ProbeReportIdentity.isResultOf(data.probeMonitorResponse, data.probeId)
  ) {
    logger.warn(
      `Probe ${data.probeId.toString()} sent a result that names a different probe. Refused.`,
      getLogAttributesFromRequest(data.req as any),
    );

    Response.sendErrorResponse(
      data.req,
      data.res,
      new BadDataException(PROBE_REPORTS_ONLY_ITS_OWN_RESULTS_MESSAGE),
    );

    return null;
  }

  return ProbeReportIdentity.bindResultToSender(
    data.probeMonitorResponse,
    data.probeId,
  );
}

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
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const data: JSONObject = req.body;

      // The probe whose owners are told: the one that sent this report.
      const probeId: ObjectID | null = ProbeRequest.getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

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
          for (const email of emailsToNotify) {
            MailService.sendMail(
              {
                toEmail: email,
                templateType: EmailTemplateType.ProbeOffline,
                subject: "ACTION REQUIRED: Probe Offline Notification",
                isSubjectLiteral: true,
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

/*
 * One check result from a probe. It is recorded as the result of the probe
 * that sent it, and nobody else's: one that names another probe is refused
 * here, and the queue worker takes it only for a monitor this probe checks
 * (MonitorResource, given the probe as reportingProbeId).
 */
router.post(
  "/probe/response/ingest",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = ProbeRequest.getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const probeMonitorResponse: JSONObject | null =
        readProbeMonitorResponse(req);

      if (!probeMonitorResponse) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeMonitorResponse not found"),
        );
      }

      const ownResult: JSONObject | null = bindResultToSender({
        req,
        res,
        probeMonitorResponse,
        probeId,
      });

      if (!ownResult) {
        return;
      }

      // Return response immediately
      Response.sendJsonObjectResponse(req, res, {
        result: "processing",
      });

      // Add to queue for asynchronous processing
      await TelemetryQueueService.addProbeIngestJob({
        probeId: probeId,
        probeMonitorResponse: ownResult,
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
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const probeId: ObjectID | null = ProbeRequest.getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

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

      // The trap, and the probe that received it - matched to its devices only.
      await TelemetryQueueService.addSnmpTrapIngestJob({
        probeId: probeId,
        snmpTrap: req.body["snmpTrap"] as JSONObject,
      });

      return;
    } catch (err) {
      return next(err);
    }
  },
);

/*
 * One step's result of a monitor test. Recorded only on a test that was
 * handed to the probe that sent it (MonitorTestService keys the write on
 * the probe), and refused here when the result names another probe.
 */
router.post(
  "/probe/response/monitor-test-ingest/:testId",
  ProbeAuthorization.isAuthorizedServiceMiddleware,
  async (
    req: ProbeExpressRequest,
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

      const probeId: ObjectID | null = ProbeRequest.getProbeId(req);

      if (!probeId) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Probe not found"),
        );
      }

      const probeMonitorResponse: JSONObject | null =
        readProbeMonitorResponse(req);

      if (!probeMonitorResponse) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeMonitorResponse not found"),
        );
      }

      const ownResult: JSONObject | null = bindResultToSender({
        req,
        res,
        probeMonitorResponse,
        probeId,
      });

      if (!ownResult) {
        return;
      }

      const testId: ObjectID = new ObjectID(testIdInParams);

      // Return response immediately
      Response.sendEmptySuccessResponse(req, res);

      // Add to queue for asynchronous processing
      await TelemetryQueueService.addProbeIngestJob({
        probeId: probeId,
        probeMonitorResponse: ownResult,
        jobType: "monitor-test",
        testId: testId.toString(),
      });

      return;
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
    req: ProbeExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      /*
       * This endpoint returns the number of monitors pending for the specific probe
       * to be used by Keda for autoscaling probe replicas
       */

      // Get the probe ID from the authenticated request
      const probeId: ObjectID | null = ProbeRequest.getProbeId(req);

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

export default router;
