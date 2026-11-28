/*
 * A RECORDED XEN ORCHESTRA, REST SIDE: what GET /rest/v0/... answers for the
 * lab the XCP-ng Agent's recorded scrape describes
 * (Tests/Ops/Fixtures/XcpNg/XenOrchestraScrape.js) - one Xen Orchestra
 * managing two XCP-ng 8.3 pools, with the same UUIDs and names.
 *
 * There is no Xen Orchestra on the machines OneUptime is built on, so the
 * objects are written here in the shapes Xen Orchestra's REST API serves
 * them, from @xen-orchestra/rest-api 0.42.0's own OpenAPI examples
 * (src/open-api/oa-examples: pool, host, vm, sr, pbd, vdi, alarm, message,
 * task, backup-job, backup-log, schedule) and its controllers, read in
 * vatesfr/xen-orchestra at 750c74beb1e (26 November 2026): every XAPI
 * object carries id, uuid, type, $pool and $poolId; a running VM's
 * $container is its host, a halted one's its pool; an alarm is a message
 * named ALARM whose body holds the name and value of what crossed its
 * threshold; tasks have short base-36 ids; backup logs are keyed by their
 * start time in milliseconds.
 *
 * The lab, on top of the scrape's: the Production pool's NFS repository is
 * unplugged on xcp-prod-02 (and on xcp-prod-03, which is down), so its PBDs
 * there are attached: false and XAPI left a PBD_PLUG_FAILED_ON_SERVER_START
 * message; a CIFS ISO library holds its password in its device_config, and
 * app-02 a cloud-init payload in its xenStoreData (the secrets an
 * investigation must never see); the nightly backup's last run failed on
 * web-01; report-05 is paused.
 */

export const PROD_POOL: string = "b7569d99-30f8-178a-7d94-801de3e29b5b";
export const LAB_POOL: string = "2ad2c2ec-1d43-4a5c-9c62-e8d0b6a4c3f1";

export const HOST_PROD_1: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
export const HOST_PROD_2: string = "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
export const HOST_PROD_3: string = "f0e1d2c3-b4a5-4968-8776-655443322110";
export const HOST_LAB_1: string = "6a7b8c9d-0e1f-4a2b-9c3d-4e5f6a7b8c9d";

export const VM_WEB_01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
export const VM_DB_01: string = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
export const VM_APP_02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
export const VM_WIN_03: string = "9d0e1f2a-3b4c-4d5e-8f6a-7b8c9d0e1f2a";
export const VM_REPORT_05: string = "5c6d7e8f-9a0b-4c1d-8e2f-3a4b5c6d7e8f";
export const VM_LAB_01: string = "5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b";
export const DOM0_PROD_1: string = "0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e";
export const DOM0_PROD_2: string = "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";

export const SR_PROD_LOCAL: string = "ad4b8c63-1f2e-4d3c-8b4a-596877665544";
export const SR_PROD_NFS: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";
export const SR_PROD_TOOLS: string = "c0ffee00-1111-4222-8333-444455556666";
export const SR_PROD_ISO_CIFS: string = "7e8f9a0b-1c2d-4e3f-8a4b-5c6d7e8f9a0b";
export const SR_LAB_LOCAL: string = "77aa88bb-99cc-4ddd-8eee-ff0011223344";

export const PBD_NFS_PROD_1: string = "16b2a60f-7c4d-f45f-7c7a-963b06fc587d";
export const PBD_NFS_PROD_2: string = "28d93f56-23cb-527c-080a-805e54593a0d";
export const PBD_NFS_PROD_3: string = "3a4b5c6d-7e8f-4a9b-8c0d-1e2f3a4b5c6d";
export const PBD_LOCAL_PROD_1: string = "387a2513-e835-baba-5684-e4a104acd78b";
export const PBD_CIFS_PROD_1: string = "4b5c6d7e-8f9a-4b0c-9d1e-2f3a4b5c6d7e";
export const PBD_LAB_LOCAL: string = "5d6e7f8a-9b0c-4d1e-8f2a-3b4c5d6e7f8a";

export const VDI_WEB_01: string = "aa11bb22-cc33-4d44-8e55-ff6677889900";
export const VDI_DB_01: string = "bb22cc33-dd44-4e55-8f66-007788990011";

export const ALARM_NFS_FULL: string = "6a4cc401-6cba-0d41-3b02-b848c5017343";
export const MESSAGE_PLUG_FAILED: string =
  "f775eaeb-abe5-94e0-9682-14c37c3a1dfe";
export const MESSAGE_APP_02_SHUTDOWN: string =
  "ed2d1623-3e65-8d39-7a14-4eb69274c5e3";
export const MESSAGE_LAB: string = "0c98c71c-2f9c-d5c2-b9b6-2c8371730eab";

export const TASK_FAILED_START: string = "0mdd1basu";
export const TASK_BACKUP_RUN: string = "0mdd1t24g";

export const BACKUP_JOB_NIGHTLY: string =
  "d33f3dc1-92b4-469c-ad58-4c2a106a4721";
export const SCHEDULE_NIGHTLY: string = "cf7249f8-d20b-494f-97f4-b1f32f94e780";
export const BACKUP_LOG_FAILED: string = "1764111600000";
export const BACKUP_LOG_SUCCESS: string = "1764025200000";

// The secrets the lab holds, which no output may ever carry.
export const CIFS_PASSWORD: string = "Sup3r-S3cret!";
export const CLOUD_INIT_ROOT_PASSWORD: string = "CloudInitRoot1";
export const XSCONTAINER_SECRET: string =
  "68c7c1a0-eb42-f21a-e872-7a19468dbd6d";

const GiB: number = 1024 * 1024 * 1024;

export type XoObject = Record<string, unknown>;

function xapi(
  type: string,
  id: string,
  pool: string,
  fields: XoObject,
): XoObject {
  return {
    type,
    ...fields,
    id,
    uuid: id,
    $pool: pool,
    $poolId: pool,
    _xapiRef: `OpaqueRef:${id.slice(0, 8)}-0000-4000-8000-${id.slice(-12)}`,
  };
}

export function labPools(): Array<XoObject> {
  return [
    xapi("pool", PROD_POOL, PROD_POOL, {
      auto_poweron: true,
      crashDumpSr: SR_PROD_LOCAL,
      current_operations: {},
      default_SR: SR_PROD_NFS,
      HA_enabled: false,
      haSrs: [],
      master: HOST_PROD_1,
      tags: [],
      name_description: "The production pool",
      name_label: "Production",
      otherConfig: {
        "xscontainer-public-secret-uuid":
          "d95d1d3c-29b9-e1b3-1c03-5d27ab82ef76",
        "xscontainer-private-secret-uuid": XSCONTAINER_SECRET,
        "memory-ratio-hvm": "0.25",
        migrationCompression: "true",
      },
      cpus: { cores: 12, sockets: 3 },
      zstdSupported: true,
      vtpmSupported: true,
      platform_version: "3.4.0",
    }),
    // A pool made by joining hosts, never named: XAPI's name_label is "".
    xapi("pool", LAB_POOL, LAB_POOL, {
      auto_poweron: false,
      current_operations: {},
      default_SR: SR_LAB_LOCAL,
      HA_enabled: false,
      haSrs: [],
      master: HOST_LAB_1,
      tags: [],
      name_description: "",
      name_label: "",
      otherConfig: {},
      cpus: { cores: 2, sockets: 1 },
      zstdSupported: true,
      vtpmSupported: true,
      platform_version: "3.4.0",
    }),
  ];
}

function host(id: string, pool: string, fields: XoObject): XoObject {
  return xapi("host", id, pool, {
    productBrand: "XCP-ng",
    version: "8.3.0",
    build: "release/yangtze/master/58",
    hvmCapable: true,
    multipathing: false,
    iscsiIqn: `iqn.2026-01.lan.example:${String(fields["name_label"])}`,
    current_operations: {},
    tags: [],
    ...fields,
  });
}

export function labHosts(): Array<XoObject> {
  return [
    host(HOST_PROD_1, PROD_POOL, {
      name_label: "xcp-prod-01",
      hostname: "xcp-prod-01",
      address: "10.0.0.11",
      power_state: "Running",
      enabled: true,
      startTime: 1763247600,
      controlDomain: DOM0_PROD_1,
      residentVms: [DOM0_PROD_1, VM_WEB_01, VM_REPORT_05],
      $PBDs: [PBD_NFS_PROD_1, PBD_LOCAL_PROD_1, PBD_CIFS_PROD_1],
      tags: ["rack-a"],
      memory: { size: 128 * GiB, usage: 41 * GiB },
      cpus: { cores: 4, sockets: 1 },
    }),
    host(HOST_PROD_2, PROD_POOL, {
      name_label: "xcp-prod-02",
      hostname: "xcp-prod-02",
      address: "10.0.0.12",
      power_state: "Running",
      // In maintenance mode: disabled, still running its VMs.
      enabled: false,
      startTime: 1764093600,
      controlDomain: DOM0_PROD_2,
      residentVms: [DOM0_PROD_2, VM_DB_01],
      $PBDs: [PBD_NFS_PROD_2],
      memory: { size: 128 * GiB, usage: 22 * GiB },
      cpus: { cores: 4, sockets: 1 },
    }),
    host(HOST_PROD_3, PROD_POOL, {
      name_label: "xcp-prod-03",
      hostname: "xcp-prod-03",
      address: "10.0.0.13",
      // Down: Xen Orchestra keeps reporting its status, and nothing else.
      power_state: "Halted",
      enabled: true,
      startTime: null,
      residentVms: [],
      $PBDs: [PBD_NFS_PROD_3],
      memory: { size: 128 * GiB, usage: 0 },
      cpus: { cores: 4, sockets: 1 },
    }),
    host(HOST_LAB_1, LAB_POOL, {
      name_label: "xcp-lab-01",
      hostname: "xcp-lab-01",
      address: "10.0.9.11",
      power_state: "Running",
      enabled: true,
      startTime: 1763852400,
      residentVms: [VM_LAB_01],
      $PBDs: [PBD_LAB_LOCAL],
      memory: { size: 32 * GiB, usage: 6 * GiB },
      cpus: { cores: 2, sockets: 1 },
    }),
  ];
}

function vm(id: string, pool: string, fields: XoObject): XoObject {
  return xapi("VM", id, pool, {
    addresses: {},
    auto_poweron: false,
    blockedOperations: {},
    boot: { firmware: "uefi", order: "cd" },
    current_operations: {},
    high_availability: "",
    virtualizationMode: "hvm",
    secureBoot: false,
    snapshots: [],
    VIFs: [],
    $VBDs: [],
    VGPUs: [],
    VTPMs: [],
    tags: [],
    other: {},
    xenStoreData: {},
    ...fields,
  });
}

export function labVms(): Array<XoObject> {
  return [
    vm(VM_WEB_01, PROD_POOL, {
      name_label: "web-01",
      name_description: "Public web",
      power_state: "Running",
      $container: HOST_PROD_1,
      CPUs: { max: 2, number: 2 },
      memory: { size: 4 * GiB },
      mainIpAddress: "10.0.1.21",
      addresses: { "0/ipv4/0": "10.0.1.21" },
      startTime: 1763938800,
      tags: ["production", "web"],
      os_version: { name: "Debian GNU/Linux 12 (bookworm)", distro: "debian" },
      xenStoreData: { "vm-data/mmio-hole-size": "268435456", "vm-data": "" },
    }),
    vm(VM_DB_01, PROD_POOL, {
      name_label: "db-01",
      power_state: "Running",
      $container: HOST_PROD_2,
      CPUs: { max: 4, number: 4 },
      memory: { size: 16 * GiB },
      mainIpAddress: "10.0.1.31",
      startTime: 1764096000,
      tags: ["production"],
    }),
    vm(VM_APP_02, PROD_POOL, {
      name_label: "app-02",
      name_description: "Order service",
      power_state: "Halted",
      // A halted VM's container is its pool.
      $container: PROD_POOL,
      CPUs: { max: 1, number: 1 },
      memory: { size: 2 * GiB },
      startTime: null,
      PV_args: "",
      other: {
        base_template_name: "Debian Bookworm 12",
        "install-repository": "http://deb.example.lan/debian",
        mac_seed: "ebcb83b9-b96d-6341-931c-9d5105656bf2",
      },
      xenStoreData: {
        "vm-data/user-data": `#cloud-config\nchpasswd:\n  list: |\n    root:${CLOUD_INIT_ROOT_PASSWORD}\n`,
        "vm-data/hostname": "app-02",
      },
    }),
    vm(VM_WIN_03, PROD_POOL, {
      name_label: "win-03",
      power_state: "Suspended",
      $container: PROD_POOL,
      CPUs: { max: 2, number: 2 },
      memory: { size: 8 * GiB },
      tags: ["windows"],
    }),
    vm(VM_REPORT_05, PROD_POOL, {
      name_label: "report-05",
      power_state: "Paused",
      $container: HOST_PROD_1,
      CPUs: { max: 1, number: 1 },
      memory: { size: 2 * GiB },
    }),
    vm(VM_LAB_01, LAB_POOL, {
      name_label: "lab-vm-01",
      power_state: "Halted",
      $container: LAB_POOL,
      CPUs: { max: 1, number: 1 },
      memory: { size: GiB },
    }),
  ];
}

export function labVmControllers(): Array<XoObject> {
  return [
    xapi("VM-controller", DOM0_PROD_1, PROD_POOL, {
      name_label: "Control domain on host: xcp-prod-01",
      power_state: "Running",
      $container: HOST_PROD_1,
      memory: { size: 2 * GiB },
    }),
    xapi("VM-controller", DOM0_PROD_2, PROD_POOL, {
      name_label: "Control domain on host: xcp-prod-02",
      power_state: "Running",
      $container: HOST_PROD_2,
      memory: { size: 2 * GiB },
    }),
  ];
}

function sr(id: string, pool: string, fields: XoObject): XoObject {
  return xapi("SR", id, pool, {
    content_type: "user",
    current_operations: {},
    inMaintenanceMode: false,
    name_description: "",
    shared: false,
    tags: [],
    VDIs: [],
    other_config: {},
    sm_config: {},
    allocationStrategy: "thin",
    ...fields,
  });
}

export function labSrs(): Array<XoObject> {
  return [
    sr(SR_PROD_LOCAL, PROD_POOL, {
      name_label: "Local storage",
      SR_type: "lvm",
      size: 500 * GiB,
      physical_usage: 120 * GiB,
      usage: 200 * GiB,
      $container: HOST_PROD_1,
      $PBDs: [PBD_LOCAL_PROD_1],
    }),
    sr(SR_PROD_NFS, PROD_POOL, {
      name_label: "NFS VM store",
      SR_type: "nfs",
      shared: true,
      size: 2048 * GiB,
      physical_usage: Math.round(1894.4 * GiB),
      usage: Math.round(2662.4 * GiB),
      $container: PROD_POOL,
      $PBDs: [PBD_NFS_PROD_1, PBD_NFS_PROD_2, PBD_NFS_PROD_3],
      VDIs: [VDI_WEB_01, VDI_DB_01],
      tags: ["shared-storage"],
    }),
    sr(SR_PROD_TOOLS, PROD_POOL, {
      name_label: "XCP-ng Tools",
      SR_type: "iso",
      content_type: "iso",
      shared: true,
      size: 0,
      physical_usage: 0,
      usage: 0,
      $container: PROD_POOL,
      $PBDs: [],
    }),
    sr(SR_PROD_ISO_CIFS, PROD_POOL, {
      name_label: "ISO library",
      SR_type: "iso",
      content_type: "iso",
      shared: true,
      size: 1024 * GiB,
      physical_usage: 80 * GiB,
      usage: 80 * GiB,
      $container: PROD_POOL,
      $PBDs: [PBD_CIFS_PROD_1],
    }),
    sr(SR_LAB_LOCAL, LAB_POOL, {
      name_label: "Local storage",
      SR_type: "ext",
      size: 250 * GiB,
      physical_usage: 40 * GiB,
      usage: 60 * GiB,
      $container: HOST_LAB_1,
      $PBDs: [PBD_LAB_LOCAL],
    }),
  ];
}

function pbd(
  id: string,
  pool: string,
  hostId: string,
  srId: string,
  attached: boolean,
  deviceConfig: XoObject,
): XoObject {
  return xapi("PBD", id, pool, {
    attached,
    host: hostId,
    SR: srId,
    device_config: deviceConfig,
    otherConfig: {},
  });
}

const NFS_DEVICE_CONFIG: XoObject = {
  server: "nfs01.example.lan",
  serverpath: "/export/vmstore",
  nfsversion: "4.1",
};

export function labPbds(): Array<XoObject> {
  return [
    pbd(PBD_NFS_PROD_1, PROD_POOL, HOST_PROD_1, SR_PROD_NFS, true, {
      ...NFS_DEVICE_CONFIG,
    }),
    // Unplugged: XAPI could not mount it when xcp-prod-02 came back.
    pbd(PBD_NFS_PROD_2, PROD_POOL, HOST_PROD_2, SR_PROD_NFS, false, {
      ...NFS_DEVICE_CONFIG,
    }),
    pbd(PBD_NFS_PROD_3, PROD_POOL, HOST_PROD_3, SR_PROD_NFS, false, {
      ...NFS_DEVICE_CONFIG,
    }),
    pbd(PBD_LOCAL_PROD_1, PROD_POOL, HOST_PROD_1, SR_PROD_LOCAL, true, {
      device: "/dev/disk/by-id/ata-YP0120GWCGV_2H5020013956-part3",
    }),
    pbd(PBD_CIFS_PROD_1, PROD_POOL, HOST_PROD_1, SR_PROD_ISO_CIFS, true, {
      location: "//nas01.example.lan/isos",
      type: "cifs",
      username: "xcp-iso",
      cifspassword: CIFS_PASSWORD,
      vers: "3.0",
    }),
    pbd(PBD_LAB_LOCAL, LAB_POOL, HOST_LAB_1, SR_LAB_LOCAL, true, {
      device: "/dev/sdb",
    }),
  ];
}

export function labVdis(): Array<XoObject> {
  return [
    xapi("VDI", VDI_WEB_01, PROD_POOL, {
      name_label: "web-01 system",
      size: 20 * GiB,
      usage: 8 * GiB,
      $SR: SR_PROD_NFS,
      $VBDs: [],
      VDI_type: "user",
      tags: [],
    }),
    xapi("VDI", VDI_DB_01, PROD_POOL, {
      name_label: "db-01 data",
      size: 100 * GiB,
      usage: 61 * GiB,
      $SR: SR_PROD_NFS,
      $VBDs: [],
      VDI_type: "user",
      tags: [],
    }),
  ];
}

// Messages, alarms among them (an alarm is a message named ALARM).
export function labMessages(): Array<XoObject> {
  return [
    xapi("message", ALARM_NFS_FULL, PROD_POOL, {
      name: "ALARM",
      time: 1764108000,
      $object: SR_PROD_NFS,
      body: { name: "physical_utilisation", value: "0.925" },
      object: { type: "SR", uuid: SR_PROD_NFS },
    }),
    xapi("message", MESSAGE_PLUG_FAILED, PROD_POOL, {
      name: "PBD_PLUG_FAILED_ON_SERVER_START",
      time: 1764093660,
      $object: HOST_PROD_2,
      body: `The SR "NFS VM store" (${SR_PROD_NFS}) could not be plugged on host xcp-prod-02: nfs01.example.lan:/export/vmstore - mount.nfs: Connection timed out`,
    }),
    xapi("message", MESSAGE_APP_02_SHUTDOWN, PROD_POOL, {
      name: "VM_SHUTDOWN",
      time: 1764104400,
      $object: VM_APP_02,
      body: `VM 'app-02' (uuid: ${VM_APP_02}) shut down`,
    }),
    xapi("message", MESSAGE_LAB, LAB_POOL, {
      name: "VM_SHUTDOWN",
      time: 1764000000,
      $object: VM_LAB_01,
      body: `VM 'lab-vm-01' (uuid: ${VM_LAB_01}) shut down`,
    }),
  ];
}

// Xen Orchestra's own tasks: they belong to Xen Orchestra, not to a pool.
export function labTasks(): Array<XoObject> {
  return [
    {
      id: TASK_FAILED_START,
      properties: {
        name: "REST API: start VM",
        objectId: VM_APP_02,
        objectType: "VM",
        type: "xo:rest-api:action",
        userId: "e531b8c9-3876-4ed9-8fd2-0476d5f825c9",
      },
      start: 1764104460000,
      end: 1764104462000,
      updatedAt: 1764104462000,
      status: "failure",
      result: {
        code: "SR_BACKEND_FAILURE_73",
        message:
          "SR_BACKEND_FAILURE_73(, NFS mount error [opterr=mount failed with return code 32], )",
        name: "XapiError",
      },
    },
    {
      id: TASK_BACKUP_RUN,
      properties: {
        name: "API call: backupNg.runJob",
        method: "backupNg.runJob",
        params: { id: BACKUP_JOB_NIGHTLY, schedule: SCHEDULE_NIGHTLY },
        type: "api.call",
        userId: "e531b8c9-3876-4ed9-8fd2-0476d5f825c9",
      },
      start: 1764111600000,
      end: 1764111900000,
      updatedAt: 1764111900000,
      status: "failure",
    },
  ];
}

export function labBackupJobs(): Array<XoObject> {
  return [
    {
      id: BACKUP_JOB_NIGHTLY,
      name: "Nightly delta",
      mode: "delta",
      type: "backup",
      vms: { $pool: PROD_POOL, tags: ["production"] },
      remotes: { id: "1af95910-01b4-4e87-9c2f-d895cafe0776" },
      settings: {
        "": { reportWhen: "failure", timezone: "Europe/Paris" },
        [SCHEDULE_NIGHTLY]: { exportRetention: 7 },
      },
    },
  ];
}

export function labSchedules(): Array<XoObject> {
  return [
    {
      id: SCHEDULE_NIGHTLY,
      cron: "0 2 * * *",
      enabled: true,
      jobId: BACKUP_JOB_NIGHTLY,
      name: "nightly",
      timezone: "Europe/Paris",
      userId: "e531b8c9-3876-4ed9-8fd2-0476d5f825c9",
    },
  ];
}

export function labBackupLogs(): Array<XoObject> {
  return [
    {
      id: BACKUP_LOG_SUCCESS,
      jobId: BACKUP_JOB_NIGHTLY,
      jobName: "Nightly delta",
      scheduleId: SCHEDULE_NIGHTLY,
      message: "backup",
      start: 1764025200000,
      end: 1764025500000,
      status: "success",
      data: { mode: "delta", reportWhen: "failure" },
    },
    {
      id: BACKUP_LOG_FAILED,
      jobId: BACKUP_JOB_NIGHTLY,
      jobName: "Nightly delta",
      scheduleId: SCHEDULE_NIGHTLY,
      message: "backup",
      start: 1764111600000,
      end: 1764111900000,
      status: "failure",
      data: { mode: "delta", reportWhen: "failure" },
      tasks: [
        {
          id: "1764111601000",
          message: "backup VM",
          data: { type: "VM", id: VM_WEB_01, name_label: "web-01" },
          start: 1764111601000,
          end: 1764111890000,
          status: "failure",
          result: {
            message:
              "connect ETIMEDOUT smb://backup:SmbPass9@10.0.0.30/backups",
            name: "Error",
          },
        },
      ],
      result: {
        message: "1 VM failed to back up",
        name: "Error",
      },
    },
  ];
}
