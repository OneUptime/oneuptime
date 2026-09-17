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
   * Port-monitor connection phases. These intentionally use a Port-specific
   * namespace instead of the HTTP phase metrics above: Port TCP timing can
   * include automatic address-family fallback and has no HTTP request phase.
   */
  PortDnsLookupTime = "oneuptime.monitor.port.dns.lookup.time",
  PortTcpConnectTime = "oneuptime.monitor.port.tcp.connect.time",

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
   * One series per polled OID that returned a numeric value (oid / oidName
   * attributes) — CPU, memory, temperature from vendor templates and any
   * custom OID a user adds. This is what makes polled OIDs chartable and
   * evaluable over time.
   */
  SnmpOidValue = "oneuptime.monitor.snmp.oid.value",

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

  /*
   * Database Health monitor series. A probe connects to PostgreSQL / MySQL /
   * Microsoft SQL Server on a schedule and runs built-in read-only catalog
   * queries; each value below is one normalized series.
   *
   * Not every engine can produce every series - MySQL has no deadlock
   * counter, SQL Server has no fixed connection ceiling by default, and
   * PostgreSQL's I/O timings need track_io_timing on. The authoritative
   * per-engine support matrix lives in DatabaseMetricCatalog.ts, which is
   * also the single source of truth for each series' title, unit,
   * aggregation and display category. Add a member here and an entry there
   * together - a member without a catalog entry is invisible to the UI and
   * fails the metric-invariant tests.
   */
  DatabaseUptimeSeconds = "oneuptime.monitor.database.uptime.seconds",

  DatabaseConnectionsTotal = "oneuptime.monitor.database.connections.total",
  DatabaseConnectionsActive = "oneuptime.monitor.database.connections.active",
  DatabaseConnectionsMax = "oneuptime.monitor.database.connections.max",
  DatabaseConnectionsUsedPercent = "oneuptime.monitor.database.connections.used.percent",
  DatabaseConnectionsIdleInTransaction = "oneuptime.monitor.database.connections.idle.in.transaction",
  DatabaseConnectionsAbortedTotal = "oneuptime.monitor.database.connections.aborted.total",

  DatabaseLongestQuerySeconds = "oneuptime.monitor.database.query.longest.seconds",
  DatabaseLongestTransactionSeconds = "oneuptime.monitor.database.transaction.longest.seconds",
  DatabaseOpenTransactions = "oneuptime.monitor.database.transaction.open.count",

  DatabaseSessionsBlocked = "oneuptime.monitor.database.sessions.blocked",
  DatabaseLocksWaiting = "oneuptime.monitor.database.locks.waiting",
  DatabaseDeadlocksTotal = "oneuptime.monitor.database.deadlocks.total",
  DatabaseTableLocksWaitedTotal = "oneuptime.monitor.database.table.locks.waited.total",

  DatabaseTransactionsTotal = "oneuptime.monitor.database.transactions.total",
  DatabaseQueriesTotal = "oneuptime.monitor.database.queries.total",
  DatabaseSlowQueriesTotal = "oneuptime.monitor.database.queries.slow.total",
  DatabaseRollbackPercent = "oneuptime.monitor.database.rollback.percent",

  DatabaseCacheHitPercent = "oneuptime.monitor.database.cache.hit.percent",
  DatabaseDiskReadsTotal = "oneuptime.monitor.database.disk.reads.total",
  DatabaseDiskWritesTotal = "oneuptime.monitor.database.disk.writes.total",
  DatabaseIoReadTimeMs = "oneuptime.monitor.database.io.read.time.ms",
  DatabaseIoWriteTimeMs = "oneuptime.monitor.database.io.write.time.ms",
  DatabasePageLifeExpectancySeconds = "oneuptime.monitor.database.page.life.expectancy.seconds",
  DatabaseMemoryGrantsPending = "oneuptime.monitor.database.memory.grants.pending",

  DatabaseSizeBytes = "oneuptime.monitor.database.size.bytes",
  DatabaseTempBytesTotal = "oneuptime.monitor.database.temp.bytes.total",
  DatabaseTempDiskTablesTotal = "oneuptime.monitor.database.temp.disk.tables.total",
  DatabaseLogSpaceUsedPercent = "oneuptime.monitor.database.log.space.used.percent",
  DatabaseTempDbFreeBytes = "oneuptime.monitor.database.tempdb.free.bytes",

  DatabaseReplicaCount = "oneuptime.monitor.database.replica.count",
  DatabaseReplicationLagSeconds = "oneuptime.monitor.database.replication.lag.seconds",
  DatabaseReplicationLagBytes = "oneuptime.monitor.database.replication.lag.bytes",
  DatabaseIsInRecovery = "oneuptime.monitor.database.is.in.recovery",
  DatabaseReplicationSlotsInactive = "oneuptime.monitor.database.replication.slots.inactive",

  DatabaseTransactionIdUsedPercent = "oneuptime.monitor.database.transaction.id.used.percent",
  DatabaseDeadTuples = "oneuptime.monitor.database.dead.tuples",
  DatabaseTablesNeverAutovacuumed = "oneuptime.monitor.database.tables.never.autovacuumed",
  DatabaseCheckpointsRequestedTotal = "oneuptime.monitor.database.checkpoints.requested.total",
  DatabaseCheckpointsTimedTotal = "oneuptime.monitor.database.checkpoints.timed.total",

  /*
   * Meta-series: how many collection groups failed on this check (a missing
   * grant, a disabled extension, a per-group timeout). Lets an operator
   * alert on "I have lost visibility" without the monitor itself going
   * offline, which is what a partial failure must never do.
   */
  DatabaseMetricGroupsFailed = "oneuptime.monitor.database.metric.groups.failed",
}

export default MonitorMetricType;
