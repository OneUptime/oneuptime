import os from 'node:os';
import diskusage from 'diskusage';
import BasicInfrastructureMetrics, {
    BasicDiskMetrics,
    CPUMetrics,
    MemoryMetrics,
} from '../Types/BasicMetrics';

// This is a workaround for a bug in the type definitions of the drivelist package. import does not work.
const drivelist: any = require('drivelist');

export class BasicMetircs {
    public static async getBasicMetrics(): Promise<BasicInfrastructureMetrics> {
        const diskPaths: Array<string> = await this.getDiskPaths();

        return {
            memoryMetrics: await this.getMemoryMetrics(),
            cpuMetrics: await this.getCPUMetrics(),
            diskMetrics: await Promise.all(
                diskPaths.map(async (diskPath: string) => {
                    return this.getDiskUsage(diskPath);
                })
            ),
        };
    }

    public static async getDiskPaths(): Promise<Array<string>> {
        const drives: Array<any> = await drivelist.list();

        const mountPoints: Array<string> = [];

        for (const drive of drives) {
            for (const mountPoint of drive.mountpoints) {
                mountPoints.push(mountPoint.path);
            }
        }

        // remove duplicates
        return Array.from(new Set(mountPoints));
    }

    public static async getDiskUsage(
        diskPath: string
    ): Promise<BasicDiskMetrics> {
        const info: diskusage.DiskUsage = await diskusage.check(diskPath);

        return {
            total: info.total,
            free: info.free,
            used: info.total - info.free,
            diskPath: diskPath,
            percentFree: (info.free / info.total) * 100,
            percentUsed: ((info.total - info.free) / info.total) * 100,
        };
    }

    public static async getMemoryMetrics(): Promise<MemoryMetrics> {
        const totalMemory: number = os.totalmem();
        const freeMemory: number = os.freemem();
        const usedMemory: number = totalMemory - freeMemory;

        return {
            total: totalMemory,
            free: freeMemory,
            used: usedMemory,
            percentFree: (freeMemory / totalMemory) * 100,
            percentUsed: (usedMemory / totalMemory) * 100,
        };
    }

    public static async getCPUMetrics(): Promise<CPUMetrics> {
        const cpuUsage: number | undefined = os.loadavg()[0]; // Returns an array containing the 1, 5, and 15 minute load averages.

        return {
            percentUsed: cpuUsage || 0,
        };
    }
}
