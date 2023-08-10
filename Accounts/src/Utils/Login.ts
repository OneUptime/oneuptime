import UserUtil from 'CommonUI/src/Utils/User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import { DASHBOARD_URL } from 'CommonUI/src/Config';
import { JSONObject } from 'Common/Types/JSON';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Analytics from 'CommonUI/src/Utils/Analytics';

export default abstract class LoginUtil {
    public static login(value: JSONObject): void {
        const user: User = JSONFunctions.fromJSON(
            value['user'] as JSONObject,
            User
        ) as User;

        const token: string = value['token'] as string;

        UserUtil.setAccessToken(token);
        UserUtil.setEmail(user.email as Email);
        UserUtil.setUserId(user.id as ObjectID);
        UserUtil.setName(user.name as Name);

        Analytics.userAuth(user.email!);

        // go to dashboard, user should be logged in.
        Navigation.navigate(DASHBOARD_URL);
    }
}
