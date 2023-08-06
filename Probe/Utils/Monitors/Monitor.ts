import MonitorStep from 'Common/Types/Monitor/MonitorStep';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import Monitor from 'Model/Models/Monitor';
import PingMonitor, { PingResponse } from './MonitorTypes/PingMonitor';
import API from 'Common/Utils/API';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import URL from 'Common/Types/API/URL';
import { PROBE_API_URL } from '../../Config';
import ProbeAPIRequest from '../ProbeAPIRequest';
import { JSONObject } from 'Common/Types/JSON';
import WebsiteMonitor, {
    ProbeWebsiteResponse,
} from './MonitorTypes/WebsiteMonitor';
import ApiMonitor, { APIResponse } from './MonitorTypes/ApiMonitor';
import JSONFunctions from 'Common/Types/JSONFunctions';
import logger from 'CommonServer/Utils/Logger';
import ProbeUtil from '../Probe';
import MonitorCriteriaInstance from 'Common/Types/Monitor/MonitorCriteriaInstance';
import { CheckOn, CriteriaFilter } from 'Common/Types/Monitor/CriteriaFilter';

export default class MonitorUtil {
    public static async probeMonitor(
        monitor: Monitor
    ): Promise<Array<ProbeMonitorResponse | null>> {
        const results: Array<ProbeMonitorResponse | null> = [];

        if (
            !monitor.monitorSteps ||
            monitor.monitorSteps.data?.monitorStepsInstanceArray.length === 0
        ) {
            logger.info('No monitor steps found');
            return [];
        }

        for (const monitorStep of monitor.monitorSteps.data
            ?.monitorStepsInstanceArray || []) {
            if (!monitorStep) {
                continue;
            }

            const result: ProbeMonitorResponse | null = await this.probeMonitorStep(
                monitorStep,
                monitor
            );

            if (result) {

                // report this back to Probe API.

                await API.fetch<JSONObject>(
                    HTTPMethod.POST,
                    URL.fromString(PROBE_API_URL.toString()).addRoute(
                        '/probe/response/ingest'
                    ),
                    {
                        ...ProbeAPIRequest.getDefaultRequestBody(),
                        probeMonitorResponse: result as any,
                    },
                    {},
                    {}
                );
            }

            results.push(result);
        }

        return results;
    }

    public static isHeadRequest(monitorStep: MonitorStep): boolean {
        // If its not GET requestm it cannot be a head request
        if (
            monitorStep.data?.requestType &&
            monitorStep.data?.requestType !== HTTPMethod.GET
        ) {
            return false;
        }

        // check if monitor step has any criteria with needs request body. If no, then return true otherwise return false.

        if (
            monitorStep.data?.monitorCriteria.data
                ?.monitorCriteriaInstanceArray &&
            monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray
                .length > 0
        ) {
            const criteriaArray: Array<MonitorCriteriaInstance> =
                monitorStep.data?.monitorCriteria.data
                    ?.monitorCriteriaInstanceArray;

            for (const criteria of criteriaArray) {
                if (
                    criteria.data?.filters &&
                    criteria.data?.filters.length > 0
                ) {
                    const filters: Array<CriteriaFilter> =
                        criteria.data?.filters;

                    for (const filter of filters) {
                        if (filter.checkOn === CheckOn.ResponseBody) {
                            return false;
                        }
                    }
                }
            }
        }

        return true;
    }

    public static async probeMonitorStep(
        monitorStep: MonitorStep,
        monitor: Monitor
    ): Promise<ProbeMonitorResponse | null> {
        const result: ProbeMonitorResponse = {
            monitorStepId: monitorStep.id,
            monitorId: monitor.id!,
            probeId: ProbeUtil.getProbeId(),
        };

        if (!monitorStep.data || !monitorStep.data?.monitorDestination) {
            return result;
        }

        if (
            monitor.monitorType === MonitorType.Ping ||
            monitor.monitorType === MonitorType.IP
        ) {
            const response: PingResponse | null = await PingMonitor.ping(
                monitorStep.data?.monitorDestination,
                {
                    retry: 5,
                }
            );

            if (!response) {
                return null;
            }

            result.isOnline = response.isOnline;
            result.responseTimeInMs = response.responseTimeInMS?.toNumber();
        }

        if (monitor.monitorType === MonitorType.Website) {
            const response: ProbeWebsiteResponse = await WebsiteMonitor.ping(
                monitorStep.data?.monitorDestination as URL,
                {
                    isHeadRequest: MonitorUtil.isHeadRequest(monitorStep),
                    retry: 5,
                }
            );

            result.isOnline = response.isOnline;
            result.responseTimeInMs = response.responseTimeInMS?.toNumber();
            result.responseBody = response.responseBody?.toString();
            result.responseHeaders = response.responseHeaders;
            result.responseCode = response.statusCode;
        }

        if (monitor.monitorType === MonitorType.API) {
            let requestBody: JSONObject | undefined = undefined;
            if (
                monitorStep.data?.requestBody &&
                typeof monitorStep.data?.requestBody === 'string'
            ) {
                requestBody = JSONFunctions.parse(
                    monitorStep.data?.requestBody
                );
            }

            const response: APIResponse = await ApiMonitor.ping(
                monitorStep.data?.monitorDestination as URL,
                {
                    requestHeaders: monitorStep.data?.requestHeaders || {},
                    requestBody: requestBody || undefined,
                    isHeadRequest: MonitorUtil.isHeadRequest(monitorStep),
                    requestType:
                        monitorStep.data?.requestType || HTTPMethod.GET,
                    retry: 5,
                }
            );

            result.isOnline = response.isOnline;
            result.responseTimeInMs = response.responseTimeInMS?.toNumber();
            result.responseBody = response.responseBody;
            result.responseHeaders = response.responseHeaders;
            result.responseCode = response.statusCode;
        }

        return result;
    }
}
