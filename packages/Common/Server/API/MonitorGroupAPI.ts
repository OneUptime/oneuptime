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
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { MonitorGroupUptimeSummary } from "../../Types/Monitor/MonitorGroupUptimeSummary";
import ObjectID from "../../Types/ObjectID";
import MonitorGroup from "../../Models/DatabaseModels/MonitorGroup";
import MonitorStatus from "../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import MonitorGroupMonitoring, {
  MonitorGroupMonitoringChange,
  MonitorGroupMonitoringSummary,
} from "../../Utils/Monitor/MonitorGroupMonitoring";
import MonitorGroupUptimeSummaryUtil from "../../Utils/Monitor/MonitorGroupUptimeSummaryUtil";
import MonitorUptimeSummaryUtil from "../../Utils/Monitor/MonitorUptimeSummaryUtil";
import ServerProductRoutes from "../Utils/ServerProducts/ServerProductRoutes";
import ProductKey from "../../Types/Product/ProductKey";

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
     * GET /monitor-group/uptime-summary/:monitorGroupId?timezone=<IANA zone>
     *
     * The Dashboard's monitor group page: the group's 90 days, cut in the
     * zone the user reads times in, and its uptime over them, measured by
     * the database from every row (MonitorGroupService.getUptimeSummary,
     * issue #6886). The timeline route above returns the group's rows under
     * one 10,000 row cap, oldest first, which on a flapping group drops its
     * newest days.
     *
     * The summary runs as root, so the route applies what reading the
     * group's history takes, before anything is read:
     *
     *   1. an authenticated member of the tenant (401 / 400 / 422),
     *   2. a valid group id and time zone (400),
     *   3. an Allow grant to read status timelines, and no team BLOCK on it,
     *   4. the group read with the CALLER's props (table and label rules),
     *      and it must belong to the tenant - a group they cannot see, or
     *      another project's, is refused with the same message.
     *
     * Its monitors are read as OneUptime, as the timeline route reads them:
     * whoever may see the group sees its history.
     */
    this.router.get(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/uptime-summary/:monitorGroupId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          ObjectID.validateUUID(req.params["monitorGroupId"] as string);

          const monitorGroupId: ObjectID = new ObjectID(
            req.params["monitorGroupId"] as string,
          );

          const timezone: string = MonitorUptimeSummaryUtil.parseTimezone(
            req.query["timezone"],
          );

          CommonAPI.assertCanReadTable({
            modelType: MonitorStatusTimeline,
            props: databaseProps,
            errorMessage:
              "You do not have permission to read this monitor group's status history.",
          });

          const monitorGroup: MonitorGroup | null =
            await this.service.findOneById({
              id: monitorGroupId,
              select: {
                _id: true,
                projectId: true,
              },
              props: databaseProps,
            });

          // A null group is refused with the same message as a foreign one.
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: monitorGroup?.projectId,
            projectId: projectId,
          });

          const summary: MonitorGroupUptimeSummary =
            await this.service.getUptimeSummary({
              monitorGroupId: monitorGroupId,
              projectId: projectId,
              timezone: timezone,
              now: OneUptimeDate.getCurrentDate(),
            });

          // A day is cut on now: a copy replayed from a cache would be stale.
          Response.setNoCacheHeaders(res);

          return Response.sendJsonObjectResponse(
            req,
            res,
            MonitorGroupUptimeSummaryUtil.toJSON(summary),
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
        ServerProductRoutes.refuseWhileOff(ProductKey.Monitors),
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
