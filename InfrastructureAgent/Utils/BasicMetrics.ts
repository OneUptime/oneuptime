import os from 'node:os';
import diskusage from 'diskusage';
import BasicInfrastructureMetrics, {
    BasicDiskMetrics,
    CPUMetrics,
    MemoryMetrics,
} from 'Common/Types/Infrastrucutre/BasicMetrics';

export class BasicMetircs {
    public static async getBasicMetrics(data: {
        diskPaths: string[];
    }): Promise<BasicInfrastructureMetrics> {
        return {
            memoryMetrics: await this.getMemoryMetrics(),
            cpuMetrics: await this.getCPUMetrics(),
            diskMetrics: await Promise.all(
                data.diskPaths.map(async (diskPath: string) => {
                    return this.getDiskUsage(diskPath);
                })
            ),
        };
    }

    public static async getDiskUsage(
        diskPath: string
    ): Promise<BasicDiskMetrics> {
        const info = await diskusage.check(diskPath);

        return {
            total: info.total,
            free: info.free,
            used: info.total - info.free,
            available: info.available,
            diskPath: diskPath,
        };
    }

    public static async getMemoryMetrics(): Promise<MemoryMetrics> {
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;

        return {
            total: totalMemory,
            free: freeMemory,
            used: usedMemory,
        };
    }

    public static async getCPUMetrics(): Promise<CPUMetrics> {
        const cpuUsage = os.loadavg()[0]; // Returns an array containing the 1, 5, and 15 minute load averages.

        return {
            percentUsage: cpuUsage || 0,
        };
    }
}
