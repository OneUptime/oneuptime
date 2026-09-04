import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";
import UserMiddleware from "../Middleware/UserAuthorization";
import RoutineEmailSettingsService from "../Services/RoutineEmailSettingsService";
import UserNotificationSettingService, {
  Service as UserNotificationSettingServiceType,
} from "../Services/UserNotificationSettingService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import Response from "../Utils/Response";
import UserNotificationSetting from "../../Models/DatabaseModels/UserNotificationSetting";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ROUTINE_EMAIL_EVENT_TYPES } from "../../Types/NotificationSetting/RoutineEmailEvents";
import ObjectID from "../../Types/ObjectID";

export default class UserNotificationSettingAPI extends BaseAPI<
  UserNotificationSetting,
  UserNotificationSettingServiceType
> {
  public constructor() {
    super(UserNotificationSetting, UserNotificationSettingService);

    this.router.post(
      "/user-notification-setting/reduce-routine-emails",
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          const props: DatabaseCommonInteractionProps =
            await CommonAPI.getDatabaseCommonInteractionProps(req);
          const projectId: ObjectID =
            CommonAPI.assertAuthenticatedProjectMember(props);

          /*
           * The model grants CurrentUser access. A member may change their own
           * settings, regardless of role, and may never select another user.
           */
          await RoutineEmailSettingsService.reduceRoutineEmails({
            userId: props.userId!,
            projectId: projectId,
          });

          return Response.sendJsonObjectResponse(req, res, {
            success: true,
            routineEventTypeCount: ROUTINE_EMAIL_EVENT_TYPES.length,
          });
        } catch (err) {
          next(err);
        }
      },
    );
  }
}
