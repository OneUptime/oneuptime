import psList from 'ps-list';
import { ServerProcess } from '../Types/ServerMonitorResponse';
import Logger from './Logger';

export default class ServerProcessUtil {
    public static async getServerProcesses(): Promise<ServerProcess[]> {
        try {
            const processes: ServerProcess[] = [];

            const processList: any[] = await psList();

            for (const process of processList) {
                processes.push({
                    pid: process.pid,
                    name: process.name,
                    command: process.command,
                });
            }

            Logger.info('Server processes:');
            Logger.info(JSON.stringify(processes, null, 2));

            return processes;
        } catch (err) {
            Logger.error('Cannot get a list of server processes');
            Logger.error(err);
            return [];
        }
    }
}
