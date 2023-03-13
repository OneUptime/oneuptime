import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';
import UserUtil from './User';

export default class API {
    public static getDefaultHeaders(
        statusPageId: ObjectID
    ): Dictionary<string> {
        return {
            'status-page-token': UserUtil.getAccessToken(statusPageId),
        };
    }
}
