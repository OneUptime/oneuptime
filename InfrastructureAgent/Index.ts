import BasicCron from 'CommonServer/Utils/BasicCron';
import { BasicMetircs } from './Utils/BasicMetrics';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import logger from 'CommonServer/Utils/Logger';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import { JSONObject } from 'Common/Types/JSON';
import BaseModel from 'Common/Models/BaseModel';
import Monitor from 'Model/Models/Monitor';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import OneUptimeDate from 'Common/Types/Date';
import JSONFunctions from 'Common/Types/JSONFunctions';

BasicCron({
    jobName: 'MonitorInfrastructure',
    options: {
        schedule: EVERY_MINUTE, // Every minute
        runOnStartup: true,
    },
    runFunction: async () => {
        try {
            const args = process.argv;

            const secretKey = args
                .filter((arg) => {
                    return arg.toLowerCase().trim().includes('--secret-key=');
                })
                .map((arg) => {
                    return arg.split('=')[1];
                })[0];

            if (!secretKey) {
                logger.error(
                    'No --secret-key= found. Please provide --secret-key= as argument. You can find secret key for this monitor on OneUptime Dashboard'
                );
                return;
            }

            let oneuptimeHost = args
                .filter((arg) => {
                    return arg
                        .toLowerCase()
                        .trim()
                        .includes('--oneuptime-url=');
                })
                .map((arg) => {
                    return arg.split('=')[1];
                })[0];

            if (!oneuptimeHost) {
                logger.info(
                    'No --oneuptime-url= found. Using default oneuptime url - https://oneuptime.com'
                );
                oneuptimeHost = 'https://oneuptime.com';
            }

            // get monitor steps to get disk paths.
            const monitorResult = await API.get(
                URL.fromString(`${oneuptimeHost}/server-monitor/${secretKey}`)
            );

            const monitor: Monitor = BaseModel.fromJSON(
                monitorResult.data as JSONObject,
                Monitor
            ) as Monitor;

            // get disk paths to monitor.

            const diskPaths: string[] = [];

            for (const step of monitor.monitorSteps?.data
                ?.monitorStepsInstanceArray || []) {
                for (const criteriaInstance of step.data?.monitorCriteria.data
                    ?.monitorCriteriaInstanceArray || []) {
                    for (const filter of criteriaInstance.data?.filters || []) {
                        if (filter.serverMonitorOptions?.diskPath) {
                            diskPaths.push(
                                filter.serverMonitorOptions?.diskPath
                            );
                        }
                    }
                }
            }

            const serverMonitorResponse: ServerMonitorResponse = {
                monitorId: monitor.id!,
                metricsCollectedAt: OneUptimeDate.getCurrentDate(),
                basicInfrastructureMetrics: await BasicMetircs.getBasicMetrics({
                    diskPaths: diskPaths,
                }),
            };

            // now we send this data back to server.

            await API.post(
                URL.fromString(
                    `${oneuptimeHost}/server-monitor/response/ingest/${secretKey}`
                ),
                {
                    serverMonitorResponse: JSONFunctions.serialize(
                        serverMonitorResponse as any
                    ),
                },
                {}
            );
        } catch (err) {
            logger.error('Error reporting metrics to OneUptime Server.');
            logger.error(err);
        }
    },
});
