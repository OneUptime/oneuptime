import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import PublicNoteReach, {
  PublicNoteReachEvent,
  PublicNoteReachResult,
} from "../../Types/StatusPage/PublicNoteReach";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import PublicNoteReachBuilder from "../Utils/StatusPage/PublicNoteReachBuilder";
import CommonAPI from "./CommonAPI";

/*
 * POST /<event>/public-note-reach: whether a public note posted now on an
 * incident, an episode or a maintenance event is on a status page, and
 * whether it notifies anyone - or why not (Types/StatusPage/PublicNoteReach,
 * Server/Utils/StatusPage/PublicNoteReachBuilder). The note composer says it
 * beside "Public" and under "Notify status page subscribers".
 *
 * Registered by each event's API on its own router, behind the same guards
 * as the subscriber audience and the owner rule preview beside it: a request
 * with no session is answered 401, so an idle tab refreshes it rather than
 * showing an error. The project is the request's tenant; a project API key
 * is admitted like a member, its permissions deciding.
 */
export default class PublicNoteReachRoute {
  public static register(data: {
    router: ExpressRouter;
    // The event API's own path, "/incident".
    apiPath: string;
    event: PublicNoteReachEvent;
  }): void {
    data.router.post(
      `${data.apiPath}${PublicNoteReach.routePath}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await PublicNoteReachRoute.handle(req, res, data.event);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
    event: PublicNoteReachEvent,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    const eventId: ObjectID = PublicNoteReachBuilder.parseEventId(req.body);

    // Whoever may post or edit this event's public notes, decided for it.
    await PublicNoteReachBuilder.assertCallerMayAsk({
      projectId: projectId,
      props: props,
      event: event,
      eventId: eventId,
    });

    const result: PublicNoteReachResult = await PublicNoteReachBuilder.build({
      projectId: projectId,
      props: props,
      event: event,
      eventId: eventId,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      PublicNoteReach.toJSON(result),
    );
  }
}
