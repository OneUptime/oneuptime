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
        const newDbMetric: Metric = Metric.fromJSON(
            dbMetric.toJSON(),
            Metric
        ) as Metric;

        newDbMetric.startTimeUnixNano = datapoint[
            'startTimeUnixNano'
        ] as number;
        newDbMetric.startTime = OneUptimeDate.fromUnixNano(
            datapoint['startTimeUnixNano'] as number
        );

        newDbMetric.timeUnixNano = datapoint['timeUnixNano'] as number;
        newDbMetric.time = OneUptimeDate.fromUnixNano(
            datapoint['timeUnixNano'] as number
        );

        if (Object.keys(datapoint).includes('asInt')) {
            newDbMetric.value = datapoint['asInt'] as number;
        } else if (Object.keys(datapoint).includes('asDouble')) {
            newDbMetric.value = datapoint['asDouble'] as number;
        }

        newDbMetric.count = datapoint['count'] as number;
        newDbMetric.sum = datapoint['sum'] as number;

        newDbMetric.min = datapoint['min'] as number;
        newDbMetric.max = datapoint['max'] as number;

        newDbMetric.bucketCounts = datapoint['bucketCounts'] as Array<number>;
        newDbMetric.explicitBounds = datapoint[
            'explicitBounds'
        ] as Array<number>;

        // attrbutes

        if (Object.keys(datapoint).includes('attributes')) {
            if (!newDbMetric.attributes) {
                newDbMetric.attributes = {};
            }

            newDbMetric.attributes = {
                ...(newDbMetric.attributes || {}),
                ...this.getAttributes(datapoint['attributes'] as JSONArray),
            };
        }

        if (newDbMetric.attributes) {
            newDbMetric.attributes = JSONFunctions.flattenObject(
                newDbMetric.attributes
            );
        }

        return newDbMetric;
    }
}
