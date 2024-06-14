export interface MemoryMetrics {
  total: number;
  free: number;
  used: number;
  percentUsed: number;
  percentFree: number;
}

export interface CPUMetrics {
  percentUsed: number;
}

export interface BasicDiskMetrics {
  total: number;
  free: number;
  used: number;
  diskPath: string;
  percentUsed: number;
  percentFree: number;
}

export default interface BasicInfrastructureMetrics {
  cpuMetrics: CPUMetrics;
  memoryMetrics: MemoryMetrics;
  diskMetrics: Array<BasicDiskMetrics>;
}
