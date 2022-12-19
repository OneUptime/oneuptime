import UserUtil from './User';
import Navigation from 'CommonUI/src/Utils/Navigation';
import Email from 'Common/Types/Email';
import ObjectID from 'Common/Types/ObjectID';
import Name from 'Common/Types/Name';
import { DASHBOARD_URL } from 'CommonUI/src/Config';
import { JSONObject } from 'Common/Types/JSON';
import User from 'Model/Models/User';
import JSONFunctions from 'Common/Types/JSONFunctions';

export default abstract class LoginUtil {
    public static login(value: JSONObject): void {
        const user: User = JSONFunctions.fromJSON(
            value['user'] as JSONObject,
            User
        ) as User;
        const token: string = value['token'] as string;

        const statusPageId: ObjectID = new ObjectID(value['statusPageId'] as string);

        UserUtil.setAccessToken(statusPageId, token);
        UserUtil.setEmail(statusPageId, user.email as Email);
        UserUtil.setUserId(statusPageId, user.id as ObjectID);
        UserUtil.setName(statusPageId, user.name as Name);

        // go to dashboard, user should be logged in.
        Navigation.navigate(DASHBOARD_URL);
    }
}
