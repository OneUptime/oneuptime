import DataToProcess from '../../Types/DataToProcess';
import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import logger from 'CommonServer/Utils/Logger';
import Typeof from 'Common/Types/Typeof';
import { JSONObject } from 'Common/Types/JSON';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';

export default class APIRequestCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: DataToProcess;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let value: number | string | undefined = input.criteriaFilter.value;

        // check response time filter
        if (input.criteriaFilter.checkOn === CheckOn.ResponseTime) {
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! > (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is greater than the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! < (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is less than the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs === (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs !== (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is not equal to the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! >= (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is greater than or equal to the criteria value of ${value} ms.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseTimeInMs! <= (value as number)
                ) {
                    return `Response time is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseTimeInMs
                    } ms which is less than or equal to the criteria value of ${value} ms.`;
                }
                return null;
            }
        }

        //check response code
        if (input.criteriaFilter.checkOn === CheckOn.ResponseStatusCode) {
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! > (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is greater than the criteria value of ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! < (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is less than the criteria value of ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode === (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    }.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode !== (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is not equal to the criteria value of ${value}.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! >= (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is greater than or equal to the criteria value of ${value}.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode &&
                    (input.dataToProcess as ProbeMonitorResponse)
                        .responseCode! <= (value as number)
                ) {
                    return `Response status code is ${
                        (input.dataToProcess as ProbeMonitorResponse)
                            .responseCode
                    } which is less than or equal to the criteria value of ${value}.`;
                }
                return null;
            }
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
                    value &&
                    responseBody &&
                    (responseBody as string).includes(value as string)
                ) {
                    return `Response body contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    responseBody &&
                    !(responseBody as string).includes(value as string)
                ) {
                    return `Response body does not contain ${value}.`;
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
                    value &&
                    headerKeys &&
                    headerKeys.includes(value as string)
                ) {
                    return `Response header contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerKeys &&
                    !headerKeys.includes(value as string)
                ) {
                    return `Response header does not contain ${value}.`;
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
                    value &&
                    headerValues &&
                    headerValues.includes(value as string)
                ) {
                    return `Response header value contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerValues &&
                    !headerValues.includes(value as string)
                ) {
                    return `Response header value does not contain ${value}.`;
                }
                return null;
            }
        }

        return null;
    }
}
