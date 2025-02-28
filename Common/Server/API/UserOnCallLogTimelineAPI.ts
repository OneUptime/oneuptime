import DatabaseConfig from "../DatabaseConfig";
import NotificationMiddleware from "../Middleware/NotificationMiddleware";
import UserOnCallLogTimelineService, {
  Service as UserNotificationLogTimelineServiceType,
} from "../Services/UserOnCallLogTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  OneUptimeRequest,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import { AppApiRoute, DashboardRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import UserOnCallLogTimeline from "Common/Models/DatabaseModels/UserOnCallLogTimeline";
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
      async (req: ExpressRequest, res: ExpressResponse) => {
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
      },
    );

    // We have this ack page to show the user a confirmation page before acknowledging the notification.
    // this is because email clients automatically make a get request to the url in the email and ack the notification automatically which is not what we want.
    // so we need to create this page for the user to confirm that they want to acknowledge the notification.
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/acknowledge-page/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
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
          : "Alert";

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        return Response.render(
          req,
          res,
          "/usr/src/Common/Server/Views/AcknowledgeUserOnCallNotification.ejs",
          {
            title: `Acknowledge ${notificationType} - ${timelineItem.triggeredByIncident?.title || timelineItem.triggeredByAlert?.title}`,
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
      },
    );

    // This is the link that actually acknowledges the notification.
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/acknowledge/:itemId`,
      async (req: ExpressRequest, res: ExpressResponse) => {
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

        // redirect to dashboard to incidents page.

        const host: Hostname = await DatabaseConfig.getHost();
        const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

        if (timelineItem.triggeredByIncidentId) {
          return Response.redirect(
            req,
            res,
            new URL(
              httpProtocol,
              host,
              DashboardRoute.addRoute(
                `/${timelineItem.projectId?.toString()}/incidents/${timelineItem.triggeredByIncidentId!.toString()}`,
              ),
            ),
          );
        }

        if (timelineItem.triggeredByAlertId) {
          return Response.redirect(
            req,
            res,
            new URL(
              httpProtocol,
              host,
              DashboardRoute.addRoute(
                `/${timelineItem.projectId?.toString()}/alerts/${timelineItem.triggeredByAlertId!.toString()}`,
              ),
            ),
          );
        }

        return Response.sendErrorResponse(
          req,
          res,
          new BadDataException("Invalid item Id"),
        );
      },
    );
  }
}
