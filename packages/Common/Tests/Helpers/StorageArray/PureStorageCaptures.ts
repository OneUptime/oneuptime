/*
 * What a Pure Storage FlashArray and FlashBlade answer on each endpoint the
 * OneUptime Storage Array Agent scrapes (agents/StorageArrayAgent), as the
 * Prometheus text exposition the collector reads.
 *
 * Not a recording from hardware: no array is reachable from CI. Every
 * family, label set and value shape follows Pure's own exporters
 * (pure-fa-openmetrics-exporter v1.0.27, which the native Purity//FA 6.7
 * /metrics endpoint mirrors, and pure-fb-openmetrics-exporter v1.1.4), the
 * same declarations StorageArraySnapshotScan.test.ts holds every series to:
 * a label appears only on the families that declare it. Empty label values
 * (a volume outside any pod, a host in no host group) are written as the
 * exporters write them, and dropped by the receiver as Prometheus drops them.
 *
 * Each capture holds the families OneUptime reads into its inventory and
 * snapshot and, beside them, families it leaves to the charts (array
 * performance, volume groups, voltages, packets, replication bandwidth), so
 * a test sees that those are passed over.
 *
 * The arrays describe a day with things wrong on it: a failed drive in the
 * FlashArray's bay 3 (its bay critical too), a degraded fan, a host that
 * reaches the array through one controller, a pod whose second replica link
 * is a minute and a half behind and whose mediator one array cannot reach,
 * and a FlashBlade blade that is unhealthy.
 */

// 2026-11-24T09:00:00.000Z — the instant every capture was scraped at.
export const PURE_CAPTURE_TIME_MS: number = Date.UTC(2026, 10, 24, 9, 0, 0);

export type FlashArrayEndpoint =
  | "array"
  | "volumes"
  | "hosts"
  | "pods"
  | "directories";

export type FlashBladeEndpoint = "array" | "filesystems" | "objectstore";

const FA_INFO: string = `# HELP purefa_info FlashArray system information
# TYPE purefa_info gauge
purefa_info{array_name="fa-prod-01",os="Purity//FA",subscription_type="FlashArray",system_id="2b7c4e9a-58f1-4d0e-9a63-1f0c8e5d7a42",version="6.7.3"} 1
`;

const FB_INFO: string = `# HELP purefb_info FlashBlade system information
# TYPE purefb_info gauge
purefb_info{array_name="fb-prod-01",os="Purity//FB",system_id="9e1d0c7b-3a26-4f58-b4e1-6c2a9f8d0b13",version="4.5.2"} 1
`;

export const FLASHARRAY_CAPTURES: Record<FlashArrayEndpoint, string> = {
  array: `${FA_INFO}# HELP purefa_alerts_open FlashArray open alert events
# TYPE purefa_alerts_open gauge
purefa_alerts_open{category="hardware",code="36",component_type="drive",created="1764000000000",issue="failure",name="10451",severity="critical",summary="(hardware:drive) CH0.BAY3: failure"} 1
purefa_alerts_open{category="array",code="68",component_type="array",created="1763990000000",issue="capacity",name="10448",severity="warning",summary="(array:space) Array capacity above 90%"} 1
purefa_alerts_open{category="software",code="214",component_type="software",created="1763980000000",issue="upgrade_available",name="10440",severity="info",summary="(software) Purity//FA 6.7.4 is available"} 1
purefa_alerts_open{category="hardware",code="9",component_type="controller",created="1763970000000",issue="phonehome",name="10437",severity="hidden",summary="(hardware:controller) CT0: phonehome"} 1
# HELP purefa_array_space_bytes FlashArray array space in bytes
# TYPE purefa_array_space_bytes gauge
purefa_array_space_bytes{space="capacity"} 2.6388279066624e+13
purefa_array_space_bytes{space="empty"} 2.11106232532992e+12
purefa_array_space_bytes{space="replication"} 0
purefa_array_space_bytes{space="shared"} 3.298534883328e+12
purefa_array_space_bytes{space="snapshots"} 1.649267441664e+12
purefa_array_space_bytes{space="system"} 0
purefa_array_space_bytes{space="unique"} 1.9329731166208e+13
# HELP purefa_array_space_utilization FlashArray array space utilization in percent
# TYPE purefa_array_space_utilization gauge
purefa_array_space_utilization 92.0
# HELP purefa_array_space_data_reduction_ratio FlashArray array space data reduction
# TYPE purefa_array_space_data_reduction_ratio gauge
purefa_array_space_data_reduction_ratio 4.1666
# HELP purefa_array_performance_latency_usec FlashArray array latency in microseconds
# TYPE purefa_array_performance_latency_usec gauge
purefa_array_performance_latency_usec{dimension="usec_per_read_op"} 6100
purefa_array_performance_latency_usec{dimension="usec_per_write_op"} 830
purefa_array_performance_latency_usec{dimension="san_usec_per_read_op"} 120
# HELP purefa_array_performance_throughput_iops FlashArray array throughput in iops
# TYPE purefa_array_performance_throughput_iops gauge
purefa_array_performance_throughput_iops{dimension="reads_per_sec"} 18400
purefa_array_performance_throughput_iops{dimension="writes_per_sec"} 9300
# HELP purefa_array_performance_queue_depth_ops FlashArray array queue depth size
# TYPE purefa_array_performance_queue_depth_ops gauge
purefa_array_performance_queue_depth_ops 14
# HELP purefa_hw_component_status FlashArray hardware component status
# TYPE purefa_hw_component_status gauge
purefa_hw_component_status{component_name="CH0",component_status="ok",component_type="chassis"} 1
purefa_hw_component_status{component_name="CH0.BAY1",component_status="ok",component_type="drive_bay"} 1
purefa_hw_component_status{component_name="CH0.BAY3",component_status="critical",component_type="drive_bay"} 1
purefa_hw_component_status{component_name="CH0.BAY9",component_status="not_installed",component_type="drive_bay"} 1
purefa_hw_component_status{component_name="CH0.FAN1",component_status="degraded",component_type="cooling"} 1
purefa_hw_component_status{component_name="CH0.PWR0",component_status="ok",component_type="power_supply"} 1
purefa_hw_component_status{component_name="CH0.PWR1",component_status="device_off",component_type="power_supply"} 1
purefa_hw_component_status{component_name="CT0",component_status="ok",component_type="controller"} 1
purefa_hw_component_status{component_name="CT1",component_status="identifying",component_type="controller"} 1
purefa_hw_component_status{component_name="CT0.ETH0",component_status="ok",component_type="eth_port"} 1
# HELP purefa_hw_component_temperature_celsius FlashArray hardware component temperature in C
# TYPE purefa_hw_component_temperature_celsius gauge
purefa_hw_component_temperature_celsius{component_name="CH0",component_type="chassis"} 27
purefa_hw_component_temperature_celsius{component_name="CT0.TMP0",component_type="temp_sensor"} 41
purefa_hw_component_temperature_celsius{component_name="CT1.TMP0",component_type="temp_sensor"} 43.5
# HELP purefa_hw_component_voltage_volt FlashArray hardware component voltage
# TYPE purefa_hw_component_voltage_volt gauge
purefa_hw_component_voltage_volt{component_name="CH0.PWR0",component_type="power_supply"} 12.1
# HELP purefa_drive_capacity_bytes FlashArray drive capacity in bytes
# TYPE purefa_drive_capacity_bytes gauge
purefa_drive_capacity_bytes{component_name="CH0.BAY1",component_protocol="NVMe",component_status="healthy",component_type="DFM"} 3.8382295343104e+12
purefa_drive_capacity_bytes{component_name="CH0.BAY3",component_protocol="NVMe",component_status="failed",component_type="DFM"} 3.8382295343104e+12
purefa_drive_capacity_bytes{component_name="CH0.NVB0",component_protocol="NVMe",component_status="healthy",component_type="NVRAM"} 2.147483648e+10
# HELP purefa_hw_controller_info FlashArray controller info
# TYPE purefa_hw_controller_info gauge
purefa_hw_controller_info{mode="primary",model="FA-X70R4",name="CT0",status="ready",type="array_controller",version="6.7.3"} 1
purefa_hw_controller_info{mode="secondary",model="FA-X70R4",name="CT1",status="ready",type="array_controller",version="6.7.3"} 1
# HELP purefa_network_interface_speed_bandwidth_bytes FlashArray network interface speed in bytes per second
# TYPE purefa_network_interface_speed_bandwidth_bytes gauge
purefa_network_interface_speed_bandwidth_bytes{enabled="true",ethsubtype="physical",name="CT0.ETH0",services="management",type="eth"} 1.25e+09
purefa_network_interface_speed_bandwidth_bytes{enabled="true",ethsubtype="physical",name="CT0.ETH4",services="iscsi",type="eth"} 3.125e+09
purefa_network_interface_speed_bandwidth_bytes{enabled="false",ethsubtype="",name="CT0.FC1",services="scsi-fc",type="fc"} 4e+09
# HELP purefa_network_interface_performance_bandwidth_bytes FlashArray network interface bandwidth in bytes per second
# TYPE purefa_network_interface_performance_bandwidth_bytes gauge
purefa_network_interface_performance_bandwidth_bytes{dimension="received_bytes_per_sec",name="CT0.ETH4",type="eth"} 8.3886e+07
purefa_network_interface_performance_bandwidth_bytes{dimension="transmitted_bytes_per_sec",name="CT0.ETH4",type="eth"} 1.6777e+08
purefa_network_interface_performance_bandwidth_bytes{dimension="other_bytes_per_sec",name="CT0.ETH4",type="eth"} 1024
# HELP purefa_network_interface_performance_errors FlashArray network interface errors in errors per second
# TYPE purefa_network_interface_performance_errors gauge
purefa_network_interface_performance_errors{dimension="total_errors_per_sec",name="CT0.ETH4",type="eth"} 0.4
purefa_network_interface_performance_errors{dimension="received_crc_errors_per_sec",name="CT0.ETH4",type="eth"} 0.4
# HELP purefa_network_interface_performance_throughput_pkts FlashArray network interface throughput in packets per second
# TYPE purefa_network_interface_performance_throughput_pkts gauge
purefa_network_interface_performance_throughput_pkts{dimension="received_packets_per_sec",name="CT0.ETH4",type="eth"} 61000
`,
  volumes: `${FA_INFO}# HELP purefa_volume_space_bytes FlashArray volume space in bytes
# TYPE purefa_volume_space_bytes gauge
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01",pod="",space="total_provisioned",volume_group=""} 2.199023255552e+12
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01",pod="",space="total_physical",volume_group=""} 5.49755813888e+11
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01",pod="",space="snapshots",volume_group=""} 4.294967296e+10
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01",pod="",space="total_provisioned",volume_group=""} 5.49755813888e+11
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01",pod="",space="total_physical",volume_group=""} 6.8719476736e+10
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011003",name="pod-prod::vol-sync-01",pod="pod-prod",space="total_provisioned",volume_group=""} 1.099511627776e+12
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011003",name="pod-prod::vol-sync-01",pod="pod-prod",space="total_physical",volume_group=""} 3.2985348833e+11
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011004",name="vg-esx/vol-esx-01",pod="",space="total_provisioned",volume_group="vg-esx"} 4.398046511104e+12
purefa_volume_space_bytes{naa_id="624A9370B1D7D1E6F00A4F3B00011004",name="vg-esx/vol-esx-01",pod="",space="total_physical",volume_group="vg-esx"} 1.319413953331e+12
# HELP purefa_volume_space_data_reduction_ratio FlashArray volume data reduction ratio
# TYPE purefa_volume_space_data_reduction_ratio gauge
purefa_volume_space_data_reduction_ratio{naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01",pod="",volume_group=""} 3.4
purefa_volume_space_data_reduction_ratio{naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01",pod="",volume_group=""} 7.95
purefa_volume_space_data_reduction_ratio{naa_id="624A9370B1D7D1E6F00A4F3B00011004",name="vg-esx/vol-esx-01",pod="",volume_group="vg-esx"} 2.6
# HELP purefa_volume_performance_latency_usec FlashArray volume latency in microseconds
# TYPE purefa_volume_performance_latency_usec gauge
purefa_volume_performance_latency_usec{dimension="usec_per_read_op",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 410
purefa_volume_performance_latency_usec{dimension="usec_per_write_op",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 690
purefa_volume_performance_latency_usec{dimension="usec_per_mirrored_write_op",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 0
purefa_volume_performance_latency_usec{dimension="usec_per_read_op",naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01"} 9800
purefa_volume_performance_latency_usec{dimension="usec_per_write_op",naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01"} 1200
purefa_volume_performance_latency_usec{dimension="usec_per_mirrored_write_op",naa_id="624A9370B1D7D1E6F00A4F3B00011003",name="pod-prod::vol-sync-01"} 1450
# HELP purefa_volume_performance_throughput_iops FlashArray volume throughput in iops
# TYPE purefa_volume_performance_throughput_iops gauge
purefa_volume_performance_throughput_iops{dimension="reads_per_sec",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 5200
purefa_volume_performance_throughput_iops{dimension="writes_per_sec",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 2100
purefa_volume_performance_throughput_iops{dimension="mirrored_writes_per_sec",naa_id="624A9370B1D7D1E6F00A4F3B00011003",name="pod-prod::vol-sync-01"} 300
# HELP purefa_volume_performance_bandwidth_bytes FlashArray volume throughput in bytes per second
# TYPE purefa_volume_performance_bandwidth_bytes gauge
purefa_volume_performance_bandwidth_bytes{dimension="read_bytes_per_sec",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 4.2598e+07
purefa_volume_performance_bandwidth_bytes{dimension="write_bytes_per_sec",naa_id="624A9370B1D7D1E6F00A4F3B00011001",name="vol-db-01"} 1.7203e+07
# HELP purefa_volume_qos_iops_limit FlashArray volume QoS IOPS limit
# TYPE purefa_volume_qos_iops_limit gauge
purefa_volume_qos_iops_limit{naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01",pod="",volume_group=""} 20000
# HELP purefa_volume_qos_bandwidth_bytes_per_sec_limit FlashArray volume QoS bandwidth limit
# TYPE purefa_volume_qos_bandwidth_bytes_per_sec_limit gauge
purefa_volume_qos_bandwidth_bytes_per_sec_limit{naa_id="624A9370B1D7D1E6F00A4F3B00011002",name="vol-web-01",pod="",volume_group=""} 2.097152e+08
# HELP purefa_volume_group_performance_latency_usec FlashArray volume group latency in microseconds
# TYPE purefa_volume_group_performance_latency_usec gauge
purefa_volume_group_performance_latency_usec{dimension="usec_per_read_op",name="vg-esx"} 350
`,
  hosts: `${FA_INFO}# HELP purefa_host_connectivity_info FlashArray host connectivity info
# TYPE purefa_host_connectivity_info gauge
purefa_host_connectivity_info{details="Redundant",host="esx-01",status="healthy"} 1
purefa_host_connectivity_info{details="Single Controller",host="esx-02",status="critical"} 1
purefa_host_connectivity_info{details="None",host="esx-03",status="unused"} 1
purefa_host_connectivity_info{details="Redundant",host="db-01",status="healthy"} 1
# HELP purefa_host_connections_info FlashArray host volumes connections
# TYPE purefa_host_connections_info gauge
purefa_host_connections_info{host="esx-01",hostgroup="vsphere-prod",volume="vg-esx/vol-esx-01"} 1
purefa_host_connections_info{host="esx-02",hostgroup="vsphere-prod",volume="vg-esx/vol-esx-01"} 1
purefa_host_connections_info{host="esx-03",hostgroup="vsphere-prod",volume=""} 1
purefa_host_connections_info{host="db-01",hostgroup="",volume="vol-db-01"} 1
purefa_host_connections_info{host="db-01",hostgroup="",volume="vol-legacy-01"} 1
# HELP purefa_host_space_bytes FlashArray host volumes space in bytes
# TYPE purefa_host_space_bytes gauge
purefa_host_space_bytes{host="esx-01",space="total_provisioned"} 4.398046511104e+12
purefa_host_space_bytes{host="esx-01",space="total_physical"} 1.319413953331e+12
purefa_host_space_bytes{host="db-01",space="total_provisioned"} 2.31928233984e+12
purefa_host_space_bytes{host="db-01",space="total_physical"} 5.7982058496e+11
# HELP purefa_host_space_data_reduction_ratio FlashArray host volumes data reduction ratio
# TYPE purefa_host_space_data_reduction_ratio gauge
purefa_host_space_data_reduction_ratio{host="esx-01"} 2.6
purefa_host_space_data_reduction_ratio{host="db-01"} 3.4
# HELP purefa_host_performance_latency_usec FlashArray host latency in microseconds
# TYPE purefa_host_performance_latency_usec gauge
purefa_host_performance_latency_usec{dimension="usec_per_read_op",host="esx-01"} 520
purefa_host_performance_latency_usec{dimension="usec_per_write_op",host="esx-01"} 780
purefa_host_performance_latency_usec{dimension="usec_per_read_op",host="db-01"} 400
# HELP purefa_host_performance_throughput_iops FlashArray host throughput in iops
# TYPE purefa_host_performance_throughput_iops gauge
purefa_host_performance_throughput_iops{dimension="reads_per_sec",host="esx-01"} 11000
purefa_host_performance_throughput_iops{dimension="writes_per_sec",host="esx-01"} 6400
# HELP purefa_host_performance_bandwidth_bytes FlashArray host bandwidth in bytes per second
# TYPE purefa_host_performance_bandwidth_bytes gauge
purefa_host_performance_bandwidth_bytes{dimension="read_bytes_per_sec",host="esx-01"} 9.0177e+07
purefa_host_performance_bandwidth_bytes{dimension="write_bytes_per_sec",host="esx-01"} 5.2429e+07
`,
  pods: `${FA_INFO}# HELP purefa_pod_space_bytes FlashArray pod space in bytes
# TYPE purefa_pod_space_bytes gauge
purefa_pod_space_bytes{name="pod-prod",space="total_provisioned"} 1.099511627776e+12
purefa_pod_space_bytes{name="pod-prod",space="total_physical"} 3.2985348833e+11
purefa_pod_space_bytes{name="pod-reports",space="total_provisioned"} 2.74877906944e+11
# HELP purefa_pod_space_data_reduction_ratio FlashArray pod space data reduction
# TYPE purefa_pod_space_data_reduction_ratio gauge
purefa_pod_space_data_reduction_ratio{name="pod-prod"} 3.3
# HELP purefa_pod_performance_latency_usec FlashArray pod latency in microseconds
# TYPE purefa_pod_performance_latency_usec gauge
purefa_pod_performance_latency_usec{dimension="usec_per_mirrored_write_op",name="pod-prod"} 1450
purefa_pod_performance_latency_usec{dimension="usec_per_read_op",name="pod-prod"} 380
purefa_pod_performance_latency_usec{dimension="usec_per_write_op",name="pod-prod"} 1520
# HELP purefa_pod_performance_throughput_iops FlashArray pod throughput in iops
# TYPE purefa_pod_performance_throughput_iops gauge
purefa_pod_performance_throughput_iops{dimension="reads_per_sec",name="pod-prod"} 900
purefa_pod_performance_throughput_iops{dimension="writes_per_sec",name="pod-prod"} 400
# HELP purefa_pod_performance_bandwidth_bytes FlashArray pod throughput in bytes per second
# TYPE purefa_pod_performance_bandwidth_bytes gauge
purefa_pod_performance_bandwidth_bytes{dimension="read_bytes_per_sec",name="pod-prod"} 7.340032e+06
purefa_pod_performance_bandwidth_bytes{dimension="write_bytes_per_sec",name="pod-prod"} 3.145728e+06
# HELP purefa_pod_performance_replication_bandwidth_bytes FlashArray pod replication bandwidth in bytes per second
# TYPE purefa_pod_performance_replication_bandwidth_bytes gauge
purefa_pod_performance_replication_bandwidth_bytes{dimension="sync",direction="total",name="pod-prod"} 3.145728e+06
# HELP purefa_pod_replica_links_lag_max_msec FlashArray pod replica links max lag in milliseconds
# TYPE purefa_pod_replica_links_lag_max_msec gauge
purefa_pod_replica_links_lag_max_msec{direction="outbound",local_pod="pod-prod",remote="fa-dr-01",remote_pod="pod-prod-dr",status="replicating"} 1200
purefa_pod_replica_links_lag_max_msec{direction="outbound",local_pod="pod-prod",remote="fa-dr-02",remote_pod="pod-prod-dr2",status="paused"} 95000
purefa_pod_replica_links_lag_max_msec{direction="outbound",local_pod="pod-reports",remote="fa-dr-01",remote_pod="pod-reports-dr",status="replicating"} 300
# HELP purefa_pod_replica_links_lag_average_msec FlashArray pod replica links average lag in milliseconds
# TYPE purefa_pod_replica_links_lag_average_msec gauge
purefa_pod_replica_links_lag_average_msec{direction="outbound",local_pod="pod-prod",remote="fa-dr-01",remote_pod="pod-prod-dr",status="replicating"} 800
purefa_pod_replica_links_lag_average_msec{direction="outbound",local_pod="pod-prod",remote="fa-dr-02",remote_pod="pod-prod-dr2",status="paused"} 61000
# HELP purefa_pod_mediator_status FlashArray pod mediator status
# TYPE purefa_pod_mediator_status gauge
purefa_pod_mediator_status{array="fa-prod-01",mediator="purestorage",pod="pod-prod",status="online"} 1
purefa_pod_mediator_status{array="fa-prod-02",mediator="purestorage",pod="pod-prod",status="unreachable"} 1
`,
  directories: `${FA_INFO}# HELP purefa_directory_space_bytes FlashArray directory space in bytes
# TYPE purefa_directory_space_bytes gauge
purefa_directory_space_bytes{name="fs1:home",space="total_physical"} 2.68435456e+11
purefa_directory_space_bytes{name="fs1:home",space="snapshots"} 1.073741824e+10
purefa_directory_space_bytes{name="fs1:projects",space="total_physical"} 1.37438953472e+12
# HELP purefa_directory_space_data_reduction_ratio FlashArray directory space data reduction
# TYPE purefa_directory_space_data_reduction_ratio gauge
purefa_directory_space_data_reduction_ratio{name="fs1:home"} 1.9
# HELP purefa_directory_performance_latency_usec FlashArray directory latency in microseconds
# TYPE purefa_directory_performance_latency_usec gauge
purefa_directory_performance_latency_usec{dimension="usec_per_read_op",name="fs1:home"} 220
purefa_directory_performance_latency_usec{dimension="usec_per_write_op",name="fs1:home"} 310
# HELP purefa_directory_performance_throughput_iops FlashArray directory throughput in iops
# TYPE purefa_directory_performance_throughput_iops gauge
purefa_directory_performance_throughput_iops{dimension="reads_per_sec",name="fs1:home"} 640
# HELP purefa_directory_performance_bandwidth_bytes FlashArray directory throughput in bytes per second
# TYPE purefa_directory_performance_bandwidth_bytes gauge
purefa_directory_performance_bandwidth_bytes{dimension="write_bytes_per_sec",name="fs1:projects"} 5.24288e+06
`,
};

export const FLASHBLADE_CAPTURES: Record<FlashBladeEndpoint, string> = {
  array: `${FB_INFO}# HELP purefb_alerts_open FlashBlade open alert events
# TYPE purefb_alerts_open gauge
purefb_alerts_open{action="Contact Pure Storage Support",code="1001",component_name="CH1.FB3",component_type="blade",created="1764001000000",kburl="https://support.purestorage.com/FlashBlade/Alerts/1001",severity="critical",summary="Blade CH1.FB3 is not healthy"} 1
purefb_alerts_open{action="",code="401",component_name="fb-prod-01",component_type="array",created="1763995000000",kburl="https://support.purestorage.com/FlashBlade/Alerts/401",severity="warning",summary="File system scratch is nearly full"} 1
purefb_alerts_open{action="",code="18",component_name="CH1.FM1",component_type="fabric_module",created="1763990000000",kburl="",severity="info",summary="Fabric module firmware update available"} 1
# HELP purefb_array_space_bytes FlashBlade total space in bytes
# TYPE purefb_array_space_bytes gauge
purefb_array_space_bytes{space="capacity",type="array"} 1.759218604441e+14
purefb_array_space_bytes{space="empty",type="array"} 6.7726397385728e+13
purefb_array_space_bytes{space="unique",type="array"} 1.0819527380992e+14
purefb_array_space_bytes{space="capacity",type="file-system"} 1.759218604441e+14
purefb_array_space_bytes{space="empty",type="object-store"} 9.9e+13
# HELP purefb_array_space_utilization FlashBlade array space utilization in percent
# TYPE purefb_array_space_utilization gauge
purefb_array_space_utilization{type="array"} 61.5
purefb_array_space_utilization{type="file-system"} 70.2
purefb_array_space_utilization{type="object-store"} 12.4
# HELP purefb_array_space_data_reduction_ratio FlashBlade overall data reduction
# TYPE purefb_array_space_data_reduction_ratio gauge
purefb_array_space_data_reduction_ratio{type="array"} 2.08
purefb_array_space_data_reduction_ratio{type="file-system"} 1.9
# HELP purefb_array_performance_latency_usec FlashBlade array latency
# TYPE purefb_array_performance_latency_usec gauge
purefb_array_performance_latency_usec{dimension="usec_per_read_op",protocol="all"} 1200
purefb_array_performance_latency_usec{dimension="usec_per_read_op",protocol="nfs"} 900
# HELP purefb_hardware_health FlashBlade hardware component health status
# TYPE purefb_hardware_health gauge
purefb_hardware_health{index="1",name="CH1.FB1",slot="1",type="fb"} 1
purefb_hardware_health{index="2",name="CH1.FB2",slot="2",type="fb"} 1
purefb_hardware_health{index="3",name="CH1.FB3",slot="3",type="fb"} 0
purefb_hardware_health{index="1",name="CH1.FM1",slot="1",type="fm"} 1
purefb_hardware_health{index="1",name="CH1.PWR1",slot="",type="pwr"} 1
purefb_hardware_health{index="4",name="CH1.FB4",slot="4",type="fb"} 2
`,
  filesystems: `${FB_INFO}# HELP purefb_file_systems_space_bytes FlashBlade file system space in bytes
# TYPE purefb_file_systems_space_bytes gauge
purefb_file_systems_space_bytes{name="home",nfs="true",nfspolicy="default",smb="false",space="total_physical"} 4.398046511104e+12
purefb_file_systems_space_bytes{name="home",nfs="true",nfspolicy="default",smb="false",space="provisioned"} 1.0995116277760e+13
purefb_file_systems_space_bytes{name="home",nfs="true",nfspolicy="default",smb="false",space="available_ratio"} 0.6
purefb_file_systems_space_bytes{name="home",nfs="true",nfspolicy="default",smb="false",space="virtual"} 5.49755813888e+12
purefb_file_systems_space_bytes{name="scratch",nfs="true",nfspolicy="hpc",smb="true",space="total_physical"} 1.0445360463872e+13
purefb_file_systems_space_bytes{name="scratch",nfs="true",nfspolicy="hpc",smb="true",space="provisioned"} 1.0995116277760e+13
purefb_file_systems_space_bytes{name="scratch",nfs="true",nfspolicy="hpc",smb="true",space="available_ratio"} 0.05
purefb_file_systems_space_bytes{name="projects",nfs="false",nfspolicy="",smb="true",space="total_physical"} 2.199023255552e+12
# HELP purefb_file_systems_space_data_reduction_ratio FlashBlade file system data reduction
# TYPE purefb_file_systems_space_data_reduction_ratio gauge
purefb_file_systems_space_data_reduction_ratio{name="home",nfs="true",nfspolicy="default",smb="false"} 1.25
purefb_file_systems_space_data_reduction_ratio{name="scratch",nfs="true",nfspolicy="hpc",smb="true"} 1.05
# HELP purefb_file_systems_performance_latency_usec FlashBlade file system latency
# TYPE purefb_file_systems_performance_latency_usec gauge
purefb_file_systems_performance_latency_usec{dimension="usec_per_read_op",name="home"} 950
purefb_file_systems_performance_latency_usec{dimension="usec_per_write_op",name="home"} 1300
purefb_file_systems_performance_latency_usec{dimension="usec_per_other_op",name="home"} 80
purefb_file_systems_performance_latency_usec{dimension="usec_per_read_op",name="scratch"} 4200
# HELP purefb_file_systems_performance_throughput_iops FlashBlade file system throughput
# TYPE purefb_file_systems_performance_throughput_iops gauge
purefb_file_systems_performance_throughput_iops{dimension="reads_per_sec",name="home"} 2400
purefb_file_systems_performance_throughput_iops{dimension="writes_per_sec",name="home"} 800
# HELP purefb_file_systems_performance_bandwidth_bytes FlashBlade file system bandwidth
# TYPE purefb_file_systems_performance_bandwidth_bytes gauge
purefb_file_systems_performance_bandwidth_bytes{dimension="read_bytes_per_sec",name="home"} 1.2582912e+08
purefb_file_systems_performance_bandwidth_bytes{dimension="write_bytes_per_sec",name="scratch"} 4.194304e+08
`,
  objectstore: `${FB_INFO}# HELP purefb_buckets_space_bytes FlashBlade buckets space in bytes
# TYPE purefb_buckets_space_bytes gauge
purefb_buckets_space_bytes{account="analytics",name="logs-archive",space="total_physical"} 7.69658139648e+11
purefb_buckets_space_bytes{account="analytics",name="logs-archive",space="virtual"} 9.89560464998e+11
purefb_buckets_space_bytes{account="analytics",name="logs-archive",space="snapshots"} 0
purefb_buckets_space_bytes{account="backup",name="veeam-repo",space="total_physical"} 2.1990232555520e+13
# HELP purefb_buckets_quota_space_bytes FlashBlade buckets quota space in bytes
# TYPE purefb_buckets_quota_space_bytes gauge
purefb_buckets_quota_space_bytes{account="analytics",hard_limit_enabled="true",name="logs-archive"} 1.099511627776e+12
# HELP purefb_buckets_space_data_reduction_ratio FlashBlade buckets space data reduction
# TYPE purefb_buckets_space_data_reduction_ratio gauge
purefb_buckets_space_data_reduction_ratio{account="analytics",name="logs-archive"} 1.29
# HELP purefb_buckets_object_count FlashBlade buckets object count
# TYPE purefb_buckets_object_count gauge
purefb_buckets_object_count{account="analytics",name="logs-archive"} 1843200
purefb_buckets_object_count{account="backup",name="veeam-repo"} 912000
# HELP purefb_buckets_performance_latency_usec FlashBlade buckets latency
# TYPE purefb_buckets_performance_latency_usec gauge
purefb_buckets_performance_latency_usec{dimension="usec_per_read_op",name="logs-archive"} 2600
purefb_buckets_performance_latency_usec{dimension="usec_per_write_op",name="veeam-repo"} 5100
# HELP purefb_buckets_performance_throughput_iops FlashBlade buckets throughput
# TYPE purefb_buckets_performance_throughput_iops gauge
purefb_buckets_performance_throughput_iops{dimension="reads_per_sec",name="logs-archive"} 120
# HELP purefb_buckets_performance_bandwidth_bytes FlashBlade buckets bandwidth
# TYPE purefb_buckets_performance_bandwidth_bytes gauge
purefb_buckets_performance_bandwidth_bytes{dimension="write_bytes_per_sec",name="veeam-repo"} 3.3554432e+08
`,
};
