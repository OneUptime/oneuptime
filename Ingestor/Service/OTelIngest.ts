import { JSONArray, JSONObject, JSONValue } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';

export default class OTelIngestService {
    public static getAttributes(items: JSONArray): JSONObject {
        const finalObj: JSONObject = {};
        // We need to convert this to date.
        const attributes: JSONArray = items;

        if (attributes) {
            for (const attribute of attributes) {
                if (attribute['key'] && typeof attribute['key'] === 'string') {
                    let value: JSONValue = attribute['value'] as JSONObject;

                    if (value['stringValue']) {
                        value = value['stringValue'] as string;
                    } else if (value['intValue']) {
                        value = value['intValue'] as number;
                    }

                    finalObj[attribute['key']] = value;
                }
            }
        }

        return JSONFunctions.flattenObject(finalObj);
    }
}
