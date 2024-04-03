import ServerMonitorResponse from '../Types/ServerMonitorResponse';
import BasicCron from '../Utils/BasicCron';
import { BasicMetircs } from '../Utils/BasicMetrics';
import Logger from '../Utils/Logger';
import axios from 'axios';
import ServerProcessUtil from '../Utils/ServerProcess';

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

                    const serverMonitorResponse: ServerMonitorResponse = {
                        secretKey: secretKey,
                        requestReceivedAt: new Date(),
                        basicInfrastructureMetrics:
                            await BasicMetircs.getBasicMetrics(),
                        processes: await ServerProcessUtil.getServerProcesses(),
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
