import UserUtil from "./User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";

export default abstract class LoginUtil {
  public static login(value: {
    user: JSONObject | StatusPagePrivateUser;
  }): void {
    const user: StatusPagePrivateUser = BaseModel.fromJSON(
      value.user,
      StatusPagePrivateUser,
    ) as StatusPagePrivateUser;

    const statusPageId: ObjectID = user.statusPageId!;

    UserUtil.setEmail(statusPageId, user.email as Email);
    UserUtil.setUserId(statusPageId, user.id as ObjectID);
  }
}
