export interface MemoryMetrics {
  total: number;
  free: number;
  used: number;
  percentUsed: number;
  percentFree: number;

  available?: number | undefined;
  buffers?: number | undefined;
  cached?: number | undefined;

  swapTotal?: number | undefined;
  swapUsed?: number | undefined;
  swapFree?: number | undefined;
  swapPercentUsed?: number | undefined;
}

export interface CPUMetrics {
  percentUsed: number;
  cores: number;

  perCorePercent?: Array<number> | undefined;
  timeUserPercent?: number | undefined;
  timeSystemPercent?: number | undefined;
  timeIdlePercent?: number | undefined;
  timeIoWaitPercent?: number | undefined;
  timeStealPercent?: number | undefined;
  timeNicePercent?: number | undefined;
  timeIrqPercent?: number | undefined;
  timeSoftIrqPercent?: number | undefined;
}

export interface BasicDiskMetrics {
  total: number;
  free: number;
  used: number;
  diskPath: string;
  percentUsed: number;
  percentFree: number;

  device?: string | undefined;
  fstype?: string | undefined;
  readBytes?: number | undefined;
  writeBytes?: number | undefined;
  readCount?: number | undefined;
  writeCount?: number | undefined;
  ioTimeMs?: number | undefined;
}

export interface NetworkInterfaceMetrics {
  interfaceName: string;
  bytesReceived: number;
  bytesSent: number;
  packetsReceived: number;
  packetsSent: number;
  errorsIn: number;
  errorsOut: number;
  dropsIn: number;
  dropsOut: number;
}

export interface NetworkMetrics {
  interfaces?: Array<NetworkInterfaceMetrics> | undefined;
  totalBytesReceived?: number | undefined;
  totalBytesSent?: number | undefined;
  totalPacketsReceived?: number | undefined;
  totalPacketsSent?: number | undefined;
  connectionsEstablished?: number | undefined;
  connectionsListen?: number | undefined;
  connectionsTotal?: number | undefined;
}

export interface LoadMetrics {
  load1: number;
  load5: number;
  load15: number;
}

export interface HostMetrics {
  platform?: string | undefined;
  platformFamily?: string | undefined;
  platformVersion?: string | undefined;
  kernelVersion?: string | undefined;
  kernelArch?: string | undefined;
  os?: string | undefined;
  uptimeSeconds?: number | undefined;
  bootTime?: number | undefined;
  hostId?: string | undefined;
  virtualizationSystem?: string | undefined;
  virtualizationRole?: string | undefined;
  numProcesses?: number | undefined;
}

export default interface BasicInfrastructureMetrics {
  cpuMetrics: CPUMetrics;
  memoryMetrics: MemoryMetrics;
  diskMetrics: Array<BasicDiskMetrics>;

  networkMetrics?: NetworkMetrics | undefined;
  loadMetrics?: LoadMetrics | undefined;
  hostMetrics?: HostMetrics | undefined;
}
