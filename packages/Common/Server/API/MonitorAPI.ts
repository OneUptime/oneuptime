import UserMiddleware from "../Middleware/UserAuthorization";
import MonitorService, {
  Service as MonitorServiceType,
} from "../Services/MonitorService";
import MonitorStatusTimelineService from "../Services/MonitorStatusTimelineService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Monitor from "../../Models/DatabaseModels/Monitor";
import MonitorStatusTimeline from "../../Models/DatabaseModels/MonitorStatusTimeline";
import OneUptimeDate from "../../Types/Date";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import { MonitorUptimeSummary } from "../../Types/Monitor/MonitorUptimeSummary";
import ObjectID from "../../Types/ObjectID";
import MonitorUptimeSummaryUtil from "../../Utils/Monitor/MonitorUptimeSummaryUtil";

export default class MonitorAPI extends BaseAPI<Monitor, MonitorServiceType> {
  public constructor() {
    super(Monitor, MonitorService);

    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/refresh-status/:monitorId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          /*
           * getUserMiddleware lets unauthenticated requests through as
           * "public", and refreshMonitorCurrentStatus reads and writes the
           * monitor as root. Require an authenticated member of the
           * monitor's own project — the caller-supplied tenant says nothing
           * about which project the monitor id in the path belongs to.
           */
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          const monitorId: ObjectID = new ObjectID(
            req.params["monitorId"] as string,
          );

          const monitor: Monitor | null = await MonitorService.findOneById({
            id: monitorId,
            select: {
              projectId: true,
            },
            props: {
              isRoot: true,
            },
          });

          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: monitor?.projectId,
            projectId: projectId,
          });

          await MonitorService.refreshMonitorCurrentStatus(monitorId);
          return Response.sendEmptySuccessResponse(req, res);
        } catch (e) {
          next(e);
        }
      },
    );

    /*
     * GET /monitor/uptime-summary/:monitorId?timezone=<IANA zone>
     *
     * The monitor overview's uptime bars and rolling windows, as a server
     * aggregate (see Types/Monitor/MonitorUptimeSummary.ts for why the page
     * no longer adds up raw timeline rows itself).
     *
     * The aggregate runs as root, so this route has to make every check the
     * CRUD read of MonitorStatusTimeline would have made, and in an order
     * that reads nothing before the caller has passed the checks that come
     * before it:
     *
     * 1. an authenticated member of the project named in the tenant header;
     * 2. a well-formed monitor id and time zone;
     * 3. an Allow grant to read timelines and no team BLOCK on it. A caller
     *    who can read monitors but not their history stops here;
     * 4. the monitor read with the CALLER's props, so the table, label and
     *    owned-scope rules on Monitor apply. A monitor the caller cannot see
     *    and one that does not exist give the same refusal;
     * 5. a timeline read with the caller's props, because MonitorStatusTimeline
     *    carries its own owned scope. When that read is empty, a root read
     *    tells "the caller's scope hides the rows" apart from "there are no
     *    rows yet". The first is refused; the second is answered with empty
     *    coverage.
     *
     * Step 5 does tell a caller who can read the monitor, but not its
     * history, whether any history exists. That is the one bit it gives
     * away, and it is harmless: every monitor gets its first timeline row
     * when it is created, so the answer is "yes" for nearly every monitor
     * the caller can already see.
     */
    this.router.get(
      `${new this.entityType().getCrudApiPath()?.toString()}/uptime-summary/:monitorId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const databaseProps: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(databaseProps);

          ObjectID.validateUUID(req.params["monitorId"] as string);

          const monitorId: ObjectID = new ObjectID(
            req.params["monitorId"] as string,
          );

          const timezone: string = MonitorUptimeSummaryUtil.parseTimezone(
            req.query["timezone"],
          );

          CommonAPI.assertCanReadTable({
            modelType: MonitorStatusTimeline,
            props: databaseProps,
            errorMessage:
              "You do not have permission to read this monitor's status history.",
          });

          const monitor: Monitor | null = await MonitorService.findOneById({
            id: monitorId,
            select: {
              _id: true,
              projectId: true,
            },
            props: databaseProps,
          });

          // A null monitor is refused with the same message as a foreign one.
          CommonAPI.assertResourceBelongsToProject({
            resourceProjectId: monitor?.projectId,
            projectId: projectId,
          });

          const visibleRow: MonitorStatusTimeline | null =
            await MonitorStatusTimelineService.findOneBy({
              query: {
                monitorId: monitorId,
                projectId: projectId,
              },
              select: {
                _id: true,
              },
              props: databaseProps,
            });

          if (!visibleRow) {
            const anyRow: MonitorStatusTimeline | null =
              await MonitorStatusTimelineService.findOneBy({
                query: {
                  monitorId: monitorId,
                  projectId: projectId,
                },
                select: {
                  _id: true,
                },
                props: {
                  isRoot: true,
                },
              });

            if (anyRow) {
              throw new NotAuthorizedException(
                "You are not authorized to access this project's data.",
              );
            }
          }

          const summary: MonitorUptimeSummary =
            await MonitorStatusTimelineService.getMonitorUptimeSummary({
              monitorId: monitorId,
              projectId: projectId,
              timezone: timezone,
              now: OneUptimeDate.getCurrentDate(),
            });

          return Response.sendJsonObjectResponse(
            req,
            res,
            MonitorUptimeSummaryUtil.toJSON(summary),
          );
        } catch (e) {
          next(e);
        }
      },
    );
  }
}
