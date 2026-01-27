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
                  description: true,
                },
                triggeredByAlertId: true,
                triggeredByAlert: {
                  title: true,
                  description: true,
                },
                triggeredByAlertEpisodeId: true,
                triggeredByAlertEpisode: {
                  title: true,
                  description: true,
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

          const notificationType: string = timelineItem.triggeredByIncidentId
            ? "Incident"
            : timelineItem.triggeredByAlertEpisodeId
              ? "Alert Episode"
              : "Alert";

          const notificationTitle: string =
            timelineItem.triggeredByIncident?.title ||
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
                triggeredByAlert: {
                  title: true,
                },
                triggeredByIncident: {
                  title: true,
                },
                triggeredByAlertEpisode: {
                  title: true,
                },
                acknowledgedAt: true,
                isAcknowledged: true,
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

          // Determine the resource type and ID for routing
          type ResourceInfo = {
            type: string;
            path: string;
            id: ObjectID;
            title: string;
          };

          const getResourceInfo: () => ResourceInfo = (): ResourceInfo => {
            if (timelineItem.triggeredByIncidentId) {
              return {
                type: "Incident",
                path: "incidents",
                id: timelineItem.triggeredByIncidentId,
                title: timelineItem.triggeredByIncident?.title || "",
              };
            }
            if (timelineItem.triggeredByAlertEpisodeId) {
              return {
                type: "Alert Episode",
                path: "alert-episodes",
                id: timelineItem.triggeredByAlertEpisodeId,
                title: timelineItem.triggeredByAlertEpisode?.title || "",
              };
            }
            if (timelineItem.triggeredByAlertId) {
              return {
                type: "Alert",
                path: "alerts",
                id: timelineItem.triggeredByAlertId,
                title: timelineItem.triggeredByAlert?.title || "",
              };
            }
            return { type: "", path: "", id: new ObjectID(""), title: "" };
          };

          const resourceInfo: ResourceInfo = getResourceInfo();

          if (timelineItem.isAcknowledged) {
            // already acknowledged. Then show already acknowledged page with view details button.

            const viewDetailsRoute: Route = new Route(
              DashboardRoute.toString(),
            ).addRoute(
              `/${timelineItem.projectId?.toString()}/${resourceInfo.path}/${resourceInfo.id.toString()}`,
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
                title: `Notification Already Acknowledged - ${resourceInfo.title}`,
                message: `This notification has already been acknowledged.`,
                viewDetailsText: `View ${resourceInfo.type}`,
                viewDetailsUrl: viewDetailsUrl.toString(),
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
          if (resourceInfo.path) {
            const resourceRoute: Route = new Route(
              DashboardRoute.toString(),
            ).addRoute(
              `/${timelineItem.projectId?.toString()}/${resourceInfo.path}/${resourceInfo.id.toString()}`,
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
