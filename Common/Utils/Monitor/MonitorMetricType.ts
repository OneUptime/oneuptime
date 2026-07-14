import AggregationType from "../../Types/BaseDatabase/AggregationType";
import { CheckOn } from "../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../Types/Monitor/MonitorType";

/*
 * Groups of metrics rendered as separate cards on the monitor metrics page.
 * Keeps the Server/VM page navigable — CPU / Memory / Disk / Network each
 * get their own card rather than one 28-chart scroll.
 */
export interface MonitorMetricCategory {
  title: string;
  description: string;
  metrics: Array<MonitorMetricType>;
}

class MonitorMetricTypeUtil {
  public static getAggregationTypeByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): AggregationType {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return AggregationType.Avg;
      case MonitorMetricType.ResponseStatusCode:
        return AggregationType.Max;
      case MonitorMetricType.IsOnline:
        return AggregationType.Min;
      case MonitorMetricType.DiskUsagePercent:
        return AggregationType.Max;
      case MonitorMetricType.CPUUsagePercent:
        return AggregationType.Avg;
      case MonitorMetricType.MemoryUsagePercent:
        return AggregationType.Avg;
      case MonitorMetricType.ExecutionTime:
        return AggregationType.Avg;
      case MonitorMetricType.PacketLossPercent:
        return AggregationType.Avg;
      case MonitorMetricType.Jitter:
        return AggregationType.Avg;
      case MonitorMetricType.DnsLookupTime:
      case MonitorMetricType.TcpConnectTime:
      case MonitorMetricType.TlsHandshakeTime:
      case MonitorMetricType.TimeToFirstByte:
      case MonitorMetricType.DownloadTime:
        return AggregationType.Avg;
      case MonitorMetricType.SnmpInterfaceOperStatus:
        return AggregationType.Min;
      case MonitorMetricType.SnmpInterfaceInBitsPerSecond:
      case MonitorMetricType.SnmpInterfaceOutBitsPerSecond:
      case MonitorMetricType.SnmpInterfaceErrorsPerSecond:
        return AggregationType.Avg;
      case MonitorMetricType.SnmpInterfaceUtilizationPercent:
        return AggregationType.Max;

      /*
       * Extended server/VM metrics. Cumulative counters (bytes/packets/ops since
       * boot) use Max so the latest value in a time bucket is returned, which the
       * chart/UI can turn into a rate by differencing adjacent buckets. Gauges
       * (percentages, counts, load averages) use Avg.
       */
      case MonitorMetricType.LoadAverage1Min:
      case MonitorMetricType.LoadAverage5Min:
      case MonitorMetricType.LoadAverage15Min:
      case MonitorMetricType.SwapUsagePercent:
      case MonitorMetricType.MemoryAvailableBytes:
      case MonitorMetricType.CPUTimeUserPercent:
      case MonitorMetricType.CPUTimeSystemPercent:
      case MonitorMetricType.CPUTimeIoWaitPercent:
      case MonitorMetricType.CPUTimeIdlePercent:
      case MonitorMetricType.CPUTimeStealPercent:
      case MonitorMetricType.NetworkConnectionsEstablished:
      case MonitorMetricType.NetworkConnectionsListen:
      case MonitorMetricType.ProcessCountTotal:
        return AggregationType.Avg;

      case MonitorMetricType.DiskReadBytesTotal:
      case MonitorMetricType.DiskWriteBytesTotal:
      case MonitorMetricType.DiskReadOpsTotal:
      case MonitorMetricType.DiskWriteOpsTotal:
      case MonitorMetricType.NetworkBytesReceivedTotal:
      case MonitorMetricType.NetworkBytesSentTotal:
      case MonitorMetricType.NetworkPacketsReceivedTotal:
      case MonitorMetricType.NetworkPacketsSentTotal:
      case MonitorMetricType.NetworkErrorsIn:
      case MonitorMetricType.NetworkErrorsOut:
      case MonitorMetricType.HostUptimeSeconds:
        return AggregationType.Max;

      default:
        throw new Error("Invalid MonitorMetricType value");
    }
  }

  public static getMonitorMeticTypeByCheckOn(
    checkOn: CheckOn,
  ): MonitorMetricType {
    switch (checkOn) {
      case CheckOn.ResponseTime:
        return MonitorMetricType.ResponseTime;
      case CheckOn.PacketLossPercent:
        return MonitorMetricType.PacketLossPercent;
      case CheckOn.Jitter:
        return MonitorMetricType.Jitter;
      case CheckOn.ResponseStatusCode:
        return MonitorMetricType.ResponseStatusCode;
      case CheckOn.IsOnline:
        return MonitorMetricType.IsOnline;
      case CheckOn.DiskUsagePercent:
        return MonitorMetricType.DiskUsagePercent;
      case CheckOn.CPUUsagePercent:
        return MonitorMetricType.CPUUsagePercent;
      case CheckOn.MemoryUsagePercent:
        return MonitorMetricType.MemoryUsagePercent;
      case CheckOn.ExecutionTime:
        return MonitorMetricType.ExecutionTime;
      case CheckOn.LoadAverage1Min:
        return MonitorMetricType.LoadAverage1Min;
      case CheckOn.LoadAverage5Min:
        return MonitorMetricType.LoadAverage5Min;
      case CheckOn.LoadAverage15Min:
        return MonitorMetricType.LoadAverage15Min;
      case CheckOn.SwapUsagePercent:
        return MonitorMetricType.SwapUsagePercent;
      case CheckOn.CPUIoWaitPercent:
        return MonitorMetricType.CPUTimeIoWaitPercent;
      default:
        throw new Error("Invalid CheckOn value");
    }
  }

  public static getMonitorMetricTypesByMonitorType(
    monitorType: MonitorType,
  ): Array<MonitorMetricType> {
    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website
    ) {
      return [
        MonitorMetricType.IsOnline,
        MonitorMetricType.ResponseTime,
        MonitorMetricType.ResponseStatusCode,
        MonitorMetricType.DnsLookupTime,
        MonitorMetricType.TcpConnectTime,
        MonitorMetricType.TlsHandshakeTime,
        MonitorMetricType.TimeToFirstByte,
        MonitorMetricType.DownloadTime,
      ];
    }

    if (monitorType === MonitorType.Server) {
      /*
       * Order below reflects the chart display order on the monitor view.
       * Core resource gauges first, then I/O counters, then diagnostics.
       */
      return [
        MonitorMetricType.IsOnline,
        MonitorMetricType.CPUUsagePercent,
        MonitorMetricType.MemoryUsagePercent,
        MonitorMetricType.DiskUsagePercent,
        MonitorMetricType.LoadAverage1Min,
        MonitorMetricType.LoadAverage5Min,
        MonitorMetricType.LoadAverage15Min,
        MonitorMetricType.SwapUsagePercent,
        MonitorMetricType.MemoryAvailableBytes,
        MonitorMetricType.CPUTimeUserPercent,
        MonitorMetricType.CPUTimeSystemPercent,
        MonitorMetricType.CPUTimeIoWaitPercent,
        MonitorMetricType.CPUTimeIdlePercent,
        MonitorMetricType.CPUTimeStealPercent,
        MonitorMetricType.DiskReadBytesTotal,
        MonitorMetricType.DiskWriteBytesTotal,
        MonitorMetricType.DiskReadOpsTotal,
        MonitorMetricType.DiskWriteOpsTotal,
        MonitorMetricType.NetworkBytesReceivedTotal,
        MonitorMetricType.NetworkBytesSentTotal,
        MonitorMetricType.NetworkPacketsReceivedTotal,
        MonitorMetricType.NetworkPacketsSentTotal,
        MonitorMetricType.NetworkErrorsIn,
        MonitorMetricType.NetworkErrorsOut,
        MonitorMetricType.NetworkConnectionsEstablished,
        MonitorMetricType.NetworkConnectionsListen,
        MonitorMetricType.ProcessCountTotal,
        MonitorMetricType.HostUptimeSeconds,
      ];
    }

    if (monitorType === MonitorType.CustomJavaScriptCode) {
      return [MonitorMetricType.ExecutionTime];
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      return [MonitorMetricType.ExecutionTime];
    }

    if (monitorType === MonitorType.Ping || monitorType === MonitorType.IP) {
      /*
       * Ping/IP checks send multiple echo requests, so they get packet-level
       * network metrics on top of availability and response time.
       */
      return [
        MonitorMetricType.IsOnline,
        MonitorMetricType.ResponseTime,
        MonitorMetricType.PacketLossPercent,
        MonitorMetricType.Jitter,
      ];
    }

    if (monitorType === MonitorType.NetworkDevice) {
      return [
        MonitorMetricType.IsOnline,
        MonitorMetricType.ResponseTime,
        MonitorMetricType.SnmpInterfaceOperStatus,
        MonitorMetricType.SnmpInterfaceInBitsPerSecond,
        MonitorMetricType.SnmpInterfaceOutBitsPerSecond,
        MonitorMetricType.SnmpInterfaceUtilizationPercent,
        MonitorMetricType.SnmpInterfaceErrorsPerSecond,
      ];
    }

    if (
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.DNS ||
      monitorType === MonitorType.DNSSEC ||
      monitorType === MonitorType.Domain ||
      monitorType === MonitorType.SQLQuery ||
      monitorType === MonitorType.ExternalStatusPage
    ) {
      return [MonitorMetricType.IsOnline, MonitorMetricType.ResponseTime];
    }

    return [];
  }

  /*
   * Returns the metrics grouped into display categories. Server monitors get
   * a rich 5-card layout; every other monitor type falls through to a single
   * "Monitor Metrics" category so existing pages look unchanged.
   */
  public static getMonitorMetricCategoriesByMonitorType(
    monitorType: MonitorType,
  ): Array<MonitorMetricCategory> {
    if (monitorType === MonitorType.Server) {
      return [
        {
          title: "Availability",
          description:
            "Heartbeat, uptime, and process count reported by the agent.",
          metrics: [
            MonitorMetricType.IsOnline,
            MonitorMetricType.HostUptimeSeconds,
            MonitorMetricType.ProcessCountTotal,
          ],
        },
        {
          title: "CPU",
          description:
            "CPU utilisation, load averages, and time-spent breakdown.",
          metrics: [
            MonitorMetricType.CPUUsagePercent,
            MonitorMetricType.LoadAverage1Min,
            MonitorMetricType.LoadAverage5Min,
            MonitorMetricType.LoadAverage15Min,
            MonitorMetricType.CPUTimeUserPercent,
            MonitorMetricType.CPUTimeSystemPercent,
            MonitorMetricType.CPUTimeIoWaitPercent,
            MonitorMetricType.CPUTimeIdlePercent,
            MonitorMetricType.CPUTimeStealPercent,
          ],
        },
        {
          title: "Memory",
          description: "RAM usage, swap pressure, and bytes still available.",
          metrics: [
            MonitorMetricType.MemoryUsagePercent,
            MonitorMetricType.SwapUsagePercent,
            MonitorMetricType.MemoryAvailableBytes,
          ],
        },
        {
          title: "Disk",
          description: "Space usage and I/O throughput per partition.",
          metrics: [
            MonitorMetricType.DiskUsagePercent,
            MonitorMetricType.DiskReadBytesTotal,
            MonitorMetricType.DiskWriteBytesTotal,
            MonitorMetricType.DiskReadOpsTotal,
            MonitorMetricType.DiskWriteOpsTotal,
          ],
        },
        {
          title: "Network",
          description:
            "Per-interface throughput, packet errors, and connection counts.",
          metrics: [
            MonitorMetricType.NetworkBytesReceivedTotal,
            MonitorMetricType.NetworkBytesSentTotal,
            MonitorMetricType.NetworkPacketsReceivedTotal,
            MonitorMetricType.NetworkPacketsSentTotal,
            MonitorMetricType.NetworkErrorsIn,
            MonitorMetricType.NetworkErrorsOut,
            MonitorMetricType.NetworkConnectionsEstablished,
            MonitorMetricType.NetworkConnectionsListen,
          ],
        },
      ];
    }

    if (monitorType === MonitorType.NetworkDevice) {
      return [
        {
          title: "Availability",
          description: "Device reachability and SNMP response time.",
          metrics: [MonitorMetricType.IsOnline, MonitorMetricType.ResponseTime],
        },
        {
          title: "Interfaces",
          description:
            "Per-interface status, bandwidth, utilization, and errors. One series per interface.",
          metrics: [
            MonitorMetricType.SnmpInterfaceOperStatus,
            MonitorMetricType.SnmpInterfaceInBitsPerSecond,
            MonitorMetricType.SnmpInterfaceOutBitsPerSecond,
            MonitorMetricType.SnmpInterfaceUtilizationPercent,
            MonitorMetricType.SnmpInterfaceErrorsPerSecond,
          ],
        },
      ];
    }

    // Other monitor types keep the single-card layout.
    const metrics: Array<MonitorMetricType> =
      this.getMonitorMetricTypesByMonitorType(monitorType);
    if (metrics.length === 0) {
      return [];
    }
    return [
      {
        title: "Monitor Metrics",
        description: "Performance metrics collected from this monitor.",
        metrics: metrics,
      },
    ];
  }

  public static getTitleByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "Response Time";
      case MonitorMetricType.ResponseStatusCode:
        return "Response Status Code";
      case MonitorMetricType.IsOnline:
        return "Is Online";
      case MonitorMetricType.DiskUsagePercent:
        return "Disk Usage Percent";
      case MonitorMetricType.CPUUsagePercent:
        return "CPU Usage Percent";
      case MonitorMetricType.MemoryUsagePercent:
        return "Memory Usage Percent";
      case MonitorMetricType.ExecutionTime:
        return "Execution Time";
      case MonitorMetricType.PacketLossPercent:
        return "Packet Loss";
      case MonitorMetricType.Jitter:
        return "Jitter";
      case MonitorMetricType.DnsLookupTime:
        return "DNS Lookup Time";
      case MonitorMetricType.TcpConnectTime:
        return "TCP Connect Time";
      case MonitorMetricType.TlsHandshakeTime:
        return "TLS Handshake Time";
      case MonitorMetricType.TimeToFirstByte:
        return "Time to First Byte";
      case MonitorMetricType.DownloadTime:
        return "Download Time";
      case MonitorMetricType.SnmpInterfaceOperStatus:
        return "Interface Status";
      case MonitorMetricType.SnmpInterfaceInBitsPerSecond:
        return "Interface Inbound Bandwidth";
      case MonitorMetricType.SnmpInterfaceOutBitsPerSecond:
        return "Interface Outbound Bandwidth";
      case MonitorMetricType.SnmpInterfaceUtilizationPercent:
        return "Interface Utilization";
      case MonitorMetricType.SnmpInterfaceErrorsPerSecond:
        return "Interface Errors";
      case MonitorMetricType.LoadAverage1Min:
        return "Load Average (1 minute)";
      case MonitorMetricType.LoadAverage5Min:
        return "Load Average (5 minute)";
      case MonitorMetricType.LoadAverage15Min:
        return "Load Average (15 minute)";
      case MonitorMetricType.SwapUsagePercent:
        return "Swap Usage Percent";
      case MonitorMetricType.MemoryAvailableBytes:
        return "Memory Available";
      case MonitorMetricType.CPUTimeUserPercent:
        return "CPU Time - User";
      case MonitorMetricType.CPUTimeSystemPercent:
        return "CPU Time - System";
      case MonitorMetricType.CPUTimeIoWaitPercent:
        return "CPU Time - IO Wait";
      case MonitorMetricType.CPUTimeIdlePercent:
        return "CPU Time - Idle";
      case MonitorMetricType.CPUTimeStealPercent:
        return "CPU Time - Steal";
      case MonitorMetricType.DiskReadBytesTotal:
        return "Disk Read Bytes (cumulative)";
      case MonitorMetricType.DiskWriteBytesTotal:
        return "Disk Write Bytes (cumulative)";
      case MonitorMetricType.DiskReadOpsTotal:
        return "Disk Read Ops (cumulative)";
      case MonitorMetricType.DiskWriteOpsTotal:
        return "Disk Write Ops (cumulative)";
      case MonitorMetricType.NetworkBytesReceivedTotal:
        return "Network Bytes Received (cumulative)";
      case MonitorMetricType.NetworkBytesSentTotal:
        return "Network Bytes Sent (cumulative)";
      case MonitorMetricType.NetworkPacketsReceivedTotal:
        return "Network Packets Received (cumulative)";
      case MonitorMetricType.NetworkPacketsSentTotal:
        return "Network Packets Sent (cumulative)";
      case MonitorMetricType.NetworkErrorsIn:
        return "Network Receive Errors";
      case MonitorMetricType.NetworkErrorsOut:
        return "Network Transmit Errors";
      case MonitorMetricType.NetworkConnectionsEstablished:
        return "Network Connections - Established";
      case MonitorMetricType.NetworkConnectionsListen:
        return "Network Connections - Listening";
      case MonitorMetricType.HostUptimeSeconds:
        return "Host Uptime";
      case MonitorMetricType.ProcessCountTotal:
        return "Running Processes";
      default:
        return "";
    }
  }

  public static getLegendByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    /*
     * Legend labels default to the title, which also matches the existing behavior
     * for every metric type. Keeping this as a separate function preserves the
     * option to diverge later (e.g. shorter legend labels for dense charts).
     */
    return this.getTitleByMonitorMetricType(monitorMetricType);
  }

  public static getLegendUnitByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "ms";
      case MonitorMetricType.ResponseStatusCode:
        return "";
      case MonitorMetricType.IsOnline:
        return "";
      case MonitorMetricType.DiskUsagePercent:
        return "%";
      case MonitorMetricType.CPUUsagePercent:
        return "%";
      case MonitorMetricType.MemoryUsagePercent:
        return "%";
      case MonitorMetricType.ExecutionTime:
        return "ms";
      case MonitorMetricType.PacketLossPercent:
        return "%";
      case MonitorMetricType.Jitter:
        return "ms";
      case MonitorMetricType.DnsLookupTime:
      case MonitorMetricType.TcpConnectTime:
      case MonitorMetricType.TlsHandshakeTime:
      case MonitorMetricType.TimeToFirstByte:
      case MonitorMetricType.DownloadTime:
        return "ms";
      case MonitorMetricType.SnmpInterfaceOperStatus:
        return "";
      case MonitorMetricType.SnmpInterfaceInBitsPerSecond:
      case MonitorMetricType.SnmpInterfaceOutBitsPerSecond:
        return "bps";
      case MonitorMetricType.SnmpInterfaceUtilizationPercent:
        return "%";
      case MonitorMetricType.SnmpInterfaceErrorsPerSecond:
        return "errors/s";
      case MonitorMetricType.LoadAverage1Min:
      case MonitorMetricType.LoadAverage5Min:
      case MonitorMetricType.LoadAverage15Min:
        return "";
      case MonitorMetricType.SwapUsagePercent:
      case MonitorMetricType.CPUTimeUserPercent:
      case MonitorMetricType.CPUTimeSystemPercent:
      case MonitorMetricType.CPUTimeIoWaitPercent:
      case MonitorMetricType.CPUTimeIdlePercent:
      case MonitorMetricType.CPUTimeStealPercent:
        return "%";
      case MonitorMetricType.MemoryAvailableBytes:
      case MonitorMetricType.DiskReadBytesTotal:
      case MonitorMetricType.DiskWriteBytesTotal:
      case MonitorMetricType.NetworkBytesReceivedTotal:
      case MonitorMetricType.NetworkBytesSentTotal:
        return "bytes";
      case MonitorMetricType.DiskReadOpsTotal:
      case MonitorMetricType.DiskWriteOpsTotal:
        return "ops";
      case MonitorMetricType.NetworkPacketsReceivedTotal:
      case MonitorMetricType.NetworkPacketsSentTotal:
        return "packets";
      case MonitorMetricType.NetworkErrorsIn:
      case MonitorMetricType.NetworkErrorsOut:
        return "errors";
      case MonitorMetricType.NetworkConnectionsEstablished:
      case MonitorMetricType.NetworkConnectionsListen:
        return "connections";
      case MonitorMetricType.HostUptimeSeconds:
        return "seconds";
      case MonitorMetricType.ProcessCountTotal:
        return "processes";
      default:
        return "";
    }
  }

  public static getDescriptionByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "Response time is the time taken for a server to respond to a request. It is the sum of the time spent waiting to establish the connection, the time spent waiting for the request to be processed, and the time spent waiting for the response to be sent.";
      case MonitorMetricType.ResponseStatusCode:
        return "Response status code is a server response code that indicates the status of the server's response to a client's request. It is a three-digit code that is returned by a server in response to a client's request.";
      case MonitorMetricType.IsOnline:
        return "Is online is a metric that indicates whether a server is online or offline. It is a boolean value that is returned by a server in response to a client's request.";
      case MonitorMetricType.DiskUsagePercent:
        return "Disk usage percent is the percentage of disk space that is currently being used on a server. It is a measure of how much disk space is being used by the server's files and data.";
      case MonitorMetricType.CPUUsagePercent:
        return "CPU usage percent is the percentage of CPU capacity that is currently being used on a server. It is a measure of how much of the server's processing power is being used.";
      case MonitorMetricType.MemoryUsagePercent:
        return "Memory usage percent is the percentage of memory that is currently being used on a server. It is a measure of how much of the server's memory is being used.";
      case MonitorMetricType.ExecutionTime:
        return "Execution time is the time taken for a custom JavaScript code or a synthetic monitor to execute.";
      case MonitorMetricType.PacketLossPercent:
        return "Percentage of ICMP echo requests that received no reply during this check. Sustained loss above 1-2% typically indicates congestion, faulty hardware, or routing problems on the path.";
      case MonitorMetricType.Jitter:
        return "Variation in round-trip time across the packets sent in each check (standard deviation). High jitter degrades real-time traffic like VoIP and video even when average latency looks healthy.";
      case MonitorMetricType.DnsLookupTime:
        return "Time spent resolving the hostname to an IP address. Spikes here point at the DNS provider, not the monitored service.";
      case MonitorMetricType.TcpConnectTime:
        return "Time spent establishing the TCP connection after DNS resolution — a proxy for raw network latency to the target.";
      case MonitorMetricType.TlsHandshakeTime:
        return "Time spent negotiating TLS after the TCP connection was established. Regressions here often follow certificate or cipher configuration changes.";
      case MonitorMetricType.TimeToFirstByte:
        return "Time from the end of connection setup until the first byte of the response arrived — the server-side processing time.";
      case MonitorMetricType.DownloadTime:
        return "Time spent receiving the response body after the first byte arrived.";
      case MonitorMetricType.SnmpInterfaceOperStatus:
        return "Operational status of each interface: 1 when up, 0 when down. Interfaces that are administratively disabled also report 0.";
      case MonitorMetricType.SnmpInterfaceInBitsPerSecond:
        return "Inbound traffic per interface, computed from the delta of IF-MIB octet counters between checks.";
      case MonitorMetricType.SnmpInterfaceOutBitsPerSecond:
        return "Outbound traffic per interface, computed from the delta of IF-MIB octet counters between checks.";
      case MonitorMetricType.SnmpInterfaceUtilizationPercent:
        return "Traffic in the busiest direction as a percentage of the interface's reported speed. Sustained values above 80% typically mean the link needs an upgrade.";
      case MonitorMetricType.SnmpInterfaceErrorsPerSecond:
        return "Combined inbound and outbound errors per second per interface. A non-zero rate usually points to cabling, SFP, or duplex problems.";
      case MonitorMetricType.LoadAverage1Min:
        return "Average number of runnable or uninterruptible processes over the last 1 minute. Values persistently above the number of CPU cores indicate CPU saturation.";
      case MonitorMetricType.LoadAverage5Min:
        return "Average number of runnable or uninterruptible processes over the last 5 minutes.";
      case MonitorMetricType.LoadAverage15Min:
        return "Average number of runnable or uninterruptible processes over the last 15 minutes — the most stable load indicator.";
      case MonitorMetricType.SwapUsagePercent:
        return "Percentage of swap space in use. Sustained non-zero values typically indicate memory pressure.";
      case MonitorMetricType.MemoryAvailableBytes:
        return "Estimated bytes of memory available for allocating to new processes without swapping.";
      case MonitorMetricType.CPUTimeUserPercent:
        return "Percentage of CPU time spent executing user-space processes.";
      case MonitorMetricType.CPUTimeSystemPercent:
        return "Percentage of CPU time spent executing kernel-space code (system calls, interrupts).";
      case MonitorMetricType.CPUTimeIoWaitPercent:
        return "Percentage of CPU time spent waiting on disk I/O. High iowait often indicates a storage bottleneck.";
      case MonitorMetricType.CPUTimeIdlePercent:
        return "Percentage of CPU time spent idle (not executing any work).";
      case MonitorMetricType.CPUTimeStealPercent:
        return "Percentage of CPU time the hypervisor stole from this VM to service other guests. Only relevant on virtualized hosts.";
      case MonitorMetricType.DiskReadBytesTotal:
        return "Cumulative bytes read from each disk since boot. Take a derivative over time to get read throughput.";
      case MonitorMetricType.DiskWriteBytesTotal:
        return "Cumulative bytes written to each disk since boot. Take a derivative over time to get write throughput.";
      case MonitorMetricType.DiskReadOpsTotal:
        return "Cumulative disk read operations since boot, per disk.";
      case MonitorMetricType.DiskWriteOpsTotal:
        return "Cumulative disk write operations since boot, per disk.";
      case MonitorMetricType.NetworkBytesReceivedTotal:
        return "Cumulative bytes received on each network interface since boot. Derivative over time yields receive throughput.";
      case MonitorMetricType.NetworkBytesSentTotal:
        return "Cumulative bytes transmitted on each network interface since boot. Derivative over time yields send throughput.";
      case MonitorMetricType.NetworkPacketsReceivedTotal:
        return "Cumulative packets received per interface since boot.";
      case MonitorMetricType.NetworkPacketsSentTotal:
        return "Cumulative packets transmitted per interface since boot.";
      case MonitorMetricType.NetworkErrorsIn:
        return "Cumulative receive errors per interface. Increases typically point to cabling, NIC, or driver issues.";
      case MonitorMetricType.NetworkErrorsOut:
        return "Cumulative transmit errors per interface.";
      case MonitorMetricType.NetworkConnectionsEstablished:
        return "Count of network connections currently in ESTABLISHED state.";
      case MonitorMetricType.NetworkConnectionsListen:
        return "Count of sockets currently in LISTEN state — one per service accepting connections.";
      case MonitorMetricType.HostUptimeSeconds:
        return "Seconds since the host was last booted.";
      case MonitorMetricType.ProcessCountTotal:
        return "Number of running processes reported by the agent.";
      default:
        return "";
    }
  }
}

export default MonitorMetricTypeUtil;
