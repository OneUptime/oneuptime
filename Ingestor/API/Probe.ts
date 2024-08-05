import ProbeAuthorization from "../Middleware/ProbeAuthorization";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import ObjectID from "Common/Types/ObjectID";
import ProbeApiIngestResponse from "Common/Types/Probe/ProbeApiIngestResponse";
import ProbeMonitor from "Common/Types/Monitor/Monitor";
import ProbeStatusReport from "Common/Types/Probe/ProbeStatusReport";
import { DisableAutomaticIncidentCreation } from "CommonServer/EnvironmentConfig";
import GlobalConfigService from "CommonServer/Services/GlobalConfigService";
import MailService from "CommonServer/Services/MailService";
import ProbeService from "CommonServer/Services/ProbeService";
import ProjectService from "CommonServer/Services/ProjectService";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "CommonServer/Utils/Express";
import logger from "CommonServer/Utils/Logger";
import MonitorService from "CommonServer/Utils/Monitor/Monitor";
import Response from "CommonServer/Utils/Response";
import GlobalConfig from "Model/Models/GlobalConfig";
import Probe from "Model/Models/Probe";
import User from "Model/Models/User";

const router: ExpressRouter = Express.getRouter();

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

        // If global probe offline? If yes, then email master-admin.
        // If not a global probe then them email project owners.

        const isGlobalProbe: boolean = !probe.projectId;
        const emailsToNotify: Email[] = [];

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

        // now send an email to all the emailsToNotify
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
            },
          ).catch((err: Error) => {
            logger.error(err);
          });
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
      if (DisableAutomaticIncidentCreation) {
        return Response.sendJsonObjectResponse(req, res, {
          message: "Automatic incident creation is disabled.",
        });
      }

      const probeResponse: ProbeMonitor = JSONFunctions.deserialize(
        req.body["probeMonitor"],
      ) as any;

      if (!probeResponse) {
        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("ProbeMonitor not found"),
        );
      }

      // process probe response here.
      const probeApiIngestResponse: ProbeApiIngestResponse =
        await MonitorResourceService.monitorResource(probeResponse);

      return Response.sendJsonObjectResponse(req, res, {
        probeApiIngestResponse: probeApiIngestResponse,
      } as any);
    } catch (err) {
      return next(err);
    }
  },
);

export default router;
