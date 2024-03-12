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
import { OneUptimeURL, SecretKey } from './Utils/Config';
import BadDataException from 'Common/Types/Exception/BadDataException';

BasicCron({
    jobName: 'MonitorInfrastructure',
    options: {
        schedule: EVERY_MINUTE, // Every minute
        runOnStartup: true,
    },
    runFunction: async () => {
        try {
            
            const secretKey: string | undefined = SecretKey; 
            const oneuptimeHost: URL = OneUptimeURL;

            if(!secretKey){
                throw new BadDataException(
                    'No SECRET_KEY environment variable found. You can find secret key for this monitor on OneUptime Dashboard'
                );
            }
            
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


            logger.info('Server Monitor Response');
            logger.info(serverMonitorResponse);

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
