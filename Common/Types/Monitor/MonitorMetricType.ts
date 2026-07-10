enum MonitorMetricType {
  ResponseTime = "oneuptime.monitor.response.time",
  ResponseStatusCode = "oneuptime.monitor.response.status.code",
  DiskUsagePercent = "oneuptime.monitor.disk.usage.percent",
  CPUUsagePercent = "oneuptime.monitor.cpu.usage.percent",
  MemoryUsagePercent = "oneuptime.monitor.memory.usage.percent",
  IsOnline = "oneuptime.monitor.online",
  ExecutionTime = "oneuptime.monitor.execution.time",

  /*
   * Packet-level network metrics. Emitted by Ping/IP monitors when the
   * probe sends multiple echo requests per check; absent for older probes.
   */
  PacketLossPercent = "oneuptime.monitor.ping.packet.loss.percent",
  Jitter = "oneuptime.monitor.ping.jitter",

  /*
   * HTTP(S) phase breakdown. Emitted by Website/API monitors when the probe
   * captured socket-level timings; absent behind proxies and on older probes.
   */
  DnsLookupTime = "oneuptime.monitor.http.dns.lookup.time",
  TcpConnectTime = "oneuptime.monitor.http.tcp.connect.time",
  TlsHandshakeTime = "oneuptime.monitor.http.tls.handshake.time",
  TimeToFirstByte = "oneuptime.monitor.http.time.to.first.byte",
  DownloadTime = "oneuptime.monitor.http.download.time",

  /*
   * Per-interface SNMP metrics. Emitted when interface monitoring is enabled
   * on an SNMP monitor; one series per interface (interfaceName attribute).
   */
  SnmpInterfaceOperStatus = "oneuptime.monitor.snmp.interface.oper.status",
  SnmpInterfaceInBitsPerSecond = "oneuptime.monitor.snmp.interface.in.bits.per.second",
  SnmpInterfaceOutBitsPerSecond = "oneuptime.monitor.snmp.interface.out.bits.per.second",
  SnmpInterfaceUtilizationPercent = "oneuptime.monitor.snmp.interface.utilization.percent",
  SnmpInterfaceErrorsPerSecond = "oneuptime.monitor.snmp.interface.errors.per.second",

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
