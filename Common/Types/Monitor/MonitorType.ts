import BadDataException from "../Exception/BadDataException";
import IconProp from "../Icon/IconProp";

enum MonitorType {
  Manual = "Manual",
  Website = "Website",
  API = "API",
  Ping = "Ping",
  Kubernetes = "Kubernetes",
  Docker = "Docker",
  Host = "Host",
  Podman = "Podman",
  DockerSwarm = "Docker Swarm",
  Proxmox = "Proxmox",
  Ceph = "Ceph",
  IoTDevice = "IoT Device",
  IP = "IP",
  IncomingRequest = "Incoming Request",
  IncomingEmail = "Incoming Email",
  Port = "Port",
  Server = "Server",
  SSLCertificate = "SSL Certificate",

  // Database monitoring — runs a read-only SQL query on a schedule from a probe.
  SQLQuery = "SQL Query",

  // These two monitor types are same but we are keeping them separate for now - this is for marketing purposes
  SyntheticMonitor = "Synthetic Monitor",
  CustomJavaScriptCode = "Custom JavaScript Code",

  // Telemetry monitor types
  Logs = "Logs",
  Metrics = "Metrics",
  Traces = "Traces",
  Exceptions = "Exceptions",
  Profiles = "Profiles",
  SecurityEvents = "Security Events",

  /*
   * Network device monitoring (SNMP-based). Replaced the retired SNMP
   * monitor type. The referenced NetworkDevice resource owns everything
   * about data collection — credentials, polling schedule, interface
   * walks, endpoint discovery, and health OIDs. The monitor is purely the
   * alerting layer: it picks a device and evaluates criteria against the
   * device's walk results and traps, server-side.
   */
  NetworkDevice = "Network Device",

  // DNS monitoring
  DNS = "DNS",

  // DNSSEC validation monitoring
  DNSSEC = "DNSSEC",

  // Domain registration monitoring
  Domain = "Domain",

  // External status page monitoring
  ExternalStatusPage = "External Status Page",
}

export default MonitorType;

export interface MonitorTypeProps {
  monitorType: MonitorType;
  description: string;
  title: string;
  icon: IconProp;
  /*
   * Words a user is likely to type that do not appear in the title or the
   * description - product names, protocols and synonyms ("k8s", "postgres",
   * "heartbeat", "tls"). The type picker searches these alongside the visible
   * copy, so someone who knows their own vocabulary does not have to learn
   * ours to find the right monitor.
   */
  keywords: Array<string>;
}

export interface MonitorTypeCategory {
  label: string;
  monitorTypes: Array<MonitorType>;
}

export class MonitorTypeHelper {
  public static getMonitorTypeCategories(): Array<MonitorTypeCategory> {
    return [
      {
        label: "Basic Monitoring",
        monitorTypes: [
          MonitorType.Website,
          MonitorType.API,
          MonitorType.Ping,
          MonitorType.IP,
          MonitorType.Port,
          MonitorType.SSLCertificate,
          MonitorType.Domain,
          MonitorType.ExternalStatusPage,
        ],
      },
      {
        label: "DNS Monitoring",
        monitorTypes: [MonitorType.DNS, MonitorType.DNSSEC],
      },
      {
        label: "Database Monitoring",
        monitorTypes: [MonitorType.SQLQuery],
      },
      {
        label: "Synthetic Monitoring",
        monitorTypes: [
          MonitorType.SyntheticMonitor,
          MonitorType.CustomJavaScriptCode,
        ],
      },
      {
        label: "Inbound Monitoring",
        monitorTypes: [MonitorType.IncomingRequest, MonitorType.IncomingEmail],
      },
      {
        label: "Network",
        monitorTypes: [MonitorType.NetworkDevice],
      },
      {
        label: "Infrastructure",
        monitorTypes: [
          MonitorType.Host,
          MonitorType.Kubernetes,
          MonitorType.Docker,
          MonitorType.Podman,
          MonitorType.DockerSwarm,
          MonitorType.Proxmox,
          MonitorType.Ceph,
          MonitorType.IoTDevice,
        ],
      },
      {
        label: "Telemetry",
        monitorTypes: [
          MonitorType.Logs,
          MonitorType.Metrics,
          MonitorType.Traces,
          MonitorType.Exceptions,
          MonitorType.SecurityEvents,
          /*
           * MonitorType.Profiles is intentionally not offered here: the
           * dashboard has no configuration form for the profile monitor
           * step, so a Profiles monitor created from this picker would have
           * no profileMonitor config and could never evaluate. Existing
           * Profiles monitors keep working — the enum value, its props in
           * getAllMonitorTypeProps, and worker-side evaluation all remain.
           */
        ],
      },
      {
        label: "Other",
        monitorTypes: [MonitorType.Manual],
      },
    ];
  }

  public static isTelemetryMonitor(monitorType: MonitorType): boolean {
    return (
      monitorType === MonitorType.Logs ||
      monitorType === MonitorType.Metrics ||
      monitorType === MonitorType.Traces ||
      monitorType === MonitorType.Exceptions ||
      monitorType === MonitorType.Profiles ||
      monitorType === MonitorType.SecurityEvents ||
      monitorType === MonitorType.Kubernetes ||
      monitorType === MonitorType.Docker ||
      monitorType === MonitorType.Host ||
      monitorType === MonitorType.Podman ||
      monitorType === MonitorType.DockerSwarm ||
      monitorType === MonitorType.Proxmox ||
      monitorType === MonitorType.Ceph ||
      monitorType === MonitorType.IoTDevice
    );
  }

  public static isManualMonitor(monitorType: MonitorType): boolean {
    return monitorType === MonitorType.Manual;
  }

  /*
   * Whether a monitor of this type adds to the project's Active Monitoring
   * bill. Mirrors what the server actually meters -
   * ActiveMonitoringMeteredPlan counts every monitor whose type is not
   * Manual - so the dashboard can warn a Free plan user about a charge using
   * the same rule that produces it. Manual monitors are free and unlimited.
   */
  public static isBilledAsActiveMonitor(monitorType: MonitorType): boolean {
    return !this.isManualMonitor(monitorType);
  }

  public static getAllMonitorTypeProps(): Array<MonitorTypeProps> {
    const monitorTypeProps: Array<MonitorTypeProps> = [
      {
        monitorType: MonitorType.API,
        title: "API",
        description:
          "Call any HTTP endpoint - GET, POST, PUT, DELETE - and alert on the response.",
        icon: IconProp.Code,
        keywords: [
          "rest",
          "endpoint",
          "http",
          "https",
          "json",
          "graphql",
          "get",
          "post",
          "put",
          "delete",
          "service",
        ],
      },
      {
        monitorType: MonitorType.Manual,
        title: "Manual",
        description:
          "No automatic checks. You set the status yourself, or from an external tool.",
        icon: IconProp.EmptyCircle,
        keywords: [
          "static",
          "external",
          "integration",
          "placeholder",
          "no check",
          "third party",
        ],
      },
      {
        monitorType: MonitorType.Website,
        title: "Website",
        description:
          "Check a page loads and responds - status code, page content, and response time.",
        icon: IconProp.Globe,
        keywords: [
          "url",
          "http",
          "https",
          "web",
          "webpage",
          "site",
          "landing page",
          "home page",
          "uptime",
        ],
      },
      {
        monitorType: MonitorType.Ping,
        title: "Ping",
        description: "ICMP reachability and round trip time for a host.",
        icon: IconProp.Signal,
        keywords: [
          "icmp",
          "echo",
          "reachable",
          "reachability",
          "latency",
          "rtt",
          "packet loss",
        ],
      },
      {
        monitorType: MonitorType.Kubernetes,
        title: "Kubernetes",
        description: "Cluster, node, workload, and pod health.",
        icon: IconProp.Cube,
        keywords: [
          "k8s",
          "cluster",
          "pod",
          "node",
          "workload",
          "deployment",
          "namespace",
          "container",
          "eks",
          "gke",
          "aks",
          "openshift",
        ],
      },
      {
        monitorType: MonitorType.Docker,
        title: "Docker Container",
        description:
          "Container CPU, memory, network, restarts, and lifecycle events.",
        icon: IconProp.Cube,
        keywords: [
          "container",
          "dockerd",
          "image",
          "restart",
          "compose",
          "oci",
        ],
      },
      {
        monitorType: MonitorType.Host,
        title: "Host",
        description:
          "CPU, memory, disk, network, and load for hosts running the Infrastructure Agent.",
        icon: IconProp.Server,
        keywords: [
          "server",
          "vm",
          "machine",
          "cpu",
          "memory",
          "ram",
          "disk",
          "load average",
          "otel",
          "opentelemetry",
          "agent",
          "linux",
          "infrastructure",
        ],
      },
      {
        monitorType: MonitorType.Podman,
        title: "Podman Container",
        description:
          "Container CPU, memory, network, restarts, and lifecycle events.",
        icon: IconProp.Podman,
        keywords: [
          "container",
          "rootless",
          "redhat",
          "oci",
          "quadlet",
          "buildah",
        ],
      },
      {
        monitorType: MonitorType.DockerSwarm,
        title: "Docker Swarm",
        description:
          "Per task container health across the cluster's services and nodes.",
        icon: IconProp.DockerSwarm,
        keywords: [
          "swarm",
          "cluster",
          "service",
          "task",
          "orchestration",
          "stack",
          "docker",
        ],
      },
      {
        monitorType: MonitorType.Proxmox,
        title: "Proxmox",
        description:
          "Node availability, VM and container guests, storage, and HA state.",
        icon: IconProp.Proxmox,
        keywords: [
          "pve",
          "hypervisor",
          "vm",
          "virtual machine",
          "lxc",
          "guest",
          "virtualization",
          "ha",
          "cluster",
        ],
      },
      {
        monitorType: MonitorType.Ceph,
        title: "Ceph",
        description:
          "Cluster health, monitor quorum, OSD availability, and pool capacity.",
        icon: IconProp.Ceph,
        keywords: [
          "storage",
          "osd",
          "placement group",
          "pool",
          "quorum",
          "rados",
          "cluster",
          "object storage",
        ],
      },
      {
        monitorType: MonitorType.IoTDevice,
        title: "IoT Device",
        description:
          "Device fleet availability, battery, connectivity, and signal strength.",
        icon: IconProp.IoT,
        keywords: [
          "iot",
          "device",
          "fleet",
          "sensor",
          "battery",
          "gateway",
          "embedded",
          "signal",
        ],
      },
      {
        monitorType: MonitorType.IP,
        title: "IP",
        description: "Reachability of any IPv4 or IPv6 address.",
        icon: IconProp.AltGlobe,
        keywords: ["ipv4", "ipv6", "address", "reachability", "host"],
      },
      {
        monitorType: MonitorType.IncomingRequest,
        title: "Incoming Request",
        description:
          "Have something call OneUptime - heartbeats, cron jobs, and webhooks.",
        icon: IconProp.Webhook,
        keywords: [
          "webhook",
          "heartbeat",
          "push",
          "cron",
          "inbound",
          "dead man switch",
          "alertmanager",
          "curl",
        ],
      },
      {
        monitorType: MonitorType.IncomingEmail,
        title: "Incoming Email",
        description:
          "Alert when email arrives at a unique address and matches your criteria.",
        icon: IconProp.Email,
        keywords: ["email", "mail", "inbox", "smtp", "imap", "mailbox"],
      },
      {
        monitorType: MonitorType.Port,
        title: "Port",
        description: "Whether a TCP or UDP port accepts connections.",
        icon: IconProp.Terminal,
        keywords: ["tcp", "udp", "socket", "telnet", "open port", "connection"],
      },
      {
        monitorType: MonitorType.Server,
        title: "Server / VM",
        description:
          "Any server, VM, or machine, reporting in through the OneUptime agent.",
        icon: IconProp.Cube,
        keywords: [
          "vm",
          "machine",
          "agent",
          "linux",
          "windows",
          "cpu",
          "memory",
          "disk",
        ],
      },
      {
        monitorType: MonitorType.SSLCertificate,
        title: "SSL Certificate",
        description: "Certificate validity and expiry for a domain.",
        icon: IconProp.ShieldCheck,
        keywords: [
          "tls",
          "ssl",
          "cert",
          "certificate",
          "https",
          "expiry",
          "expiration",
          "x509",
          "chain",
          "handshake",
        ],
      },
      {
        monitorType: MonitorType.SQLQuery,
        title: "SQL Query",
        description:
          "Run a read only query on a schedule and alert on rows, values, or errors.",
        icon: IconProp.Database,
        keywords: [
          "database",
          "db",
          "postgres",
          "postgresql",
          "mysql",
          "mariadb",
          "mssql",
          "sql server",
          "query",
          "row count",
        ],
      },
      {
        monitorType: MonitorType.SyntheticMonitor,
        title: "Synthetic Monitor",
        description:
          "Drive your web app in a real browser and alert when the journey fails.",
        icon: IconProp.Window,
        keywords: [
          "browser",
          "playwright",
          "e2e",
          "user journey",
          "ui",
          "click",
          "flow",
          "transaction",
          "headless",
        ],
      },
      {
        monitorType: MonitorType.CustomJavaScriptCode,
        title: "Custom JavaScript Code",
        description:
          "Run your own JavaScript on a schedule and alert on what it returns.",
        icon: IconProp.Code,
        keywords: [
          "js",
          "javascript",
          "script",
          "code",
          "custom",
          "node",
          "programmatic",
        ],
      },
      {
        monitorType: MonitorType.Logs,
        title: "Logs",
        description:
          "Alert on log volume or matching log content from any source.",
        icon: IconProp.Logs,
        keywords: [
          "log",
          "otel",
          "opentelemetry",
          "log query",
          "error log",
          "search logs",
        ],
      },
      {
        monitorType: MonitorType.SecurityEvents,
        title: "Security Events",
        description:
          "Alert on SIEM signal volume or matching security events from any source.",
        icon: IconProp.ShieldExclamation,
        keywords: [
          "security",
          "siem",
          "secops",
          "chronicle",
          "ocsf",
          "detection",
          "threat",
        ],
      },
      {
        monitorType: MonitorType.Exceptions,
        title: "Exceptions",
        description: "Alert on exceptions and error groups from any source.",
        icon: IconProp.Bug,
        keywords: [
          "exception",
          "error",
          "crash",
          "stack trace",
          "bug",
          "error group",
        ],
      },
      {
        monitorType: MonitorType.Traces,
        title: "Traces",
        description: "Alert on span latency and error rate from any source.",
        icon: IconProp.Waterfall,
        keywords: [
          "trace",
          "span",
          "otel",
          "opentelemetry",
          "distributed tracing",
          "apm",
          "latency",
        ],
      },
      {
        monitorType: MonitorType.Metrics,
        title: "Metrics",
        description: "Alert on any metric you ingest.",
        icon: IconProp.Heartbeat,
        keywords: [
          "metric",
          "otel",
          "opentelemetry",
          "gauge",
          "counter",
          "histogram",
          "timeseries",
          "prometheus",
        ],
      },
      {
        monitorType: MonitorType.Profiles,
        title: "Profiles",
        description: "Alert on continuous profiling data from any source.",
        icon: IconProp.Fire,
        keywords: [
          "profiling",
          "cpu profile",
          "flamegraph",
          "pprof",
          "continuous profiling",
        ],
      },
      {
        monitorType: MonitorType.NetworkDevice,
        title: "Network Device",
        description:
          "Alert on a registered switch, router, firewall, or access point.",
        icon: IconProp.Signal,
        keywords: [
          "snmp",
          "switch",
          "router",
          "firewall",
          "access point",
          "interface",
          "oid",
          "trap",
          "bandwidth",
        ],
      },
      {
        monitorType: MonitorType.DNS,
        title: "DNS",
        description: "Resolution and record values for your domains.",
        icon: IconProp.GlobeAlt,
        keywords: [
          "resolution",
          "resolve",
          "record",
          "cname",
          "mx",
          "txt",
          "ns",
          "srv",
          "resolver",
          "nslookup",
          "dig",
        ],
      },
      {
        monitorType: MonitorType.DNSSEC,
        title: "DNSSEC",
        description:
          "Full DNSSEC validation - DNSKEY, DS, RRSIG, and resolver behaviour.",
        icon: IconProp.Key,
        keywords: [
          "dnskey",
          "ds record",
          "rrsig",
          "signing",
          "validation",
          "secure dns",
          "chain of trust",
        ],
      },
      {
        monitorType: MonitorType.Domain,
        title: "Domain",
        description:
          "Registration health - expiry, registrar, nameservers, and WHOIS status.",
        icon: IconProp.Globe,
        keywords: [
          "whois",
          "registrar",
          "registration",
          "expiry",
          "expiration",
          "nameserver",
          "delegation",
          "tld",
        ],
      },
      {
        monitorType: MonitorType.ExternalStatusPage,
        title: "External Status Page",
        description:
          "Watch a third party status page - AWS, GCP, Azure, GitHub, Cloudflare.",
        icon: IconProp.ExternalLink,
        keywords: [
          "third party",
          "vendor",
          "upstream",
          "dependency",
          "aws",
          "gcp",
          "azure",
          "github",
          "cloudflare",
          "statuspage",
        ],
      },
    ];

    return monitorTypeProps;
  }

  public static getDescription(monitorType: MonitorType): string {
    const monitorTypeProps: Array<MonitorTypeProps> =
      this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      });

    if (!monitorTypeProps[0]) {
      throw new BadDataException(
        `${monitorType} does not have monitorType props`,
      );
    }

    return monitorTypeProps[0].description;
  }

  public static getTitle(monitorType: MonitorType): string {
    const monitorTypeProps: Array<MonitorTypeProps> =
      this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      });

    if (!monitorTypeProps[0]) {
      throw new BadDataException(
        `${monitorType} does not have monitorType props`,
      );
    }

    return monitorTypeProps[0].title;
  }

  public static getKeywords(monitorType: MonitorType): Array<string> {
    const monitorTypeProps: Array<MonitorTypeProps> =
      this.getAllMonitorTypeProps().filter((item: MonitorTypeProps) => {
        return item.monitorType === monitorType;
      });

    if (!monitorTypeProps[0]) {
      throw new BadDataException(
        `${monitorType} does not have monitorType props`,
      );
    }

    return monitorTypeProps[0].keywords;
  }

  /*
   * Monitor types the probe executes on a schedule via MonitorProbe rows.
   *
   * NetworkDevice is deliberately NOT probeable: the NetworkDevice resource
   * owns its own polling (the device's assigned probe walks it on the
   * device's schedule), and Network Device monitors are evaluated
   * server-side against each walk result and incoming trap — like
   * IncomingRequest monitors, they never appear in a probe's work list.
   */
  public static isProbableMonitor(monitorType: MonitorType): boolean {
    const isProbeableMonitor: boolean =
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.SSLCertificate ||
      monitorType === MonitorType.SyntheticMonitor ||
      monitorType === MonitorType.CustomJavaScriptCode ||
      monitorType === MonitorType.DNS ||
      monitorType === MonitorType.DNSSEC ||
      monitorType === MonitorType.Domain ||
      monitorType === MonitorType.SQLQuery ||
      monitorType === MonitorType.ExternalStatusPage;
    return isProbeableMonitor;
  }

  public static getActiveMonitorTypes(): Array<MonitorType> {
    return [
      MonitorType.API,
      MonitorType.Website,
      MonitorType.IP,
      MonitorType.Ping,
      MonitorType.Port,
      MonitorType.SSLCertificate,
      MonitorType.SyntheticMonitor,
      MonitorType.CustomJavaScriptCode,
      MonitorType.IncomingRequest,
      MonitorType.IncomingEmail,
      MonitorType.Server,
      MonitorType.Logs,
      MonitorType.Metrics,
      MonitorType.Traces,
      MonitorType.Exceptions,
      MonitorType.Profiles,
      MonitorType.SecurityEvents,
      MonitorType.NetworkDevice,
      MonitorType.DNS,
      MonitorType.DNSSEC,
      MonitorType.Domain,
      MonitorType.SQLQuery,
      MonitorType.ExternalStatusPage,
      MonitorType.Kubernetes,
      MonitorType.Docker,
      MonitorType.Host,
      MonitorType.Podman,
      MonitorType.DockerSwarm,
      MonitorType.Proxmox,
      MonitorType.Ceph,
      MonitorType.IoTDevice,
    ];
  }

  public static doesMonitorTypeHaveDocumentation(
    monitorType: MonitorType,
  ): boolean {
    return (
      monitorType === MonitorType.IncomingRequest ||
      monitorType === MonitorType.IncomingEmail ||
      monitorType === MonitorType.Server ||
      monitorType === MonitorType.NetworkDevice
    );
  }

  public static doesMonitorTypeHaveInterval(monitorType: MonitorType): boolean {
    return this.isProbableMonitor(monitorType);
  }

  public static doesMonitorTypeHaveCriteria(monitorType: MonitorType): boolean {
    return monitorType !== MonitorType.Manual;
  }

  public static doesMonitorTypeHaveGraphs(monitorType: MonitorType): boolean {
    if (
      monitorType === MonitorType.Website ||
      monitorType === MonitorType.API ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.Server ||
      monitorType === MonitorType.SSLCertificate ||
      monitorType === MonitorType.SyntheticMonitor ||
      monitorType === MonitorType.CustomJavaScriptCode ||
      monitorType === MonitorType.NetworkDevice ||
      monitorType === MonitorType.DNS ||
      monitorType === MonitorType.DNSSEC ||
      monitorType === MonitorType.Domain ||
      monitorType === MonitorType.SQLQuery ||
      monitorType === MonitorType.ExternalStatusPage
    ) {
      return true;
    }

    return false;
  }
}
