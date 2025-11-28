import UserMiddleware from "../Middleware/UserAuthorization";
import AcmeChallengeService from "../Services/AcmeChallengeService";
import IncidentPublicNoteService from "../Services/IncidentPublicNoteService";
import IncidentService from "../Services/IncidentService";
import IncidentStateService from "../Services/IncidentStateService";
import IncidentStateTimelineService from "../Services/IncidentStateTimelineService";
import MonitorGroupResourceService from "../Services/MonitorGroupResourceService";
import MonitorGroupService from "../Services/MonitorGroupService";
import MonitorStatusService from "../Services/MonitorStatusService";
import ScheduledMaintenancePublicNoteService from "../Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../Services/ScheduledMaintenanceStateTimelineService";
import StatusPageAnnouncementService from "../Services/StatusPageAnnouncementService";
import StatusPageDomainService from "../Services/StatusPageDomainService";
import StatusPageFooterLinkService from "../Services/StatusPageFooterLinkService";
import StatusPageGroupService from "../Services/StatusPageGroupService";
import StatusPageHeaderLinkService from "../Services/StatusPageHeaderLinkService";
import StatusPageHistoryChartBarColorRuleService from "../Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageResourceService from "../Services/StatusPageResourceService";
import StatusPageService, {
  Service as StatusPageServiceType,
} from "../Services/StatusPageService";
import StatusPageSsoService from "../Services/StatusPageSsoService";
import StatusPageSubscriberService from "../Services/StatusPageSubscriberService";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import logger from "../Utils/Logger";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ArrayUtil from "../../Utils/Array";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import PositiveNumber from "../../Types/PositiveNumber";
import HashedString from "../../Types/HashedString";
import AcmeChallenge from "../../Models/DatabaseModels/AcmeChallenge";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentPublicNote from "../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../Models/DatabaseModels/IncidentState";
import IncidentStateTimeline from "../../Models/DatabaseModels/IncidentStateTimeline";
import MonitorGroupResource from "../../Models/DatabaseModels/MonitorGroupResource";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import ScheduledMaintenance from "../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import ScheduledMaintenanceState from "../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../Models/DatabaseModels/StatusPageAnnouncement";
import File from "../../Models/DatabaseModels/File";
import StatusPageDomain from "../../Models/DatabaseModels/StatusPageDomain";
import StatusPageFooterLink from "../../Models/DatabaseModels/StatusPageFooterLink";
import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageHeaderLink from "../../Models/DatabaseModels/StatusPageHeaderLink";
import StatusPageHistoryChartBarColorRule from "../../Models/DatabaseModels/StatusPageHistoryChartBarColorRule";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageSSO from "../../Models/DatabaseModels/StatusPageSso";
import StatusPageSubscriber from "../../Models/DatabaseModels/StatusPageSubscriber";
import StatusPageEventType from "../../Types/StatusPage/StatusPageEventType";
import StatusPageResourceUptimeUtil from "../../Utils/StatusPage/ResourceUptime";
import UptimePrecision from "../../Types/StatusPage/UptimePrecision";
import { Green } from "../../Types/BrandColors";
import UptimeUtil from "../../Utils/Uptime/UptimeUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import SMS from "../../Types/SMS/SMS";
import SmsService from "../Services/SmsService";
import ProjectCallSMSConfigService from "../Services/ProjectCallSMSConfigService";
import MailService from "../Services/MailService";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import DatabaseConfig from "../DatabaseConfig";
import CookieUtil from "../Utils/Cookie";
import { EncryptionSecret } from "../EnvironmentConfig";
import { StatusPageApiRoute } from "../../ServiceRoute";
import ProjectSmtpConfigService from "../Services/ProjectSmtpConfigService";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import { MASTER_PASSWORD_INVALID_MESSAGE } from "../../Types/StatusPage/MasterPassword";

type ResolveStatusPageIdOrThrowFunction = (
  statusPageIdOrDomain: string,
) => Promise<ObjectID>;

const resolveStatusPageIdOrThrow: ResolveStatusPageIdOrThrowFunction = async (
  statusPageIdOrDomain: string,
): Promise<ObjectID> => {
  if (!statusPageIdOrDomain) {
    throw new NotFoundException("Status Page not found");
  }

  if (statusPageIdOrDomain.includes(".")) {
    const statusPageDomain: StatusPageDomain | null =
      await StatusPageDomainService.findOneBy({
        query: {
          fullDomain: statusPageIdOrDomain,
          domain: {
            isVerified: true,
          } as any,
        },
        select: {
          statusPageId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!statusPageDomain || !statusPageDomain.statusPageId) {
      throw new NotFoundException("Status Page not found");
    }

    return statusPageDomain.statusPageId;
  }

  try {
    return new ObjectID(statusPageIdOrDomain);
  } catch (err) {
    logger.error(
      `Error converting statusPageIdOrDomain to ObjectID: ${statusPageIdOrDomain}`,
    );
    logger.error(err);
    throw new NotFoundException("Status Page not found");
  }
};

export default class StatusPageAPI extends BaseAPI<
  StatusPage,
  StatusPageServiceType
> {
  public constructor() {
    super(StatusPage, StatusPageService);

    // get title, description of the page.  This is used for SEO.
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/seo/:statusPageIdOrDomain`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const statusPageIdOrDomain: string = req.params[
          "statusPageIdOrDomain"
        ] as string;

        let statusPageId: ObjectID | null = null;

        if (statusPageIdOrDomain && statusPageIdOrDomain.includes(".")) {
          // then this is a domain and not the status page id. We need to get the status page id from the domain.

          const statusPageDomain: StatusPageDomain | null =
            await StatusPageDomainService.findOneBy({
              query: {
                fullDomain: statusPageIdOrDomain,
                domain: {
                  isVerified: true,
                } as any,
              },
              select: {
                statusPageId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPageDomain || !statusPageDomain.statusPageId) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException("Status Page not found"),
            );
          }

          statusPageId = statusPageDomain.statusPageId;
        } else {
          // then this is a status page id. We need to get the status page id from the id.
          try {
            statusPageId = new ObjectID(statusPageIdOrDomain);
          } catch (err) {
            logger.error(
              `Error converting statusPageIdOrDomain to ObjectID: ${statusPageIdOrDomain}`,
            );
            logger.error(err);
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException("Status Page not found"),
            );
          }
        }

        const statusPage: StatusPage | null = await StatusPageService.findOneBy(
          {
            query: {
              _id: statusPageId,
            },
            select: {
              pageTitle: true,
              pageDescription: true,
              name: true,
            },
            props: {
              isRoot: true,
            },
          },
        );

        if (!statusPage) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("Status Page not found"),
          );
        }

        return Response.sendJsonObjectResponse(req, res, {
          title: statusPage.pageTitle || statusPage.name,
          description: statusPage.pageDescription,
          _id: statusPage._id?.toString(),
        });
      },
    );

    // favicon api.
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/favicon/:statusPageIdOrDomain`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const statusPageId: ObjectID = await resolveStatusPageIdOrThrow(
            req.params["statusPageIdOrDomain"] as string,
          );

          const statusPage: StatusPage | null =
            await StatusPageService.findOneBy({
              query: {
                _id: statusPageId,
              },
              select: {
                faviconFile: {
                  file: true,
                  _id: true,
                  fileType: true,
                  name: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPage || !statusPage.faviconFile) {
            logger.debug("Favicon file not found. Returning default favicon.");

            return Response.sendFileByPath(
              req,
              res,
              `/usr/src/Common/UI/Images/favicon/status-green.png`,
            );
          }

          logger.debug(
            `Favicon file found. Sending file: ${statusPage.faviconFile.name}`,
          );

          return Response.sendFileResponse(req, res, statusPage.faviconFile);
        } catch (error) {
          if (error instanceof NotFoundException) {
            return Response.sendErrorResponse(req, res, error);
          }

          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("Status Page not found"),
          );
        }
      },
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/logo/:statusPageIdOrDomain`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const statusPageId: ObjectID = await resolveStatusPageIdOrThrow(
            req.params["statusPageIdOrDomain"] as string,
          );

          const statusPage: StatusPage | null =
            await StatusPageService.findOneBy({
              query: {
                _id: statusPageId,
              },
              select: {
                logoFile: {
                  file: true,
                  _id: true,
                  fileType: true,
                  name: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPage || !statusPage.logoFile) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException("Status Page logo not found"),
            );
          }

          return Response.sendFileResponse(req, res, statusPage.logoFile);
        } catch (error) {
          if (error instanceof NotFoundException) {
            return Response.sendErrorResponse(req, res, error);
          }

          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("Status Page logo not found"),
          );
        }
      },
    );

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/cover-image/:statusPageIdOrDomain`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const statusPageId: ObjectID = await resolveStatusPageIdOrThrow(
            req.params["statusPageIdOrDomain"] as string,
          );

          const statusPage: StatusPage | null =
            await StatusPageService.findOneBy({
              query: {
                _id: statusPageId,
              },
              select: {
                coverImageFile: {
                  file: true,
                  _id: true,
                  fileType: true,
                  name: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPage || !statusPage.coverImageFile) {
            return Response.sendErrorResponse(
              req,
              res,
              new NotFoundException("Status Page cover image not found"),
            );
          }

          return Response.sendFileResponse(req, res, statusPage.coverImageFile);
        } catch (error) {
          if (error instanceof NotFoundException) {
            return Response.sendErrorResponse(req, res, error);
          }

          logger.error(error);
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("Status Page cover image not found"),
          );
        }
      },
    );

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/incident-public-note/attachment/:statusPageId/:incidentId/:noteId/:fileId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getIncidentPublicNoteAttachment(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/scheduled-maintenance-public-note/attachment/:statusPageId/:scheduledMaintenanceId/:noteId/:fileId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getScheduledMaintenancePublicNoteAttachment(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/status-page-announcement/attachment/:statusPageId/:announcementId/:fileId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getStatusPageAnnouncementAttachment(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    // embedded overall status badge api
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/badge/:statusPageId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        try {
          const statusPageId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const token: string = req.query["token"] as string;

          if (!token) {
            return res.status(400).send("Token is required");
          }

          // Fetch status page with security token
          const statusPage: StatusPage | null =
            await StatusPageService.findOneBy({
              query: {
                _id: statusPageId,
                enableEmbeddedOverallStatus: true,
                embeddedOverallStatusToken: token,
              },
              select: {
                _id: true,
                projectId: true,
                downtimeMonitorStatuses: {
                  _id: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPage) {
            return res.status(404).send("Status badge not found or disabled");
          }

          // Get status page resources and current statuses
          const statusPageResources: Array<StatusPageResource> =
            await StatusPageResourceService.findBy({
              query: {
                statusPageId: statusPageId,
              },
              select: {
                _id: true,
                monitor: {
                  _id: true,
                  currentMonitorStatusId: true,
                },
                monitorGroupId: true,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          // Get monitor statuses
          const monitorStatuses: Array<MonitorStatus> =
            await MonitorStatusService.findBy({
              query: {
                projectId: statusPage.projectId!,
              },
              select: {
                _id: true,
                name: true,
                color: true,
                priority: true,
                isOperationalState: true,
              },
              sort: {
                priority: SortOrder.Ascending,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });

          // Get monitor group current statuses
          const monitorGroupCurrentStatuses: Dictionary<ObjectID> =
            await StatusPageService.getMonitorGroupCurrentStatuses({
              statusPageResources,
              monitorStatuses,
            });

          // Calculate overall status
          const overallStatus: MonitorStatus | null =
            StatusPageService.getOverallMonitorStatus({
              statusPageResources,
              monitorStatuses,
              monitorGroupCurrentStatuses,
            });

          // Generate SVG badge
          const statusName: string = overallStatus?.name || "Unknown";
          const statusColor: string =
            overallStatus?.color?.toString() || "#808080";

          const svg: string = `<svg xmlns="http://www.w3.org/2000/svg" width="150" height="20">
  <linearGradient id="b" x2="0" y2="100%">
    <stop offset="0" stop-color="#bbb" stop-opacity=".1"/>
    <stop offset="1" stop-opacity=".1"/>
  </linearGradient>
  <mask id="a">
    <rect width="150" height="20" rx="3" fill="#fff"/>
  </mask>
  <g mask="url(#a)">
    <path fill="#555" d="M0 0h50v20H0z"/>
    <path fill="${statusColor}" d="M50 0h100v20H50z"/>
    <path fill="url(#b)" d="M0 0h150v20H0z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">
    <text x="25" y="15" fill="#010101" fill-opacity=".3">status</text>
    <text x="25" y="14">status</text>
    <text x="100" y="15" fill="#010101" fill-opacity=".3">${statusName}</text>
    <text x="100" y="14">${statusName}</text>
  </g>
</svg>`;

          res.setHeader("Content-Type", "image/svg+xml");
          res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
          return res.send(svg);
        } catch (err) {
          logger.error(err);
          return res.status(500).send("Internal Server Error");
        }
      },
    );

    // confirm subscription api
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/confirm-subscription/:statusPageSubscriberId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const token: string = req.query["verification-token"] as string;

        const statusPageSubscriberId: ObjectID = new ObjectID(
          req.params["statusPageSubscriberId"] as string,
        );

        const subscriber: StatusPageSubscriber | null =
          await StatusPageSubscriberService.findOneBy({
            query: {
              _id: statusPageSubscriberId,
              subscriptionConfirmationToken: token,
            },
            select: {
              isSubscriptionConfirmed: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!subscriber) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException(
              "Subscriber not found or confirmation token is invalid",
            ),
          );
        }

        // check if subscription confirmed already.

        if (subscriber.isSubscriptionConfirmed) {
          return Response.sendEmptySuccessResponse(req, res);
        }

        await StatusPageSubscriberService.updateOneById({
          id: statusPageSubscriberId,
          data: {
            isSubscriptionConfirmed: true,
          },
          props: {
            isRoot: true,
          },
        });

        await StatusPageSubscriberService.sendYouHaveSubscribedEmail({
          subscriberId: statusPageSubscriberId,
        });

        return Response.sendEmptySuccessResponse(req, res);
      },
    );

    // CNAME verification api
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/cname-verification/:token`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const host: string | undefined = req.get("host");

        if (!host) {
          throw new BadDataException("Host not found");
        }

        const token: string = req.params["token"] as string;

        logger.debug(`CNAME Verification: Host:${host}  - Token:${token}`);

        const domain: StatusPageDomain | null =
          await StatusPageDomainService.findOneBy({
            query: {
              cnameVerificationToken: token,
              fullDomain: host,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!domain) {
          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid token."),
          );
        }

        return Response.sendEmptySuccessResponse(req, res);
      },
    );

    // ACME Challenge Validation.
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/.well-known/acme-challenge/:token`,
      async (req: ExpressRequest, res: ExpressResponse) => {
        const challenge: AcmeChallenge | null =
          await AcmeChallengeService.findOneBy({
            query: {
              token: req.params["token"] as string,
            },
            select: {
              challenge: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!challenge) {
          return Response.sendErrorResponse(
            req,
            res,
            new NotFoundException("Challenge not found"),
          );
        }

        return Response.sendTextResponse(
          req,
          res,
          challenge.challenge as string,
        );
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/test-email-report`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const email: Email = new Email(req.body["email"] as string);
          const statusPageId: ObjectID = new ObjectID(
            req.body["statusPageId"].toString() as string,
          );

          await StatusPageService.sendEmailReport({
            email: email,
            statusPageId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/domain`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.body["domain"]) {
            throw new BadDataException("domain is required in request body");
          }

          const domain: string = req.body["domain"] as string;

          const statusPageDomain: StatusPageDomain | null =
            await StatusPageDomainService.findOneBy({
              query: {
                fullDomain: domain,
                domain: {
                  isVerified: true,
                } as any,
              },
              select: {
                statusPageId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPageDomain) {
            throw new BadDataException("No status page found with this domain");
          }

          const objectId: ObjectID = statusPageDomain.statusPageId!;

          return Response.sendJsonObjectResponse(req, res, {
            statusPageId: objectId.toString(),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/master-page/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const select: Select<StatusPage> = {
            _id: true,
            slug: true,
            coverImageFileId: true,
            logoFileId: true,
            pageTitle: true,
            pageDescription: true,
            copyrightText: true,
            customCSS: true,
            customJavaScript: true,
            hidePoweredByOneUptimeBranding: true,
            headerHTML: true,
            footerHTML: true,
            enableEmailSubscribers: true,
            enableSlackSubscribers: true,
            enableMicrosoftTeamsSubscribers: true,
            enableSmsSubscribers: true,
            isPublicStatusPage: true,
            enableMasterPassword: true,
            allowSubscribersToChooseResources: true,
            allowSubscribersToChooseEventTypes: true,
            requireSsoForLogin: true,
            coverImageFile: {
              file: true,
              _id: true,
              fileType: true,
              name: true,
            },
            faviconFile: {
              file: true,
              _id: true,
              fileType: true,
              name: true,
            },
            logoFile: {
              file: true,
              _id: true,
              fileType: true,
              name: true,
            },
            showIncidentsOnStatusPage: true,
            showAnnouncementsOnStatusPage: true,
            showScheduledMaintenanceEventsOnStatusPage: true,
            showSubscriberPageOnStatusPage: true,
          };

          const hasEnabledSSO: PositiveNumber =
            await StatusPageSsoService.countBy({
              query: {
                isEnabled: true,
                statusPageId: objectId,
              },
              props: {
                isRoot: true,
              },
            });

          const item: StatusPage | null = await this.service.findOneById({
            id: objectId,
            select,
            props: {
              isRoot: true,
            },
          });

          if (!item) {
            throw new BadDataException("Status Page not found");
          }

          const footerLinks: Array<StatusPageFooterLink> =
            await StatusPageFooterLinkService.findBy({
              query: {
                statusPageId: objectId,
              },
              select: {
                _id: true,
                link: true,
                title: true,
                order: true,
              },
              sort: {
                order: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          const headerLinks: Array<StatusPageHeaderLink> =
            await StatusPageHeaderLinkService.findBy({
              query: {
                statusPageId: objectId,
              },
              select: {
                _id: true,
                link: true,
                title: true,
                order: true,
              },
              sort: {
                order: SortOrder.Ascending,
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          const response: JSONObject = {
            statusPage: BaseModel.toJSON(item, StatusPage),
            footerLinks: BaseModel.toJSONArray(
              footerLinks,
              StatusPageFooterLink,
            ),
            headerLinks: BaseModel.toJSONArray(
              headerLinks,
              StatusPageHeaderLink,
            ),
            hasEnabledSSO: hasEnabledSSO.toNumber(),
          };

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/master-password/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          if (!req.params["statusPageId"]) {
            throw new BadDataException("Status Page ID not found");
          }

          const statusPageId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const password: string | undefined =
            req.body && (req.body["password"] as string);

          if (!password) {
            throw new BadDataException("Master password is required.");
          }

          const statusPage: StatusPage | null =
            await StatusPageService.findOneById({
              id: statusPageId,
              select: {
                _id: true,
                projectId: true,
                enableMasterPassword: true,
                masterPassword: true,
                isPublicStatusPage: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!statusPage) {
            throw new NotFoundException("Status Page not found");
          }

          if (statusPage.isPublicStatusPage) {
            throw new BadDataException(
              "This status page is already visible to everyone.",
            );
          }

          if (!statusPage.enableMasterPassword || !statusPage.masterPassword) {
            throw new BadDataException(
              "Master password has not been configured for this status page.",
            );
          }

          const hashedInput: string = await HashedString.hashValue(
            password,
            EncryptionSecret,
          );

          if (hashedInput !== statusPage.masterPassword.toString()) {
            throw new BadDataException(MASTER_PASSWORD_INVALID_MESSAGE);
          }

          CookieUtil.setStatusPageMasterPasswordCookie({
            expressResponse: res,
            statusPageId,
          });

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/sso/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const sso: Array<StatusPageSSO> = await StatusPageSsoService.findBy({
            query: {
              statusPageId: objectId,
              isEnabled: true,
            },
            select: {
              signOnURL: true,
              name: true,
              description: true,
              _id: true,
            },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: {
              isRoot: true,
            },
          });

          return Response.sendEntityArrayResponse(
            req,
            res,
            sso,
            new PositiveNumber(sso.length),
            StatusPageSSO,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    // Get all status page resources for subscriber to subscribe to.
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/resources/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const statusPageId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          await this.checkHasReadAccess({
            statusPageId: statusPageId,
            req: req,
          });

          const resources: Array<StatusPageResource> =
            await StatusPageResourceService.findBy({
              query: {
                statusPageId: statusPageId,
              },
              select: {
                _id: true,
                displayName: true,
                order: true,
                statusPageGroup: {
                  _id: true,
                  name: true,
                  order: true,
                },
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              props: {
                isRoot: true,
              },
            });

          return Response.sendEntityArrayResponse(
            req,
            res,
            resources,
            new PositiveNumber(resources.length),
            StatusPageResource,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/uptime/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          // This reosurce ID can be of a status page resource OR a status page group.
          const statusPageResourceId: ObjectID = new ObjectID(
            req.params["statusPageResourceId"] as string,
          );

          const statusPageId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          if (!statusPageId || !statusPageResourceId) {
            throw new BadDataException("Status Page or Resource not found");
          }

          await this.checkHasReadAccess({
            statusPageId: statusPageId,
            req: req,
          });

          /*
           * get start and end date from request body.
           * if no end date is provided then it will be current date.
           * if no start date is provided then it will be 14 days ago from end date.
           */

          let startDate: Date = OneUptimeDate.getSomeDaysAgo(14);
          let endDate: Date = OneUptimeDate.getCurrentDate();

          if (req.body["startDate"]) {
            startDate = OneUptimeDate.fromString(
              req.body["startDate"] as string,
            );
          }

          if (req.body["endDate"]) {
            endDate = OneUptimeDate.fromString(req.body["endDate"] as string);
          }

          if (OneUptimeDate.isAfter(startDate, endDate)) {
            throw new BadDataException("Start date cannot be after end date");
          }

          if (
            OneUptimeDate.getDaysBetweenTwoDatesInclusive(startDate, endDate) >
            90
          ) {
            throw new BadDataException(
              "You can only get uptime for 90 days. Please select a date range within 90 days.",
            );
          }

          const {
            monitorStatuses,
            monitorGroupCurrentStatuses,
            statusPageResources,
            statusPage,
            monitorStatusTimelines,
            statusPageGroups,
            monitorsInGroup,
          } = await this.getStatusPageResourcesAndTimelines({
            statusPageId: statusPageId,
            startDateForMonitorTimeline: startDate,
            endDateForMonitorTimeline: endDate,
          });

          const downtimeMonitorStatuses: Array<MonitorStatus> =
            statusPage.downtimeMonitorStatuses || [];

          type ResourceUptime = {
            statusPageResourceId: ObjectID;
            uptimePercent: number | null;
            statusPageResourceName: string;
            currentStatus: MonitorStatus | null;
          };

          type StatusPageGroupUptime = {
            statusPageGroupId: ObjectID | null;
            uptimePercent: number | null;
            statusPageResourceUptimes: Array<ResourceUptime>;
            statusPageGroupName: string | null;
            currentStatus: MonitorStatus | null;
          };

          type GetUptimeByStatusPageGroup = (data: {
            statusPageGroup: StatusPageGroup | null;
          }) => StatusPageGroupUptime;

          const getUptimeByStatusPageGroup: GetUptimeByStatusPageGroup =
            (data: {
              statusPageGroup: StatusPageGroup | null;
            }): StatusPageGroupUptime => {
              const groupUptime: StatusPageGroupUptime = {
                statusPageGroupId:
                  data && data.statusPageGroup
                    ? data.statusPageGroup?.id
                    : null,
                uptimePercent: null,
                statusPageResourceUptimes: [],
                statusPageGroupName: data.statusPageGroup?.name || null,
                currentStatus: null,
              };

              const group: StatusPageGroup | null = data.statusPageGroup;

              for (const resource of statusPageResources) {
                if (
                  (resource.statusPageGroupId &&
                    resource.statusPageGroupId.toString() &&
                    group &&
                    group._id?.toString() &&
                    group._id?.toString() ===
                      resource.statusPageGroupId.toString()) ||
                  (!resource.statusPageGroupId && !group)
                ) {
                  // if its not a monitor or a monitor group, then continue. This should ideally not happen.

                  if (!resource.monitor && !resource.monitorGroupId) {
                    continue;
                  }

                  const resourceUptime: ResourceUptime = {
                    statusPageResourceId: resource.id!,
                    uptimePercent: null,
                    statusPageResourceName:
                      resource.displayName || resource.monitor?.name || "",
                    currentStatus: null,
                  };

                  // if its a monitor

                  const precision: UptimePrecision =
                    resource.uptimePercentPrecision ||
                    UptimePrecision.ONE_DECIMAL;

                  if (resource.monitor) {
                    let currentStatus: MonitorStatus | undefined =
                      monitorStatuses.find((status: MonitorStatus) => {
                        return (
                          status._id?.toString() ===
                          resource.monitor?.currentMonitorStatusId?.toString()
                        );
                      });

                    if (!currentStatus) {
                      currentStatus = new MonitorStatus();
                      currentStatus.name = "Operational";
                      currentStatus.color = Green;

                      resourceUptime.currentStatus = currentStatus;
                    } else {
                      resourceUptime.currentStatus = currentStatus;
                    }

                    if (!resource.showCurrentStatus) {
                      resourceUptime.currentStatus = null;
                    }

                    const resourceStatusTimelines: Array<MonitorStatusTimeline> =
                      StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource(
                        {
                          statusPageResource: resource,
                          monitorStatusTimelines: monitorStatusTimelines,
                          monitorsInGroup: monitorsInGroup,
                        },
                      );

                    if (resource.showUptimePercent) {
                      const uptimePercent: number =
                        UptimeUtil.calculateUptimePercentage(
                          resourceStatusTimelines,
                          precision,
                          downtimeMonitorStatuses,
                        );

                      resourceUptime.uptimePercent = uptimePercent;
                    }

                    groupUptime.statusPageResourceUptimes.push(resourceUptime);
                  }

                  // if its a monitor group, then...

                  if (resource.monitorGroupId) {
                    let currentStatus: MonitorStatus | undefined =
                      monitorStatuses.find((status: MonitorStatus) => {
                        return (
                          status._id?.toString() ===
                          monitorGroupCurrentStatuses[
                            resource.monitorGroupId?.toString() || ""
                          ]?.toString()
                        );
                      });

                    if (!currentStatus) {
                      currentStatus = new MonitorStatus();
                      currentStatus.name = "Operational";
                      currentStatus.color = Green;

                      resourceUptime.currentStatus = currentStatus;
                    } else {
                      resourceUptime.currentStatus = currentStatus;
                    }

                    if (!resource.showCurrentStatus) {
                      resourceUptime.currentStatus = null;
                    }

                    if (resource.showUptimePercent) {
                      const resourceStatusTimelines: Array<MonitorStatusTimeline> =
                        StatusPageResourceUptimeUtil.getMonitorStatusTimelineForResource(
                          {
                            statusPageResource: resource,
                            monitorStatusTimelines: monitorStatusTimelines,
                            monitorsInGroup: monitorsInGroup,
                          },
                        );

                      const uptimePercent: number =
                        UptimeUtil.calculateUptimePercentage(
                          resourceStatusTimelines,
                          precision,
                          downtimeMonitorStatuses,
                        );

                      resourceUptime.uptimePercent = uptimePercent;
                    }

                    groupUptime.statusPageResourceUptimes.push(resourceUptime);
                  }
                }
              }

              if (group?.showUptimePercent) {
                // calculate uptime percent for the group.
                const avgUptimePercent: number =
                  UptimeUtil.calculateAvgUptimePercentage({
                    uptimePercentages: groupUptime.statusPageResourceUptimes
                      .filter((resource: ResourceUptime) => {
                        return resource.uptimePercent !== null;
                      })
                      .map((resource: ResourceUptime) => {
                        return resource.uptimePercent || 0;
                      }),
                    precision:
                      group.uptimePercentPrecision ||
                      UptimePrecision.ONE_DECIMAL,
                  });

                groupUptime.uptimePercent = avgUptimePercent;
              }

              if (group?.showCurrentStatus) {
                const currentStatuses: Array<MonitorStatus> =
                  groupUptime.statusPageResourceUptimes
                    .filter((resourceUptime: ResourceUptime) => {
                      return resourceUptime.currentStatus !== null;
                    })
                    .map((resourceUptime: ResourceUptime) => {
                      return resourceUptime.currentStatus!;
                    });

                const worstStatus: MonitorStatus | null =
                  StatusPageResourceUptimeUtil.getWorstMonitorStatus({
                    monitorStatuses: currentStatuses,
                  });

                groupUptime.currentStatus = worstStatus;
              }

              return groupUptime;
            };

          const groupUptimes: Array<StatusPageGroupUptime> = [];

          for (const group of statusPageGroups) {
            groupUptimes.push(
              getUptimeByStatusPageGroup({ statusPageGroup: group }),
            );
          }

          return Response.sendJsonObjectResponse(req, res, {
            statusPageResourceUptimes: [
              ...getUptimeByStatusPageGroup({ statusPageGroup: null })
                .statusPageResourceUptimes,
            ],
            groupUptimes: groupUptimes,
            startDate: startDate,
            endDate: endDate,
          });
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/overview/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const statusPageId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          await this.checkHasReadAccess({
            statusPageId: statusPageId,
            req: req,
          });

          const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
          const endDate: Date = OneUptimeDate.getCurrentDate();

          const {
            monitorStatuses,
            monitorGroupCurrentStatuses,
            statusPageResources,
            statusPage,
            monitorsOnStatusPage,
            monitorStatusTimelines,
            statusPageGroups,
            monitorsInGroup,
          } = await this.getStatusPageResourcesAndTimelines({
            statusPageId: statusPageId,
            startDateForMonitorTimeline: startDate,
            endDateForMonitorTimeline: endDate,
          });

          // check if status page has active incident.
          let activeIncidents: Array<Incident> = [];
          if (monitorsOnStatusPage.length > 0) {
            let select: Select<Incident> = {
              createdAt: true,
              declaredAt: true,
              title: true,
              description: true,
              _id: true,
              incidentSeverity: {
                name: true,
                color: true,
              },
              currentIncidentState: {
                _id: true,
                name: true,
                color: true,
                order: true,
              },
              monitors: {
                _id: true,
              },
            };

            if (statusPage.showIncidentLabelsOnStatusPage) {
              select = {
                ...select,
                labels: {
                  name: true,
                  color: true,
                },
              };
            }

            const unresolvedIncidentStates: Array<IncidentState> =
              await IncidentStateService.getUnresolvedIncidentStates(
                statusPage.projectId!,
                {
                  isRoot: true,
                },
              );

            const unresolvedIncidentStateIds: Array<ObjectID> =
              unresolvedIncidentStates.map((state: IncidentState) => {
                return state.id!;
              });

            if (statusPage.showIncidentsOnStatusPage) {
              activeIncidents = await IncidentService.findBy({
                query: {
                  monitors: monitorsOnStatusPage as any,
                  currentIncidentStateId: QueryHelper.any(
                    unresolvedIncidentStateIds,
                  ),
                  isVisibleOnStatusPage: true,
                  projectId: statusPage.projectId!,
                },
                select: select,
                sort: {
                  declaredAt: SortOrder.Descending,
                  createdAt: SortOrder.Descending,
                },

                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                  isRoot: true,
                },
              });
            }
          }

          const incidentsOnStatusPage: Array<ObjectID> = activeIncidents.map(
            (incident: Incident) => {
              return incident.id!;
            },
          );

          let incidentPublicNotes: Array<IncidentPublicNote> = [];

          if (incidentsOnStatusPage.length > 0) {
            incidentPublicNotes = await IncidentPublicNoteService.findBy({
              query: {
                incidentId: QueryHelper.any(incidentsOnStatusPage),
                projectId: statusPage.projectId!,
              },
              select: {
                note: true,
                incidentId: true,
                postedAt: true,
                attachments: {
                  _id: true,
                  name: true,
                },
              },
              sort: {
                postedAt: SortOrder.Descending, // new note first
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });
          }

          let incidentStateTimelines: Array<IncidentStateTimeline> = [];

          if (incidentsOnStatusPage.length > 0) {
            incidentStateTimelines = await IncidentStateTimelineService.findBy({
              query: {
                incidentId: QueryHelper.any(incidentsOnStatusPage),
                projectId: statusPage.projectId!,
              },
              select: {
                _id: true,
                createdAt: true,
                startsAt: true,
                incidentId: true,
                incidentState: {
                  _id: true,
                  name: true,
                  color: true,
                  isCreatedState: true,
                  isResolvedState: true,
                  isAcknowledgedState: true,
                },
              },

              sort: {
                startsAt: SortOrder.Descending, // newer state changes first
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });
          }

          // check if status page has active announcement.

          const today: Date = OneUptimeDate.getCurrentDate();

          let activeAnnouncements: Array<StatusPageAnnouncement> = [];

          if (statusPage.showAnnouncementsOnStatusPage) {
            activeAnnouncements = await StatusPageAnnouncementService.findBy({
              query: {
                statusPages: statusPageId as any,
                showAnnouncementAt: QueryHelper.lessThan(today),
                endAnnouncementAt: QueryHelper.greaterThanOrNull(today),
                projectId: statusPage.projectId!,
              },
              select: {
                createdAt: true,
                title: true,
                description: true,
                _id: true,
                showAnnouncementAt: true,
                endAnnouncementAt: true,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });
          }

          // check if status page has active scheduled events.

          let scheduledEventsSelect: Select<ScheduledMaintenance> = {
            createdAt: true,
            title: true,
            description: true,
            _id: true,
            endsAt: true,
            startsAt: true,
            currentScheduledMaintenanceState: {
              name: true,
              color: true,
              isScheduledState: true,
              isResolvedState: true,
              isOngoingState: true,
            },
            monitors: {
              _id: true,
            },
          };

          if (statusPage.showScheduledEventLabelsOnStatusPage) {
            scheduledEventsSelect = {
              ...scheduledEventsSelect,
              labels: {
                name: true,
                color: true,
              },
            };
          }

          let scheduledMaintenanceEvents: Array<ScheduledMaintenance> = [];

          if (statusPage.showScheduledMaintenanceEventsOnStatusPage) {
            scheduledMaintenanceEvents =
              await ScheduledMaintenanceService.findBy({
                query: {
                  currentScheduledMaintenanceState: {
                    isOngoingState: true,
                  } as any,
                  statusPages: statusPageId as any,
                  projectId: statusPage.projectId!,
                  isVisibleOnStatusPage: true,
                },
                select: scheduledEventsSelect,
                sort: {
                  startsAt: SortOrder.Ascending,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                  isRoot: true,
                },
              });
          }

          let futureScheduledMaintenanceEvents: Array<ScheduledMaintenance> =
            [];

          if (statusPage.showScheduledMaintenanceEventsOnStatusPage) {
            futureScheduledMaintenanceEvents =
              await ScheduledMaintenanceService.findBy({
                query: {
                  currentScheduledMaintenanceState: {
                    isScheduledState: true,
                  } as any,
                  statusPages: statusPageId as any,
                  projectId: statusPage.projectId!,
                  isVisibleOnStatusPage: true,
                },
                select: scheduledEventsSelect,
                sort: {
                  startsAt: SortOrder.Ascending,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                  isRoot: true,
                },
              });
          }

          futureScheduledMaintenanceEvents.forEach(
            (event: ScheduledMaintenance) => {
              scheduledMaintenanceEvents.push(event);
            },
          );

          const scheduledMaintenanceEventsOnStatusPage: Array<ObjectID> =
            scheduledMaintenanceEvents.map((event: ScheduledMaintenance) => {
              return event.id!;
            });

          let scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
            [];

          if (scheduledMaintenanceEventsOnStatusPage.length > 0) {
            scheduledMaintenanceEventsPublicNotes =
              await ScheduledMaintenancePublicNoteService.findBy({
                query: {
                  scheduledMaintenanceId: QueryHelper.any(
                    scheduledMaintenanceEventsOnStatusPage,
                  ),
                  projectId: statusPage.projectId!,
                },
                select: {
                  postedAt: true,
                  note: true,
                  scheduledMaintenanceId: true,
                  attachments: {
                    _id: true,
                    name: true,
                  },
                },
                sort: {
                  postedAt: SortOrder.Ascending,
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                  isRoot: true,
                },
              });
          }

          let scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
            [];

          if (scheduledMaintenanceEventsOnStatusPage.length > 0) {
            scheduledMaintenanceStateTimelines =
              await ScheduledMaintenanceStateTimelineService.findBy({
                query: {
                  scheduledMaintenanceId: QueryHelper.any(
                    scheduledMaintenanceEventsOnStatusPage,
                  ),
                  projectId: statusPage.projectId!,
                },
                select: {
                  _id: true,
                  createdAt: true,
                  startsAt: true,
                  scheduledMaintenanceId: true,
                  scheduledMaintenanceState: {
                    _id: true,
                    color: true,
                    name: true,
                    isScheduledState: true,
                    isResolvedState: true,
                    isOngoingState: true,
                  },
                },

                sort: {
                  startsAt: SortOrder.Descending, // newer state changes first
                },
                skip: 0,
                limit: LIMIT_PER_PROJECT,
                props: {
                  isRoot: true,
                },
              });
          }

          // get all status page bar chart rules
          const statusPageHistoryChartBarColorRules: Array<StatusPageHistoryChartBarColorRule> =
            await StatusPageHistoryChartBarColorRuleService.findBy({
              query: {
                statusPageId: statusPageId,
              },
              select: {
                _id: true,
                barColor: true,
                order: true,
                statusPageId: true,
                uptimePercentGreaterThanOrEqualTo: true,
              },
              sort: {
                order: SortOrder.Ascending,
              },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: {
                isRoot: true,
              },
            });

          const overallStatus: MonitorStatus | null =
            StatusPageService.getOverallMonitorStatus({
              statusPageResources,
              monitorStatuses,
              monitorGroupCurrentStatuses,
            });

          const response: JSONObject = {
            overallStatus: overallStatus
              ? BaseModel.toJSON(overallStatus, MonitorStatus)
              : null,

            scheduledMaintenanceEventsPublicNotes: BaseModel.toJSONArray(
              scheduledMaintenanceEventsPublicNotes,
              ScheduledMaintenancePublicNote,
            ),
            statusPageHistoryChartBarColorRules: BaseModel.toJSONArray(
              statusPageHistoryChartBarColorRules,
              StatusPageHistoryChartBarColorRule,
            ),
            scheduledMaintenanceEvents: BaseModel.toJSONArray(
              scheduledMaintenanceEvents,
              ScheduledMaintenance,
            ),
            activeAnnouncements: BaseModel.toJSONArray(
              activeAnnouncements,
              StatusPageAnnouncement,
            ),
            incidentPublicNotes: BaseModel.toJSONArray(
              incidentPublicNotes,
              IncidentPublicNote,
            ),

            activeIncidents: BaseModel.toJSONArray(activeIncidents, Incident),

            monitorStatusTimelines: BaseModel.toJSONArray(
              monitorStatusTimelines,
              MonitorStatusTimeline,
            ),
            resourceGroups: BaseModel.toJSONArray(
              statusPageGroups,
              StatusPageGroup,
            ),
            monitorStatuses: BaseModel.toJSONArray(
              monitorStatuses,
              MonitorStatus,
            ),
            statusPageResources: BaseModel.toJSONArray(
              statusPageResources,
              StatusPageResource,
            ),
            incidentStateTimelines: BaseModel.toJSONArray(
              incidentStateTimelines,
              IncidentStateTimeline,
            ),
            statusPage: BaseModel.toJSONObject(statusPage, StatusPage),
            scheduledMaintenanceStateTimelines: BaseModel.toJSONArray(
              scheduledMaintenanceStateTimelines,
              ScheduledMaintenanceStateTimeline,
            ),

            monitorGroupCurrentStatuses: JSONFunctions.serialize(
              monitorGroupCurrentStatuses,
            ),
            monitorsInGroup: JSONFunctions.serialize(monitorsInGroup),
          };

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.put(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/update-subscription/:statusPageId/:subscriberId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.subscribeToStatusPage(req);
          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/get-subscription/:statusPageId/:subscriberId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const subscriber: StatusPageSubscriber =
            await this.getSubscriber(req);

          return Response.sendEntityResponse(
            req,
            res,
            subscriber,
            StatusPageSubscriber,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/subscribe/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.subscribeToStatusPage(req);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/manage-subscription/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.manageExistingSubscription(req);

          return Response.sendEmptySuccessResponse(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/incidents/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const response: JSONObject = await this.getIncidents(
            objectId,
            null,
            req,
          );

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/scheduled-maintenance-events/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const response: JSONObject = await this.getScheduledMaintenanceEvents(
            objectId,
            null,

            req,
          );

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/announcements/:statusPageId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const response: JSONObject = await this.getAnnouncements(
            objectId,
            null,

            req,
          );

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/incidents/:statusPageId/:incidentId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const incidentId: ObjectID = new ObjectID(
            req.params["incidentId"] as string,
          );

          const response: JSONObject = await this.getIncidents(
            objectId,
            incidentId,
            req,
          );

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/scheduled-maintenance-events/:statusPageId/:scheduledMaintenanceId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const scheduledMaintenanceId: ObjectID = new ObjectID(
            req.params["scheduledMaintenanceId"] as string,
          );

          const response: JSONObject = await this.getScheduledMaintenanceEvents(
            objectId,
            scheduledMaintenanceId,

            req,
          );

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/announcements/:statusPageId/:announcementId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const objectId: ObjectID = new ObjectID(
            req.params["statusPageId"] as string,
          );

          const announcementId: ObjectID = new ObjectID(
            req.params["announcementId"] as string,
          );

          const response: JSONObject = await this.getAnnouncements(
            objectId,
            announcementId,

            req,
          );

          return Response.sendJsonObjectResponse(req, res, response);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  @CaptureSpan()
  public async getScheduledMaintenanceEvents(
    statusPageId: ObjectID,
    scheduledMaintenanceId: ObjectID | null,
    req: ExpressRequest,
  ): Promise<JSONObject> {
    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        showScheduledEventHistoryInDays: true,
        showScheduledEventLabelsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status Page not found");
    }

    if (!statusPage.showScheduledMaintenanceEventsOnStatusPage) {
      throw new BadDataException(
        "Scheduled Maintenance Events are not enabled on this status page",
      );
    }

    // get monitors on status page.
    const statusPageResources: Array<StatusPageResource> =
      await StatusPageService.getStatusPageResources({
        statusPageId: statusPageId,
      });

    // check if status page has active scheduled events.
    const today: Date = OneUptimeDate.getCurrentDate();
    const historyDays: Date = OneUptimeDate.getSomeDaysAgo(
      statusPage.showScheduledEventHistoryInDays || 14,
    );

    let query: Query<ScheduledMaintenance> = {
      startsAt: QueryHelper.inBetween(historyDays, today),
      statusPages: [statusPageId] as any,
      projectId: statusPage.projectId!,
      isVisibleOnStatusPage: true,
    };

    if (scheduledMaintenanceId) {
      query = {
        _id: scheduledMaintenanceId.toString(),
        statusPages: [statusPageId] as any,
        projectId: statusPage.projectId!,
      };
    }

    let scheduledEventsSelect: Select<ScheduledMaintenance> = {
      createdAt: true,
      title: true,
      description: true,
      _id: true,
      endsAt: true,
      startsAt: true,
      currentScheduledMaintenanceState: {
        name: true,
        color: true,
        isScheduledState: true,
        isResolvedState: true,
        isOngoingState: true,
        order: true,
      },
      monitors: {
        _id: true,
      },
    };

    if (statusPage.showScheduledEventLabelsOnStatusPage) {
      scheduledEventsSelect = {
        ...scheduledEventsSelect,
        labels: {
          name: true,
          color: true,
        },
      };
    }

    const scheduledMaintenanceEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: query,
        select: scheduledEventsSelect,
        sort: {
          startsAt: SortOrder.Descending,
        },

        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    let futureScheduledMaintenanceEvents: Array<ScheduledMaintenance> = [];

    // If there is no scheduledMaintenanceId, then fetch all future scheduled events.
    if (!scheduledMaintenanceId) {
      futureScheduledMaintenanceEvents =
        await ScheduledMaintenanceService.findBy({
          query: {
            currentScheduledMaintenanceState: {
              isScheduledState: true,
            } as any,
            statusPages: [statusPageId] as any,
            projectId: statusPage.projectId!,
            isVisibleOnStatusPage: true,
          },
          select: scheduledEventsSelect,
          sort: {
            createdAt: SortOrder.Ascending,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      futureScheduledMaintenanceEvents.forEach(
        (event: ScheduledMaintenance) => {
          scheduledMaintenanceEvents.push(event);
        },
      );
    }

    const scheduledMaintenanceEventsOnStatusPage: Array<ObjectID> =
      scheduledMaintenanceEvents.map((event: ScheduledMaintenance) => {
        return event.id!;
      });

    let scheduledMaintenanceEventsPublicNotes: Array<ScheduledMaintenancePublicNote> =
      [];

    if (scheduledMaintenanceEventsOnStatusPage.length > 0) {
      scheduledMaintenanceEventsPublicNotes =
        await ScheduledMaintenancePublicNoteService.findBy({
          query: {
            scheduledMaintenanceId: QueryHelper.any(
              scheduledMaintenanceEventsOnStatusPage,
            ),
            projectId: statusPage.projectId!,
          },
          select: {
            postedAt: true,
            note: true,
            scheduledMaintenanceId: true,
            attachments: {
              _id: true,
              name: true,
            },
          },
          sort: {
            postedAt: SortOrder.Ascending,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });
    }

    let scheduledMaintenanceStateTimelines: Array<ScheduledMaintenanceStateTimeline> =
      [];

    if (scheduledMaintenanceEventsOnStatusPage.length > 0) {
      scheduledMaintenanceStateTimelines =
        await ScheduledMaintenanceStateTimelineService.findBy({
          query: {
            scheduledMaintenanceId: QueryHelper.any(
              scheduledMaintenanceEventsOnStatusPage,
            ),
            projectId: statusPage.projectId!,
          },
          select: {
            _id: true,
            createdAt: true,
            startsAt: true,
            scheduledMaintenanceId: true,
            scheduledMaintenanceState: {
              name: true,
              color: true,
              isScheduledState: true,
              isResolvedState: true,
              isOngoingState: true,
            },
          },

          sort: {
            startsAt: SortOrder.Descending, // newer state changes first
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });
    }

    const monitorGroupIds: Array<ObjectID> = statusPageResources
      .map((resource: StatusPageResource) => {
        return resource.monitorGroupId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    // get monitors in the group.
    const monitorsInGroup: Dictionary<Array<ObjectID>> = {};

    // get monitor status charts.
    const monitorsOnStatusPage: Array<ObjectID> = statusPageResources
      .map((monitor: StatusPageResource) => {
        return monitor.monitorId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    for (const monitorGroupId of monitorGroupIds) {
      // get monitors in the group.

      const groupResources: Array<MonitorGroupResource> =
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroupId,
          },
          select: {
            monitorId: true,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const monitorsInGroupIds: Array<ObjectID> = groupResources
        .map((resource: MonitorGroupResource) => {
          return resource.monitorId!;
        })
        .filter((id: ObjectID) => {
          return Boolean(id); // remove nulls
        });

      for (const monitorId of monitorsInGroupIds) {
        if (
          !monitorsOnStatusPage.find((item: ObjectID) => {
            return item.toString() === monitorId.toString();
          })
        ) {
          monitorsOnStatusPage.push(monitorId);
        }
      }

      monitorsInGroup[monitorGroupId.toString()] = monitorsInGroupIds;
    }

    // get scheduled event states.
    const scheduledEventStates: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.findBy({
        query: {
          projectId: statusPage.projectId!,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          order: true,
          isEndedState: true,
          isOngoingState: true,
          isScheduledState: true,
        },
      });

    const response: JSONObject = {
      scheduledMaintenanceEventsPublicNotes: BaseModel.toJSONArray(
        scheduledMaintenanceEventsPublicNotes,
        ScheduledMaintenancePublicNote,
      ),
      scheduledMaintenanceStates: BaseModel.toJSONArray(
        scheduledEventStates,
        ScheduledMaintenanceState,
      ),
      scheduledMaintenanceEvents: BaseModel.toJSONArray(
        scheduledMaintenanceEvents,
        ScheduledMaintenance,
      ),
      statusPageResources: BaseModel.toJSONArray(
        statusPageResources,
        StatusPageResource,
      ),
      scheduledMaintenanceStateTimelines: BaseModel.toJSONArray(
        scheduledMaintenanceStateTimelines,
        ScheduledMaintenanceStateTimeline,
      ),
      monitorsInGroup: JSONFunctions.serialize(monitorsInGroup),
    };

    return response;
  }

  @CaptureSpan()
  public async getAnnouncements(
    statusPageId: ObjectID,
    announcementId: ObjectID | null,
    req: ExpressRequest,
  ): Promise<JSONObject> {
    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        showAnnouncementHistoryInDays: true,
        showAnnouncementsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status Page not found");
    }

    if (!statusPage.showAnnouncementsOnStatusPage) {
      throw new BadDataException(
        "Announcements are not enabled for this status page.",
      );
    }

    // check if status page has active announcement.

    const today: Date = OneUptimeDate.getCurrentDate();
    const historyDays: Date = OneUptimeDate.getSomeDaysAgo(
      statusPage.showAnnouncementHistoryInDays || 14,
    );

    let query: Query<StatusPageAnnouncement> = {
      statusPages: [statusPageId] as any,
      showAnnouncementAt: QueryHelper.inBetween(historyDays, today),
      projectId: statusPage.projectId!,
    };

    if (announcementId) {
      query = {
        statusPages: [statusPageId] as any,
        _id: announcementId.toString(),
        projectId: statusPage.projectId!,
      };
    }

    const announcements: Array<StatusPageAnnouncement> =
      await StatusPageAnnouncementService.findBy({
        query: query,
        select: {
          createdAt: true,
          title: true,
          description: true,
          _id: true,
          showAnnouncementAt: true,
          endAnnouncementAt: true,
          monitors: {
            _id: true,
            name: true,
          },
          attachments: {
            _id: true,
            name: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    // get monitors on status page.
    const statusPageResources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          statusPageGroupId: true,
          monitorId: true,
          displayTooltip: true,
          displayDescription: true,
          displayName: true,
          monitorGroupId: true,
          monitor: {
            _id: true,
            currentMonitorStatusId: true,
          },
        },

        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const monitorGroupIds: Array<ObjectID> = statusPageResources
      .map((resource: StatusPageResource) => {
        return resource.monitorGroupId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    // get monitors in the group.
    const monitorsInGroup: Dictionary<Array<ObjectID>> = {};

    // get monitor status charts.
    const monitorsOnStatusPage: Array<ObjectID> = statusPageResources
      .map((monitor: StatusPageResource) => {
        return monitor.monitorId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    for (const monitorGroupId of monitorGroupIds) {
      // get monitors in the group.

      const groupResources: Array<MonitorGroupResource> =
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroupId,
          },
          select: {
            monitorId: true,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const monitorsInGroupIds: Array<ObjectID> = groupResources
        .map((resource: MonitorGroupResource) => {
          return resource.monitorId!;
        })
        .filter((id: ObjectID) => {
          return Boolean(id); // remove nulls
        });

      for (const monitorId of monitorsInGroupIds) {
        if (
          !monitorsOnStatusPage.find((item: ObjectID) => {
            return item.toString() === monitorId.toString();
          })
        ) {
          monitorsOnStatusPage.push(monitorId);
        }
      }

      monitorsInGroup[monitorGroupId.toString()] = monitorsInGroupIds;
    }

    const response: JSONObject = {
      announcements: BaseModel.toJSONArray(
        announcements,
        StatusPageAnnouncement,
      ),
      statusPageResources: BaseModel.toJSONArray(
        statusPageResources,
        StatusPageResource,
      ),
      monitorsInGroup: JSONFunctions.serialize(monitorsInGroup),
    };

    return response;
  }

  @CaptureSpan()
  public async manageExistingSubscription(req: ExpressRequest): Promise<void> {
    const statusPageId: ObjectID = new ObjectID(
      req.params["statusPageId"] as string,
    );

    logger.debug(
      `Managing Existing Subscription for Status Page: ${statusPageId}`,
    );

    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        enableEmailSubscribers: true,
        enableSlackSubscribers: true,
        enableMicrosoftTeamsSubscribers: true,
        enableSmsSubscribers: true,
        allowSubscribersToChooseResources: true,
        allowSubscribersToChooseEventTypes: true,
        showSubscriberPageOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      logger.debug(`Status page not found with ID: ${statusPageId}`);
      throw new BadDataException("Status Page not found");
    }

    if (!statusPage.showSubscriberPageOnStatusPage) {
      logger.debug(
        `Subscriber page not enabled for status page with ID: ${statusPageId}`,
      );
      throw new BadDataException(
        "Subscribes not enabled for this status page.",
      );
    }

    logger.debug(`Status page found: ${JSON.stringify(statusPage)}`);

    if (
      req.body.data["subscriberEmail"] &&
      !statusPage.enableEmailSubscribers
    ) {
      logger.debug(
        `Email subscribers not enabled for status page with ID: ${statusPageId}`,
      );
      throw new BadDataException(
        "Email subscribers not enabled for this status page.",
      );
    }

    if (
      req.body.data["slackIncomingWebhookUrl"] &&
      !statusPage.enableSlackSubscribers
    ) {
      logger.debug(
        `Slack subscribers not enabled for status page with ID: ${statusPageId}`,
      );
      throw new BadDataException(
        "Slack subscribers not enabled for this status page.",
      );
    }

    if (req.body.data["subscriberPhone"] && !statusPage.enableSmsSubscribers) {
      logger.debug(
        `SMS subscribers not enabled for status page with ID: ${statusPageId}`,
      );
      throw new BadDataException(
        "SMS subscribers not enabled for this status page.",
      );
    }

    // if no email or phone, throw error.

    if (
      !req.body.data["subscriberEmail"] &&
      !req.body.data["subscriberPhone"] &&
      !req.body.data["slackWorkspaceName"]
    ) {
      logger.debug(
        `No email, slack workspace name or phone provided for subscription to status page with ID: ${statusPageId}`,
      );
      throw new BadDataException(
        "Email, phone or slack workspace name is required to subscribe to this status page.",
      );
    }

    const email: Email | undefined = req.body.data["subscriberEmail"]
      ? new Email(req.body.data["subscriberEmail"] as string)
      : undefined;

    const phone: Phone | undefined = req.body.data["subscriberPhone"]
      ? new Phone(req.body.data["subscriberPhone"] as string)
      : undefined;

    const slackWorkspaceName: string | undefined = req.body.data[
      "slackWorkspaceName"
    ]
      ? (req.body.data["slackWorkspaceName"] as string)
      : undefined;

    let statusPageSubscriber: StatusPageSubscriber | null = null;

    if (email) {
      logger.debug(`Setting subscriber email: ${email}`);
      statusPageSubscriber = await StatusPageSubscriberService.findOneBy({
        query: {
          subscriberEmail: email,
          statusPageId: statusPageId,
        },
        select: {
          _id: true,
          subscriberEmail: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (phone) {
      logger.debug(`Setting subscriber phone: ${phone}`);
      statusPageSubscriber = await StatusPageSubscriberService.findOneBy({
        query: {
          subscriberPhone: phone,
          statusPageId: statusPageId,
        },
        select: {
          _id: true,
          subscriberPhone: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (slackWorkspaceName) {
      logger.debug(`Setting subscriber slack workspace: ${slackWorkspaceName}`);
      statusPageSubscriber = await StatusPageSubscriberService.findOneBy({
        query: {
          slackWorkspaceName: slackWorkspaceName,
          statusPageId: statusPageId,
        },
        select: {
          _id: true,
          slackWorkspaceName: true,
          slackIncomingWebhookUrl: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    if (!statusPageSubscriber) {
      // not found, return bad data
      logger.debug(
        `Subscriber not found for email: ${email}, phone: ${phone}, or slack workspace: ${slackWorkspaceName}`,
      );

      let identifierType: string = "email";
      if (phone) {
        identifierType = "phone";
      } else if (slackWorkspaceName) {
        identifierType = "slack workspace name";
      }

      throw new BadDataException(
        `Subscription not found for this status page. Please make sure your ${identifierType} is correct.`,
      );
    }

    const statusPageURL: string =
      await StatusPageService.getStatusPageURL(statusPageId);

    const manageUrlink: string = StatusPageSubscriberService.getUnsubscribeLink(
      URL.fromString(statusPageURL),
      statusPageSubscriber.id!,
    ).toString();

    const statusPages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification([
        statusPageId,
      ]);

    for (const statusPage of statusPages) {
      // send email to subscriber or sms if phone is provided.

      if (email) {
        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
        const statusPageIdString: string | null =
          statusPage.id?.toString() || statusPage._id?.toString() || null;

        MailService.sendMail(
          {
            toEmail: email,
            templateType:
              EmailTemplateType.ManageExistingStatusPageSubscriberSubscription,
            vars: {
              statusPageName: statusPage.name || "Status Page",
              statusPageUrl: statusPageURL,
              logoUrl:
                statusPage.logoFileId && statusPageIdString
                  ? new URL(httpProtocol, host)
                      .addRoute(StatusPageApiRoute)
                      .addRoute(`/logo/${statusPageIdString}`)
                      .toString()
                  : "",
              isPublicStatusPage: statusPage.isPublicStatusPage
                ? "true"
                : "false",
              subscriberEmailNotificationFooterText:
                StatusPageServiceType.getSubscriberEmailFooterText(statusPage),

              manageSubscriptionUrl: manageUrlink,
            },
            subject:
              "Manage your Subscription for " +
              (statusPage.name || "Status Page"),
          },
          {
            mailServer: ProjectSmtpConfigService.toEmailServer(
              statusPage.smtpConfig,
            ),
            projectId: statusPage.projectId!,
            statusPageId: statusPage.id!,
          },
        );
      }

      if (phone) {
        const sms: SMS = {
          message: `You have selected to manage your subscription for the status page: ${statusPage.name}. You can manage your subscription here: ${manageUrlink}`,
          to: phone,
        };
        // send sms here.
        SmsService.sendSms(sms, {
          projectId: statusPage.projectId,
          customTwilioConfig: ProjectCallSMSConfigService.toTwilioConfig(
            statusPage.callSmsConfig,
          ),
          statusPageId: statusPage.id!,
        }).catch((err: Error) => {
          logger.error(err);
        });
      }

      if (statusPageSubscriber.slackIncomingWebhookUrl) {
        const slackMessage: string = `You have selected to manage your subscription for the status page: ${statusPage.name}. You can manage your subscription here: ${manageUrlink}`;

        SlackUtil.sendMessageToChannelViaIncomingWebhook({
          url: statusPageSubscriber.slackIncomingWebhookUrl,
          text: slackMessage,
        }).catch((err: Error) => {
          logger.error(err);
        });
      }

      logger.debug(
        `Subscription management link sent to subscriber with ID: ${statusPageSubscriber.id}`,
      );
    }
  }

  @CaptureSpan()
  public async subscribeToStatusPage(req: ExpressRequest): Promise<void> {
    const objectId: ObjectID = new ObjectID(
      req.params["statusPageId"] as string,
    );

    logger.debug(`Subscribing to status page with ID: ${objectId}`);

    await this.checkHasReadAccess({
      statusPageId: objectId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: objectId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        enableEmailSubscribers: true,
        enableSmsSubscribers: true,
        enableSlackSubscribers: true,
        enableMicrosoftTeamsSubscribers: true,
        allowSubscribersToChooseResources: true,
        allowSubscribersToChooseEventTypes: true,
        showSubscriberPageOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      logger.debug(`Status page not found with ID: ${objectId}`);
      throw new BadDataException("Status Page not found");
    }

    if (!statusPage.showSubscriberPageOnStatusPage) {
      logger.debug(
        `Subscriber page not enabled for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Subscribes not enabled for this status page.",
      );
    }

    logger.debug(`Status page found: ${JSON.stringify(statusPage)}`);

    if (
      req.body.data["subscriberEmail"] &&
      !statusPage.enableEmailSubscribers
    ) {
      logger.debug(
        `Email subscribers not enabled for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Email subscribers not enabled for this status page.",
      );
    }

    if (req.body.data["subscriberPhone"] && !statusPage.enableSmsSubscribers) {
      logger.debug(
        `SMS subscribers not enabled for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "SMS subscribers not enabled for this status page.",
      );
    }

    // if no email or phone, throw error.

    if (
      req.body.data["slackWorkspaceName"] &&
      !statusPage.enableSlackSubscribers
    ) {
      logger.debug(
        `Slack subscribers not enabled for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Slack subscribers not enabled for this status page.",
      );
    }

    if (
      req.body.data["microsoftTeamsWorkspaceName"] &&
      !statusPage.enableMicrosoftTeamsSubscribers
    ) {
      logger.debug(
        `Microsoft Teams subscribers not enabled for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Microsoft Teams subscribers not enabled for this status page.",
      );
    }

    if (
      !req.body.data["subscriberEmail"] &&
      !req.body.data["subscriberPhone"] &&
      !req.body.data["slackWorkspaceName"] &&
      !req.body.data["microsoftTeamsWorkspaceName"]
    ) {
      logger.debug(
        `No email, phone, slack workspace name, or Microsoft Teams workspace name provided for subscription to status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Email, phone, slack workspace name, or Microsoft Teams workspace name is required to subscribe to this status page.",
      );
    }

    const email: Email | undefined = req.body.data["subscriberEmail"]
      ? new Email(req.body.data["subscriberEmail"] as string)
      : undefined;

    const phone: Phone | undefined = req.body.data["subscriberPhone"]
      ? new Phone(req.body.data["subscriberPhone"] as string)
      : undefined;

    const slackIncomingWebhookUrl: string | undefined = req.body.data[
      "slackIncomingWebhookUrl"
    ]
      ? (req.body.data["slackIncomingWebhookUrl"] as string)
      : undefined;

    const slackWorkspaceName: string | undefined = req.body.data[
      "slackWorkspaceName"
    ]
      ? (req.body.data["slackWorkspaceName"] as string)
      : undefined;

    const microsoftTeamsIncomingWebhookUrl: string | undefined = req.body.data[
      "microsoftTeamsIncomingWebhookUrl"
    ]
      ? (req.body.data["microsoftTeamsIncomingWebhookUrl"] as string)
      : undefined;

    const microsoftTeamsWorkspaceName: string | undefined = req.body.data[
      "microsoftTeamsWorkspaceName"
    ]
      ? (req.body.data["microsoftTeamsWorkspaceName"] as string)
      : undefined;

    let statusPageSubscriber: StatusPageSubscriber | null = null;

    let isUpdate: boolean = false;

    if (!req.params["subscriberId"]) {
      logger.debug(
        `Creating new subscriber for status page with ID: ${objectId}`,
      );
      statusPageSubscriber = new StatusPageSubscriber();
    } else {
      const subscriberId: ObjectID = new ObjectID(
        req.params["subscriberId"] as string,
      );

      logger.debug(
        `Updating existing subscriber with ID: ${subscriberId} for status page with ID: ${objectId}`,
      );
      statusPageSubscriber = await StatusPageSubscriberService.findOneBy({
        query: {
          _id: subscriberId.toString(),
        },
        props: {
          isRoot: true,
        },
      });

      if (!statusPageSubscriber) {
        logger.debug(`Subscriber not found with ID: ${subscriberId}`);
        throw new BadDataException("Subscriber not found");
      }

      isUpdate = true;
    }

    if (email) {
      logger.debug(`Setting subscriber email: ${email}`);
      statusPageSubscriber.subscriberEmail = email;
    }

    if (phone) {
      logger.debug(`Setting subscriber phone: ${phone}`);
      statusPageSubscriber.subscriberPhone = phone;
    }

    if (slackIncomingWebhookUrl) {
      logger.debug(`Setting subscriber slack: ${slackIncomingWebhookUrl}`);
      statusPageSubscriber.slackIncomingWebhookUrl = URL.fromString(
        slackIncomingWebhookUrl,
      );
    }

    if (slackWorkspaceName) {
      logger.debug(
        `Setting subscriber slack workspace name: ${slackWorkspaceName}`,
      );
      statusPageSubscriber.slackWorkspaceName = slackWorkspaceName;
    }

    if (microsoftTeamsIncomingWebhookUrl) {
      logger.debug(
        `Setting subscriber Microsoft Teams webhook: ${microsoftTeamsIncomingWebhookUrl}`,
      );
      statusPageSubscriber.microsoftTeamsIncomingWebhookUrl = URL.fromString(
        microsoftTeamsIncomingWebhookUrl,
      );
    }

    if (microsoftTeamsWorkspaceName) {
      logger.debug(
        `Setting subscriber Microsoft Teams workspace name: ${microsoftTeamsWorkspaceName}`,
      );
      statusPageSubscriber.microsoftTeamsWorkspaceName =
        microsoftTeamsWorkspaceName;
    }

    if (
      req.body.data["statusPageResources"] &&
      !statusPage.allowSubscribersToChooseResources
    ) {
      logger.debug(
        `Subscribers not allowed to choose resources for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Subscribers are not allowed to choose resources for this status page.",
      );
    }

    if (
      req.body.data["statusPageEventTypes"] &&
      !statusPage.allowSubscribersToChooseEventTypes
    ) {
      logger.debug(
        `Subscribers not allowed to choose event types for status page with ID: ${objectId}`,
      );
      throw new BadDataException(
        "Subscribers are not allowed to choose event types for this status page.",
      );
    }

    statusPageSubscriber.statusPageId = objectId;
    statusPageSubscriber.sendYouHaveSubscribedMessage = true;
    statusPageSubscriber.projectId = statusPage.projectId!;
    statusPageSubscriber.isSubscribedToAllResources = Boolean(
      req.body.data["isSubscribedToAllResources"],
    );

    statusPageSubscriber.isSubscribedToAllEventTypes = Boolean(
      req.body.data["isSubscribedToAllEventTypes"],
    );

    if (
      req.body.data["statusPageResources"] &&
      req.body.data["statusPageResources"].length > 0
    ) {
      logger.debug(
        `Setting subscriber resources: ${JSON.stringify(req.body.data["statusPageResources"])}`,
      );
      statusPageSubscriber.statusPageResources = req.body.data[
        "statusPageResources"
      ] as Array<StatusPageResource>;
    }

    if (
      req.body.data["statusPageEventTypes"] &&
      req.body.data["statusPageEventTypes"].length > 0
    ) {
      logger.debug(
        `Setting subscriber event types: ${JSON.stringify(req.body.data["statusPageEventTypes"])}`,
      );
      statusPageSubscriber.statusPageEventTypes = req.body.data[
        "statusPageEventTypes"
      ] as Array<StatusPageEventType>;
    }

    if (isUpdate) {
      // check isUnsubscribed is set to false.
      logger.debug(`Updating subscriber with ID: ${statusPageSubscriber.id}`);
      statusPageSubscriber.isUnsubscribed = Boolean(
        req.body.data["isUnsubscribed"],
      );

      await StatusPageSubscriberService.updateOneById({
        id: statusPageSubscriber.id!,
        data: {
          statusPageResources: statusPageSubscriber.statusPageResources!,
          isSubscribedToAllResources:
            statusPageSubscriber.isSubscribedToAllResources!,
          isUnsubscribed: statusPageSubscriber.isUnsubscribed,
        } as any,
        props: {
          isRoot: true,
        },
      });
    } else {
      logger.debug(
        `Creating new subscriber: ${JSON.stringify(statusPageSubscriber)}`,
      );
      await StatusPageSubscriberService.create({
        data: statusPageSubscriber,
        props: {
          isRoot: true,
        },
      });
    }

    logger.debug(
      `Subscription process completed for status page with ID: ${objectId}`,
    );
  }

  @CaptureSpan()
  public async getSubscriber(
    req: ExpressRequest,
  ): Promise<StatusPageSubscriber> {
    const objectId: ObjectID = new ObjectID(
      req.params["statusPageId"] as string,
    );

    await this.checkHasReadAccess({
      statusPageId: objectId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: objectId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status Page not found");
    }

    const subscriberId: ObjectID = new ObjectID(
      req.params["subscriberId"] as string,
    );

    const statusPageSubscriber: StatusPageSubscriber | null =
      await StatusPageSubscriberService.findOneBy({
        query: {
          _id: subscriberId.toString(),
          statusPageId: statusPage.id!,
        },
        select: {
          isUnsubscribed: true,
          subscriberEmail: true,
          subscriberPhone: true,
          slackWorkspaceName: true,
          statusPageId: true,
          statusPageResources: true,
          isSubscribedToAllResources: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!statusPageSubscriber) {
      throw new BadDataException("Subscriber not found");
    }

    return statusPageSubscriber;
  }

  @CaptureSpan()
  public async getIncidents(
    statusPageId: ObjectID,
    incidentId: ObjectID | null,
    req: ExpressRequest,
  ): Promise<JSONObject> {
    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        showIncidentHistoryInDays: true,
        showIncidentLabelsOnStatusPage: true,
        showIncidentsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status Page not found");
    }

    if (!statusPage.showIncidentsOnStatusPage) {
      throw new BadDataException(
        "Incidents are not enabled on this status page.",
      );
    }

    // get monitors on status page.
    const statusPageResources: Array<StatusPageResource> =
      await StatusPageService.getStatusPageResources({
        statusPageId: statusPageId,
      });

    const { monitorsOnStatusPage, monitorsInGroup } =
      await StatusPageService.getMonitorIdsOnStatusPage({
        statusPageId: statusPageId,
      });

    const today: Date = OneUptimeDate.getCurrentDate();

    const historyDays: Date = OneUptimeDate.getSomeDaysAgo(
      statusPage.showIncidentHistoryInDays || 14,
    );

    let incidentQuery: Query<Incident> = {
      monitors: monitorsOnStatusPage as any,
      projectId: statusPage.projectId!,
      createdAt: QueryHelper.inBetween(historyDays, today),
      isVisibleOnStatusPage: true,
    };

    if (incidentId) {
      incidentQuery = {
        monitors: monitorsOnStatusPage as any,
        projectId: statusPage.projectId!,
        _id: incidentId.toString(),
      };
    }

    // check if status page has active incident.
    let incidents: Array<Incident> = [];

    let selectIncidents: Select<Incident> = {
      createdAt: true,
      declaredAt: true,
      title: true,
      description: true,
      _id: true,
      incidentSeverity: {
        name: true,
        color: true,
      },
      currentIncidentState: {
        name: true,
        color: true,
        _id: true,
        order: true,
      },
      monitors: {
        _id: true,
      },
    };

    if (statusPage.showIncidentLabelsOnStatusPage) {
      selectIncidents = {
        ...selectIncidents,
        labels: {
          name: true,
          color: true,
        },
      };
    }

    if (monitorsOnStatusPage.length > 0) {
      incidents = await IncidentService.findBy({
        query: incidentQuery,
        select: selectIncidents,
        sort: {
          declaredAt: SortOrder.Descending,
          createdAt: SortOrder.Descending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

      let activeIncidents: Array<Incident> = [];

      const unresolvedIncidentStates: Array<IncidentState> =
        await IncidentStateService.getUnresolvedIncidentStates(
          statusPage.projectId!,
          {
            isRoot: true,
          },
        );

      const unresolvbedIncidentStateIds: Array<ObjectID> =
        unresolvedIncidentStates.map((state: IncidentState) => {
          return state.id!;
        });

      // If there is no particular incident id to fetch then fetch active incidents.
      if (!incidentId) {
        activeIncidents = await IncidentService.findBy({
          query: {
            monitors: monitorsOnStatusPage as any,
            isVisibleOnStatusPage: true,
            currentIncidentStateId: QueryHelper.any(
              unresolvbedIncidentStateIds,
            ),
            projectId: statusPage.projectId!,
          },
          select: selectIncidents,
          sort: {
            declaredAt: SortOrder.Descending,
            createdAt: SortOrder.Descending,
          },

          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });
      }

      incidents = [...activeIncidents, ...incidents];

      // get distinct by id.

      incidents = ArrayUtil.distinctByFieldName(incidents, "_id");
    }

    const incidentsOnStatusPage: Array<ObjectID> = incidents.map(
      (incident: Incident) => {
        return incident.id!;
      },
    );

    let incidentPublicNotes: Array<IncidentPublicNote> = [];

    if (incidentsOnStatusPage.length > 0) {
      incidentPublicNotes = await IncidentPublicNoteService.findBy({
        query: {
          incidentId: QueryHelper.any(incidentsOnStatusPage),
          projectId: statusPage.projectId!,
        },
        select: {
          postedAt: true,
          note: true,
          incidentId: true,
          attachments: {
            _id: true,
            name: true,
          },
        },
        sort: {
          postedAt: SortOrder.Descending, // new note first
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    let incidentStateTimelines: Array<IncidentStateTimeline> = [];

    if (incidentsOnStatusPage.length > 0) {
      incidentStateTimelines = await IncidentStateTimelineService.findBy({
        query: {
          incidentId: QueryHelper.any(incidentsOnStatusPage),
          projectId: statusPage.projectId!,
        },
        select: {
          _id: true,
          createdAt: true,
          startsAt: true,
          incidentId: true,
          incidentState: {
            name: true,
            color: true,
          },
        },
        sort: {
          startsAt: SortOrder.Descending, // newer state changes first
        },

        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });
    }

    // get all the incident states for this project.
    const incidentStates: Array<IncidentState> =
      await IncidentStateService.findBy({
        query: {
          projectId: statusPage.projectId!,
        },
        select: {
          isResolvedState: true,
          order: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const response: JSONObject = {
      incidentPublicNotes: BaseModel.toJSONArray(
        incidentPublicNotes,
        IncidentPublicNote,
      ),
      incidentStates: BaseModel.toJSONArray(incidentStates, IncidentState),
      incidents: BaseModel.toJSONArray(incidents, Incident),
      statusPageResources: BaseModel.toJSONArray(
        statusPageResources,
        StatusPageResource,
      ),
      incidentStateTimelines: BaseModel.toJSONArray(
        incidentStateTimelines,
        IncidentStateTimeline,
      ),
      monitorsInGroup: JSONFunctions.serialize(monitorsInGroup),
    };

    return response;
  }

  @CaptureSpan()
  public async getStatusPageResourcesAndTimelines(data: {
    statusPageId: ObjectID;
    startDateForMonitorTimeline: Date;
    endDateForMonitorTimeline: Date;
  }): Promise<{
    statusPageResources: StatusPageResource[];
    monitorStatuses: MonitorStatus[];
    monitorStatusTimelines: MonitorStatusTimeline[];
    monitorGroupCurrentStatuses: Dictionary<ObjectID>;
    statusPageGroups: StatusPageGroup[];
    statusPage: StatusPage;
    monitorsOnStatusPage: ObjectID[];
    monitorsInGroup: Dictionary<ObjectID[]>;
  }> {
    const objectId: ObjectID = data.statusPageId;

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: objectId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        isPublicStatusPage: true,
        overviewPageDescription: true,
        showIncidentLabelsOnStatusPage: true,
        showScheduledEventLabelsOnStatusPage: true,
        downtimeMonitorStatuses: {
          _id: true,
        },
        defaultBarColor: true,
        showOverallUptimePercentOnStatusPage: true,
        overallUptimePercentPrecision: true,
        showAnnouncementsOnStatusPage: true,
        showIncidentsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status Page not found");
    }

    //get monitor statuses

    const monitorStatuses: Array<MonitorStatus> =
      await MonitorStatusService.findBy({
        query: {
          projectId: statusPage.projectId!,
        },
        select: {
          name: true,
          color: true,
          priority: true,
          isOperationalState: true,
        },
        sort: {
          priority: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    // get resource groups.

    const groups: Array<StatusPageGroup> = await StatusPageGroupService.findBy({
      query: {
        statusPageId: objectId,
      },
      select: {
        name: true,
        order: true,
        description: true,
        isExpandedByDefault: true,
        showCurrentStatus: true,
        showUptimePercent: true,
        uptimePercentPrecision: true,
      },
      sort: {
        order: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
      props: {
        isRoot: true,
      },
    });

    // get monitors on status page.
    const statusPageResources: Array<StatusPageResource> =
      await StatusPageResourceService.findBy({
        query: {
          statusPageId: objectId,
        },
        select: {
          statusPageGroupId: true,
          monitorId: true,
          displayTooltip: true,
          displayDescription: true,
          displayName: true,
          showStatusHistoryChart: true,
          showCurrentStatus: true,
          order: true,
          monitor: {
            _id: true,
            currentMonitorStatusId: true,
          },
          monitorGroupId: true,
          showUptimePercent: true,
          uptimePercentPrecision: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const monitorGroupIds: Array<ObjectID> = statusPageResources
      .map((resource: StatusPageResource) => {
        return resource.monitorGroupId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    // get monitors in the group.
    const monitorGroupCurrentStatuses: Dictionary<ObjectID> = {};
    const monitorsInGroup: Dictionary<Array<ObjectID>> = {};

    // get monitor status charts.
    const monitorsOnStatusPage: Array<ObjectID> = statusPageResources
      .map((monitor: StatusPageResource) => {
        return monitor.monitorId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    const monitorsOnStatusPageForTimeline: Array<ObjectID> = statusPageResources
      .filter((monitor: StatusPageResource) => {
        return monitor.showStatusHistoryChart || monitor.showUptimePercent;
      })
      .map((monitor: StatusPageResource) => {
        return monitor.monitorId!;
      })
      .filter((id: ObjectID) => {
        return Boolean(id); // remove nulls
      });

    for (const monitorGroupId of monitorGroupIds) {
      // get current status of monitors in the group.

      const currentStatus: MonitorStatus =
        await MonitorGroupService.getCurrentStatus(monitorGroupId, {
          isRoot: true,
        });

      monitorGroupCurrentStatuses[monitorGroupId.toString()] =
        currentStatus.id!;

      // get monitors in the group.

      const groupResources: Array<MonitorGroupResource> =
        await MonitorGroupResourceService.findBy({
          query: {
            monitorGroupId: monitorGroupId,
          },
          select: {
            monitorId: true,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
        });

      const monitorsInGroupIds: Array<ObjectID> = groupResources
        .map((resource: MonitorGroupResource) => {
          return resource.monitorId!;
        })
        .filter((id: ObjectID) => {
          return Boolean(id); // remove nulls
        });

      const shouldShowTimelineForThisGroup: boolean = Boolean(
        statusPageResources.find((resource: StatusPageResource) => {
          return (
            resource.monitorGroupId?.toString() === monitorGroupId.toString() &&
            (resource.showStatusHistoryChart || resource.showUptimePercent)
          );
        }),
      );

      for (const monitorId of monitorsInGroupIds) {
        if (!monitorId) {
          continue;
        }

        if (
          !monitorsOnStatusPage.find((item: ObjectID) => {
            return item.toString() === monitorId.toString();
          })
        ) {
          monitorsOnStatusPage.push(monitorId);
        }

        // add this to the timeline event for this group.

        if (
          shouldShowTimelineForThisGroup &&
          !monitorsOnStatusPageForTimeline.find((item: ObjectID) => {
            return item.toString() === monitorId.toString();
          })
        ) {
          monitorsOnStatusPageForTimeline.push(monitorId);
        }
      }

      monitorsInGroup[monitorGroupId.toString()] = monitorsInGroupIds;
    }

    const monitorStatusTimelines: Array<MonitorStatusTimeline> =
      await StatusPageService.getMonitorStatusTimelineForStatusPage({
        monitorIds: monitorsOnStatusPageForTimeline,
        startDate: data.startDateForMonitorTimeline,
        endDate: data.endDateForMonitorTimeline,
      });

    // return everything.

    return {
      statusPageResources,
      monitorStatuses,
      monitorGroupCurrentStatuses,
      statusPageGroups: groups,
      monitorStatusTimelines,
      statusPage,
      monitorsOnStatusPage,
      monitorsInGroup,
    };
  }

  private async getStatusPageAnnouncementAttachment(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const statusPageIdParam: string | undefined = req.params["statusPageId"];
    const announcementIdParam: string | undefined =
      req.params["announcementId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (!statusPageIdParam || !announcementIdParam || !fileIdParam) {
      throw new NotFoundException("Attachment not found");
    }

    let statusPageId: ObjectID;
    let announcementId: ObjectID;
    let fileId: ObjectID;

    try {
      statusPageId = new ObjectID(statusPageIdParam);
      announcementId = new ObjectID(announcementIdParam);
      fileId = new ObjectID(fileIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        showAnnouncementsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !statusPage ||
      !statusPage.projectId ||
      !statusPage.showAnnouncementsOnStatusPage
    ) {
      throw new NotFoundException("Attachment not found");
    }

    const announcement: StatusPageAnnouncement | null =
      await StatusPageAnnouncementService.findOneBy({
        query: {
          _id: announcementId.toString(),
          projectId: statusPage.projectId!,
          statusPages: [statusPageId] as any,
        },
        select: {
          attachments: {
            _id: true,
            file: true,
            fileType: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!announcement) {
      throw new NotFoundException("Attachment not found");
    }

    const attachment: File | undefined = announcement.attachments?.find(
      (file: File) => {
        const attachmentId: string | null = file._id
          ? file._id.toString()
          : file.id
            ? file.id.toString()
            : null;
        return attachmentId === fileId.toString();
      },
    );

    if (!attachment || !attachment.file) {
      throw new NotFoundException("Attachment not found");
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }

  private async getScheduledMaintenancePublicNoteAttachment(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const statusPageIdParam: string | undefined = req.params["statusPageId"];
    const scheduledMaintenanceIdParam: string | undefined =
      req.params["scheduledMaintenanceId"];
    const noteIdParam: string | undefined = req.params["noteId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (
      !statusPageIdParam ||
      !scheduledMaintenanceIdParam ||
      !noteIdParam ||
      !fileIdParam
    ) {
      throw new NotFoundException("Attachment not found");
    }

    let statusPageId: ObjectID;
    let scheduledMaintenanceId: ObjectID;
    let noteId: ObjectID;
    let fileId: ObjectID;

    try {
      statusPageId = new ObjectID(statusPageIdParam);
      scheduledMaintenanceId = new ObjectID(scheduledMaintenanceIdParam);
      noteId = new ObjectID(noteIdParam);
      fileId = new ObjectID(fileIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !statusPage ||
      !statusPage.projectId ||
      !statusPage.showScheduledMaintenanceEventsOnStatusPage
    ) {
      throw new NotFoundException("Attachment not found");
    }

    const scheduledMaintenance: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneBy({
        query: {
          _id: scheduledMaintenanceId.toString(),
          projectId: statusPage.projectId!,
          isVisibleOnStatusPage: true,
          statusPages: statusPageId as any,
        },
        select: {
          _id: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenance) {
      throw new NotFoundException("Attachment not found");
    }

    const scheduledMaintenancePublicNote: ScheduledMaintenancePublicNote | null =
      await ScheduledMaintenancePublicNoteService.findOneBy({
        query: {
          _id: noteId.toString(),
          scheduledMaintenanceId: scheduledMaintenanceId.toString(),
          projectId: statusPage.projectId!,
        },
        select: {
          attachments: {
            _id: true,
            file: true,
            fileType: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!scheduledMaintenancePublicNote) {
      throw new NotFoundException("Attachment not found");
    }

    const attachment: File | undefined =
      scheduledMaintenancePublicNote.attachments?.find((file: File) => {
        const attachmentId: string | null = file._id
          ? file._id.toString()
          : file.id
            ? file.id.toString()
            : null;
        return attachmentId === fileId.toString();
      });

    if (!attachment || !attachment.file) {
      throw new NotFoundException("Attachment not found");
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }

  private async getIncidentPublicNoteAttachment(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const statusPageIdParam: string | undefined = req.params["statusPageId"];
    const incidentIdParam: string | undefined = req.params["incidentId"];
    const noteIdParam: string | undefined = req.params["noteId"];
    const fileIdParam: string | undefined = req.params["fileId"];

    if (
      !statusPageIdParam ||
      !incidentIdParam ||
      !noteIdParam ||
      !fileIdParam
    ) {
      throw new NotFoundException("Attachment not found");
    }

    let statusPageId: ObjectID;
    let incidentId: ObjectID;
    let noteId: ObjectID;
    let fileId: ObjectID;

    try {
      statusPageId = new ObjectID(statusPageIdParam);
      incidentId = new ObjectID(incidentIdParam);
      noteId = new ObjectID(noteIdParam);
      fileId = new ObjectID(fileIdParam);
    } catch {
      throw new NotFoundException("Attachment not found");
    }

    await this.checkHasReadAccess({
      statusPageId: statusPageId,
      req: req,
    });

    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        showIncidentsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage || !statusPage.projectId) {
      throw new NotFoundException("Attachment not found");
    }

    if (!statusPage.showIncidentsOnStatusPage) {
      throw new NotFoundException("Attachment not found");
    }

    const { monitorsOnStatusPage } =
      await StatusPageService.getMonitorIdsOnStatusPage({
        statusPageId: statusPageId,
      });

    if (!monitorsOnStatusPage || monitorsOnStatusPage.length === 0) {
      throw new NotFoundException("Attachment not found");
    }

    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: incidentId.toString(),
        projectId: statusPage.projectId!,
        isVisibleOnStatusPage: true,
        monitors: monitorsOnStatusPage as any,
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!incident) {
      throw new NotFoundException("Attachment not found");
    }

    const incidentPublicNote: IncidentPublicNote | null =
      await IncidentPublicNoteService.findOneBy({
        query: {
          _id: noteId.toString(),
          incidentId: incidentId.toString(),
          projectId: statusPage.projectId!,
        },
        select: {
          attachments: {
            _id: true,
            file: true,
            fileType: true,
            name: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    if (!incidentPublicNote) {
      throw new NotFoundException("Attachment not found");
    }

    const attachment: File | undefined = incidentPublicNote.attachments?.find(
      (file: File) => {
        const attachmentId: string | null = file._id
          ? file._id.toString()
          : file.id
            ? file.id.toString()
            : null;
        return attachmentId === fileId.toString();
      },
    );

    if (!attachment || !attachment.file) {
      throw new NotFoundException("Attachment not found");
    }

    Response.setNoCacheHeaders(res);
    return Response.sendFileResponse(req, res, attachment);
  }

  public async checkHasReadAccess(data: {
    statusPageId: ObjectID;
    req: ExpressRequest;
  }): Promise<void> {
    const accessResult: {
      hasReadAccess: boolean;
      error?: NotAuthenticatedException | ForbiddenException;
    } = await this.service.hasReadAccess({
      statusPageId: data.statusPageId,
      req: data.req,
    });

    if (!accessResult.hasReadAccess) {
      throw (
        accessResult.error ||
        new NotAuthenticatedException(
          "You are not authenticated to access this status page",
        )
      );
    }
  }
}
