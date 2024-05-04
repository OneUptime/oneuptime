import UserUtil from '../Utils/User';
import Navigation from '../Utils/Navigation';
import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import { DASHBOARD_URL } from '../Config';
import { JSONObject } from 'Common/Types/JSON';
import User from 'Model/Models/User';
import Analytics from '../Utils/Analytics';
import BaseModel from 'Common/Models/BaseModel';

export default abstract class LoginUtil {
    public static login(value: JSONObject): void {
        const user: User = BaseModel.fromJSON(
            value['user'] as JSONObject,
            User
        ) as User;

        UserUtil.setEmail(user.email as Email);
        UserUtil.setUserId(user.id as ObjectID);
        UserUtil.setName(user.name || new Name(''));
        UserUtil.setIsMasterAdmin(user.isMasterAdmin as boolean);

        if (user.profilePictureId) {
            UserUtil.setProfilePicId(user.profilePictureId);
        }

        Analytics.userAuth(user.email!);

        // go to dashboard, user should be logged in.
        Navigation.navigate(DASHBOARD_URL);
    }
}
