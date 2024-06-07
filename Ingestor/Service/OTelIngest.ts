import OneUptimeDate from 'Common/Types/Date';
import { JSONArray, JSONObject, JSONValue } from 'Common/Types/JSON';
import JSONFunctions from 'Common/Types/JSONFunctions';
import Metric from 'Model/AnalyticsModels/Metric';

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

    public static getMetricFromDatapoint(
        dbMetric: Metric,
        datapoint: JSONObject
    ): Metric {
        dbMetric.startTimeUnixNano = datapoint['startTimeUnixNano'] as number;
        dbMetric.startTime = OneUptimeDate.fromUnixNano(
            datapoint['startTimeUnixNano'] as number
        );

        dbMetric.timeUnixNano = datapoint['timeUnixNano'] as number;
        dbMetric.time = OneUptimeDate.fromUnixNano(
            datapoint['timeUnixNano'] as number
        );

        if (Object.keys(datapoint).includes('asInt')) {
            dbMetric.value = datapoint['asInt'] as number;
        } else if (Object.keys(datapoint).includes('asDouble')) {
            dbMetric.value = datapoint['asDouble'] as number;
        }

        dbMetric.count = datapoint['count'] as number;
        dbMetric.sum = datapoint['sum'] as number;

        dbMetric.min = datapoint['min'] as number;
        dbMetric.max = datapoint['max'] as number;

        dbMetric.bucketCounts = datapoint['bucketCounts'] as Array<number>;
        dbMetric.explicitBounds = datapoint['explicitBounds'] as Array<number>;

        return dbMetric;
    }
}
