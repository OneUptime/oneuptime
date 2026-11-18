import UserMiddleware from "../Middleware/UserAuthorization";
import Express, {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import ProjectCanSendReader from "../Utils/ServerSending/ProjectCanSendReader";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  PROJECT_CAN_SEND_API_PATH,
  ProjectCanSendAnswer,
} from "../../Types/ServerSending/ProjectCanSend";

/*
 * GET /project-can-send (Types/ServerSending/ProjectCanSend, #7151, #6880):
 * whether a page can reach this project's people by email, SMS and call -
 * three yes-or-noes, for the guided on-call setup, Notification Methods and
 * Notification Channels to say so before anyone types a number.
 *
 * A signed-in member of the project in the tenantid header, and nobody
 * else. Never what is missing, what a provider said or any setting: those
 * are the server's admins' (GET /global-config/sending-status, master admins
 * only). A read only: one settings row, and the project's default Twilio
 * configs while the server's own cannot send.
 *
 * A bare router, as OnCallReadinessAPI is: it reads no single model's CRUD
 * routes.
 */

const router: ExpressRouter = Express.getRouter();

router.get(
  PROJECT_CAN_SEND_API_PATH,
  UserMiddleware.getUserMiddleware,
  async (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      const projectId: ObjectID =
        CommonAPI.assertAuthenticatedProjectMember(props);

      const answer: ProjectCanSendAnswer =
        await ProjectCanSendReader.read(projectId);

      Response.setNoCacheHeaders(res);

      return Response.sendJsonObjectResponse(req, res, {
        email: answer.email,
        sms: answer.sms,
        call: answer.call,
      } as JSONObject);
    } catch (err) {
      next(err);
    }
  },
);

export default router;
