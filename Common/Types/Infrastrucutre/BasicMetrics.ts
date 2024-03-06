export interface MemoryMetrics {
    total: number;
    free: number;
    used: number;
}

export interface CPUMetrics {
    percentUsage: number;
}

export interface BasicDiskMetrics {
    total: number;
    free: number;
    used: number;
    available: number;
    diskPath: string;
}


export default interface BasicInfrastructureMetrics {
    cpuMetrics: CPUMetrics;
    memoryMetrics: MemoryMetrics;
    diskMetrics: Array<BasicDiskMetrics>
}