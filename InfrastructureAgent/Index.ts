import BasicCron from 'CommonServer/Utils/BasicCron';
import { BasicMetircs } from './Utils/BasicMetrics';
import { EVERY_MINUTE } from 'Common/Utils/CronTime';
import logger from 'CommonServer/Utils/Logger';
import API from 'Common/Utils/API';
import URL from 'Common/Types/API/URL';
import BaseModel from 'Common/Models/BaseModel';
import Monitor from 'Model/Models/Monitor';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import OneUptimeDate from 'Common/Types/Date';
import JSONFunctions from 'Common/Types/JSONFunctions';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

BasicCron({
    jobName: 'MonitorInfrastructure',
    options: {
        schedule: EVERY_MINUTE, // Every minute
        runOnStartup: true,
    },
    runFunction: async () => {
        try {
            const args: Array<string> = process.argv;

            const secretKey: string | undefined = args
                .filter((arg: string) => {
                    return arg.toLowerCase().trim().includes('--secret-key=');
                })
                .map((arg: string) => {
                    return arg.split('=')[1];
                })[0];

            if (!secretKey) {
                logger.error(
                    'No --secret-key= found. Please provide --secret-key= as argument. You can find secret key for this monitor on OneUptime Dashboard'
                );
                return;
            }

            let oneuptimeHost: string | undefined = args
                .filter((arg: string) => {
                    return arg
                        .toLowerCase()
                        .trim()
                        .includes('--oneuptime-url=');
                })
                .map((arg: string) => {
                    return arg.split('=')[1];
                })[0];

            if (!oneuptimeHost) {
                logger.info(
                    'No --oneuptime-url= found. Using default oneuptime url - https://oneuptime.com'
                );
                oneuptimeHost = 'https://oneuptime.com';
            }

            console.log('oneuptimeHost', oneuptimeHost);
            console.log('secretKey', secretKey);

            // get monitor steps to get disk paths.
            const monitorResult: HTTPErrorResponse | HTTPResponse<BaseModel> =
                await API.get(
                    URL.fromString(
                        `${oneuptimeHost}/server-monitor/${secretKey}`
                    )
                );

            if (monitorResult instanceof HTTPErrorResponse) {
                throw monitorResult;
            }


            console.log(monitorResult)

            const monitor: Monitor = BaseModel.fromJSON(
                monitorResult.data,
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
                requestReceivedAt: OneUptimeDate.getCurrentDate(),
                basicInfrastructureMetrics: await BasicMetircs.getBasicMetrics({
                    diskPaths: diskPaths,
                }),
                onlyCheckRequestReceivedAt: false,
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
