import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';
import Monitor from 'Model/Models/Monitor';
import { CheckOn } from 'Common/Types/Monitor/CriteriaFilter';

RunCron(
    'IncomingRequestMonitor:CheckHeartbeat',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const incomingRequestMonitors: Array<Monitor> =
            await MonitorService.findBy({
                query: {
                    monitorType: MonitorType.IncomingRequest,
                },
                props: {
                    isRoot: true,
                },
                select: {
                    _id: true,
                    monitorSteps: true,
                    incomingRequestReceivedAt: true,
                    createdAt: true,
                },
                limit: LIMIT_MAX,
                skip: 0,
            });

        for (const monitor of incomingRequestMonitors) {
            if (!monitor.monitorSteps) {
                continue;
            }

            const processRequest: boolean = shouldProcessRequest(monitor);

            if (!processRequest) {
                continue;
            }

            const incomingRequest: IncomingMonitorRequest = {
                monitorId: monitor.id!,
                requestHeaders: undefined,
                requestBody: undefined,
                requestMethod: undefined,
                incomingRequestReceivedAt:
                    monitor.incomingRequestReceivedAt || monitor.createdAt!,
                onlyCheckForIncomingRequestReceivedAt: true,
            };

            await ProbeMonitorResponseService.processProbeResponse(
                incomingRequest
            );
        }
    }
);

type ShouldProcessRequestFunction = (monitor: Monitor) => boolean;

const shouldProcessRequest: ShouldProcessRequestFunction = (
    monitor: Monitor
): boolean => {
    // check if any criteria has request time step. If yes, then process the request. If no then skip the request.
    // We dont want Incoming Request Monitor to process the request if there is no criteria that checks for incoming request.
    // Those monitors criteria should be checked if the request is receievd from the API and not through the worker.

    let shouldWeProcessRequest: boolean = false;

    for (const steps of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (steps.data?.monitorCriteria.data?.monitorCriteriaInstanceArray) {
            for (const criteria of steps.data?.monitorCriteria.data
                ?.monitorCriteriaInstanceArray || []) {
                for (const filters of criteria.data?.filters || []) {
                    if (filters.checkOn === CheckOn.IncomingRequest) {
                        shouldWeProcessRequest = true;
                        break;
                    }
                }

                if (shouldWeProcessRequest) {
                    break;
                }
            }
        }

        if (shouldWeProcessRequest) {
            break;
        }
    }

    return shouldWeProcessRequest;
};
