import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "../../Types/StatusPage/AnnouncementReach";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
} from "../Utils/Express";
import AnnouncementReachBuilder from "../Utils/StatusPage/AnnouncementReachBuilder";
import PickedStatusPagesReachRoute from "./PickedStatusPagesReachRoute";

/*
 * POST /status-page-announcement/reach: whether an announcement on the
 * status pages picked on its form shows on one of them, and whether it
 * notifies anyone - or why not (Types/StatusPage/AnnouncementReach,
 * Server/Utils/StatusPage/AnnouncementReachBuilder). Create Announcement's
 * Schedule & Notifications line says it, and the announcement's Edit
 * (#9775), whose answer adds where the announcement's own notification
 * stands (#9921).
 *
 * The route every form that picks status pages asks
 * (PickedStatusPagesReachRoute): a POST, behind the session guards, in the
 * request's project, never cached. Who may ask is decided for the
 * announcement (AnnouncementReachBuilder).
 */
export default class AnnouncementReachRoute {
  public static register(data: {
    router: ExpressRouter;
    // The announcement API's own path, "/status-page-announcement".
    apiPath: string;
  }): void {
    PickedStatusPagesReachRoute.register({
      router: data.router,
      apiPath: data.apiPath,
      answer: AnnouncementReachRoute.answer,
    });
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    return PickedStatusPagesReachRoute.handle(
      req,
      res,
      AnnouncementReachRoute.answer,
    );
  }

  private static async answer(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    body: unknown;
  }): Promise<JSONObject> {
    const result: AnnouncementReachResult =
      await AnnouncementReachBuilder.build({
        projectId: data.projectId,
        props: data.props,
        request: AnnouncementReachBuilder.parseRequest(data.body),
      });

    return AnnouncementReach.toJSON(result);
  }
}
