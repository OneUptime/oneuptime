import { JSONObject } from "Common/Types/JSON";

/*
 * UNISPHERE FOR POWERMAX'S ANSWERS, AS DELL DOCUMENTS THEM (#11004).
 *
 * Each recording below is the response example Dell publishes for the call
 * - in the "PowerMax" OpenAPI document 10.4 (paths /104/... and
 * /performance/...), the "PowerMax - Enhanced Endpoints" OpenAPI
 * documents 10.1 and 10.4 (paths /v1/systems/{id}/...), and the PowerMax
 * REST API change log 10.3 (paging) - copied as published, with only the
 * array ids and object names changed where a test needs two arrays to
 * differ. Where an example leaves a field out, the field is added with the
 * name and type the same document's schema gives it, and the comment says
 * so. Nothing here was recorded from a real array: these are Dell's own
 * examples, and FakeUnisphere serves them the way the documents say a
 * server does.
 */

// GET /univmax/restapi/version (OpenAPI 10.4 example, verbatim): Unisphere 10.0.
export const VERSION_10_0: JSONObject = {
  version: "T10.0.1.12",
  api_version: "100",
  supported_api_versions: ["100", "92", "91"],
};

// The same answer from Unisphere 10.4 (the version and lists follow 10.0's form).
export const VERSION_10_4: JSONObject = {
  version: "T10.4.0.83",
  api_version: "104",
  supported_api_versions: ["104", "103", "102", "101", "100"],
};

// And from Unisphere 10.1, which has the bulk endpoints but no paging.
export const VERSION_10_1: JSONObject = {
  version: "T10.1.0.468",
  api_version: "101",
  supported_api_versions: ["101", "100", "92"],
};

/*
 * GET /104/system/symmetrix (OpenAPI 10.4 example): the example writes
 * "symmetrixIds"; PyU4V 10.5 reads "symmetrixId". Both are served.
 */
export const SYMMETRIX_LIST_KEY_OPENAPI: string = "symmetrixIds";
export const SYMMETRIX_LIST_KEY_PYU4V: string = "symmetrixId";

/*
 * GET /104/system/symmetrix/{id} (OpenAPI 10.4 example, verbatim but for
 * the id, the model and the microcode of each test array).
 */
export function systemSymmetrix(data: {
  symmetrixId: string;
  model: string;
  microcode: string;
  local: boolean;
}): JSONObject {
  return {
    symm_alert: "11/38",
    rep_cache_usage: 0,
    cache_partition: "Disabled",
    service_level_rt_multiplier: "Low",
    dynamic_rdf_config: "Enabled",
    cache_size_mb: 858112,
    access_control_config: "Enabled",
    switched_rdf_config: "Enabled",
    disk_count: 40,
    max_hyper_per_disk: 128,
    local: data.local,
    disk_group_assignment: "In Use",
    concurrent_dynamic_rdf_config: "Enabled",
    spare_disk_count: 2,
    max_dev_slot: 303989,
    config_change_state: "Enabled",
    model: data.model,
    microcode: data.microcode,
    microcode_date: "11-02-2021",
    microcode_registered_build: 18,
    microcode_package_version:
      "10.0.0.0 (Internal QT804, Build 6079_053/0025, 2021-10-12 19:00:27)",
    data_encryption: "Enabled",
    disk_service_state: "Deferred",
    device_count: 16608,
    last_ipl_time: "2021-05-15 17:22:57",
    srdfa_max_throttle: 0,
    dev_masking_aclx_config: "Mixed",
    last_fast_ipl_time: "2021-07-23 18:59:55",
    aclx_lun_addr: 0,
    all_flash: true,
    system_sized_property: [
      {
        srp_name: "SRP_1",
        sized_fba_data_reduction_ratio: "3.0:1",
        sized_fba_capacity_tb: 183,
      },
    ],
    rdf_dir_count: 5,
    fba_geo_emulation: "Native",
    max_sys_slot: 6079785,
    unconfig_disk_count: 0,
    symmetrixId: data.symmetrixId,
    srdfa_cache_usage: 75,
    sddf_state: "Enabled",
    concurrent_rdf_config: "Enabled",
    raid_config: "RAID-5 (7+1)",
    num_ava_cache_slot: 8106380,
    fe_dir_count: 6,
    be_dir_count: 4,
    pav_model: "DynamicStandardPAV",
    pav_alias_limit: 255,
    rdf_data_mobility_config: "Disabled",
  };
}

// GET /104/sloprovisioning/symmetrix/{id} (OpenAPI 10.4 example, verbatim but for the id).
export function sloProvisioningSymmetrix(symmetrixId: string): JSONObject {
  return {
    symmetrixId: symmetrixId,
    device_count: 10975,
    microcode: "5978.669.669",
    model: "PowerMax_2000",
    local: true,
    default_fba_srp: "SRP_1",
    system_capacity: {
      subscribed_allocated_tb: 15.46,
      subscribed_total_tb: 261.74,
      snapshot_modified_tb: 0,
      snapshot_total_tb: 783.59,
      usable_used_tb: 17.27,
      usable_total_tb: 61.12,
      subscribed_usable_capacity_percent: 429,
    },
    system_efficiency: {
      overall_efficiency_ratio_to_one: 71,
      data_reduction_ratio_to_one: 3,
      data_reduction_enabled_percent: 7,
      virtual_provisioning_savings_ratio_to_one: 17,
      snapshot_savings_ratio_to_one: 4450382.4,
      unreducible_data_tb: 0,
      drr_on_reducible_only_to_one: 0,
    },
    meta_data_usage: {
      system_meta_data_used_percent: 38,
      replication_cache_used_percent: 0,
      frontend_meta_data_used_percent: 22,
      backend_meta_data_used_percent: 47,
    },
    physicalCapacity: {
      used_capacity_gb: 76290.38,
      total_capacity_gb: 76290.38,
    },
    host_visible_device_count: 10655,
    tags: "aa, Two, Three, aaa",
  };
}

// GET /104/sloprovisioning/symmetrix/{id}/srp/{srpId} (OpenAPI 10.4 example, verbatim).
export const SRP_1: JSONObject = {
  srpId: "SRP_1",
  num_of_disk_groups: 1,
  description: "First SRP - FBA - not mixed",
  emulation: "FBA",
  reserved_cap_percent: 0,
  total_srdf_dse_allocated_cap_gb: 0,
  rdfa_dse: true,
  diskGroupId: ["2"],
  srp_capacity: {
    subscribed_allocated_tb: 35.66,
    subscribed_total_tb: 347.88,
    snapshot_modified_tb: 0,
    snapshot_total_tb: 133.76,
    usable_used_tb: 36.96,
    usable_total_tb: 62.87,
    effective_used_capacity_percent: 54,
  },
  srp_efficiency: {
    compression_state: "Enabled",
    overall_efficiency_ratio_to_one: 13.5,
    data_reduction_ratio_to_one: 38.2,
    data_reduction_enabled_percent: 0,
    virtual_provisioning_savings_ratio_to_one: 9.8,
  },
};

// GET /104/system/symmetrix/{id}/health (OpenAPI 10.4 example, verbatim).
export const HEALTH: JSONObject = {
  num_failed_disks: 0,
  health_score_metric: [
    {
      cached_date: 1580314727132,
      expired: false,
      metric: "SERVICE_LEVEL_COMPLIANCE",
      instance_metrics: [{}],
      health_score: 100,
      data_date: 1580314727132,
    },
    {
      cached_date: 0,
      expired: false,
      metric: "OVERALL",
      instance_metrics: [{}],
      data_date: 0,
    },
    {
      cached_date: 1580314727118,
      expired: false,
      metric: "CAPACITY",
      instance_metrics: [{}],
      health_score: 100,
      data_date: 1580314727118,
    },
  ],
};

/*
 * GET /104/system/symmetrix/{id}/alert/{alertId} (OpenAPI 10.4 example):
 * the example's alert, with its severity, state and object varied per
 * test alert.
 */
export function alert(data: {
  alertId: string;
  symmetrixId: string;
  severity: string;
  state?: string | undefined;
  acknowledged?: boolean | undefined;
  object?: string | undefined;
  objectType?: string | undefined;
  type?: string | undefined;
  description?: string | undefined;
  createdMs?: number | undefined;
}): JSONObject {
  return {
    alertId: data.alertId,
    state: data.state || "NEW",
    severity: data.severity,
    type: data.type || "ARRAY",
    array: data.symmetrixId,
    object: data.object || "SDAT1608_SG603",
    object_type: data.objectType || "Storage Group",
    created_date: "Aug-16-2021 14:10:37.000",
    created_date_milliseconds: data.createdMs ?? 1629119437000,
    description:
      data.description ||
      "Snapshot Policy has been detached from the SG.[SnapPolicy:SDAT1608_SP603_minute] - Object is: 000120000335:SDAT1608_SG603",
    acknowledged: data.acknowledged ?? false,
  };
}

// GET /104/system/symmetrix/{id}/director (OpenAPI 10.4 example, verbatim).
export const CLASSIC_DIRECTOR_IDS: Array<string> = [
  "DF-1C",
  "DF-2C",
  "DF-3C",
  "DF-4C",
  "DX-1F",
  "DX-2F",
  "DX-3F",
  "DX-4F",
  "ED-1B",
  "ED-2B",
  "ED-3B",
  "ED-4B",
  "FA-1D",
  "FA-2D",
  "FA-3D",
  "FA-4D",
  "IM-1A",
  "IM-2A",
  "IM-3A",
  "IM-4A",
  "RE-2G",
  "RF-1E",
  "RF-3E",
  "SE-2E",
  "SE-4E",
];

// GET /104/system/symmetrix/{id}/director/{directorId} (OpenAPI 10.4 example).
export function classicDirector(
  directorId: string,
  availability: string = "Online",
): JSONObject {
  return {
    availability: availability,
    director_number: 33,
    director_slot_number: 1,
    directorId: directorId,
    num_of_ports: 4,
    num_of_cores: 5,
  };
}

// GET /performance/Array/registrationdetails/{id} (OpenAPI 10.4 example, verbatim but for the id).
export function registrationDetails(data: {
  symmetrixId: string;
  realtime: boolean;
  diagnostic: boolean;
  selectedSGs: string;
}): JSONObject {
  return {
    registrationDetailsInfo: [
      {
        symmetrixId: data.symmetrixId,
        realtime: data.realtime,
        diagnostic: data.diagnostic,
        file: false,
        collectionintervalmins: 5,
        selectedSGs: data.selectedSGs,
        message: "Success",
      },
    ],
  };
}

/*
 * GET /v1/systems/{id}/storage-groups (Enhanced 10.4 example): the example
 * group, its fields as published; rdf_infos' states, modes and local group
 * are the schema's (StorageGroup.rdf_infos[], Enhanced 10.1+), and cap_gb
 * and effective_used_capacity_gb the schema's too.
 */
export function enhancedStorageGroup(data: {
  id: string;
  symmetrixId: string;
  srp?: string | undefined;
  serviceLevel?: string | undefined;
  volumes: number;
  capGb: number;
  usedGb: number;
  rdf?:
    | {
        states: Array<string>;
        modes: Array<string>;
        localGroup: string;
        remoteGroup: string;
        remoteSystem: string;
      }
    | undefined;
}): JSONObject {
  return {
    id: data.id,
    resource_type: "storage-groups",
    type: "child",
    uuid: "00000000000000000000000000000000",
    system: { id: data.symmetrixId },
    volume_emulation: "FBA",
    srp: { id: data.srp || "SRP_1" },
    num_of_volumes: data.volumes,
    num_of_non_gk_volumes: data.volumes,
    num_of_child_storage_groups: 0,
    num_of_parent_storage_groups: 1,
    parent_storage_groups: [{ id: "PF_PMUNI-16037" }],
    num_of_snapshots: 0,
    snapshots: [],
    num_of_snapshot_policies: 0,
    snapshot_policies: [],
    num_of_rdf_infos: data.rdf ? 1 : 0,
    rdf_infos: data.rdf
      ? [
          {
            pairs: [
              {
                local_volume: { id: "006E7" },
                remote_volume: { id: "01A55" },
              },
            ],
            states: data.rdf.states,
            modes: data.rdf.modes,
            local_rdf_group: { id: data.rdf.localGroup },
            remote_rdf_group: {
              id: data.rdf.remoteGroup,
              system: data.rdf.remoteSystem,
            },
          },
        ]
      : [],
    service_level: { id: data.serviceLevel || "Diamond" },
    last_modified_time_ms: 3080498,
    group_last_modified_time_ms: 3080498,
    timestamp_ms: 1684507278,
    data_reduction_enabled: true,
    data_reduction_ratio_to_one: 2.5,
    unreducible_data_gb: 0,
    cap_gb: data.capGb,
    effective_used_capacity_gb: data.usedGb,
  };
}

// GET /v1/systems/{id}/volumes (Enhanced 10.4 example), with its storage groups (schema).
export function enhancedVolume(data: {
  id: string;
  symmetrixId: string;
  identifier?: string | undefined;
  capGb: number;
  usedGb: number;
  storageGroups: Array<string>;
  status?: string | undefined;
}): JSONObject {
  return {
    id: data.id,
    resource_type: "volumes",
    type: "TDEV",
    system: { resource_type: "systems", id: data.symmetrixId },
    emulation: "FBA",
    status: data.status || "Ready",
    identifier: data.identifier || "",
    ssid: "FFFFFFFF",
    nguid: "6709004b000006fe00009760072a1aaa",
    wwn: "60000970072a1ed06709004b00000aaa",
    effective_wwn: "60000970072a1ed06709004b00000aaa",
    has_effective_wwn: false,
    mobility_id_enabled: true,
    encapsulated: false,
    snapvx_source: false,
    snapvx_target: false,
    num_of_storage_groups: data.storageGroups.length,
    storage_groups: data.storageGroups.map((id: string): JSONObject => {
      return { id: id, resource_type: "storage-groups" };
    }),
    num_of_masking_views: 0,
    num_of_snapshots: 0,
    num_of_clones: 0,
    num_of_rdf_infos: 0,
    rdf_infos: [],
    cap_tb: 0,
    cap_gb: data.capGb,
    cap_mb: data.capGb * 1024,
    cap_cyl: 1092267,
    unreducible_data_gb: 0,
    data_reduction_ratio_to_one: 0,
    data_reduction_enabled: false,
    effective_used_capacity_gb: data.usedGb,
    srp: { resource_type: "srps", id: "SRP_1" },
    volume_host_paths: [],
    num_of_volume_host_paths: 0,
  };
}

// GET /v1/systems/{id}/directors (Enhanced 10.4 example, verbatim but for the system).
export function enhancedDirectors(symmetrixId: string): Array<JSONObject> {
  return [
    {
      id: "EM-4A",
      resource_type: "directors",
      system: { id: symmetrixId, resource_type: "systems" },
      type: "ArrayAndDataService",
      status: "Online",
      director_number: 4,
      engine_number: 2,
      slot_number: 4,
      num_of_ports: 0,
      ports: [],
    },
    {
      id: "DF-1B",
      resource_type: "directors",
      system: { id: symmetrixId, resource_type: "systems" },
      type: "InternalDisk",
      status: "Online",
      director_number: 17,
      engine_number: 1,
      slot_number: 1,
      num_of_ports: 0,
      ports: [],
    },
    {
      id: "EM-3A",
      resource_type: "directors",
      system: { id: symmetrixId, resource_type: "systems" },
      type: "ArrayAndDataService",
      status: "Online",
      director_number: 3,
      engine_number: 2,
      slot_number: 3,
      num_of_ports: 0,
      ports: [],
    },
    {
      id: "OR-1C",
      resource_type: "directors",
      system: { id: symmetrixId, resource_type: "systems" },
      type: "OSHostAndRDF",
      status: "Online",
      director_number: 33,
      engine_number: 1,
      slot_number: 1,
      num_of_ports: 11,
      ports: [
        { id: "T1ItMUN8Mg", resource_type: "ports", port_number: "2" },
        { id: "T1ItMUN8MQ", resource_type: "ports", port_number: "1" },
      ],
    },
  ];
}

/*
 * GET /v1/systems/{id}/ports (Enhanced 10.4 example): its two ports as
 * published - an NVMe/FC host port in a port group, ON, and an SRDF over FC
 * port PendOn - and an iSCSI port the schema describes, Offline and in a
 * masking view.
 */
export function enhancedPorts(symmetrixId: string): Array<JSONObject> {
  return [
    {
      id: "T1ItM0N8MzU",
      resource_type: "ports",
      port_number: "35",
      port_identifier: "50000974100434a3",
      director: {
        id: "OR-3C",
        resource_type: "directors",
        director_number: 35,
      },
      system: { resource_type: "systems", id: symmetrixId },
      type: "OSHostAndRDF",
      protocol: "Host_NVMe/FC",
      port_status: "ON",
      director_status: "Online",
      max_speed: 65535,
      negotiated_speed: 16,
      iscsi_endpoint: false,
      virtual: true,
      nvmetcp_endpoint: false,
      port_group_candidate: false,
      num_of_cores: 10,
      num_of_ip_interfaces: 0,
      ip_interfaces: [],
      num_of_volumes: 0,
      volumes: [],
      num_of_port_groups: 1,
      port_groups: [{ id: "_FILE_FILE-1_PG", resource_type: "port-groups" }],
      num_of_masking_views: 0,
      masking_views: [],
    },
    {
      id: "T1ItMkN8Ng",
      resource_type: "ports",
      port_number: "6",
      port_identifier: "5000097410043446",
      director: {
        id: "OR-2C",
        resource_type: "directors",
        director_number: 34,
      },
      system: { resource_type: "systems", id: symmetrixId },
      type: "OSHostAndRDF",
      protocol: "RDF_FC",
      port_status: "PendOn",
      director_status: "Online",
      max_speed: 32,
      negotiated_speed: 32,
      iscsi_endpoint: false,
      virtual: false,
      nvmetcp_endpoint: false,
      num_of_port_groups: 0,
      num_of_masking_views: 0,
      rx_power_level_mw: 0.512,
      tx_power_level_mw: 0.618,
    },
    {
      id: "T1ItNEN8NA",
      resource_type: "ports",
      port_number: "4",
      port_identifier: "iqn.1992-04.com.emc:600009700bcbb70e3287017400000001",
      director: {
        id: "OR-4C",
        resource_type: "directors",
        director_number: 36,
      },
      system: { resource_type: "systems", id: symmetrixId },
      type: "OSHostAndRDF",
      protocol: "Host_iSCSI",
      port_status: "Offline",
      director_status: "Online",
      max_speed: 25,
      negotiated_speed: 0,
      iscsi_endpoint: true,
      nvmetcp_endpoint: false,
      num_of_port_groups: 0,
      num_of_masking_views: 1,
    },
  ];
}

/*
 * GET /v1/systems/{id}/rdf-groups (Enhanced 10.4 example): its group 88
 * as published (Synchronous, to 000220002429, through OR-1C:1 and :2),
 * and an asynchronous group whose RDFA properties carry a lag.
 */
export function enhancedRdfGroups(
  symmetrixId: string,
  remoteSystem: string,
): Array<JSONObject> {
  return [
    {
      id: "88",
      resource_type: "rdf-groups",
      system: { id: symmetrixId, resource_type: "systems" },
      type: "Dynamic",
      label: "SGKG20a5ba",
      modes: ["Synchronous"],
      offline: false,
      metro: false,
      async: false,
      cap_gb: 3.22,
      remote_rdf_group: {
        id: "88",
        resource_type: "rdf-groups",
        system: { resource_type: "systems", id: remoteSystem },
        label: "SGKG20a5ba",
      },
      num_of_volumes: 1,
      volumes: [{ id: "0048D", resource_type: "volumes" }],
      num_of_ports: 2,
      ports: [
        {
          id: "T1ItMUN8Mg",
          resource_type: "ports",
          port_number: "2",
          director: { id: "OR-1C", resource_type: "directors" },
        },
        {
          id: "T1ItMUN8MQ",
          resource_type: "ports",
          port_number: "1",
          director: { id: "OR-1C", resource_type: "directors" },
        },
      ],
      witness: false,
      witness_degraded: false,
      link_limbo: 10,
      device_polarity: "RDF2",
      rdfa_properties: {
        session_uncommitted_tracks: 0,
        r1_to_r2_lag_time: 0,
        duration_of_last_cycle_secs: 0,
        average_cycle_time_secs: 0,
        minimum_cycle_time_secs: 5,
        transmit_queue_depth: 0,
        cycle_number: 0,
        transmit_idle_state: "Enabled",
      },
    },
    {
      id: "12",
      resource_type: "rdf-groups",
      system: { id: symmetrixId, resource_type: "systems" },
      type: "Dynamic",
      label: "DR_ASYNC",
      modes: ["Asynchronous"],
      offline: false,
      metro: false,
      async: true,
      cap_gb: 2048,
      remote_rdf_group: {
        id: "12",
        resource_type: "rdf-groups",
        system: { resource_type: "systems", id: remoteSystem },
        label: "DR_ASYNC",
      },
      num_of_volumes: 8,
      num_of_ports: 0,
      ports: [],
      witness_degraded: false,
      rdfa_properties: {
        session_uncommitted_tracks: 1204,
        r1_to_r2_lag_time: 42,
        duration_of_last_cycle_secs: 30,
        average_cycle_time_secs: 30,
        minimum_cycle_time_secs: 15,
      },
    },
  ];
}

/*
 * GET /v1/systems/{id}/performance-categories (Enhanced 10.4 example): the
 * categories and their KPI metrics, as published (the ones a collection
 * reads) - FEDirector and FEPort, which the example array has none of,
 * added with the metrics Dell's /performance/FEDirector/metrics and
 * /performance/FEPort/metrics examples (OpenAPI 10.4) answer.
 */
export const PERFORMANCE_CATEGORIES: Record<string, Array<string>> = {
  Array: [
    "BEIOs",
    "BEUtilization",
    "FEUtilization",
    "HostIOs",
    "HostMBs",
    "PercentCacheWP",
    "PercentHit",
    "PercentReads",
    "PercentWrites",
    "RDFUtilization",
    "ReadResponseTime",
    "WriteResponseTime",
  ],
  BEDirector: [
    "IOs",
    "MBRead",
    "MBWritten",
    "MBs",
    "PercentBusy",
    "ReadReqs",
    "Reqs",
    "SyscallCount",
    "WriteReqs",
  ],
  FEDirector: [
    "HostIOs",
    "HostMBs",
    "PercentBusy",
    "ReadResponseTime",
    "Reqs",
    "WriteResponseTime",
  ],
  FEPort: ["IOs", "MBRead", "MBWritten", "MBs", "PercentBusy", "ResponseTime"],
  RDFA: [
    "AvgCycleSizeCapacity",
    "AvgCycleTime",
    "AvgIOServiceTime",
    "RDF_R1_R2_IOs",
    "RDF_R1_R2_MBs",
    "RdfResponseTime",
  ],
  RDFDirector: [
    "AvgIOServiceTime",
    "CopyIOs",
    "CopyMBs",
    "IOs",
    "MBRead",
    "MBSentAndReceived",
    "MBWritten",
    "PercentBusy",
    "WriteReqs",
  ],
  RDFPort: [
    "AvgIOSize",
    "IOs",
    "MBRead",
    "MBWritten",
    "MBs",
    "PercentBusy",
    "Reads",
    "SpeedGBs",
    "Writes",
  ],
  RDFS: [
    "HostIOs",
    "HostMBWritten",
    "HostMBs",
    "RDFS_WriteResponseTime",
    "ResponseTime",
    "WriteResponseTime",
  ],
  SRP: ["BEMBTransferred", "BEReqs", "HostIOs", "HostMBs", "ResponseTime"],
  StorageGroup: [
    "HostIOLimitPercentTimeExceeded",
    "HostIOs",
    "HostMBReads",
    "HostMBWritten",
    "HostMBs",
    "HostReads",
    "HostWrites",
    "PercentHit",
    "ReadResponseTime",
    "ResponseTime",
    "WriteResponseTime",
  ],
};

/*
 * GET /v1/systems/{id}/performance-categories/{category} (Enhanced 10.4
 * example, BEDirector, verbatim): each instance's newest 5-minute sample.
 */
export const BE_DIRECTOR_INSTANCES: Array<JSONObject> = [
  {
    id: "DF-4B",
    metrics: [
      {
        PercentBusy: 0,
        IOs: 23.342194,
        Reqs: 6.2358804,
        ReadReqs: 0.036544852,
        WriteReqs: 6.1993356,
        SyscallCount: 0.029900333,
        MBRead: 1.3213897,
        MBWritten: 0.5396854,
        MBs: 1.8610752,
        timestamp: 1686657300000,
      },
    ],
  },
  {
    id: "DF-3B",
    metrics: [
      {
        PercentBusy: 0,
        IOs: 35.813953,
        Reqs: 10.727574,
        ReadReqs: 0.003322259,
        WriteReqs: 10.724253,
        SyscallCount: 0.026578072,
        MBRead: 1.8624507,
        MBWritten: 1.1601952,
        MBs: 3.022646,
        timestamp: 1686657300000,
      },
    ],
  },
];

/*
 * POST /performance/realtime/metrics (OpenAPI 10.4 example): the answer's
 * paging envelope as published; its result points carry the metrics a
 * test asks for.
 */
export function realtimeAnswer(points: Array<JSONObject>): JSONObject {
  return {
    expirationTime: 1635512328942,
    count: points.length,
    maxPageSize: 1000,
    id: "647b9081-9d2e-4351-a142-7522cb00f452_0",
    resultList: { result: points, from: 1, to: points.length },
  };
}

// POST /performance/Volume/metrics (OpenAPI 10.4 example): its envelope, per volume.
export function volumeMetricsAnswer(
  volumes: Array<{
    volumeId: string;
    storageGroups: string;
    points: Array<JSONObject>;
  }>,
): JSONObject {
  return {
    expirationTime: 1635512328942,
    count: 1,
    maxPageSize: 1000,
    id: "647b9081-9d2e-4351-a142-7522cb00f452_0",
    resultList: {
      result: volumes.map(
        (volume: {
          volumeId: string;
          storageGroups: string;
          points: Array<JSONObject>;
        }): JSONObject => {
          return {
            volumeResult: volume.points,
            volumeId: volume.volumeId,
            storageGroups: volume.storageGroups,
          };
        },
      ),
      from: 1,
      to: 1,
    },
  };
}

/*
 * GET /performance/realtime/help/{systemId}/{category}/metrics (OpenAPI
 * 10.4 example, verbatim): the Array category's real-time metrics. Dell's
 * documents list a category's only by asking; a test server answers the
 * StorageGroups category with these.
 */
export const REALTIME_HELP_METRICS: Array<string> = [
  "BEIOs",
  "BEReadReqs",
  "BEWriteReqs",
  "DeviceWPEvents",
  "FEReadReqs",
  "FEWriteReqs",
  "HostMBs",
  "FEHitReqs",
  "HostIOs",
  "FEReadHitReqs",
  "FEReadMissReqs",
  "FEReqs",
  "ReadResponseTime",
  "WriteResponseTime",
  "SystemWPEvents",
  "BEReqs",
  "PercentCacheWP",
  "WPCount",
  "SystemMaxWPLimit",
  "FEWriteHitReqs",
  "FEWriteMissReqs",
];

/*
 * An enhanced endpoint's error (PowerMax REST API change log 10.3,
 * 3.5.3.3.2, verbatim but for the message).
 */
export function enhancedError(
  status: number,
  code: string,
  message: string,
): JSONObject {
  return {
    message: message,
    http_status_code: status,
    messages: [
      {
        code: code,
        timestamp_ms: 1720615449598,
        severity: "ERROR",
        message: message,
      },
    ],
  };
}

// The Volume metrics a /performance/Volume/metrics query may name (OpenAPI 10.4 enum).
export const VOLUME_METRIC_ENUM: Array<string> = [
  "HostMBs",
  "MBRead",
  "MBWritten",
  "IoRate",
  "Reads",
  "Writes",
  "ResponseTime",
  "ReadResponseTime",
  "WriteResponseTime",
  "WPCount",
  "WPUsedCapacity",
];
