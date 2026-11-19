import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "../../Types/StatusPage/PickedStatusPagesReach";
import UserMiddleware from "../Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import PickedStatusPagesReachBuilder, {
  PickedStatusPagesRecordKind,
} from "../Utils/StatusPage/PickedStatusPagesReachBuilder";
import CommonAPI from "./CommonAPI";

/*
 * POST /<record>/reach: whether a record on the status pages picked on its
 * form shows on one of them, and whether it notifies anyone - or why not
 * (Types/StatusPage/PickedStatusPagesReach, Server/Utils/StatusPage
 * /PickedStatusPagesReachBuilder). Create Announcement's Schedule &
 * Notifications line says it (#9775, AnnouncementReachRoute), and Schedule
 * Maintenance Event's and a maintenance template's Subscriber
 * Notifications (#9920).
 *
 * A POST because the pages picked travel in the body. Behind the same
 * guards as the public note reach beside it (PublicNoteReachRoute): a
 * request with no session is answered 401, so an idle tab refreshes it
 * rather than showing an error. The project is the request's tenant; a
 * project API key is admitted like a member, its permissions deciding, and
 * who may ask is decided for the record (PickedStatusPagesReachBuilder).
 */

// What a route answers, from the request's project, caller and body.
export type PickedStatusPagesReachAnswer = (data: {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  body: unknown;
}) => Promise<JSONObject>;

export default class PickedStatusPagesReachRoute {
  public static register(data: {
    router: ExpressRouter;
    // The record API's own path, "/scheduled-maintenance".
    apiPath: string;
    answer: PickedStatusPagesReachAnswer;
  }): void {
    data.router.post(
      `${data.apiPath}${PickedStatusPagesReach.routePath}`,
      UserMiddleware.getUserMiddleware,
      UserMiddleware.requireUserAuthentication,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await PickedStatusPagesReachRoute.handle(req, res, data.answer);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  public static async handle(
    req: ExpressRequest,
    res: ExpressResponse,
    answer: PickedStatusPagesReachAnswer,
  ): Promise<void> {
    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const projectId: ObjectID = CommonAPI.assertTenantScoped(props);

    const json: JSONObject = await answer({
      projectId: projectId,
      props: props,
      body: req.body,
    });

    Response.setNoCacheHeaders(res);

    return Response.sendJsonObjectResponse(req, res, json);
  }

  /*
   * The answer for a kind of record whose answer is the pages' alone: a
   * maintenance event's, a maintenance template's.
   */
  public static answerFor<TModel extends BaseModel>(
    kind: PickedStatusPagesRecordKind<TModel>,
  ): PickedStatusPagesReachAnswer {
    return async (data: {
      projectId: ObjectID;
      props: DatabaseCommonInteractionProps;
      body: unknown;
    }): Promise<JSONObject> => {
      const result: PickedStatusPagesReachResult =
        await PickedStatusPagesReachBuilder.build({
          projectId: data.projectId,
          props: data.props,
          request: PickedStatusPagesReachBuilder.parseRequest(data.body, kind),
          kind: kind,
        });

      return PickedStatusPagesReach.toJSON(result);
    };
  }
}
