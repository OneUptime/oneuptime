import { DASHBOARD_URL } from "../Config";
import Analytics from "../Utils/Analytics";
import Navigation from "../Utils/Navigation";
import UserUtil from "../Utils/User";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Email from "../../Types/Email";
import { JSONObject } from "../../Types/JSON";
import Name from "../../Types/Name";
import ObjectID from "../../Types/ObjectID";
import User from "../../Models/DatabaseModels/User";

export default abstract class LoginUtil {
  public static login(value: JSONObject): void {
    const user: User = BaseModel.fromJSON(
      value["user"] as JSONObject,
      User,
    ) as User;

    UserUtil.setEmail(user.email as Email);
    UserUtil.setUserId(user.id as ObjectID);
    UserUtil.setName(user.name || new Name(""));
    if (user.timezone) {
      UserUtil.setSavedUserTimezone(user.timezone);
    }
    UserUtil.setIsMasterAdmin(user.isMasterAdmin as boolean);

    if (user.profilePictureId) {
      UserUtil.setProfilePicId(user.profilePictureId);
    }

    Analytics.userAuth(user.email!);

    // go to dashboard, user should be logged in.
    Navigation.navigate(DASHBOARD_URL);
  }
}
