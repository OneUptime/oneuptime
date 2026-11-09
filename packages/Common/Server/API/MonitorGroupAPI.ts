import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorGroupService, {
  Service as MonitorGroupServiceType,
} from "../Services/MonitorGroupService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import MonitorGroup from "../../Models/DatabaseModels/MonitorGroup";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringChange,
  MonitorGroupMonitoringSummary,
} from "../../Utils/Monitor/MonitorGroupMonitoring";

export default class MonitorGroupAPI extends BaseAPI<
  MonitorGroup,
  MonitorGroupServiceType
> {
  public constructor() {
    super(MonitorGroup, MonitorGroupService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/current-status/:monitorGroupId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          // get group id.

          if (!req.params["monitorGroupId"]) {
            throw new BadDataException("Monitor group id is required.");
          }

          const currentStatus: MonitorStatus =
            await this.service.getCurrentStatus(
              new ObjectID(req.params["monitorGroupId"].toString()),
              await CommonAPI.getDatabaseCommonInteractionProps(req),
            );

          return Response.sendEntityResponse(
            req,
            res,
            currentStatus,
            MonitorStatus,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/timeline/:monitorGroupId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          // get group id.

          if (!req.params["monitorGroupId"]) {
            throw new BadDataException("Monitor group id is required.");
          }

          const startDate: Date = OneUptimeDate.getSomeDaysAgo(90);
          const endDate: Date = OneUptimeDate.getCurrentDate();

          const timeline: Array<MonitorStatusTimeline> =
            await this.service.getStatusTimeline(
              new ObjectID(req.params["monitorGroupId"].toString()),
              startDate,
              endDate,
              await CommonAPI.getDatabaseCommonInteractionProps(req),
            );

          return Response.sendEntityArrayResponse(
            req,
            res,
            timeline,
            timeline.length,
            MonitorStatusTimeline,
          );
        } catch (err) {
          next(err);
        }
      },
    );

    /*
     * Monitoring for every monitor in the group (issue #6401): how many of
     * its monitors are checked, and turning monitoring off or on for all of
     * them at once. See MonitorGroupService.setMonitoringForMonitorsInGroup:
     * the switch is the caller's own update of the monitors.
     */
    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/monitoring-summary/:monitorGroupId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const summary: MonitorGroupMonitoringSummary =
            await this.service.getMonitoringSummary(
              MonitorGroupAPI.getMonitorGroupId(req),
              await CommonAPI.getDatabaseCommonInteractionProps(req),
            );

          return Response.sendJsonObjectResponse(
            req,
            res,
            MonitorGroupMonitoring.toJSON(summary),
          );
        } catch (err) {
          next(err);
        }
      },
    );

    for (const route of [
      { path: "turn-monitoring-off", isMonitoringOn: false },
      { path: "turn-monitoring-on", isMonitoringOn: true },
    ]) {
      this.router.post(
        `${new this.entityType()
          .getCrudApiPath()
          ?.toString()}/${route.path}/:monitorGroupId`,
        UserMiddleware.getUserMiddleware,
        async (
          req: ExpressRequest,
          res: ExpressResponse,
          next: NextFunction,
        ) => {
          try {
            const change: MonitorGroupMonitoringChange =
              await this.service.setMonitoringForMonitorsInGroup({
                monitorGroupId: MonitorGroupAPI.getMonitorGroupId(req),
                isMonitoringOn: route.isMonitoringOn,
                props: await CommonAPI.getDatabaseCommonInteractionProps(req),
              });

            return Response.sendJsonObjectResponse(
              req,
              res,
              MonitorGroupMonitoring.toJSON(change),
            );
          } catch (err) {
            next(err);
          }
        },
      );
    }
  }

  private static getMonitorGroupId(req: ExpressRequest): ObjectID {
    if (!req.params["monitorGroupId"]) {
      throw new BadDataException("Monitor group id is required.");
    }

    return new ObjectID(req.params["monitorGroupId"].toString());
  }
}
