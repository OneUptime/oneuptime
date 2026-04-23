enum MonitorMetricType {
  ResponseTime = "oneuptime.monitor.response.time",
  ResponseStatusCode = "oneuptime.monitor.response.status.code",
  DiskUsagePercent = "oneuptime.monitor.disk.usage.percent",
  CPUUsagePercent = "oneuptime.monitor.cpu.usage.percent",
  MemoryUsagePercent = "oneuptime.monitor.memory.usage.percent",
  IsOnline = "oneuptime.monitor.online",
  ExecutionTime = "oneuptime.monitor.execution.time",

  /*
   * Extended server/VM metrics. Emitted when the agent payload contains them;
   * absent for older agents, which keeps the pipeline backwards-compatible.
   */
  LoadAverage1Min = "oneuptime.monitor.load.avg.1min",
  LoadAverage5Min = "oneuptime.monitor.load.avg.5min",
  LoadAverage15Min = "oneuptime.monitor.load.avg.15min",

  SwapUsagePercent = "oneuptime.monitor.memory.swap.usage.percent",
  MemoryAvailableBytes = "oneuptime.monitor.memory.available.bytes",

  CPUTimeUserPercent = "oneuptime.monitor.cpu.time.user.percent",
  CPUTimeSystemPercent = "oneuptime.monitor.cpu.time.system.percent",
  CPUTimeIoWaitPercent = "oneuptime.monitor.cpu.time.iowait.percent",
  CPUTimeIdlePercent = "oneuptime.monitor.cpu.time.idle.percent",
  CPUTimeStealPercent = "oneuptime.monitor.cpu.time.steal.percent",

  DiskReadBytesTotal = "oneuptime.monitor.disk.io.read.bytes.total",
  DiskWriteBytesTotal = "oneuptime.monitor.disk.io.write.bytes.total",
  DiskReadOpsTotal = "oneuptime.monitor.disk.io.read.ops.total",
  DiskWriteOpsTotal = "oneuptime.monitor.disk.io.write.ops.total",

  NetworkBytesReceivedTotal = "oneuptime.monitor.network.bytes.received.total",
  NetworkBytesSentTotal = "oneuptime.monitor.network.bytes.sent.total",
  NetworkPacketsReceivedTotal = "oneuptime.monitor.network.packets.received.total",
  NetworkPacketsSentTotal = "oneuptime.monitor.network.packets.sent.total",
  NetworkErrorsIn = "oneuptime.monitor.network.errors.in",
  NetworkErrorsOut = "oneuptime.monitor.network.errors.out",
  NetworkConnectionsEstablished = "oneuptime.monitor.network.connections.established",
  NetworkConnectionsListen = "oneuptime.monitor.network.connections.listen",

  HostUptimeSeconds = "oneuptime.monitor.host.uptime.seconds",
  ProcessCountTotal = "oneuptime.monitor.process.count.total",
}

export default MonitorMetricType;
