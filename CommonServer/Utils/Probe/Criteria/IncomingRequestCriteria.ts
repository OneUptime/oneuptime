import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import logger from '../../../Utils/Logger';
import Typeof from 'Common/Types/Typeof';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import { JSONObject } from 'Common/Types/JSON';
import OneUptimeDate from 'Common/Types/Date';
import DataToProcess from '../DataToProcess';

export default class IncomingRequestCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: DataToProcess;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let value: number | string | undefined = input.criteriaFilter.value;

        // All incoming request related checks

        if (input.criteriaFilter.checkOn === CheckOn.IncomingRequest) {
            const lastCheckTime: Date = (
                input.dataToProcess as IncomingMonitorRequest
            ).incomingRequestReceivedAt;

            const differenceInMinutes: number =
                OneUptimeDate.getDifferenceInMinutes(
                    lastCheckTime,
                    OneUptimeDate.getCurrentDate()
                );

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

            if (
                input.criteriaFilter.filterType === FilterType.RecievedInMinutes
            ) {
                if (value && differenceInMinutes <= (value as number)) {
                    return `Incoming request / heartbeat received in ${value} minutes.`;
                }
                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.NotRecievedInMinutes
            ) {
                if (value && differenceInMinutes > (value as number)) {
                    return `Incoming request / heartbeat not received in ${value} minutes.`;
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.RequestBody &&
            !(input.dataToProcess as IncomingMonitorRequest)
                .onlyCheckForIncomingRequestReceivedAt
        ) {
            let responseBody: string | JSONObject | undefined = (
                input.dataToProcess as IncomingMonitorRequest
            ).requestBody;

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
                    return `Request body contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    responseBody &&
                    !(responseBody as string).includes(value as string)
                ) {
                    return `Request body does not contain ${value}.`;
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.RequestHeader &&
            !(input.dataToProcess as IncomingMonitorRequest)
                .onlyCheckForIncomingRequestReceivedAt
        ) {
            const headerKeys: Array<string> = Object.keys(
                (input.dataToProcess as IncomingMonitorRequest)
                    .requestHeaders || {}
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
                    return `Request header contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerKeys &&
                    !headerKeys.includes(value as string)
                ) {
                    return `Request header does not contain ${value}.`;
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.RequestHeaderValue &&
            !(input.dataToProcess as IncomingMonitorRequest)
                .onlyCheckForIncomingRequestReceivedAt
        ) {
            const headerValues: Array<string> = Object.values(
                (input.dataToProcess as IncomingMonitorRequest)
                    .requestHeaders || {}
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
                    return `Request header value contains ${value}.`;
                }
                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotContains) {
                if (
                    value &&
                    headerValues &&
                    !headerValues.includes(value as string)
                ) {
                    return `Request header value does not contain ${value}.`;
                }
                return null;
            }
        }

        return null;
    }
}
