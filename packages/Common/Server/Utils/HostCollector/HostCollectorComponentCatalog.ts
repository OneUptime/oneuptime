/*
 * The OpenTelemetry Collector components a config OneUptime sends to hosts
 * may use (HostCollectorConfigPolicy).
 *
 * A Collector Config runs on every host it applies to, so it is held to what
 * a host collector is for: reading the host and the services on it, shaping
 * that data, and sending it to this OneUptime. Each kind of component is an
 * allowlist, not a denylist, so a component a new collector release adds is
 * refused until someone has looked at it. What is left out, and why:
 *
 *   - every exporter but otlphttp to this OneUptime (and debug and nop): a
 *     config may not send a host's data anywhere else;
 *   - components that run programs, create other receivers, or read cloud
 *     or cluster credentials off the host: receiver_creator, sql_query, the
 *     cloud receivers (aws_*, azure_*, google_*), the Kubernetes receivers
 *     and k8s_attributes;
 *   - the full prometheus receiver, whose scrape configs can read files and
 *     send them to any address (prometheus_simple scrapes one endpoint);
 *   - extensions that open debugging ports or authenticate with files
 *     (pprof, zpages, the auth extensions), and the opamp extension, which
 *     the supervisor adds itself;
 *   - processors that serve data over a port of their own (remotetap).
 *
 * Names are the collector's types: release 0.161.0 renamed many of them
 * (hostmetrics became host_metrics) and still accepts the old names, which
 * the host guide and most configs in the wild use. Both spellings of an
 * allowed component are allowed.
 */

export enum HostCollectorComponentKind {
  Receiver = "receivers",
  Processor = "processors",
  Exporter = "exporters",
  Extension = "extensions",
  Connector = "connectors",
}

/*
 * Each allowed component as [type, ...older names]. The first name is the
 * one collector release 0.161.0 lists.
 */
const RECEIVERS: ReadonlyArray<ReadonlyArray<string>> = [
  // The host itself.
  ["host_metrics", "hostmetrics"],
  ["file_log", "filelog"],
  ["journald"],
  ["systemd"],
  ["windows_event_log", "windowseventlog"],
  ["windows_service", "windowsservice"],
  ["windows_perf_counters", "windowsperfcounters"],
  ["macos_unified_logging", "macosunifiedlogging"],
  ["iis"],
  ["active_directory_ds"],
  ["file_stats", "filestats"],
  ["docker_stats"],
  ["podman_stats"],
  // What applications and devices send to the collector on this host.
  ["otlp"],
  ["syslog"],
  ["tcp_log", "tcplog"],
  ["udp_log", "udplog"],
  ["statsd"],
  ["fluent_forward", "fluentforward"],
  ["zipkin"],
  ["jaeger"],
  // Services on or near the host, read over their own protocols.
  ["prometheus_simple"],
  ["postgresql"],
  ["mysql"],
  ["sqlserver"],
  ["oracledb"],
  ["mongodb"],
  ["redis"],
  ["memcached"],
  ["rabbitmq"],
  ["elasticsearch"],
  ["couchdb"],
  ["riak"],
  ["aerospike"],
  ["zookeeper"],
  ["kafka_metrics", "kafkametrics"],
  ["nginx"],
  ["apache"],
  ["apache_spark", "apachespark"],
  ["flink_metrics", "flinkmetrics"],
  ["haproxy"],
  ["expvar"],
  ["saphana"],
  ["splunk_enterprise", "splunkenterprise"],
  ["vcenter"],
  ["nsxt"],
  ["purefa"],
  ["purefb"],
  ["snmp"],
  ["ntp"],
  ["chrony"],
  // Checks the host runs against what it can reach.
  ["http_check", "httpcheck"],
  ["tcp_check", "tcpcheck"],
  ["tls_check", "tlscheck"],
  ["icmp_check", "icmpcheckreceiver"],
  ["ssh_check", "sshcheck"],
  ["nop"],
];

const PROCESSORS: ReadonlyArray<ReadonlyArray<string>> = [
  ["batch"],
  ["memory_limiter"],
  ["resource"],
  ["resource_detection", "resourcedetection"],
  ["attributes"],
  ["filter"],
  ["transform"],
  ["redaction"],
  ["probabilistic_sampler"],
  ["tail_sampling"],
  ["groupbyattrs"],
  ["groupbytrace"],
  ["cumulative_to_delta", "cumulativetodelta"],
  ["delta_to_cumulative", "deltatocumulative"],
  ["delta_to_rate", "deltatorate"],
  ["metrics_transform", "metricstransform"],
  ["metricsgeneration"],
  ["metric_start_time", "metricstarttime"],
  ["interval"],
  ["log_dedup", "logdedup"],
  ["span"],
  ["span_pruning", "spanpruning"],
  ["schema"],
  ["cardinality_guardian"],
  ["unroll"],
];

const EXPORTERS: ReadonlyArray<ReadonlyArray<string>> = [
  ["otlp_http", "otlphttp"],
  ["debug"],
  ["nop"],
];

const EXTENSIONS: ReadonlyArray<ReadonlyArray<string>> = [
  ["health_check"],
  ["file_storage"],
];

const CONNECTORS: ReadonlyArray<ReadonlyArray<string>> = [
  ["count"],
  ["exceptions"],
  ["forward"],
  ["routing"],
  ["round_robin", "roundrobin"],
  ["failover"],
  ["span_metrics", "spanmetrics"],
  ["service_graph", "servicegraph"],
  ["signal_to_metrics", "signaltometrics"],
  ["sum"],
  ["metrics_as_logs", "metricsaslogs"],
];

const CATALOG: Record<
  HostCollectorComponentKind,
  ReadonlyArray<ReadonlyArray<string>>
> = {
  [HostCollectorComponentKind.Receiver]: RECEIVERS,
  [HostCollectorComponentKind.Processor]: PROCESSORS,
  [HostCollectorComponentKind.Exporter]: EXPORTERS,
  [HostCollectorComponentKind.Extension]: EXTENSIONS,
  [HostCollectorComponentKind.Connector]: CONNECTORS,
};

// Every allowed name of a kind, older names included, to its 0.161.0 type.
const CANONICAL_TYPES: Record<
  HostCollectorComponentKind,
  Map<string, string>
> = {
  [HostCollectorComponentKind.Receiver]: new Map<string, string>(),
  [HostCollectorComponentKind.Processor]: new Map<string, string>(),
  [HostCollectorComponentKind.Exporter]: new Map<string, string>(),
  [HostCollectorComponentKind.Extension]: new Map<string, string>(),
  [HostCollectorComponentKind.Connector]: new Map<string, string>(),
};

for (const kind of Object.values(HostCollectorComponentKind)) {
  for (const names of CATALOG[kind]) {
    const canonical: string = names[0]!;
    for (const name of names) {
      CANONICAL_TYPES[kind].set(name, canonical);
    }
  }
}

/*
 * The 0.161.0 type an allowed component name stands for (host_metrics for
 * hostmetrics), or null when the name is not allowed in this kind.
 */
export function getAllowedComponentType(
  kind: HostCollectorComponentKind,
  type: string,
): string | null {
  return CANONICAL_TYPES[kind].get(type) || null;
}

// Every allowed name of a kind, for messages and the docs.
export function getAllowedComponentNames(
  kind: HostCollectorComponentKind,
): Array<string> {
  return CATALOG[kind].map((names: ReadonlyArray<string>): string => {
    return names[0]!;
  });
}

/*
 * Settings of an allowed component that would let a config run a program or
 * reach outside what the component is for, refused among that component's
 * own settings.
 */
export const FORBIDDEN_COMPONENT_SETTINGS: Record<
  string,
  ReadonlyArray<string>
> = {
  // journalctl_path runs any program; root_path chroots it.
  journald: ["journalctl_path", "root_path"],
  // A directory of its own choosing would let a config write anywhere.
  file_storage: ["directory"],
};

/*
 * Settings refused in every component: each names a file whose contents the
 * component reads and sends to the address it talks to, which would let a
 * config send a file off the host. TLS files (ca_file, cert_file, key_file)
 * are kept: they are used for the handshake, never sent.
 */
export const FILE_SETTINGS_ALLOWED: ReadonlyArray<string> = [
  "ca_file",
  "cert_file",
  "key_file",
  "client_ca_file",
];

export function isForbiddenFileSetting(key: string): boolean {
  if (FILE_SETTINGS_ALLOWED.includes(key)) {
    return false;
  }

  return (
    key.endsWith("_file") ||
    key.endsWith("_files") ||
    key === "file_sd_configs" ||
    key === "http_sd_configs"
  );
}
