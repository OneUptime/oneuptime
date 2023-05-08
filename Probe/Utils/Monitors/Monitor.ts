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

export default class MonitorUtil {
    public static async probeMonitor(
        monitor: Monitor
    ): Promise<Array<ProbeMonitorResponse>> {
        const results: Array<ProbeMonitorResponse> = [];

        if (
            !monitor.monitorSteps ||
            monitor.monitorSteps.data?.monitorStepsInstanceArray.length === 0
        ) {
            return [];
        }

        for (const monitorStep of monitor.monitorSteps.data
            ?.monitorStepsInstanceArray || []) {
            if (!monitorStep) {
                continue;
            }

            const result: ProbeMonitorResponse = await this.probeMonitorStep(
                monitorStep,
                monitor
            );

            // report this back to Probe API.

            await API.fetch<JSONObject>(
                HTTPMethod.POST,
                URL.fromString(PROBE_API_URL.toString()).addRoute(
                    '/probe/response/ingest'
                ),
                ProbeAPIRequest.getDefaultRequestBody(),
                {},
                {}
            );

            results.push(result);
        }

        return results;
    }

    public static async probeMonitorStep(
        monitorStep: MonitorStep,
        monitor: Monitor
    ): Promise<ProbeMonitorResponse> {
        const result: ProbeMonitorResponse = {
            monitorStepId: monitorStep.id,
            monitorId: monitor.id!,
        };

        if (!monitorStep.data || !monitorStep.data?.monitorDestination) {
            return result;
        }

        if (monitor.monitorType === MonitorType.Ping) {
            const response: PingResponse = await PingMonitor.ping(
                monitorStep.data?.monitorDestination
            );

            result.isOnline = response.isOnline;
            result.responseTimeInMs = response.responseTimeInMS?.toNumber();
        }

        return result;
    }
}
