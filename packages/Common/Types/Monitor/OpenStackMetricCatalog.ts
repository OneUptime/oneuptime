import MetricsAggregationType from "../Metrics/MetricsAggregationType";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OPENSTACK_INSTANCE_METRIC_UNITS,
  OpenStackHypervisorMetric,
  OpenStackInstanceMetric,
} from "../OpenStack/OpenStackInstanceMetrics";
import { OpenStackServiceType } from "../OpenStack/OpenStackResourceKind";
import { translationKey } from "../Translator";

export type OpenStackMetricCategory =
  | "Availability"
  | "Control Plane"
  | "Compute"
  | "Network"
  | "Storage"
  | "Images"
  | "Identity"
  | "Projects";

export interface OpenStackMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: OpenStackMetricCategory;
  // Up, alive and state series read Min; counts, sizes and info series read Max.
  defaultAggregation: MetricsAggregationType;
  // The agent's scrape job that collects it, so how often it reports.
  service: OpenStackServiceType;
  /*
   * The exporter's own labels on this series, as openstack-exporter spells them.
   * Every series also carries the `openstack.cloud.name` resource attribute, and
   * `openstack.region.name` and `openstack_service` on each datapoint.
   */
  identityAttributes: ReadonlyArray<string>;
  /*
   * The agent's exporter leaves some reads out by name. This is the
   * `--disable-metric=<service>-<head>` line that keeps this series off: `head` is
   * the series whose read also fills the others, so one line turns them all off
   * (agents/OpenStackAgent/docker-compose.yml). Deleting it turns the series on.
   */
  offByDefault?: string;
  /*
   * Labels only the probe's native collector sends on this series, beside the
   * exporter's: what it can read from the APIs that the exporter leaves behind. A query
   * filtering on one finds nothing from a cloud the agent collects.
   */
  probeOnlyAttributes?: ReadonlyArray<string>;
  // A series only the probe's native collector sends: the exporter has no such thing.
  onlyFromProbe?: boolean;
  /*
   * Worked out at ingest from libvirt's or Ceilometer's exporter, whichever a cloud has
   * (OpenStackInstanceMetricsScan). Empty until a cloud names a source, and it says so.
   */
  fromInstanceSource?: boolean;
  /*
   * Written by OneUptime itself, from a cloud's rows, for a cloud past the summary size
   * (OpenStackScale), in place of a series per instance. Nothing collects these.
   */
  fromSummaryMode?: boolean;
  unit?: string;
}

/*
 * Every series the OpenStack agent can collect from openstack-exporter, one
 * scrape job per service (agents/OpenStackAgent/otel-collector-config.yaml), and
 * the Prometheus receiver's own two that say whether a collection worked.
 *
 * What each one's value holds is the trap here, because the exporter's status
 * series carry a code rather than a count: openstack_nova_server_status reads 4
 * for an instance in ERROR, and its `status` label holds the word. The labels are
 * checked by OpenStackMetricCatalog.test.ts against what the exporter the agent pins
 * says (Tests/Types/Monitor/Utils/OpenStackExporterSeries.ts).
 *
 * The default aggregation is never Sum. A monitor reads one-minute buckets across
 * series and scrapes, and a Sum adds them together: 12 hosts with one down read 22
 * to 24 and "Up < 12" never fired (issue #5433).
 */
const HYPERVISOR_LABELS: ReadonlyArray<string> = [
  "hostname",
  "availability_zone",
  "aggregates",
];
const COMPUTE_LIMIT_LABELS: ReadonlyArray<string> = ["tenant", "tenant_id"];
const QUOTA_LABELS: ReadonlyArray<string> = ["type", "tenant", "tenant_id"];
const PLACEMENT_LABELS: ReadonlyArray<string> = ["hostname", "resourcetype"];
const NETWORK_IP_LABELS: ReadonlyArray<string> = [
  "network_id",
  "network_name",
  "ip_version",
  "cidr",
  "subnet_name",
  "project_id",
];
const SUBNET_POOL_LABELS: ReadonlyArray<string> = [
  "ip_version",
  "prefix",
  "prefix_length",
  "project_id",
  "subnet_pool_id",
  "subnet_pool_name",
];
const POOL_LABELS: ReadonlyArray<string> = [
  "name",
  "volume_backend_name",
  "vendor_name",
];
// What Cinder's driver says of itself, which is what says a pool is on a Ceph cluster.
const POOL_PROBE_ONLY_LABELS: ReadonlyArray<string> = [
  "storage_protocol",
  "ceph_fsid",
  "ceph_pool",
];
const VOLUME_LIMIT_LABELS: ReadonlyArray<string> = ["tenant", "tenant_id"];

const INSTANCE_LABELS: ReadonlyArray<string> = [
  OPENSTACK_INSTANCE_ID_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
  OPENSTACK_INSTANCE_PROJECT_ATTRIBUTE,
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
];
const INSTANCE_DEVICE_LABELS: ReadonlyArray<string> = [
  ...INSTANCE_LABELS,
  OPENSTACK_INSTANCE_DEVICE_ATTRIBUTE,
];
const HYPERVISOR_USAGE_LABELS: ReadonlyArray<string> = [
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OPENSTACK_INSTANCE_SOURCE_ATTRIBUTE,
];

const FROM_INSTANCE_SOURCE: string =
  "Reported only where libvirt's or Ceilometer's exporter is read.";

function usage(data: {
  metricName: OpenStackInstanceMetric | OpenStackHypervisorMetric;
  friendlyName: string;
  description: string;
  identityAttributes: ReadonlyArray<string>;
}): OpenStackMetricDefinition {
  return metric({
    metricName: data.metricName,
    friendlyName: data.friendlyName,
    description: `${data.description} ${FROM_INSTANCE_SOURCE}`,
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: data.identityAttributes,
    fromInstanceSource: true,
    unit: OPENSTACK_INSTANCE_METRIC_UNITS[data.metricName],
  });
}

function metric(
  data: Omit<OpenStackMetricDefinition, "id">,
): OpenStackMetricDefinition {
  return {
    ...data,
    id: data.metricName.replace(/_/g, "-"),
    description:
      data.offByDefault && !data.description.includes("--disable-metric")
        ? `${data.description} Off by default: delete the --disable-metric=${data.offByDefault} line from the exporter to turn it on.`
        : data.description,
  };
}

const openStackMetricCatalog: Array<OpenStackMetricDefinition> = [
  // Availability: the receiver's own two, then each API's.
  metric({
    metricName: "up",
    friendlyName: translationKey("Collection Answered"),
    description:
      "Whether the exporter answered this collection at all (1) or did not (0): it was stopped, it timed out, or it answered with an error. 1 says nothing about the API itself, because the exporter answers even when it could not reach it. Reported by the agent's collector, one series per service per region.",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
  }),
  metric({
    metricName: "scrape_samples_scraped",
    friendlyName: translationKey("Series in a Collection"),
    description:
      "How many series the exporter answered a collection with. 0 means it had nothing to say: it could not log in to Keystone, or it could not reach Nova's API to agree a microversion, and those failures leave no openstack_* series at all. Reported by the agent's collector, one series per service per region.",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_up",
    friendlyName: translationKey("Identity API Up"),
    description:
      "Whether Keystone's API answered the exporter's calls (1) or every one of them failed (0). When Keystone cannot be logged in to at all, the exporter answers with nothing, so this series goes away rather than reading 0.",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    probeOnlyAttributes: ["refresh_cycle_minutes"],
  }),
  metric({
    metricName: "openstack_nova_up",
    friendlyName: translationKey("Compute API Up"),
    description:
      "Whether Nova's API answered the exporter's calls (1) or every one of them failed (0). When Nova's API cannot be reached at all, the exporter answers with nothing, so this series goes away rather than reading 0.",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Compute,
    identityAttributes: [],
    probeOnlyAttributes: ["refresh_cycle_minutes"],
  }),
  metric({
    metricName: "openstack_neutron_up",
    friendlyName: translationKey("Network API Up"),
    description:
      "Whether Neutron's API answered the exporter's calls (1) or every one of them failed (0).",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    probeOnlyAttributes: ["refresh_cycle_minutes"],
  }),
  metric({
    metricName: "openstack_cinder_up",
    friendlyName: translationKey("Block Storage API Up"),
    description:
      "Whether Cinder's API answered the exporter's calls (1) or every one of them failed (0).",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Volume,
    identityAttributes: [],
    probeOnlyAttributes: ["refresh_cycle_minutes"],
  }),
  metric({
    metricName: "openstack_glance_up",
    friendlyName: translationKey("Image API Up"),
    description:
      "Whether Glance's API answered the exporter's calls (1) or every one of them failed (0).",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Image,
    identityAttributes: [],
    probeOnlyAttributes: ["refresh_cycle_minutes"],
  }),
  metric({
    metricName: "openstack_placement_up",
    friendlyName: translationKey("Placement API Up"),
    description:
      "Whether Placement's API answered the exporter's calls (1) or every one of them failed (0).",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Placement,
    identityAttributes: [],
    probeOnlyAttributes: ["refresh_cycle_minutes"],
  }),

  // Control plane: the workers `openstack compute service list` and friends show.
  metric({
    metricName: "openstack_nova_agent_state",
    friendlyName: translationKey("Compute Service Alive"),
    description:
      "Whether a Nova worker (nova-compute, nova-scheduler, nova-conductor) is up (1) or down (0), one series per worker. adminState says enabled or disabled, and a disabled one is planned work, with its reason in disabledReason. hostname is Nova's short host name, where hypervisor and Placement series say the full name.",
    category: "Control Plane",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Compute,
    identityAttributes: [
      "id",
      "hostname",
      "service",
      "adminState",
      "zone",
      "disabledReason",
    ],
  }),
  metric({
    metricName: "openstack_neutron_agent_state",
    friendlyName: translationKey("Network Agent Alive"),
    description:
      "Whether a Neutron agent is alive (1) or not (0), one series per host and binary. adminState says up or down, and one set down is planned work.",
    category: "Control Plane",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "hostname",
      "service",
      "adminState",
      "availability_zone",
    ],
  }),
  metric({
    metricName: "openstack_cinder_agent_state",
    friendlyName: translationKey("Block Storage Service Alive"),
    description:
      "Whether a Cinder service (cinder-volume, cinder-scheduler, cinder-backup) is up (1) or down (0), one series per host and binary. adminState says enabled or disabled, and a disabled one is planned work. The uuid label is made up afresh on every collection, so never group by it.",
    category: "Control Plane",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Volume,
    identityAttributes: [
      "uuid",
      "hostname",
      "service",
      "adminState",
      "zone",
      "disabledReason",
    ],
  }),

  // Compute: hypervisors, what Placement has promised, instances and flavors.
  metric({
    metricName: "openstack_placement_resource_total",
    friendlyName: translationKey("Placement Capacity"),
    description:
      "How much of a resource a hypervisor has, before any allocation ratio: vCPUs for VCPU, MiB for MEMORY_MB, GiB for DISK_GB, by the resourcetype label. hostname is the hypervisor's full name.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Placement,
    identityAttributes: PLACEMENT_LABELS,
  }),
  metric({
    metricName: "openstack_placement_resource_reserved",
    friendlyName: translationKey("Placement Reserved"),
    description:
      "How much of a resource Placement keeps back from instances on a hypervisor, in the same units as Placement Capacity.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Placement,
    identityAttributes: PLACEMENT_LABELS,
  }),
  metric({
    metricName: "openstack_placement_resource_allocation_ratio",
    friendlyName: translationKey("Placement Allocation Ratio"),
    description:
      "How many times over Placement will promise a hypervisor's resource. What it will promise is (capacity - reserved) x this ratio.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Placement,
    identityAttributes: PLACEMENT_LABELS,
    unit: "ratio",
  }),
  metric({
    metricName: "openstack_placement_resource_usage",
    friendlyName: translationKey("Placement Allocated"),
    description:
      "How much of a resource Placement has promised to instances on a hypervisor. This is allocation, not load: an idle instance holds all of it.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Placement,
    identityAttributes: PLACEMENT_LABELS,
  }),
  metric({
    metricName: "openstack_placement_resource_generation",
    friendlyName: translationKey("Placement Generation"),
    description:
      "How many times a hypervisor's inventory has changed, as Placement counts it. It climbs on every change, so it says something changed, not what.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Placement,
    identityAttributes: PLACEMENT_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_placement_resource_provider_allocations",
    friendlyName: translationKey("Placement Allocations per Instance"),
    description:
      "How much of a resource one consumer, its uuid, holds on a hypervisor.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Placement,
    identityAttributes: ["hostname", "uuid", "resourcetype"],
  }),
  metric({
    metricName: "openstack_nova_vcpus_available",
    friendlyName: translationKey("Hypervisor vCPUs"),
    description:
      "The vCPUs a hypervisor has, whatever the name says, before any allocation ratio. Nova stopped reporting this at microversion 2.88, so Placement's series are the ones to trust.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_vcpus_used",
    friendlyName: translationKey("Hypervisor vCPUs Allocated"),
    description:
      "The vCPUs Nova has promised to instances on a hypervisor. Allocation, not load.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_memory_available_bytes",
    friendlyName: translationKey("Hypervisor Memory"),
    description:
      "The memory a hypervisor has, whatever the name says, before any allocation ratio.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_nova_memory_used_bytes",
    friendlyName: translationKey("Hypervisor Memory Allocated"),
    description:
      "The memory Nova has promised to instances on a hypervisor. Allocation, not load.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_nova_local_storage_available_bytes",
    friendlyName: translationKey("Hypervisor Local Disk"),
    description:
      "The local disk a hypervisor has, whatever the name says, before any allocation ratio.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_nova_local_storage_used_bytes",
    friendlyName: translationKey("Hypervisor Local Disk Allocated"),
    description:
      "The local disk Nova has promised to instances on a hypervisor. Allocation, not usage.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_nova_free_disk_bytes",
    friendlyName: translationKey("Hypervisor Free Disk"),
    description:
      "The local disk Nova counts as free on a hypervisor. It can go negative when a hypervisor has promised more than it has.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_nova_current_workload",
    friendlyName: translationKey("Hypervisor Current Workload"),
    description:
      "How many build, resize, snapshot, migrate and rescue operations are running on a hypervisor. It is not CPU load.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_running_vms",
    friendlyName: translationKey("Running Instances per Project"),
    description:
      "How many ACTIVE instances a hypervisor has. hostname is the hypervisor's full name.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: HYPERVISOR_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_server_status",
    friendlyName: translationKey("Instance Status"),
    description:
      "One series per instance, whose value is a numeric code for its status: ACTIVE is 0, BUILD is 1, ERROR is 4. Read the word from the status label, and filter on it: the code is not a count and not a severity. address_ipv4 and address_ipv6 are empty on a real cloud, and hypervisor_hostname, host_id and availability_zone are empty until the instance is scheduled.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: [
      "id",
      "status",
      "name",
      "tenant_id",
      "user_id",
      "address_ipv4",
      "address_ipv6",
      "host_id",
      "hypervisor_hostname",
      "uuid",
      "availability_zone",
      "flavor_id",
      "instance_libvirt",
    ],
    probeOnlyAttributes: ["task_state", "updated_at", "fault_message"],
  }),
  metric({
    metricName: "openstack_nova_server_local_gb",
    friendlyName: translationKey("Instance Local Disk"),
    description: "The local disk one instance holds.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: ["name", "id", "tenant_id"],
    offByDefault: "nova-server_local_gb",
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_nova_instances_by_status",
    friendlyName: translationKey("Instances by Status"),
    description:
      "How many instances are in each status, one series per status in each region. A cloud past the summary size keeps this in place of a series per instance. Other clouds do not send it.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: ["status"],
    fromSummaryMode: true,
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_instances_by_project",
    friendlyName: translationKey("Instances by Project"),
    description:
      "How many instances each project holds, one series per project in each region. A cloud past the summary size keeps this in place of a series per instance. Other clouds do not send it.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: ["tenant_id"],
    fromSummaryMode: true,
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_total_vms",
    friendlyName: translationKey("Total Instances"),
    description: "How many instances the region has, in any status.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_flavors",
    friendlyName: translationKey("Flavors"),
    description: "How many flavors the region has.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_flavor",
    friendlyName: translationKey("Flavor Info"),
    description:
      "One series per flavor, always 1, with its size in the vcpus, ram (MiB) and disk (GiB) labels.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: ["id", "name", "vcpus", "ram", "disk", "is_public"],
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_availability_zones",
    friendlyName: translationKey("Availability Zones"),
    description: "How many availability zones Nova has in the region.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_security_groups",
    friendlyName: translationKey("Security Groups (Nova)"),
    description:
      "How many security groups Nova reports in the region. The agent leaves it out with --disable-metric=nova-security_groups, because Nova no longer has this route.",
    category: "Compute",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: [],
    offByDefault: "nova-security_groups",
    unit: "count",
  }),

  // Network.
  metric({
    metricName: "openstack_neutron_routers_not_active",
    friendlyName: translationKey("Routers Not Active"),
    description:
      "How many routers in the region have a status other than ACTIVE. Reads 0 when all is well.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_floating_ips_associated_not_active",
    friendlyName: translationKey("Floating IPs Not Active"),
    description:
      "How many floating IPs in the region are attached to something and not ACTIVE. A spare one is meant to be down, so it does not count here. Reads 0 when all is well.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_l3_agent_of_router",
    friendlyName: translationKey("L3 Agent of a Router"),
    description:
      "One series per router and L3 agent holding it: 1 while the agent is alive, 0 when it is not, with its ha_state (active or standby) and agent_admin_up labels. A router is fine while any agent is alive, so read it with Max by router. A cloud on OVN has no such agents, and so no such series.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "router_id",
      "l3_agent_id",
      "ha_state",
      "agent_alive",
      "agent_admin_up",
      "agent_host",
    ],
  }),
  metric({
    metricName: "openstack_neutron_network_ip_availabilities_total",
    friendlyName: translationKey("Addresses in a Subnet"),
    description:
      "How many addresses a subnet has, one series per subnet of each network.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: NETWORK_IP_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_network_ip_availabilities_used",
    friendlyName: translationKey("Addresses Used in a Subnet"),
    description:
      "How many of a subnet's addresses are taken, one series per subnet of each network.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: NETWORK_IP_LABELS,
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_network",
    friendlyName: translationKey("Network Info"),
    description:
      "One series per network, whose value is a numeric code for its status: ACTIVE is 0, BUILD is 1, DOWN is 2, ERROR is 3. Whether it is external is in the is_external label.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "tenant_id",
      "status",
      "name",
      "is_shared",
      "is_external",
      "provider_network_type",
      "provider_physical_network",
      "provider_segmentation_id",
      "subnets",
      "tags",
      "mtu",
    ],
  }),
  metric({
    metricName: "openstack_neutron_networks",
    friendlyName: translationKey("Networks"),
    description: "How many networks the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_subnet",
    friendlyName: translationKey("Subnet Info"),
    description: "One series per subnet, always 1, with its details in labels.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "tenant_id",
      "name",
      "network_id",
      "cidr",
      "gateway_ip",
      "enable_dhcp",
      "dns_nameservers",
      "tags",
    ],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_subnets",
    friendlyName: translationKey("Subnets"),
    description: "How many subnets the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_subnets_total",
    friendlyName: translationKey("Subnet Pool Capacity"),
    description:
      "How many subnets of a prefix length a subnet pool could hold in all.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: SUBNET_POOL_LABELS,
    offByDefault: "neutron-subnets_total",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_subnets_used",
    friendlyName: translationKey("Subnet Pool Used"),
    description:
      "How many subnets of a prefix length a subnet pool has given out.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: SUBNET_POOL_LABELS,
    offByDefault: "neutron-subnets_total",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_subnets_free",
    friendlyName: translationKey("Subnet Pool Free"),
    description:
      "How many subnets of a prefix length a subnet pool has left to give.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Network,
    identityAttributes: SUBNET_POOL_LABELS,
    offByDefault: "neutron-subnets_total",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_router",
    friendlyName: translationKey("Router Info"),
    description:
      "One series per router, always 1, with its status and admin_state_up labels.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "name",
      "project_id",
      "admin_state_up",
      "status",
      "external_network_id",
    ],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_routers",
    friendlyName: translationKey("Routers"),
    description: "How many routers the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_floating_ip",
    friendlyName: translationKey("Floating IP Info"),
    description:
      "One series per floating IP, always 1, with its status and the router it goes through in labels. A spare one reads DOWN with no router_id.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "floating_network_id",
      "router_id",
      "status",
      "project_id",
      "floating_ip_address",
    ],
    probeOnlyAttributes: ["port_id"],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_floating_ips",
    friendlyName: translationKey("Floating IPs"),
    description: "How many floating IPs the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_security_groups",
    friendlyName: translationKey("Security Groups"),
    description: "How many security groups Neutron has in the region.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_port",
    friendlyName: translationKey("Port Info"),
    description:
      "One series per port, always 1, with its status and binding_vif_type labels. The agent keeps it off, because listing every port with an admin credential can saturate Neutron on a large cloud.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "uuid",
      "network_id",
      "mac_address",
      "device_owner",
      "device_id",
      "status",
      "binding_vif_type",
      "admin_state_up",
      "fixed_ips",
    ],
    offByDefault: "neutron-port",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_ports",
    friendlyName: translationKey("Ports"),
    description:
      "How many ports the region has. The agent keeps it off, because listing every port with an admin credential can saturate Neutron on a large cloud.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    offByDefault: "neutron-ports",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_ports_no_ips",
    friendlyName: translationKey("Active Ports Without an Address"),
    description:
      "How many ACTIVE ports have no address. The agent keeps it off, with the other port series.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    offByDefault: "neutron-ports_no_ips",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_ports_lb_not_active",
    friendlyName: translationKey("Load Balancer Ports Not Active"),
    description:
      "How many load balancer ports are not ACTIVE. The agent keeps it off, with the other port series.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    offByDefault: "neutron-ports_lb_not_active",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_vpn_endpoint_groups",
    friendlyName: translationKey("VPN Endpoint Groups"),
    description: "How many VPN endpoint groups the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_vpn_ike_policies",
    friendlyName: translationKey("VPN IKE Policies"),
    description: "How many VPN IKE policies the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_vpn_ipsec_policies",
    friendlyName: translationKey("VPN IPsec Policies"),
    description: "How many VPN IPsec policies the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_vpn_services",
    friendlyName: translationKey("VPN Services"),
    description: "How many VPN services the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_vpn_service",
    friendlyName: translationKey("VPN Service Status"),
    description:
      "One series per VPN service, whose value is a numeric code for its status: ACTIVE is 0, DOWN is 1, BUILD is 2, ERROR is 3.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "project_id",
      "subnet_id",
      "router_id",
      "admin_state_up",
      "name",
      "external_ipv4",
      "external_ipv6",
      "flavor_id",
    ],
  }),
  metric({
    metricName: "openstack_neutron_vpn_siteconnections",
    friendlyName: translationKey("VPN Site Connections"),
    description: "How many VPN site connections the region has.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_vpn_siteconnection",
    friendlyName: translationKey("VPN Site Connection Status"),
    description:
      "One series per VPN site connection, whose value is a numeric code for its status: ACTIVE is 0, DOWN is 1, BUILD is 2, ERROR is 3.",
    category: "Network",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: [
      "id",
      "project_id",
      "admin_state_up",
      "name",
      "vpn_service_id",
      "ike_policy_id",
      "ipsec_policy_id",
      "peer_id",
      "peer_ep_group_id",
      "local_id",
      "local_ep_group_id",
    ],
  }),

  // Storage.
  metric({
    metricName: "openstack_cinder_pool_capacity_total_gb",
    friendlyName: translationKey("Storage Pool Capacity"),
    description: "How much a Cinder storage pool holds, as its backend says.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: POOL_LABELS,
    probeOnlyAttributes: POOL_PROBE_ONLY_LABELS,
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_pool_capacity_free_gb",
    friendlyName: translationKey("Storage Pool Free"),
    description:
      "How much of a Cinder storage pool is free, as its backend says.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Min,
    service: OpenStackServiceType.Volume,
    identityAttributes: POOL_LABELS,
    probeOnlyAttributes: POOL_PROBE_ONLY_LABELS,
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_volume_status_counter",
    friendlyName: translationKey("Volumes by Status"),
    description:
      "How many volumes are in each status, one series per status word in the status label. A known status with no volumes reads 0.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: ["status"],
    unit: "count",
  }),
  metric({
    metricName: "openstack_cinder_volume_gb",
    friendlyName: translationKey("Volume Size"),
    description:
      "One series per volume, whose value is its size, with its status word in the status label.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: [
      "id",
      "name",
      "status",
      "availability_zone",
      "bootable",
      "tenant_id",
      "user_id",
      "volume_type",
      "server_id",
    ],
    probeOnlyAttributes: ["updated_at"],
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_snapshot_gb",
    friendlyName: translationKey("Snapshot Size"),
    description:
      "One series per volume snapshot, whose value is its size, with its status word in the status label. Only a probe sends this: the agent's exporter only counts snapshots.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: [
      "id",
      "name",
      "status",
      "tenant_id",
      "volume_id",
      "updated_at",
    ],
    onlyFromProbe: true,
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_backup_gb",
    friendlyName: translationKey("Backup Size"),
    description:
      "One series per volume backup, whose value is its size, with its status word in the status label, so a backup that keeps failing can be seen. Only a probe sends this: the agent's exporter has no backups.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: [
      "id",
      "name",
      "status",
      "tenant_id",
      "volume_id",
      "availability_zone",
      "is_incremental",
      "updated_at",
    ],
    onlyFromProbe: true,
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_volume_status",
    friendlyName: translationKey("Volume Status (Deprecated)"),
    description:
      "One series per volume, whose value is a numeric code for its status. The exporter has deprecated it: read Volume Size's status label, or Volumes by Status.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: [
      "id",
      "name",
      "status",
      "bootable",
      "tenant_id",
      "size",
      "volume_type",
      "server_id",
    ],
  }),
  metric({
    metricName: "openstack_cinder_volumes",
    friendlyName: translationKey("Volumes"),
    description: "How many volumes the region has.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_cinder_snapshots",
    friendlyName: translationKey("Volume Snapshots"),
    description: "How many volume snapshots the region has.",
    category: "Storage",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: [],
    unit: "count",
  }),

  // Images.
  metric({
    metricName: "openstack_glance_images",
    friendlyName: translationKey("Images"),
    description: "How many images the region has.",
    category: "Images",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Image,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_glance_image_bytes",
    friendlyName: translationKey("Image Size"),
    description: "One series per image, whose value is its size.",
    category: "Images",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Image,
    identityAttributes: ["id", "name", "tenant_id"],
    probeOnlyAttributes: ["image_type", "updated_at"],
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_glance_image_created_at",
    friendlyName: translationKey("Image Created"),
    description:
      "One series per image, whose value is when it was created, as a Unix time.",
    category: "Images",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Image,
    identityAttributes: [
      "id",
      "name",
      "tenant_id",
      "visibility",
      "hidden",
      "status",
    ],
    unit: "seconds",
  }),

  // Identity.
  metric({
    metricName: "openstack_identity_project_info",
    friendlyName: translationKey("Project Info"),
    description:
      "One series per project, always 1, with its name, domain and enabled labels.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: [
      "is_domain",
      "description",
      "domain_id",
      "enabled",
      "id",
      "name",
      "parent_id",
      "tags",
    ],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_projects",
    friendlyName: translationKey("Projects"),
    description: "How many projects the cloud has.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_domain_info",
    friendlyName: translationKey("Domain Info"),
    description:
      "One series per domain, always 1, with its name and enabled labels.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: ["description", "enabled", "id", "name"],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_domains",
    friendlyName: translationKey("Domains"),
    description: "How many domains the cloud has.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_users",
    friendlyName: translationKey("Users"),
    description: "How many users the cloud has.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_groups",
    friendlyName: translationKey("Groups"),
    description: "How many groups the cloud has.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    unit: "count",
  }),
  metric({
    metricName: "openstack_identity_regions",
    friendlyName: translationKey("Regions"),
    description: "How many regions Keystone knows.",
    category: "Identity",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Identity,
    identityAttributes: [],
    unit: "count",
  }),

  /*
   * Projects: what a project may use and has used. All of these read the API once
   * per project on every collection, so the agent's exporter leaves them out by
   * name. A limit of -1 means no limit.
   */
  metric({
    metricName: "openstack_nova_limits_vcpus_max",
    friendlyName: translationKey("Project vCPU Limit"),
    description: "How many vCPUs a project may use, and -1 for no limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: COMPUTE_LIMIT_LABELS,
    offByDefault: "nova-limits_vcpus_max",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_limits_vcpus_used",
    friendlyName: translationKey("Project vCPUs Used"),
    description: "How many vCPUs a project's instances hold.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: COMPUTE_LIMIT_LABELS,
    offByDefault: "nova-limits_vcpus_max",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_limits_memory_max",
    friendlyName: translationKey("Project Memory Limit"),
    description:
      "How much memory, in MiB, a project may use, and -1 for no limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: COMPUTE_LIMIT_LABELS,
    offByDefault: "nova-limits_vcpus_max",
    unit: "MiB",
  }),
  metric({
    metricName: "openstack_nova_limits_memory_used",
    friendlyName: translationKey("Project Memory Used"),
    description: "How much memory, in MiB, a project's instances hold.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: COMPUTE_LIMIT_LABELS,
    offByDefault: "nova-limits_vcpus_max",
    unit: "MiB",
  }),
  metric({
    metricName: "openstack_nova_limits_instances_max",
    friendlyName: translationKey("Project Instance Limit"),
    description: "How many instances a project may have, and -1 for no limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: COMPUTE_LIMIT_LABELS,
    offByDefault: "nova-limits_vcpus_max",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_limits_instances_used",
    friendlyName: translationKey("Project Instances Used"),
    description: "How many instances a project has.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: COMPUTE_LIMIT_LABELS,
    offByDefault: "nova-limits_vcpus_max",
    unit: "count",
  }),
  metric({
    metricName: "openstack_cinder_limits_volume_max_gb",
    friendlyName: translationKey("Project Volume Limit"),
    description:
      "How much volume space a project may use, and -1 for no limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: VOLUME_LIMIT_LABELS,
    offByDefault: "cinder-limits_volume_max_gb",
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_limits_volume_used_gb",
    friendlyName: translationKey("Project Volume Space Used"),
    description: "How much volume space a project holds.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: VOLUME_LIMIT_LABELS,
    offByDefault: "cinder-limits_volume_max_gb",
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_limits_backup_max_gb",
    friendlyName: translationKey("Project Backup Limit"),
    description:
      "How much backup space a project may use, and -1 for no limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: VOLUME_LIMIT_LABELS,
    offByDefault: "cinder-limits_volume_max_gb",
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_limits_backup_used_gb",
    friendlyName: translationKey("Project Backup Space Used"),
    description: "How much backup space a project holds.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: VOLUME_LIMIT_LABELS,
    offByDefault: "cinder-limits_volume_max_gb",
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_cinder_volume_type_quota_gigabytes",
    friendlyName: translationKey("Project Quota per Volume Type"),
    description: "How much of one volume type a project may use.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Volume,
    identityAttributes: ["tenant", "tenant_id", "volume_type"],
    offByDefault: "cinder-limits_volume_max_gb",
    unit: "GiB",
  }),
  metric({
    metricName: "openstack_nova_quota_cores",
    friendlyName: translationKey("Project vCPU Quota"),
    description:
      "A project's vCPU quota. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_instances",
    friendlyName: translationKey("Project Instance Quota"),
    description:
      "A project's instance quota. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_ram",
    friendlyName: translationKey("Project Memory Quota"),
    description:
      "A project's memory quota in MiB. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "MiB",
  }),
  metric({
    metricName: "openstack_nova_quota_key_pairs",
    friendlyName: translationKey("Project Key Pair Quota"),
    description:
      "A project's key pair quota. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_metadata_items",
    friendlyName: translationKey("Project Metadata Item Quota"),
    description:
      "A project's quota of metadata items per instance. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_server_groups",
    friendlyName: translationKey("Project Server Group Quota"),
    description:
      "A project's server group quota. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_server_group_members",
    friendlyName: translationKey("Project Server Group Member Quota"),
    description:
      "A project's quota of members per server group. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_fixed_ips",
    friendlyName: translationKey("Project Fixed IP Quota"),
    description:
      "A project's fixed IP quota in Nova, which modern clouds leave to Neutron. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_floating_ips",
    friendlyName: translationKey("Project Floating IP Quota (Nova)"),
    description:
      "A project's floating IP quota in Nova, which modern clouds leave to Neutron. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_security_groups",
    friendlyName: translationKey("Project Security Group Quota (Nova)"),
    description:
      "A project's security group quota in Nova, which modern clouds leave to Neutron. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_security_group_rules",
    friendlyName: translationKey("Project Security Group Rule Quota (Nova)"),
    description:
      "A project's security group rule quota in Nova, which modern clouds leave to Neutron. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_injected_files",
    friendlyName: translationKey("Project Injected File Quota"),
    description:
      "A project's quota of files injected per instance. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "count",
  }),
  metric({
    metricName: "openstack_nova_quota_injected_file_content_bytes",
    friendlyName: translationKey("Project Injected File Size Quota"),
    description:
      "A project's quota on the size of an injected file. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_nova_quota_injected_file_path_bytes",
    friendlyName: translationKey("Project Injected File Path Quota"),
    description:
      "A project's quota on the length of an injected file's path. Its type label says which number this is: in_use, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Compute,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "nova-quota_cores",
    unit: "bytes",
  }),
  metric({
    metricName: "openstack_neutron_quota_network",
    friendlyName: translationKey("Project Network Quota"),
    description:
      "A project's network quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_subnet",
    friendlyName: translationKey("Project Subnet Quota"),
    description:
      "A project's subnet quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_subnetpool",
    friendlyName: translationKey("Project Subnet Pool Quota"),
    description:
      "A project's subnet pool quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_port",
    friendlyName: translationKey("Project Port Quota"),
    description:
      "A project's port quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_router",
    friendlyName: translationKey("Project Router Quota"),
    description:
      "A project's router quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_floatingip",
    friendlyName: translationKey("Project Floating IP Quota"),
    description:
      "A project's floating IP quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_security_group",
    friendlyName: translationKey("Project Security Group Quota"),
    description:
      "A project's security group quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_security_group_rule",
    friendlyName: translationKey("Project Security Group Rule Quota"),
    description:
      "A project's security group rule quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),
  metric({
    metricName: "openstack_neutron_quota_rbac_policy",
    friendlyName: translationKey("Project RBAC Policy Quota"),
    description:
      "A project's RBAC policy quota. Its type label says which number this is: used, reserved or limit.",
    category: "Projects",
    defaultAggregation: MetricsAggregationType.Max,
    service: OpenStackServiceType.Network,
    identityAttributes: QUOTA_LABELS,
    offByDefault: "neutron-quota_network",
    unit: "count",
  }),

  // What is really busy, as apart from what Placement has promised.
  usage({
    metricName: OpenStackInstanceMetric.CpuUsage,
    friendlyName: translationKey("Instance CPU in Use"),
    description:
      "How many of its hypervisor's CPU threads this instance is using, worked out from its cumulative CPU time.",
    identityAttributes: INSTANCE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.CpuUtilization,
    friendlyName: translationKey("Instance CPU Utilization"),
    description:
      "That CPU as a share of the instance's own vCPUs. 100 is every vCPU busy, and it can read past 100 while QEMU's own threads work for it.",
    identityAttributes: INSTANCE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.CpuContention,
    friendlyName: translationKey("Instance CPU Contention"),
    description:
      "How much of the time the instance's vCPUs wanted to run and the hypervisor made them wait, as a share of its vCPUs: the guest calls this steal. It says a neighbour is the problem rather than the instance. From libvirt's exporter, and from Ceilometer on releases that have its cpu.delay meter.",
    identityAttributes: INSTANCE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.MemoryUsage,
    friendlyName: translationKey("Instance Memory in Use"),
    description:
      "What the guest says it is using, from its balloon driver. A guest without one has no such reading.",
    identityAttributes: INSTANCE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.MemoryResident,
    friendlyName: translationKey("Instance Memory on Host"),
    description:
      "What the instance really holds of its hypervisor's memory, whatever the guest says it is using.",
    identityAttributes: INSTANCE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.DiskReadRate,
    friendlyName: translationKey("Instance Disk Read Rate"),
    description: "Bytes per second this instance is reading from one disk.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.DiskWriteRate,
    friendlyName: translationKey("Instance Disk Write Rate"),
    description: "Bytes per second this instance is writing to one disk.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.DiskReadOperations,
    friendlyName: translationKey("Instance Disk Reads"),
    description: "Read requests per second on one disk of this instance.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.DiskWriteOperations,
    friendlyName: translationKey("Instance Disk Writes"),
    description: "Write requests per second on one disk of this instance.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.DiskReadLatency,
    friendlyName: translationKey("Instance Disk Read Latency"),
    description:
      "How long a read took on one disk of this instance, on average. A disk with no reads has no reading, rather than reading 0.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.DiskWriteLatency,
    friendlyName: translationKey("Instance Disk Write Latency"),
    description:
      "How long a write took on one disk of this instance, on average. A disk with no writes has no reading, rather than reading 0.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.NetworkReceiveRate,
    friendlyName: translationKey("Instance Network Receive Rate"),
    description:
      "Bytes per second reaching this instance on one network interface.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackInstanceMetric.NetworkTransmitRate,
    friendlyName: translationKey("Instance Network Transmit Rate"),
    description:
      "Bytes per second leaving this instance on one network interface.",
    identityAttributes: INSTANCE_DEVICE_LABELS,
  }),
  usage({
    metricName: OpenStackHypervisorMetric.InstancesCpuUsage,
    friendlyName: translationKey("Hypervisor CPU Used by Instances"),
    description:
      "How many of this hypervisor's CPU threads its instances are using between them. The host's own processes are not in this: the Host product has them, where OneUptime's agent runs on it.",
    identityAttributes: HYPERVISOR_USAGE_LABELS,
  }),
  usage({
    metricName: OpenStackHypervisorMetric.InstancesCpuUtilization,
    friendlyName: translationKey("Hypervisor CPU Share Used by Instances"),
    description:
      "That as a share of the CPU threads this hypervisor has, before any allocation ratio. 100 is every thread busy. It needs the inventory to know what the hypervisor has.",
    identityAttributes: HYPERVISOR_USAGE_LABELS,
  }),
  usage({
    metricName: OpenStackHypervisorMetric.InstancesMemoryResident,
    friendlyName: translationKey("Hypervisor Memory Held by Instances"),
    description:
      "What this hypervisor's instances really hold of its memory between them, whatever they have been promised.",
    identityAttributes: HYPERVISOR_USAGE_LABELS,
  }),
  usage({
    metricName: OpenStackHypervisorMetric.InstancesMemoryUtilization,
    friendlyName: translationKey("Hypervisor Memory Share Held by Instances"),
    description:
      "That as a share of the memory this hypervisor has, before any allocation ratio. It needs the inventory to know what the hypervisor has.",
    identityAttributes: HYPERVISOR_USAGE_LABELS,
  }),
  usage({
    metricName: OpenStackHypervisorMetric.InstancesReporting,
    friendlyName: translationKey("Hypervisor Instances Reporting"),
    description:
      "How many instances those series add up, so a total can be told from a total with some of them missing.",
    identityAttributes: HYPERVISOR_USAGE_LABELS,
  }),
];

export function getAllOpenStackMetrics(): Array<OpenStackMetricDefinition> {
  return openStackMetricCatalog;
}

export function getOpenStackMetricsByCategory(
  category: OpenStackMetricCategory,
): Array<OpenStackMetricDefinition> {
  return openStackMetricCatalog.filter((m: OpenStackMetricDefinition) => {
    return m.category === category;
  });
}

export function getOpenStackMetricById(
  id: string,
): OpenStackMetricDefinition | undefined {
  return openStackMetricCatalog.find((m: OpenStackMetricDefinition) => {
    return m.id === id;
  });
}

export function getOpenStackMetricByMetricName(
  metricName: string,
): OpenStackMetricDefinition | undefined {
  return openStackMetricCatalog.find((m: OpenStackMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllOpenStackMetricCategories(): Array<OpenStackMetricCategory> {
  return [
    "Availability",
    "Control Plane",
    "Compute",
    "Network",
    "Storage",
    "Images",
    "Identity",
    "Projects",
  ];
}
