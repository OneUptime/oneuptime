import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import Monitor from 'Model/Models/Monitor';
import { CheckOn } from 'Common/Types/Monitor/CriteriaFilter';
import QueryHelper from 'CommonServer/Types/Database/QueryHelper';
import OneUptimeDate from 'Common/Types/Date';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';

RunCron(
    'ServerMonitor:CheckOnlineStatus',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {

        const twoMinsAgo: Date = OneUptimeDate.getSomeMinutesAgo(2);

        const serverMonitors: Array<Monitor> = await MonitorService.findBy({
            query: {
                monitorType: MonitorType.Server,
                serverMonitorRequestReceivedAt:
                    QueryHelper.lessThan(twoMinsAgo),
            },
            props: {
                isRoot: true,
            },
            select: {
                _id: true,
                monitorSteps: true,
                serverMonitorRequestReceivedAt: true,
                createdAt: true,
            },
            limit: LIMIT_MAX,
            skip: 0,
        });

        for (const monitor of serverMonitors) {
            if (!monitor.monitorSteps) {
                continue;
            }

            const processRequest: boolean = shouldProcessRequest(monitor);

            if (!processRequest) {
                continue;
            }

            const serverMonitorResponse: ServerMonitorResponse = {
                monitorId: monitor.id!,
                onlyCheckRequestReceivedAt: true,
                requestReceivedAt:
                    monitor.serverMonitorRequestReceivedAt ||
                    monitor.createdAt!,
            };

            await ProbeMonitorResponseService.processProbeResponse(
                serverMonitorResponse
            );
        }
    }
);

type ShouldProcessRequestFunction = (monitor: Monitor) => boolean;

const shouldProcessRequest: ShouldProcessRequestFunction = (
    monitor: Monitor
): boolean => {
    // check if any criteria has Is Online step. If yes, then process the request. If no then skip the request.

    let shouldWeProcessRequest: boolean = false;

    for (const steps of monitor.monitorSteps?.data?.monitorStepsInstanceArray ||
        []) {
        if (steps.data?.monitorCriteria.data?.monitorCriteriaInstanceArray) {
            for (const criteria of steps.data?.monitorCriteria.data
                ?.monitorCriteriaInstanceArray || []) {
                for (const filters of criteria.data?.filters || []) {
                    if (filters.checkOn === CheckOn.IsOnline) {
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
