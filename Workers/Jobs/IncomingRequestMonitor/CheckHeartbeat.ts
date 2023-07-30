import RunCron from '../../Utils/Cron';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import LIMIT_MAX from 'Common/Types/Database/LimitMax';
import MonitorService from 'CommonServer/Services/MonitorService';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import ProbeMonitorResponseService from 'CommonServer/Utils/Probe/ProbeMonitorResponse';
import IncomingMonitorRequest from 'Common/Types/Monitor/IncomingMonitor/IncomingMonitorRequest';

RunCron(
    'HardDelete:HardDeleteItemsInDatabase',
    { schedule: EVERY_MINUTE, runOnStartup: false },
    async () => {
        const incomingRequestMonitors = await MonitorService.findBy({
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
            const incomingRequest: IncomingMonitorRequest = {
                monitorId: monitor.id!,
                requestHeaders: undefined,
                requestBody: undefined,
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
