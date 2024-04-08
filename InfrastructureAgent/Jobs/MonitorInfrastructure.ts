import ServerMonitorResponse from '../Types/ServerMonitorResponse';
import BasicCron from '../Utils/BasicCron';
import { BasicMetircs } from '../Utils/BasicMetrics';
import Logger from '../Utils/Logger';
import axios, { AxiosResponse } from 'axios';
import ServerProcessUtil from '../Utils/ServerProcess';

export default class MonitorInfrastructure {
    public static initJob(secretKey: string, oneuptimeUrl: string): void {
        const EVERY_MINUTE: string = '* * * * *';

        BasicCron({
            jobName: 'MonitorInfrastructure',
            options: {
                schedule: EVERY_MINUTE, // Every minute
                runOnStartup: true,
            },
            runFunction: async () => {
                await MonitorInfrastructure.monitorServerMetrics({
                    oneuptimeUrl: oneuptimeUrl,
                    secretKey: secretKey,
                });
            },
        });
    }

    public static async checkIfSecretKeyIsValid(data: {
        oneuptimeUrl: string;
        secretKey: string;
    }): Promise<boolean> {
        try {
            const { oneuptimeUrl, secretKey } = data;

            if (!secretKey) {
                throw new Error(
                    'No SECRET_KEY environment variable found. You can find secret key for this monitor on OneUptime Dashboard'
                );
            }

            const response: AxiosResponse = await axios.get(
                `${oneuptimeUrl}/server-monitor/secret-key/verify/${secretKey}`
            );

            if (response.status === 200) {
                return true;
            }

            return false;
        } catch (err) {
            Logger.error(err);
            return false;
        }
    }

    public static async monitorServerMetrics(data: {
        oneuptimeUrl: string;
        secretKey: string;
    }): Promise<void> {
        try {
            const { oneuptimeUrl, secretKey } = data;

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
                `${oneuptimeUrl}/server-monitor/response/ingest/${secretKey}`,
                {
                    serverMonitorResponse: serverMonitorResponse,
                },
                {}
            );
        } catch (err) {
            Logger.error(err);
        }
    }
}
