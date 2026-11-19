import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "../../Types/StatusPage/AnnouncementReach";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import AnnouncementReachBuilder, {
  AnnouncementReachRequest,
} from "../Utils/StatusPage/AnnouncementReachBuilder";
import CommonAPI from "./CommonAPI";

/*
 * POST /status-page-announcement/reach: whether an announcement on the
 * status pages picked on its form shows on one of them, and whether it
 * notifies anyone - or why not (Types/StatusPage/AnnouncementReach,
 * Server/Utils/StatusPage/AnnouncementReachBuilder). Create Announcement's
 * Schedule & Notifications line says it, and the announcement's Edit
 * (#9775).
 *
 * A POST because the pages picked travel in the body. Behind the same
 * guards as the public note reach beside it (PublicNoteReachRoute): a
 * request with no session is answered 401, so an idle tab refreshes it
 * rather than showing an error. The project is the request's tenant; a
 * project API key is admitted like a member, its permissions deciding, and
 * who may ask is decided for the announcement (AnnouncementReachBuilder).
 */
export default class AnnouncementReachRoute {
  public static register(data: {
    router: ExpressRouter;
    // The announcement API's own path, "/status-page-announcement".
    apiPath: string;
  }): void {
    data.router.post(
      `${data.apiPath}${AnnouncementReach.routePath}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await AnnouncementReachRoute.handle(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    const request: AnnouncementReachRequest =
      AnnouncementReachBuilder.parseRequest(req.body);

    const result: AnnouncementReachResult =
      await AnnouncementReachBuilder.build({
        projectId: projectId,
        props: props,
        request: request,
      });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(
      req,
      res,
      AnnouncementReach.toJSON(result),
    );
  }
}
