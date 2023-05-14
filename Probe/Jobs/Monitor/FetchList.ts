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
import JSONFunctions from 'Common/Types/JSONFunctions';
import { JSONArray } from 'Common/Types/JSON';

RunCron(
    'Monitor: Fetch List and monitor',
    {
        schedule: EVERY_FIVE_SECONDS,
        runOnStartup: false,
    },
    async () => {

        // run a set timeout function randomly between 1 to 5 seconds

        setTimeout(async () => {
            const result: HTTPResponse<JSONArray> | HTTPErrorResponse =
                await API.fetch<JSONArray>(
                    HTTPMethod.POST,
                    URL.fromString(PROBE_API_URL.toString()).addRoute(
                        '/monitor/list'
                    ),
                    ProbeAPIRequest.getDefaultRequestBody(),
                    {},
                    {}
                );

            const monitors: Array<Monitor> = JSONFunctions.fromJSONArray(
                result.data as JSONArray,
                Monitor
            );

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
        }, Math.floor(Math.random() * 5000) + 1000);


    }
);
