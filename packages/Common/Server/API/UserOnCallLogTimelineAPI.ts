import DatabaseConfig from "../DatabaseConfig";
import NotificationMiddleware from "../Middleware/NotificationMiddleware";
import UserOnCallLogTimelineService, {
  Service as UserNotificationLogTimelineServiceType,
} from "../Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import { AppApiRoute, DashboardRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import UserNotificationStatus from "../../Types/UserNotification/UserNotificationStatus";
import UserOnCallLogTimeline from "../../Models/DatabaseModels/UserOnCallLogTimeline";
import Route from "../../Types/API/Route";
import {
  OnCallNotificationContext,
  OnCallNotificationResourceReference,
  detailsToJSON,
  getOnCallNotificationContext,
  getResourceReference,
} from "../Utils/OnCallNotificationContext";

export default class UserNotificationLogTimelineAPI extends BaseAPI<
  UserOnCallLogTimeline,
  UserNotificationLogTimelineServiceType
> {
  public constructor() {
    super(UserOnCallLogTimeline, UserOnCallLogTimelineService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/call/gather-input/:itemId`,
      NotificationMiddleware.isValidCallNotificationRequest,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.params["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item ID"),
            );
          }

          const token: JSONObject = (req as any).callTokenData;

          const itemId: ObjectID = new ObjectID(req.params["itemId"]);

          const timelineItem: UserOnCallLogTimeline | null =
            await this.service.findOneById({
              id: itemId,
              select: {
                _id: true,
                projectId: true,
                triggeredByIncidentId: true,
                triggeredByAlertId: true,
              },
              props: {
                isRoot: true,
              },
            });

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          // check digits.

          if (req.body["Digits"] === "1") {
            // then ack incident
            await this.service.updateOneById({
              id: itemId,
              data: {
                acknowledgedAt: OneUptimeDate.getCurrentDate(),
                isAcknowledged: true,
                status: UserNotificationStatus.Acknowledged,
                statusMessage: "Notification Acknowledged",
              },
              props: {
                isRoot: true,
              },
            });
          }

          return NotificationMiddleware.sendResponse(req, res, token as any);
        } catch (error) {
          return next(error);
        }
      },
    );

    /*
     * We have this ack page to show the user a confirmation page before acknowledging the notification.
     * this is because email clients automatically make a get request to the url in the email and ack the notification automatically which is not what we want.
     * so we need to create this page for the user to confirm that they want to acknowledge the notification.
     */
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/acknowledge-page/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.params["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item ID is required"),
            );
          }

          const itemId: ObjectID = new ObjectID(req.params["itemId"]);

          const timelineItem: UserOnCallLogTimeline | null =
            await this.service.findOneById({
              id: itemId,
              select: {
                _id: true,
                projectId: true,
                triggeredByIncidentId: true,
                triggeredByIncident: {
                  title: true,
                },
                triggeredByAlertId: true,
                triggeredByAlert: {
                  title: true,
                },
                triggeredByAlertEpisodeId: true,
                triggeredByAlertEpisode: {
                  title: true,
                },
                triggeredByIncidentEpisodeId: true,
                triggeredByIncidentEpisode: {
                  title: true,
                },
                /*
                 * The timestamps below are rendered in the recipient's own
                 * timezone. Formatting them in the container's zone would tell
                 * an on-call engineer nothing.
                 */
                user: {
                  timezone: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          const reference: OnCallNotificationResourceReference | null =
            getResourceReference(timelineItem);

          const notificationType: string = reference
            ? reference.resourceType.toString()
            : "Alert";

          /*
           * The context read is what puts severity, state, project, monitors
           * and the time it was raised on the page. It is best effort on
           * purpose: a deleted resource, or a resource this notification no
           * longer points at, must still leave a page the engineer can
           * acknowledge from.
           */
          const context: OnCallNotificationContext | null =
            await getOnCallNotificationContext({
              timelineItem: timelineItem,
              timezone: timelineItem.user?.timezone?.toString(),
            });

          const notificationTitle: string =
            context?.resourceTitle ||
            timelineItem.triggeredByIncident?.title ||
            timelineItem.triggeredByIncidentEpisode?.title ||
            timelineItem.triggeredByAlertEpisode?.title ||
            timelineItem.triggeredByAlert?.title ||
            "";

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          return Response.render(
            req,
            res,
            "/usr/src/Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
            {
              title: `Acknowledge ${notificationType} - ${notificationTitle}`,
              message: `Do you want to acknowledge this ${notificationType}?`,
              acknowledgeText: `Acknowledge ${notificationType}`,
              acknowledgeUrl: new URL(
                httpProtocol,
                host,
                new Route(AppApiRoute.toString())
                  .addRoute(new UserOnCallLogTimeline().crudApiPath!)
                  .addRoute("/acknowledge/" + itemId.toString()),
              ).toString(),
              resourceNumber: context?.resourceNumber || "",
              resourceTitle: notificationTitle,
              resourceDescription: context?.resourceDescription || "",
              details: detailsToJSON(context?.details || []),
            },
          );
        } catch (error) {
          return next(error);
        }
      },
    );

    // This is the link that actually acknowledges the notification.
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/acknowledge/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          req = req as OneUptimeRequest;

          if (!req.params["itemId"]) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Item ID is required"),
            );
          }

          const itemId: ObjectID = new ObjectID(req.params["itemId"]);

          const timelineItem: UserOnCallLogTimeline | null =
            await this.service.findOneById({
              id: itemId,
              select: {
                _id: true,
                projectId: true,
                triggeredByIncidentId: true,
                triggeredByAlertId: true,
                triggeredByAlertEpisodeId: true,
                triggeredByIncidentEpisodeId: true,
                triggeredByAlert: {
                  title: true,
                },
                triggeredByIncident: {
                  title: true,
                },
                triggeredByAlertEpisode: {
                  title: true,
                },
                triggeredByIncidentEpisode: {
                  title: true,
                },
                acknowledgedAt: true,
                isAcknowledged: true,
                user: {
                  timezone: true,
                },
              },
              props: {
                isRoot: true,
              },
            });

          if (!timelineItem) {
            return Response.sendErrorResponse(
              req,
              res,
              new BadDataException("Invalid item Id"),
            );
          }

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          // Determine the resource type and ID for routing.
          const reference: OnCallNotificationResourceReference | null =
            getResourceReference(timelineItem);

          const fallbackTitle: string =
            timelineItem.triggeredByIncident?.title ||
            timelineItem.triggeredByIncidentEpisode?.title ||
            timelineItem.triggeredByAlertEpisode?.title ||
            timelineItem.triggeredByAlert?.title ||
            "";

          if (timelineItem.isAcknowledged) {
            // already acknowledged. Then show already acknowledged page with view details button.

            /*
             * Same context the acknowledge page shows. Someone who follows the
             * link twice - or whose colleague got there first - still needs to
             * know what the page they are looking at is about.
             */
            const context: OnCallNotificationContext | null =
              await getOnCallNotificationContext({
                timelineItem: timelineItem,
                timezone: timelineItem.user?.timezone?.toString(),
              });

            const acknowledgedTitle: string =
              context?.resourceTitle || fallbackTitle;

            const viewDetailsRoute: Route = new Route(
              DashboardRoute.toString(),
            ).addRoute(
              `/${timelineItem.projectId?.toString()}/${reference?.dashboardPath || ""}/${reference?.resourceId.toString() || ""}`,
            );

            const viewDetailsUrl: URL = new URL(
              httpProtocol,
              host,
              viewDetailsRoute,
            );

            return Response.render(
              req,
              res,
              "/usr/src/Common/Server/Views/ViewMessage.ejs",
              {
                title: `Notification Already Acknowledged - ${acknowledgedTitle}`,
                message: `This notification has already been acknowledged.`,
                viewDetailsText: `View ${reference?.resourceType.toString() || ""}`,
                viewDetailsUrl: viewDetailsUrl.toString(),
                resourceNumber: context?.resourceNumber || "",
                resourceTitle: acknowledgedTitle,
                resourceDescription: context?.resourceDescription || "",
                details: detailsToJSON(context?.details || []),
              },
            );
          }

          await this.service.updateOneById({
            id: itemId,
            data: {
              acknowledgedAt: OneUptimeDate.getCurrentDate(),
              isAcknowledged: true,
              status: UserNotificationStatus.Acknowledged,
              statusMessage: "Notification Acknowledged",
            },
            props: {
              isRoot: true,
            },
          });

          // redirect to dashboard to the resource page.
          if (reference) {
            const resourceRoute: Route = new Route(
              DashboardRoute.toString(),
            ).addRoute(
              `/${timelineItem.projectId?.toString()}/${reference.dashboardPath}/${reference.resourceId.toString()}`,
            );

            return Response.redirect(
              req,
              res,
              new URL(httpProtocol, host, resourceRoute),
            );
          }

          return Response.sendErrorResponse(
            req,
            res,
            new BadDataException("Invalid item Id"),
          );
        } catch (error) {
          return next(error);
        }
      },
    );
  }
}
