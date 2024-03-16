import ServerMonitorResponse from '../Types/ServerMonitorResponse';
import BasicCron from '../Utils/BasicCron';
import { BasicMetircs } from '../Utils/BasicMetrics';
import Logger from '../Utils/Logger';
import axios, { AxiosResponse } from 'axios';

export default class MonitorInfrastructure {
    public static initJob(secretKey: string, oneuptimeHost: string): void {
        const EVERY_MINUTE: string = '* * * * *';

        BasicCron({
            jobName: 'MonitorInfrastructure',
            options: {
                schedule: EVERY_MINUTE, // Every minute
                runOnStartup: true,
            },
            runFunction: async () => {
                try {
                    if (!secretKey) {
                        throw new Error(
                            'No SECRET_KEY environment variable found. You can find secret key for this monitor on OneUptime Dashboard'
                        );
                    }

                    // get monitor steps to get disk paths.
                    const monitorResult: AxiosResponse = await axios.get(
                        `${oneuptimeHost}/server-monitor/${secretKey}`
                    );

                    const monitor: any = monitorResult.data;
                    // get disk paths to monitor.

                    const diskPaths: string[] = [];

                    for (const step of monitor.monitorSteps?.data
                        ?.monitorStepsInstanceArray || []) {
                        for (const criteriaInstance of step.data
                            ?.monitorCriteria.data
                            ?.monitorCriteriaInstanceArray || []) {
                            for (const filter of criteriaInstance.data
                                ?.filters || []) {
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
                        requestReceivedAt: new Date(),
                        basicInfrastructureMetrics:
                            await BasicMetircs.getBasicMetrics({
                                diskPaths: diskPaths,
                            }),
                        onlyCheckRequestReceivedAt: false,
                    };

                    Logger.info('Server Monitor Response');
                    Logger.info(JSON.stringify(serverMonitorResponse));

                    // now we send this data back to server.

                    await axios.post(
                        `${oneuptimeHost}/server-monitor/response/ingest/${secretKey}`,
                        {
                            serverMonitorResponse: serverMonitorResponse,
                        },
                        {}
                    );
                } catch (err) {
                    Logger.error(err);
                }
            },
        });
    }
}
