import API from 'Common/Utils/API';
import RunCron from '../../Utils/Cron';
import { EVERY_FIVE_SECONDS } from 'Common/Utils/CronTime';
import { PROBE_API_URL } from '../../Config';
import URL from 'Common/Types/API/URL';
import HTTPResponse from 'Common/Types/API/HTTPResponse';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import Monitor from 'Model/Models/Monitor';
import HTTPMethod from 'Common/Types/API/HTTPMethod';
import ProbeAPIRequest from '../../Utils/ProbeAPIRequest';
import MonitorUtil from '../../Utils/Monitors/Monitor';
import logger from 'CommonServer/Utils/Logger';

RunCron(
    'Monitor: Fetch List and monitor',
    {
        schedule: EVERY_FIVE_SECONDS,
        runOnStartup: false,
    },
    async () => {
        const result: HTTPResponse<Array<Monitor>> | HTTPErrorResponse =
            await API.fetch<Array<Monitor>>(
                HTTPMethod.POST,
                URL.fromString(PROBE_API_URL.toString()).addRoute(
                    '/monitor/list'
                ),
                ProbeAPIRequest.getDefaultRequestBody(),
                {},
                {}
            );

        const monitors: Array<Monitor> = result.data as Array<Monitor>;

        const monitoringPromises: Array<Promise<void>> = [];

        for (const monitor of monitors) {
            const promise: Promise<void> = new Promise<void>(
                (resolve: Function, reject: Function): void => {
                    MonitorUtil.probeMonitor(monitor)
                        .then(() => {
                            resolve();
                        })
                        .catch((err: Error) => {
                            logger.error(err);
                            reject(err);
                        });
                }
            );

            monitoringPromises.push(promise);
        }

        await Promise.allSettled(monitoringPromises);
    }
);
