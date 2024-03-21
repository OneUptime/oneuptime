
import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import Typeof from 'Common/Types/Typeof';
import { JSONObject } from 'Common/Types/JSON';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import CompareCriteria from './CompareCriteria';
import EvaluateOverTime from './EvaluateOverTime';
import DataToProcess from '../DataToProcess';

export default class APIRequestCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: DataToProcess;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let threshold: number | string | undefined | null =
            input.criteriaFilter.value;

        let overTimeValue: Array<number> | number | undefined = undefined;

        if (
            input.criteriaFilter.eveluateOverTime &&
            input.criteriaFilter.evaluateOverTimeOptions
        ) {
            overTimeValue = await EvaluateOverTime.getValueOverTime({
                monitorId: input.dataToProcess.monitorId!,
                evaluateOverTimeOptions:
                    input.criteriaFilter.evaluateOverTimeOptions,
                metricType: input.criteriaFilter.checkOn,
                miscData: input.criteriaFilter
                    .serverMonitorOptions as JSONObject,
            });

            if (Array.isArray(overTimeValue) && overTimeValue.length === 0) {
                return null;
            }

            if (overTimeValue === undefined) {
                return null;
            }
        }

        // check response time filter
        if (input.criteriaFilter.checkOn === CheckOn.ResponseTime) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            const value: Array<number> | number =
                overTimeValue ||
                (input.dataToProcess as ProbeMonitorResponse).responseTimeInMs!;

            return CompareCriteria.compareCriteriaNumbers({
                value: value,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        //check response code
        if (input.criteriaFilter.checkOn === CheckOn.ResponseStatusCode) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            const value: Array<number> | number =
                overTimeValue ||
                (input.dataToProcess as ProbeMonitorResponse).responseCode!;

            return CompareCriteria.compareCriteriaNumbers({
                value: value,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseBody) {
            let responseBody: string | JSONObject | undefined = (
                input.dataToProcess as ProbeMonitorResponse
            ).responseBody;

            if (responseBody && typeof responseBody === Typeof.Object) {
                responseBody = JSON.stringify(responseBody);
            }

            if (!responseBody) {
                return null;
            }

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    threshold &&
                    responseBody &&
                    (responseBody as string).includes(threshold as string)
                ) {
                    return `Response body contains ${threshold}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    threshold &&
                    responseBody &&
                    !(responseBody as string).includes(threshold as string)
                ) {
                    return `Response body does not contain ${threshold}.`;
                }
                return null;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseHeader) {
            const headerKeys: Array<string> = Object.keys(
                (input.dataToProcess as ProbeMonitorResponse).responseHeaders ||
                    {}
            ).map((key: string) => {
                return key.toLowerCase();
            });

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    threshold &&
                    headerKeys &&
                    headerKeys.includes(threshold as string)
                ) {
                    return `Response header contains ${threshold}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    threshold &&
                    headerKeys &&
                    !headerKeys.includes(threshold as string)
                ) {
                    return `Response header does not contain ${threshold}.`;
                }
                return null;
            }
        }

        if (input.criteriaFilter.checkOn === CheckOn.ResponseHeaderValue) {
            const headerValues: Array<string> = Object.values(
                (input.dataToProcess as ProbeMonitorResponse).responseHeaders ||
                    {}
            ).map((key: string) => {
                return key.toLowerCase();
            });

            // contains
            if (input.criteriaFilter.filterType === FilterType.Contains) {
                if (
                    threshold &&
                    headerValues &&
                    headerValues.includes(threshold as string)
                ) {
                    return `Response header threshold contains ${threshold}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    threshold &&
                    headerValues &&
                    !headerValues.includes(threshold as string)
                ) {
                    return `Response header threshold does not contain ${threshold}.`;
                }
                return null;
            }
        }

        return null;
    }
}
