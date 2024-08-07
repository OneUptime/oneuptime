import UserUtil from "./User";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "Common/Types/API/Route";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Cookie from "CommonUI/src/Utils/Cookie";
import StatusPagePrivateUser from "Common/Models/DatabaseModels/StatusPagePrivateUser";

export default abstract class LoginUtil {
  public static login(value: JSONObject): void {
    const user: StatusPagePrivateUser = BaseModel.fromJSON(
      value["user"] as JSONObject,
      StatusPagePrivateUser,
    ) as StatusPagePrivateUser;

    const statusPageId: ObjectID = user.statusPageId!;

    UserUtil.setEmail(statusPageId, user.email as Email);
    UserUtil.setUserId(statusPageId, user.id as ObjectID);
    if (value && value["token"]) {
      // set token as cookie.
      Cookie.setItem("user-token-" + statusPageId.toString(), value["token"], {
        path: new Route("/"),
        maxAgeInDays: 30,
      });
    }
  }
}
