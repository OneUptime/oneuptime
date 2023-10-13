import Dictionary from 'Common/Types/Dictionary';
import ObjectID from 'Common/Types/ObjectID';

export default class API {
    public static getDefaultHeaders(
        statusPageId: ObjectID
    ): Dictionary<string> {
        return {
            'status-page-id': statusPageId.toString(),
        };
    }
}
