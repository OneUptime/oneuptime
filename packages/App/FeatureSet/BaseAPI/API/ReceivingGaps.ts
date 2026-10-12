import BadDataException from "Common/Types/Exception/BadDataException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import CallerPermission from "Common/Server/Utils/Permission/CallerPermission";
import CommonAPI from "Common/Server/API/CommonAPI";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import ReceivingCoverage from "Common/Server/Utils/Telemetry/ReceivingCoverage";
import Metric from "Common/Models/AnalyticsModels/Metric";
import ReceivingGapsUtil, {
  ReceivingGap,
} from "Common/Utils/Telemetry/ReceivingGaps";

/*
 * When OneUptime was not receiving data, for a window a chart shows
 * (issue #2825).
 *
 * The host, Docker host, Podman host and Kubernetes cluster overviews draw
 * availability from the heartbeat their agents send. A stretch with no
 * heartbeat used to read as "down" even when the reason was OneUptime itself
 * restarting, being upgraded, or catching up on its ingest queue. These are
 * those stretches, so the charts can show them as "not monitored" and leave
 * them out of the uptime percentage.
 *
 * The answer is about the OneUptime instance, not about a project's data,
 * but it is only given to someone signed in to a project who may read that
 * project's metrics - the data the gaps explain.
 */

/*
 * The longest window that can be asked about: the longest range the charts
 * offer, with room to spare.
 */
export const MAX_RECEIVING_GAPS_WINDOW_IN_DAYS: number = 400;

function readDate(value: JSONValue | undefined, name: string): Date {
  if (typeof value !== "string" && typeof value !== "number") {
    throw new BadDataException(`${name} is required.`);
  }

  const date: Date = new Date(value);

  if (!Number.isFinite(date.getTime())) {
    throw new BadDataException(`${name} is not a valid date.`);
  }

  return date;
}

export default class ReceivingGapsAPI {
  public getRouter(): ExpressRouter {
    const router: ExpressRouter = Express.getRouter();

    router.post(
      "/receiving-gaps",
      UserMiddleware.getUserMiddleware,
      async (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ): Promise<void> => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);

          CommonAPI.assertCredentialsPresent(props);

          if (!props.tenantId) {
            throw new BadDataException("Project not found in request");
          }

          if (!props.isRoot && !props.isMasterAdmin) {
            if (
              !CallerPermission.holdsModelPermission(props, {
                model: new Metric(),
                operation: "read",
              })
            ) {
              throw new NotAuthorizedException(
                "You do not have permission to read metrics for this project.",
              );
            }
          }

          const body: JSONObject = (req.body || {}) as JSONObject;
          const startsAt: Date = readDate(body["startsAt"], "startsAt");
          const endsAt: Date = readDate(body["endsAt"], "endsAt");

          if (endsAt.getTime() <= startsAt.getTime()) {
            throw new BadDataException("endsAt must be after startsAt.");
          }

          if (
            endsAt.getTime() - startsAt.getTime() >
            MAX_RECEIVING_GAPS_WINDOW_IN_DAYS * 24 * 60 * 60 * 1000
          ) {
            throw new BadDataException(
              `The window can be at most ${MAX_RECEIVING_GAPS_WINDOW_IN_DAYS} days long.`,
            );
          }

          const gaps: Array<ReceivingGap> = await ReceivingCoverage.getGaps({
            startsAt,
            endsAt,
          });

          return Response.sendJsonObjectResponse(req, res, {
            gaps: ReceivingGapsUtil.toJSON(gaps),
          });
        } catch (err) {
          next(err);
        }
      },
    );

    return router;
  }
}
