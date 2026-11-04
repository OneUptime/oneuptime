import { OpenStackServiceType } from "../../../../Types/OpenStack/OpenStackResourceKind";

/*
 * What the exporter the OpenStack agent pins says, for tests that pin the OneUptime
 * side to it: every series, its exact labels, and what its status codes mean.
 *
 * Copied from openstack-exporter's own source at the revision the pinned image is
 * built from (exporters/{keystone,nova,placement,neutron,cinder,glance}.go), and
 * checked against what that image answered on a real DevStack: `recorded` says this
 * series was in the recording (scenes healthy and compute-disabled), with exactly
 * these labels. The rest did not appear because the test cloud had none of them
 * (volumes, L3 agents on OVN, VPNs) or they were switched off at the time, so only
 * the source vouches for them.
 *
 * Newer sources differ: at this revision openstack_nova_running_vms has no tenant_id,
 * openstack_neutron_floating_ip has no port_id or fixed_ip_address, and Cinder has no
 * snapshot_gb or backup series. So this goes stale the moment the agent moves to
 * another exporter, which is why OPENSTACK_EXPORTER_IMAGE is checked against
 * agents/OpenStackAgent/docker-compose.yml: bumping the image fails the tests until
 * someone re-reads those files and updates this one.
 */
export const OPENSTACK_EXPORTER_IMAGE: string =
  "ghcr.io/openstack-exporter/openstack-exporter:2.0.0-alpha@sha256:2a864f41db28a1656a5034e8a17831fb37986e8856fd3f5361586a05f928950a";

// The source revision the pinned image's own log says it was built from.
export const OPENSTACK_EXPORTER_REVISION: string =
  "38c8acfd06300b27d3f7cc3eb705dc5713c936e6";

export interface OpenStackExporterSeries {
  labels: ReadonlyArray<string>;
  service: OpenStackServiceType;
  recorded: boolean;
}

export const OPENSTACK_EXPORTER_SERIES: Readonly<
  Record<string, OpenStackExporterSeries>
> = {
  openstack_cinder_agent_state: {
    labels: [
      "adminState",
      "disabledReason",
      "hostname",
      "service",
      "uuid",
      "zone",
    ],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_cinder_limits_backup_max_gb: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_limits_backup_used_gb: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_limits_volume_max_gb: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_limits_volume_used_gb: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_pool_capacity_free_gb: {
    labels: ["name", "vendor_name", "volume_backend_name"],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_cinder_pool_capacity_total_gb: {
    labels: ["name", "vendor_name", "volume_backend_name"],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_cinder_snapshots: {
    labels: [],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_cinder_up: {
    labels: [],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_cinder_volume_gb: {
    labels: [
      "availability_zone",
      "bootable",
      "id",
      "name",
      "server_id",
      "status",
      "tenant_id",
      "user_id",
      "volume_type",
    ],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_volume_status: {
    labels: [
      "bootable",
      "id",
      "name",
      "server_id",
      "size",
      "status",
      "tenant_id",
      "volume_type",
    ],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_volume_status_counter: {
    labels: ["status"],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_cinder_volume_type_quota_gigabytes: {
    labels: ["tenant", "tenant_id", "volume_type"],
    service: OpenStackServiceType.Volume,
    recorded: false,
  },
  openstack_cinder_volumes: {
    labels: [],
    service: OpenStackServiceType.Volume,
    recorded: true,
  },
  openstack_glance_image_bytes: {
    labels: ["id", "name", "tenant_id"],
    service: OpenStackServiceType.Image,
    recorded: false,
  },
  openstack_glance_image_created_at: {
    labels: ["hidden", "id", "name", "status", "tenant_id", "visibility"],
    service: OpenStackServiceType.Image,
    recorded: false,
  },
  openstack_glance_images: {
    labels: [],
    service: OpenStackServiceType.Image,
    recorded: true,
  },
  openstack_glance_up: {
    labels: [],
    service: OpenStackServiceType.Image,
    recorded: true,
  },
  openstack_identity_domain_info: {
    labels: ["description", "enabled", "id", "name"],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_domains: {
    labels: [],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_groups: {
    labels: [],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_project_info: {
    labels: [
      "description",
      "domain_id",
      "enabled",
      "id",
      "is_domain",
      "name",
      "parent_id",
      "tags",
    ],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_projects: {
    labels: [],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_regions: {
    labels: [],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_up: {
    labels: [],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_identity_users: {
    labels: [],
    service: OpenStackServiceType.Identity,
    recorded: true,
  },
  openstack_neutron_agent_state: {
    labels: ["adminState", "availability_zone", "hostname", "id", "service"],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_floating_ip: {
    labels: [
      "floating_ip_address",
      "floating_network_id",
      "id",
      "project_id",
      "router_id",
      "status",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_floating_ips: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_floating_ips_associated_not_active: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_l3_agent_of_router: {
    labels: [
      "agent_admin_up",
      "agent_alive",
      "agent_host",
      "ha_state",
      "l3_agent_id",
      "router_id",
    ],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_network: {
    labels: [
      "id",
      "is_external",
      "is_shared",
      "mtu",
      "name",
      "provider_network_type",
      "provider_physical_network",
      "provider_segmentation_id",
      "status",
      "subnets",
      "tags",
      "tenant_id",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_network_ip_availabilities_total: {
    labels: [
      "cidr",
      "ip_version",
      "network_id",
      "network_name",
      "project_id",
      "subnet_name",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_network_ip_availabilities_used: {
    labels: [
      "cidr",
      "ip_version",
      "network_id",
      "network_name",
      "project_id",
      "subnet_name",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_networks: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_port: {
    labels: [
      "admin_state_up",
      "binding_vif_type",
      "device_id",
      "device_owner",
      "fixed_ips",
      "mac_address",
      "network_id",
      "status",
      "uuid",
    ],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_ports: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_ports_lb_not_active: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_ports_no_ips: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_floatingip: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_network: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_port: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_rbac_policy: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_router: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_security_group: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_security_group_rule: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_subnet: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_quota_subnetpool: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_router: {
    labels: [
      "admin_state_up",
      "external_network_id",
      "id",
      "name",
      "project_id",
      "status",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_routers: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_routers_not_active: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_security_groups: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_subnet: {
    labels: [
      "cidr",
      "dns_nameservers",
      "enable_dhcp",
      "gateway_ip",
      "id",
      "name",
      "network_id",
      "tags",
      "tenant_id",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_subnets: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_subnets_free: {
    labels: [
      "ip_version",
      "prefix",
      "prefix_length",
      "project_id",
      "subnet_pool_id",
      "subnet_pool_name",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_subnets_total: {
    labels: [
      "ip_version",
      "prefix",
      "prefix_length",
      "project_id",
      "subnet_pool_id",
      "subnet_pool_name",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_subnets_used: {
    labels: [
      "ip_version",
      "prefix",
      "prefix_length",
      "project_id",
      "subnet_pool_id",
      "subnet_pool_name",
    ],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_up: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: true,
  },
  openstack_neutron_vpn_endpoint_groups: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_vpn_ike_policies: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_vpn_ipsec_policies: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_vpn_service: {
    labels: [
      "admin_state_up",
      "external_ipv4",
      "external_ipv6",
      "flavor_id",
      "id",
      "name",
      "project_id",
      "router_id",
      "subnet_id",
    ],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_vpn_services: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_vpn_siteconnection: {
    labels: [
      "admin_state_up",
      "id",
      "ike_policy_id",
      "ipsec_policy_id",
      "local_ep_group_id",
      "local_id",
      "name",
      "peer_ep_group_id",
      "peer_id",
      "project_id",
      "vpn_service_id",
    ],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_neutron_vpn_siteconnections: {
    labels: [],
    service: OpenStackServiceType.Network,
    recorded: false,
  },
  openstack_nova_agent_state: {
    labels: [
      "adminState",
      "disabledReason",
      "hostname",
      "id",
      "service",
      "zone",
    ],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_availability_zones: {
    labels: [],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_current_workload: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_flavor: {
    labels: ["disk", "id", "is_public", "name", "ram", "vcpus"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_flavors: {
    labels: [],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_free_disk_bytes: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_limits_instances_max: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_limits_instances_used: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_limits_memory_max: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_limits_memory_used: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_limits_vcpus_max: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_limits_vcpus_used: {
    labels: ["tenant", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_local_storage_available_bytes: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_local_storage_used_bytes: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_memory_available_bytes: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_memory_used_bytes: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_cores: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_fixed_ips: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_floating_ips: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_injected_file_content_bytes: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_injected_file_path_bytes: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_injected_files: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_instances: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_key_pairs: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_metadata_items: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_ram: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_security_group_rules: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_security_groups: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_server_group_members: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_quota_server_groups: {
    labels: ["tenant", "tenant_id", "type"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_running_vms: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_security_groups: {
    labels: [],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_server_local_gb: {
    labels: ["id", "name", "tenant_id"],
    service: OpenStackServiceType.Compute,
    recorded: false,
  },
  openstack_nova_server_status: {
    labels: [
      "address_ipv4",
      "address_ipv6",
      "availability_zone",
      "flavor_id",
      "host_id",
      "hypervisor_hostname",
      "id",
      "instance_libvirt",
      "name",
      "status",
      "tenant_id",
      "user_id",
      "uuid",
    ],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_total_vms: {
    labels: [],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_up: {
    labels: [],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_vcpus_available: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_nova_vcpus_used: {
    labels: ["aggregates", "availability_zone", "hostname"],
    service: OpenStackServiceType.Compute,
    recorded: true,
  },
  openstack_placement_resource_allocation_ratio: {
    labels: ["hostname", "resourcetype"],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
  openstack_placement_resource_generation: {
    labels: ["hostname", "resourcetype"],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
  openstack_placement_resource_provider_allocations: {
    labels: ["hostname", "resourcetype", "uuid"],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
  openstack_placement_resource_reserved: {
    labels: ["hostname", "resourcetype"],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
  openstack_placement_resource_total: {
    labels: ["hostname", "resourcetype"],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
  openstack_placement_resource_usage: {
    labels: ["hostname", "resourcetype"],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
  openstack_placement_up: {
    labels: [],
    service: OpenStackServiceType.Placement,
    recorded: true,
  },
};

/*
 * The Prometheus receiver's own series for a collection, beside the exporter's: in the
 * recording's OTLP, with `openstack.region.name` and `openstack_service` on each.
 */
export const OPENSTACK_RECEIVER_SERIES: ReadonlyArray<string> = [
  "up",
  "scrape_samples_scraped",
];

// knownServerStatuses, nova.go: the value of openstack_nova_server_status.
export const OPENSTACK_EXPORTER_INSTANCE_STATUS_CODES: Readonly<
  Record<string, number>
> = {
  ACTIVE: 0,
  BUILD: 1,
  "BUILD(spawning)": 2,
  DELETED: 3,
  ERROR: 4,
  HARD_REBOOT: 5,
  PASSWORD: 6,
  REBOOT: 7,
  REBUILD: 8,
  RESCUE: 9,
  RESIZE: 10,
  SHUTOFF: 11,
  SUSPENDED: 12,
  UNKNOWN: 13,
  VERIFY_RESIZE: 14,
  MIGRATING: 15,
  PAUSED: 16,
  REVERT_RESIZE: 17,
  SHELVED: 18,
  SHELVED_OFFLOADED: 19,
  SOFT_DELETED: 20,
};

// knownVolumeStatuses, cinder.go: the words openstack_cinder_volume_status_counter holds.
export const OPENSTACK_EXPORTER_VOLUME_STATUSES: ReadonlyArray<string> = [
  "creating",
  "available",
  "reserved",
  "attaching",
  "detaching",
  "in-use",
  "maintenance",
  "deleting",
  "awaiting-transfer",
  "error",
  "error_deleting",
  "backing-up",
  "restoring-backup",
  "error_backing-up",
  "error_restoring",
  "error_extending",
  "downloading",
  "uploading",
  "retyping",
  "extending",
];
