import { JSONArray, JSONObject } from 'Common/Types/JSON';
import KeyValueNestedModel from 'Model/AnalyticsModels/NestedModels/KeyValueNestedModel';

export default class OTelIngestService {
    public static getKeyValues(items: JSONArray): Array<KeyValueNestedModel> {
        // We need to convert this to date.
        const attributes: JSONArray = items;

        if (attributes) {
            const dbattributes: Array<KeyValueNestedModel> = [];

            for (const attribute of attributes) {
                const dbattribute: KeyValueNestedModel =
                    new KeyValueNestedModel();
                dbattribute.key = attribute['key'] as string;

                const value: JSONObject = attribute['value'] as JSONObject;

                if (value['stringValue']) {
                    dbattribute.stringValue = value['stringValue'] as string;
                }

                if (value['intValue']) {
                    dbattribute.numberValue = value['intValue'] as number;
                }
                dbattributes.push(dbattribute);
            }

            return dbattributes;
        }

        return [];
    }
}
