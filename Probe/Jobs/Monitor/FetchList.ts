import API from 'Common/Utils/API';
import RunCron from '../../Utils/Cron';
import { EVERY_FIVE_SECONDS } from 'Common/Utils/CronTime';
import { PROBE_API_URL } from '../../Config';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Monitor from 'Model/Models/Monitor';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import ProbeAPIRequest from "../../Utils/ProbeAPIRequest";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import MonitorUtil from "../../Utils/Monitor";
import logger from 'CommonServer/Utils/Logger';

RunCron(
    'Monitor: Fetch List and monitor',
    {
        schedule: EVERY_FIVE_SECONDS,
        runOnStartup: false,
    },
    async () => {

        const result: HTTPResponse<Array<Monitor>> | HTTPErrorResponse = await API.fetch<Array<Monitor>>(
            HTTPMethod.POST,
            URL.fromString(PROBE_API_URL.toString()).addRoute("/monitor/list"),
            ProbeAPIRequest.getDefaultRequestBody(),
            {},
            {
            }
        );


        const monitors = result.data as Array<Monitor>;

        const monitoringPromises: Array<Promise<void>> = [];

        for (const monitor of monitors) {
            const promise = new Promise<void>(async (resolve, reject) => {
                try {
                    await MonitorUtil.probeMonitor(monitor);
                    resolve();
                } catch (err) {
                    logger.error(err);
                    reject(err);
                }

            });

            monitoringPromises.push(promise);
        }


        await Promise.allSettled(monitoringPromises);
    }
);
