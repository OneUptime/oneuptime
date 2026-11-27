/*
 * Offline fixture for a storage array's pages: the production array layout
 * (ModelPage, the array's side menu) with its Overview (its health and Needs
 * attention by the array's rules, Pages/StorageArray/Utils/
 * StorageArrayHealth), its Hosts, Replication, Hardware and File Systems
 * lists, and a volume's, a host's and a file system's own page - under
 * their real RouteMap patterns. Only the data boundary (ModelAPI,
 * AnalyticsModelAPI, API, Realtime) and the signed-in user are replaced.
 * Every record is fabricated for an "Acme Storage" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?array=     trouble (default): the FlashArray has a critical and a
 *               warning alert open, is 92% full and reads at 6.1 ms; a
 *               drive failed, a fan is degraded, a host reaches it through
 *               one controller and a pod is a minute and a half behind; the
 *               FlashBlade's scratch file system has 5% left | calm: every
 *               part fine (the PowerStore's failed drive, power supply,
 *               fan and port, its stopped NAS server, its volume that is not
 *               ready and its nearly full file system too)
 *   ?collector= disconnected: the arrays' agents stopped reporting three
 *               days ago
 *   ?fail=      inventory: every inventory read fails
 *   ?lang=      de reads the German locale file, fa the Persian one (right
 *               to left)
 *   ?theme=     dark adds html.dark (handled by server.js)
 *
 * Every read is recorded on window.__storageArrayPagesFixture: listRequests,
 * itemRequests, aggregateRequests, apiRequests and unhandled - anything the
 * fixture does not model. The spec asserts `unhandled` is empty.
 */
import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import { followLanguageForDates } from "Common/UI/Utils/DateDisplayLanguage";
import { localeResources } from "../../SuiteHelpers/FixtureLocales";
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import StorageArrayLayout from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Layout";
import StorageArrayOverview from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Index";
import StorageArrayHosts from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Hosts";
import StorageArrayHostDetail from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/HostDetail";
import StorageArrayVolumes from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Volumes";
import StorageArrayVolumeDetail from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/VolumeDetail";
import StorageArrayReplication from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Replication";
import StorageArrayHardware from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Hardware";
import StorageArrayFileSystems from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/FileSystems";
import StorageArrayFileSystemDetail from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/FileSystemDetail";
import StorageArrayBuckets from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Buckets";
import StorageArrayBucketDetail from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/BucketDetail";
import StorageArrayInventory from "../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Inventory";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Metric from "Common/Models/AnalyticsModels/Metric";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThan from "Common/Types/BaseDatabase/GreaterThan";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import StorageSystem from "Common/Types/StorageArray/StorageSystem";
import StorageArrayPlatformRegistry from "Common/Types/StorageArray/StorageArrayPlatformRegistry";
import {
  ACME_AGGREGATE_KIND,
  ACME_PLATFORM,
} from "Common/Tests/Helpers/StorageArray/AcmePlatform";
import API from "Common/UI/Utils/API/API";
import AnalyticsModelAPI from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import UserUtil from "Common/UI/Utils/User";
import { ARCHIVABLE_VALUE_TABLE_NAMES } from "Common/Utils/ArchivableValues";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);

const LANGUAGE = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const CALM = params.get("array") === "calm";
const DISCONNECTED = params.get("collector") === "disconnected";
const INVENTORY_FAILS = params.get("fail") === "inventory";

// A Persian page reads right to left, as production lays it out.
if (params.get("dir") === "rtl" || LANGUAGE === "fa") {
  document.documentElement.dir = "rtl";
}
document.documentElement.lang = LANGUAGE;

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [...GLOBAL_PERMISSIONS, Permission.ProjectOwner];

/*
 * ---------------------------------------------------------------------------
 * Ids, the clock and the arrays
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const MINUTE = 60 * 1000;
const LOADED_AT = Date.now();
const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * GIB;

const FLASHARRAY_ID = uuid("58000000", 1);
const FLASHBLADE_ID = uuid("58000000", 2);
const ACME_ID = uuid("58000000", 3);
const POWERSTORE_ID = uuid("58000000", 4);

/*
 * Acme, a platform that exists only in tests (#11000), registered here the
 * way a test registers it: its array gets the tab, the counts and the
 * inventory page a new platform gets with no page changed for it.
 */
StorageArrayPlatformRegistry.register(ACME_PLATFORM);

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Storage",
});

// When the agents' last report reached OneUptime.
const LAST_REPORT = new Date(
  LOADED_AT - (DISCONNECTED ? 3 * 24 * 60 * MINUTE : 20 * 1000),
);
const reportedAt = new Date(LAST_REPORT.getTime() - 10 * 1000);

const flashArray = {
  _id: FLASHARRAY_ID,
  name: "fa-prod-01",
  description: "The block storage behind the vSphere cluster, in Frankfurt.",
  storageSystem: StorageSystem.PureStorageFlashArray,
  reportedName: "fa-prod-01",
  systemId: "5f6a1b2c-3d4e-4f50-8a9b-0c1d2e3f4a5b",
  osName: "Purity//FA",
  osVersion: "6.7.2",
  agentVersion: "14.0.101",
  otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
  lastSeenAt: LAST_REPORT,
  capacityBytes: 100 * TIB,
  usedBytes: (CALM ? 61 : 92) * TIB,
  capacityUsedPercent: CALM ? 61 : 92,
  dataReductionRatio: 4.2,
  openAlertCount: CALM ? 0 : 2,
  criticalAlertCount: CALM ? 0 : 1,
  warningAlertCount: CALM ? 0 : 1,
  healthStatus: CALM ? 0 : 2,
  volumeCount: 6,
  hostCount: 6,
  podCount: 2,
  hardwareComponentCount: 7,
  unhealthyHardwareCount: CALM ? 0 : 2,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 120 * 24 * 60 * MINUTE),
};

const flashBlade = {
  _id: FLASHBLADE_ID,
  name: "fb-prod-01",
  description: "File and object storage for the analytics team.",
  storageSystem: StorageSystem.PureStorageFlashBlade,
  reportedName: "fb-prod-01",
  systemId: "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d",
  osName: "Purity//FB",
  osVersion: "4.5.3",
  agentVersion: "14.0.101",
  otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
  lastSeenAt: LAST_REPORT,
  capacityBytes: 400 * TIB,
  usedBytes: 160 * TIB,
  capacityUsedPercent: 40,
  dataReductionRatio: 1.6,
  openAlertCount: 0,
  criticalAlertCount: 0,
  warningAlertCount: 0,
  healthStatus: 0,
  fileSystemCount: 3,
  bucketCount: 1,
  hardwareComponentCount: 4,
  unhealthyHardwareCount: 0,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 60 * 24 * 60 * MINUTE),
};

// An array of the test-only Acme platform: volumes, and aggregates of its own.
const acmeArray = {
  _id: ACME_ID,
  name: "acme-prod-01",
  description: "An array of a platform the preview registers itself.",
  storageSystem: ACME_PLATFORM.storageSystem,
  reportedName: "acme-prod-01",
  osName: "AcmeOS",
  osVersion: "9.1",
  agentVersion: "14.0.101",
  otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
  lastSeenAt: LAST_REPORT,
  capacityBytes: 50 * TIB,
  usedBytes: 20 * TIB,
  capacityUsedPercent: 40,
  openAlertCount: 0,
  criticalAlertCount: 0,
  warningAlertCount: 0,
  healthStatus: 0,
  volumeCount: 2,
  countsByKind: { Volume: 2, [ACME_AGGREGATE_KIND]: 3 },
  isArchived: false,
  createdAt: new Date(LOADED_AT - 10 * 24 * 60 * MINUTE),
};

/*
 * A Dell PowerStore cluster of two appliances (#11002), as the agent reads
 * one through Dell's exporter: no open alerts here (a PowerStore sends them
 * by syslog, to the Logs page), its health from its parts. Its per-kind
 * counts are the inventory's, set once its parts are made below.
 */
const powerStore = {
  _id: POWERSTORE_ID,
  name: "ps-prod-01",
  description: "Block and file storage for the ERP systems, in Amsterdam.",
  storageSystem: StorageSystem.DellPowerStore,
  reportedName: "ps-prod-01",
  systemId: "PS4f5c9a3d21e7",
  osName: "PowerStoreOS",
  agentVersion: "14.0.101",
  otelCollectorStatus: DISCONNECTED ? "disconnected" : "connected",
  lastSeenAt: LAST_REPORT,
  capacityBytes: 220 * TIB,
  usedBytes: (CALM ? 101 : 155) * TIB,
  capacityUsedPercent: CALM ? 45.9 : 70.5,
  dataReductionRatio: 3.2,
  healthStatus: CALM ? 0 : 2,
  volumeCount: 6,
  fileSystemCount: 3,
  isArchived: false,
  createdAt: new Date(LOADED_AT - 21 * 24 * 60 * MINUTE),
};

let rowNumber = 0;
const inventory = [];

function part(arrayId, fields) {
  rowNumber++;
  inventory.push({
    _id: uuid("59000000", rowNumber),
    storageArrayId: arrayId,
    lastSeenAt: reportedAt,
    metricsUpdatedAt: reportedAt,
    createdAt: new Date(LOADED_AT - 30 * 24 * 60 * MINUTE),
    details: {},
    ...fields,
  });
}

/*
 * The FlashArray's parts. The trouble array's: a failed drive in bay 3 (the
 * bay critical too), a degraded fan, esx-04 reaching it through one
 * controller, dr-pod a minute and a half behind.
 */
const VOLUMES = [
  { name: "vg1/vol-db", provisionedTib: 4, usedTib: 1.2, hosts: 2 },
  { name: "vg1/vol-logs", provisionedTib: 2, usedTib: 0.4, hosts: 2 },
  { name: "esx-datastore-01", provisionedTib: 16, usedTib: 9.8, hosts: 6 },
  { name: "esx-datastore-02", provisionedTib: 16, usedTib: 7.1, hosts: 6 },
  { name: "dr-pod::vol-orders", provisionedTib: 8, usedTib: 3.3, hosts: 1 },
  {
    name: "vsphere-prod-datastore-archive-2024-eu-central-replicated",
    provisionedTib: 32,
    usedTib: 11.6,
    hosts: 6,
  },
];

for (const volume of VOLUMES) {
  part(FLASHARRAY_ID, {
    kind: "Volume",
    externalId: volume.name,
    name: volume.name,
    capacityBytes: Math.round(volume.provisionedTib * TIB),
    usedBytes: Math.round(volume.usedTib * TIB),
    connectionCount: volume.hosts,
    dataReductionRatio: 3.8,
    readLatencyUsec: 410,
    writeLatencyUsec: 380,
    readIops: 1200,
    writeIops: 900,
  });
}

const HOSTS = ["esx-01", "esx-02", "esx-03", "esx-04", "esx-05", "esx-06"];
for (const host of HOSTS) {
  const lostPath = !CALM && host === "esx-04";
  const unused = host === "esx-06";
  part(FLASHARRAY_ID, {
    kind: "Host",
    externalId: host,
    name: host,
    status: unused ? "unused" : lostPath ? "critical" : "healthy",
    statusDetail: unused
      ? "None"
      : lostPath
        ? "Single Controller"
        : "Redundant",
    groupName: unused ? null : "vsphere-prod",
    connectionCount: unused ? 0 : 5,
    capacityBytes: unused ? 0 : 68 * TIB,
    readLatencyUsec: 520,
    writeLatencyUsec: 610,
  });
}

part(FLASHARRAY_ID, {
  kind: "Pod",
  externalId: "dr-pod",
  name: "dr-pod",
  status: "replicating",
  replicationLagMs: CALM ? 3000 : 95000,
  details: {
    remote: "fa-dr-02",
    remotePod: "dr-pod",
    direction: "outbound",
    averageLagMs: CALM ? 2000 : 61000,
    mediatorStatus: "online",
  },
});
part(FLASHARRAY_ID, {
  kind: "Pod",
  externalId: "sync-pod",
  name: "sync-pod",
  status: "replicating",
  replicationLagMs: 0,
  details: {
    remote: "fa-prod-02",
    remotePod: "sync-pod",
    direction: "outbound",
    averageLagMs: 0,
    mediatorStatus: "online",
  },
});

const HARDWARE = [
  { kind: "Controller", name: "CT0", status: "ready" },
  { kind: "Controller", name: "CT1", status: "ready" },
  { kind: "Hardware", name: "CT0.FAN1", status: CALM ? "ok" : "degraded" },
  { kind: "Hardware", name: "CH0.BAY3", status: CALM ? "ok" : "critical" },
  { kind: "Hardware", name: "CH0.BAY9", status: "not_installed" },
  { kind: "Hardware", name: "CT0.PWR0", status: "ok" },
  { kind: "Drive", name: "CH0.BAY1", status: "healthy" },
  { kind: "Drive", name: "CH0.BAY2", status: "healthy" },
  { kind: "Drive", name: "CH0.BAY3", status: CALM ? "healthy" : "failed" },
  { kind: "NetworkInterface", name: "CT0.ETH4", status: "enabled" },
  { kind: "NetworkInterface", name: "CT1.ETH4", status: "enabled" },
];
for (const hardware of HARDWARE) {
  part(FLASHARRAY_ID, {
    kind: hardware.kind,
    externalId: hardware.name,
    name: hardware.name,
    status: hardware.status,
    capacityBytes: hardware.kind === "Drive" ? Math.round(3.84 * TIB) : null,
  });
}

// The FlashBlade's file systems: scratch nearly full on the trouble day.
const FILE_SYSTEMS = [
  {
    name: "scratch",
    provisionedTib: 10,
    usedTib: 2,
    available: CALM ? 0.5 : 0.05,
  },
  { name: "home", provisionedTib: 40, usedTib: 12, available: 0.6 },
  { name: "projects", provisionedTib: 80, usedTib: 41, available: 0.3 },
];
for (const fileSystem of FILE_SYSTEMS) {
  part(FLASHBLADE_ID, {
    kind: "FileSystem",
    externalId: fileSystem.name,
    name: fileSystem.name,
    capacityBytes: Math.round(fileSystem.provisionedTib * TIB),
    usedBytes: Math.round(fileSystem.usedTib * TIB),
    details: { nfs: "true", smb: "true" },
  });
}
part(FLASHBLADE_ID, {
  kind: "Bucket",
  externalId: "logs-archive",
  name: "logs-archive",
  // Its account, where the ingest writes it (StorageArraySnapshotScan).
  groupName: "analytics",
  usedBytes: Math.round(3.1 * TIB),
  details: { objectCount: 1820044 },
});
for (const blade of ["CH1.FB1", "CH1.FB2", "CH1.FM1", "CH1.PWR1"]) {
  part(FLASHBLADE_ID, {
    kind: "Hardware",
    externalId: blade,
    name: blade,
    status: "healthy",
  });
}

// What the trouble array raised: an alert on esx-04, an incident on dr-pod.
const openAlerts = CALM
  ? []
  : [
      {
        _id: uuid("61000000", 1),
        title:
          "[Storage Array] Host Lost Redundant Paths (esx-04) - fa-prod-01",
        alertNumber: 52,
        createdAt: new Date(LOADED_AT - 18 * MINUTE),
        currentAlertStateId: uuid("51000000", 1),
        storageArrays: FLASHARRAY_ID,
        seriesLabels: { host: "esx-04" },
      },
    ];

const openIncidents = CALM
  ? []
  : [
      {
        _id: uuid("62000000", 1),
        title: "[Storage Array] Replication Lag Above 1 Minute - fa-prod-01",
        incidentNumber: 23,
        createdAt: new Date(LOADED_AT - 9 * MINUTE),
        declaredAt: new Date(LOADED_AT - 9 * MINUTE),
        currentIncidentStateId: uuid("50000000", 1),
        storageArrays: FLASHARRAY_ID,
        seriesLabels: { local_pod: "dr-pod" },
      },
    ];

// The Acme array's parts.
for (const [name, usedTib, sizeTib] of [
  ["aggr1", 12, 20],
  ["aggr2", 6, 20],
  ["aggr3", 2, 10],
]) {
  part(ACME_ID, {
    kind: ACME_AGGREGATE_KIND,
    externalId: name,
    name: name,
    status: "online",
    capacityBytes: sizeTib * TIB,
    usedBytes: usedTib * TIB,
  });
}
for (const name of ["vol-acme-01", "vol-acme-02"]) {
  part(ACME_ID, {
    kind: "Volume",
    externalId: name,
    name: name,
    status: "online",
    capacityBytes: 2 * TIB,
    usedBytes: TIB,
  });
}

/*
 * The PowerStore's parts, as its extractor writes them: each appliance by
 * its id, and every part of an appliance keyed by the appliance and its
 * name, with the appliance as its group (each appliance names its parts
 * alike). The trouble day's: a failed drive and power supply on A1, a fan
 * and a port down on A2, a NAS server stopped, a volume not ready and a
 * file system 94.5% full.
 */
const POWERSTORE_APPLIANCES = [
  {
    id: "A1",
    name: "ps-prod-01-appliance-1",
    model: "PowerStore 1200T",
    usedPercent: CALM ? 41.2 : 48.9,
    reduction: 3.6,
    readUsec: 412,
    writeUsec: 598,
  },
  {
    id: "A2",
    name: "ps-prod-01-appliance-2",
    model: "PowerStore 1200T",
    usedPercent: CALM ? 50.6 : 92.1,
    reduction: 2.9,
    readUsec: 655,
    writeUsec: 840,
  },
];
for (const appliance of POWERSTORE_APPLIANCES) {
  part(POWERSTORE_ID, {
    kind: "Appliance",
    externalId: appliance.id,
    name: appliance.name,
    model: appliance.model,
    capacityBytes: 110 * TIB,
    usedBytes: Math.round((110 * TIB * appliance.usedPercent) / 100),
    dataReductionRatio: appliance.reduction,
    readLatencyUsec: appliance.readUsec,
    writeLatencyUsec: appliance.writeUsec,
    readIops: 38000,
    writeIops: 21000,
  });
}

const POWERSTORE_VOLUMES = [
  {
    name: "erp-db-01",
    appliance: "A1",
    sizeTib: 4,
    usedTib: 1.9,
    readUsec: 610,
    writeUsec: 880,
  },
  {
    name: "erp-db-logs",
    appliance: "A1",
    sizeTib: 1,
    usedTib: 0.3,
    readUsec: 240,
    writeUsec: 410,
  },
  {
    name: "vmfs-prod-01",
    appliance: "A2",
    sizeTib: 16,
    usedTib: 9.4,
    readUsec: 520,
    writeUsec: 760,
  },
  {
    name: "vmfs-prod-02",
    appliance: "A2",
    sizeTib: 16,
    usedTib: 7.7,
    readUsec: 470,
    writeUsec: 690,
  },
  {
    name: "sql-backup",
    appliance: "A1",
    sizeTib: 8,
    usedTib: 5.1,
    readUsec: 330,
    writeUsec: 1240,
  },
  {
    name: "archive-legacy",
    appliance: "A2",
    sizeTib: 2,
    usedTib: 1.6,
    readUsec: 180,
    writeUsec: 260,
    notReady: !CALM,
  },
];
for (const volume of POWERSTORE_VOLUMES) {
  part(POWERSTORE_ID, {
    kind: "Volume",
    externalId: volume.name,
    name: volume.name,
    status: volume.notReady ? "not ready" : "ready",
    groupName: volume.appliance,
    capacityBytes: Math.round(volume.sizeTib * TIB),
    usedBytes: Math.round(volume.usedTib * TIB),
    readLatencyUsec: volume.readUsec,
    writeLatencyUsec: volume.writeUsec,
    readIops: 2400,
    writeIops: 1300,
  });
}

for (const [name, sizeTib, usedTib, appliances] of [
  ["erp-vg", 5, 2.2, "A1"],
  ["vmfs-vg", 32, 17.1, "A1, A2"],
]) {
  part(POWERSTORE_ID, {
    kind: "VolumeGroup",
    externalId: name,
    name: name,
    capacityBytes: sizeTib * TIB,
    usedBytes: Math.round(usedTib * TIB),
    readLatencyUsec: 402,
    writeLatencyUsec: 575,
    readIops: 9100,
    writeIops: 4800,
    details: { appliances: appliances },
  });
}

for (const [name, started] of [
  ["nas-prod-01", true],
  ["nas-files-02", CALM],
]) {
  part(POWERSTORE_ID, {
    kind: "NasServer",
    externalId: name,
    name: name,
    status: started ? "started" : "not started",
    readLatencyUsec: started ? 690 : null,
    writeLatencyUsec: started ? 910 : null,
    readIops: started ? 3200 : null,
    writeIops: started ? 1100 : null,
  });
}

for (const [name, sizeTib, usedPercent] of [
  ["fs-home", 10, CALM ? 61 : 94.5],
  ["fs-projects", 40, 30],
  ["fs-scratch", 5, 20],
]) {
  part(POWERSTORE_ID, {
    kind: "FileSystem",
    externalId: name,
    name: name,
    capacityBytes: sizeTib * TIB,
    usedBytes: Math.round((sizeTib * TIB * usedPercent) / 100),
  });
}

// Each appliance's nodes, and their fans, power supplies and batteries.
for (const appliance of ["A1", "A2"]) {
  for (const node of ["NodeA", "NodeB"]) {
    const parts = [
      ["", "Node"],
      ["-Fan0", "Fan"],
      ["-Fan1", "Fan"],
      ["-PowerSupply", "Power Supply"],
      ["-Battery", "Battery"],
    ];
    for (const [suffix, type] of parts) {
      const name = `BaseEnclosure-${node}${suffix}`;
      const faulty =
        !CALM &&
        ((appliance === "A1" && name === "BaseEnclosure-NodeB-PowerSupply") ||
          (appliance === "A2" && name === "BaseEnclosure-NodeB-Fan1"));
      part(POWERSTORE_ID, {
        kind: "Hardware",
        externalId: `${appliance}/${name}`,
        name: name,
        groupName: appliance,
        componentType: type,
        status: faulty ? "unhealthy" : "healthy",
      });
    }
  }
}

// Each appliance's drives: NVMe SSDs and an NVRAM drive.
for (const appliance of ["A1", "A2"]) {
  for (const slot of [0, 1, 2, 3, 23]) {
    const name = `Drive_0_0_${slot}`;
    const nvram = slot === 23;
    const failed = !CALM && appliance === "A1" && slot === 2;
    part(POWERSTORE_ID, {
      kind: "Drive",
      externalId: `${appliance}/${name}`,
      name: name,
      groupName: appliance,
      componentType: nvram ? "NVMe NVRAM" : "NVMe SSD",
      status: failed ? "unhealthy" : "healthy",
      capacityBytes: nvram ? 8 * GIB : 3840755982336,
      details: {
        protocol: "NVMe",
        enduranceRemainingPercent: appliance === "A1" && slot === 3 ? 8 : 97,
      },
    });
  }
}

// Each node's front-end ports: Fibre Channel and Ethernet.
for (const appliance of ["A1", "A2"]) {
  for (const [name, type, speedGbps] of [
    ["BaseEnclosure-NodeA-IoModule0-FEPort0", "Fibre Channel", 32],
    ["BaseEnclosure-NodeB-IoModule0-FEPort1", "Fibre Channel", 32],
    ["BaseEnclosure-NodeA-4PortCard-FEPort0", "Ethernet", 25],
  ]) {
    const down =
      !CALM &&
      appliance === "A2" &&
      name === "BaseEnclosure-NodeB-IoModule0-FEPort1";
    part(POWERSTORE_ID, {
      kind: "NetworkInterface",
      externalId: `${appliance}/${name}`,
      name: name,
      groupName: appliance,
      componentType: type,
      status: down ? "down" : "up",
      details: {
        speedGbps: down ? 0 : speedGbps,
        speedBytesPerSec: down ? 0 : (speedGbps * 1e9) / 8,
        errorsPerSec: 0,
      },
    });
  }
}

// The cluster's counts, as the server keeps them: every kind it holds.
powerStore.countsByKind = {};
powerStore.hardwareComponentCount = 0;
powerStore.unhealthyHardwareCount = 0;
for (const row of inventory) {
  if (row.storageArrayId === POWERSTORE_ID) {
    powerStore.countsByKind[row.kind] =
      (powerStore.countsByKind[row.kind] || 0) + 1;
    if (["Hardware", "Drive"].includes(row.kind)) {
      powerStore.hardwareComponentCount++;
      if (row.status === "unhealthy") {
        powerStore.unhealthyHardwareCount++;
      }
    }
  }
}

/*
 * ---------------------------------------------------------------------------
 * The data boundary
 * ---------------------------------------------------------------------------
 */
const fixture = {
  listRequests: [],
  itemRequests: [],
  aggregateRequests: [],
  apiRequests: [],
  unhandled: [],
};
window.__storageArrayPagesFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

function plain(value) {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return value;
}

/*
 * A query's plain values, its Includes and its GreaterThan must match, as
 * the server would; what else a query holds (a search) is let through.
 */
function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (wanted instanceof Includes) {
      const allowed = new Set(
        wanted.values.map((entry) => {
          return String(plain(entry));
        }),
      );
      if (!allowed.has(String(plain(record[field])))) {
        return false;
      }
      continue;
    }
    if (wanted instanceof GreaterThan) {
      if (!(Number(record[field]) > Number(wanted.value))) {
        return false;
      }
      continue;
    }
    const value = plain(wanted);
    if (
      typeof value !== "string" &&
      typeof value !== "boolean" &&
      typeof value !== "number"
    ) {
      continue;
    }
    if (String(record[field] ?? "") !== String(value)) {
      return false;
    }
  }
  return true;
}

const store = {
  StorageArray: [flashArray, flashBlade, acmeArray, powerStore],
  StorageArrayResource: inventory,
  IncidentState: [
    { _id: uuid("50000000", 1), name: "Identified", order: 1 },
    {
      _id: uuid("50000000", 2),
      name: "Resolved",
      order: 2,
      isResolvedState: true,
    },
  ],
  AlertState: [
    { _id: uuid("51000000", 1), name: "Created", order: 1 },
    {
      _id: uuid("51000000", 2),
      name: "Resolved",
      order: 2,
      isResolvedState: true,
    },
  ],
  ScheduledMaintenanceState: [
    { _id: uuid("54000000", 1), name: "Scheduled", order: 1 },
    {
      _id: uuid("54000000", 2),
      name: "Completed",
      order: 2,
      isResolvedState: true,
      isEndedState: true,
    },
  ],
  Incident: openIncidents,
  Alert: openAlerts,
  ScheduledMaintenance: [],
  // The part alerts cards read which monitors exist: none yet.
  Monitor: [],
  // The golden charts read the metrics' units: none recorded yet.
  MetricType: [],
  RecommendationDismissal: [],
  Label: [],
  TableView: [],
};

for (const name of ARCHIVABLE_VALUE_TABLE_NAMES) {
  for (const record of store[name] || []) {
    if (record.isArchived === undefined) {
      record.isArchived = false;
    }
  }
}

// In the order the server sorts them: by each sort field, in turn.
function sortRecords(records, sort) {
  const fields = Object.entries(sort || {});
  return [...records].sort((left, right) => {
    for (const [field, order] of fields) {
      const a = left[field] ?? "";
      const b = right[field] ?? "";
      const bothNumbers = typeof a === "number" && typeof b === "number";
      if (a !== b) {
        const ascending = bothNumbers
          ? a < b
            ? -1
            : 1
          : String(a) < String(b)
            ? -1
            : 1;
        return String(order).toLowerCase().startsWith("desc")
          ? -ascending
          : ascending;
      }
    }
    return 0;
  });
}

function rows(modelType, query, sort) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return sortRecords(
    store[name].filter((record) => {
      return matches(record, query);
    }),
    sort,
  ).map((record) => {
    return Object.assign(new modelType(), record);
  });
}

UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID(uuid("80000000", 1));
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-storage.example";
};
PermissionUtil.getAllPermissions = () => {
  return [...rolePermissions];
};
PermissionUtil.getGlobalPermissions = () => {
  return {
    _type: "UserGlobalAccessPermission",
    projectIds: [projectObjectId],
    globalPermissions: [...GLOBAL_PERMISSIONS],
  };
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: projectObjectId,
    permissions: rolePermissions
      .filter((permission) => {
        return !GLOBAL_PERMISSIONS.includes(permission);
      })
      .map((permission) => {
        return { _type: "UserPermission", permission, labelIds: [] };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({
    modelName,
    query: serialize(options.query),
    limit: options.limit,
  });

  if (modelName === "StorageArrayResource" && INVENTORY_FAILS) {
    throw new Error("The inventory could not be read.");
  }

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  const skip = options.skip || 0;
  const limit = options.limit || 10;
  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip: skip,
    limit: limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  const id = plain(options.id);
  fixture.itemRequests.push({ modelName, id });

  if (!store[modelName]) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }

  const record = store[modelName].find((candidate) => {
    return candidate._id === id;
  });

  return record ? Object.assign(new options.modelType(), record) : null;
};

function arrayNameOf(attributes) {
  return String((attributes || {})["resource.storage.array.name"] || "").trim();
}

function metricRow(modelType, value, attributes, minutesAgo) {
  const row = new modelType();
  row.time = new Date(LOADED_AT - (minutesAgo || 0) * MINUTE - 20 * 1000);
  row.value = value;
  row.attributes = attributes;
  return row;
}

/*
 * The newest readings the pages read: the alerts each array raised, its
 * latency by dimension and each FlashBlade file system's available share -
 * newest first.
 */
AnalyticsModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  const query = options.query || {};
  fixture.listRequests.push({ modelName, query: serialize(query) });

  // The golden charts look for change events to mark: none here.
  if (modelName === "ChangeEventV1") {
    return { data: [], count: 0, skip: 0, limit: options.limit || 10 };
  }

  if (modelName !== tableName(Metric)) {
    fixture.unhandled.push({
      kind: "analytics.getList",
      modelName,
      name: query.name || null,
    });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }

  const attributes = query.attributes || {};
  const arrayName = arrayNameOf(attributes);
  let data = [];

  if (DISCONNECTED) {
    data = [];
  } else if (query.name === "purefa_alerts_open") {
    data =
      CALM || arrayName !== "fa-prod-01"
        ? []
        : [
            metricRow(options.modelType, 1, {
              "resource.storage.array.name": "fa-prod-01",
              severity: "critical",
              code: "12",
              component_name: "CH0.BAY3",
              component_type: "drive",
              summary: "Drive failed",
              created: "1730600000000",
            }),
            metricRow(options.modelType, 1, {
              "resource.storage.array.name": "fa-prod-01",
              severity: "warning",
              code: "41",
              component_name: "CT0.FAN1",
              component_type: "cooling",
              summary: "Fan running degraded",
              created: "1730600300000",
            }),
          ];
  } else if (query.name === "purefb_alerts_open") {
    data = [];
  } else if (
    query.name === "purefa_array_performance_latency_usec" ||
    query.name === "purefb_array_performance_latency_usec"
  ) {
    const fa = query.name.startsWith("purefa");
    const read = fa ? (CALM ? 800 : 6100) : 2000;
    const write = fa ? 900 : 1500;
    data = [
      metricRow(options.modelType, read, {
        "resource.storage.array.name": arrayName,
        dimension: "usec_per_read_op",
      }),
      metricRow(options.modelType, write, {
        "resource.storage.array.name": arrayName,
        dimension: "usec_per_write_op",
      }),
    ].filter((row) => {
      return (
        !attributes["dimension"] ||
        row.attributes["dimension"] === attributes["dimension"]
      );
    });
  } else if (query.name === "purefb_file_systems_space_bytes") {
    data = FILE_SYSTEMS.map((fileSystem) => {
      return metricRow(options.modelType, fileSystem.available, {
        "resource.storage.array.name": "fb-prod-01",
        name: fileSystem.name,
        space: "available_ratio",
      });
    }).filter((row) => {
      return (
        !attributes["name"] || row.attributes["name"] === attributes["name"]
      );
    });
  } else if (
    String(query.name || "").startsWith("purefa_") ||
    String(query.name || "").startsWith("purefb_") ||
    String(query.name || "").startsWith("powerstore_")
  ) {
    // A golden chart's raw points: empty, as it draws from the aggregates.
    data = [];
  } else {
    fixture.unhandled.push({
      kind: "analytics.getList",
      modelName,
      name: query.name || null,
    });
  }
  return { data, count: data.length, skip: 0, limit: options.limit || 10 };
};

AnalyticsModelAPI.count = async (modelType) => {
  fixture.unhandled.push({
    kind: "analytics.count",
    modelName: tableName(modelType),
  });
  return 0;
};

/*
 * The series the pages chart: any of the arrays' own (purefa_*, purefb_*,
 * powerstore_*), a smooth line over the chart's range.
 */
AnalyticsModelAPI.aggregate = async (options) => {
  const modelName = tableName(options.modelType);
  const aggregateBy = options.aggregateBy || {};
  const query = aggregateBy.query || {};
  fixture.aggregateRequests.push({ modelName, name: query.name || null });

  const name = String(query.name || "");
  if (
    modelName !== tableName(Metric) ||
    !(
      name.startsWith("purefa_") ||
      name.startsWith("purefb_") ||
      name.startsWith("powerstore_")
    )
  ) {
    fixture.unhandled.push({ kind: "aggregate", modelName, name: query.name });
    return { data: [] };
  }

  if (DISCONNECTED) {
    return { data: [] };
  }

  const data = [];
  const level = chartLevel(name, query.attributes || {});
  for (let step = 30; step >= 0; step--) {
    data.push({
      timestamp: new Date(LOADED_AT - step * MINUTE).toISOString(),
      value: level * (1 + 0.08 * Math.sin(step / 4)),
      attributes: {},
    });
  }
  return { data };
};

// Where a chart's line sits: what the array reports for that series.
function chartLevel(name, attributes) {
  // A PowerStore names reads and writes in the series' name.
  if (name.startsWith("powerstore_")) {
    const writes = name.includes("write");
    if (name.includes("used_percent")) {
      return powerStore.capacityUsedPercent;
    }
    if (name.includes("latency")) {
      return writes ? 690 : 520;
    }
    if (name.includes("iops")) {
      return writes ? 21000 : 38000;
    }
    if (name.includes("bandwidth")) {
      return (writes ? 450 : 900) * 1024 * 1024;
    }
    return 1000;
  }
  const dimension = String(attributes["dimension"] || "");
  const write = dimension.includes("write");
  if (name.includes("latency")) {
    if (write) {
      return 900;
    }
    return name.startsWith("purefa_array") ? (CALM ? 800 : 6100) : 450;
  }
  if (name.includes("iops")) {
    return write ? 18000 : 42000;
  }
  if (name.includes("bandwidth") || name.includes("bytes_per_sec")) {
    return write ? 600 * 1024 * 1024 : 1200 * 1024 * 1024;
  }
  if (name.includes("utilization")) {
    return name.startsWith("purefa") ? flashArray.capacityUsedPercent : 40;
  }
  return 1000;
}

function ok(data) {
  return new HTTPResponse(200, data, {});
}

async function handleApi(method, options) {
  const url = options.url.toString();
  const parsed = new URL(url, window.location.origin);
  const body = options.data || {};
  fixture.apiRequests.push({
    method,
    url: parsed.pathname,
    body: serialize(body),
  });

  // The side menu's counts, from the inventory as the server counts it.
  if (method === "POST" && parsed.pathname.includes("/inventory-summary/")) {
    const arrayId = parsed.pathname.split("/").pop();
    const count = (kind) => {
      return inventory.filter((row) => {
        return row.storageArrayId === arrayId && row.kind === kind;
      }).length;
    };
    // Distinct parts, as the server counts them: a failed drive and its bay are one.
    const unhealthy = new Set(
      inventory
        .filter((row) => {
          return (
            row.storageArrayId === arrayId &&
            ["Hardware", "Drive", "Controller"].includes(row.kind) &&
            ["critical", "failed", "degraded", "unhealthy", "missing"].includes(
              row.status,
            )
          );
        })
        .map((row) => {
          return row.externalId.toLowerCase();
        }),
    ).size;
    // Every kind's count, as the server's summary has it (countsByKind).
    const countsByKind = {};
    for (const row of inventory) {
      if (row.storageArrayId === arrayId) {
        countsByKind[row.kind] = (countsByKind[row.kind] || 0) + 1;
      }
    }
    return ok({
      countsByKind: countsByKind,
      volumeCount: count("Volume"),
      hostCount: count("Host"),
      podCount: count("Pod"),
      directoryCount: count("Directory"),
      fileSystemCount: count("FileSystem"),
      bucketCount: count("Bucket"),
      hardwareCount: count("Hardware"),
      driveCount: count("Drive"),
      controllerCount: count("Controller"),
      networkInterfaceCount: count("NetworkInterface"),
      unhealthyHardwareCount: unhealthy,
    });
  }

  // When OneUptime itself was not receiving: never, here.
  if (method === "POST" && parsed.pathname.endsWith("/receiving-gaps")) {
    return ok({ gaps: [] });
  }

  /*
   * Which recommended monitors exist already (#11074), as the server
   * answers from the Monitor store: none yet, so none is covered.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/monitor/recommendation-coverage")
  ) {
    return ok({ covered: {} });
  }

  /*
   * The Overview's AI agent card: answered "no AI agent yet", as the server
   * answers for an array nobody installed one beside.
   */
  if (
    method === "POST" &&
    parsed.pathname.endsWith("/resource-ai-access/status")
  ) {
    return ok({
      resourceType: "StorageArray",
      resourceId: FLASHARRAY_ID,
      resourceName: "fa-prod-01",
      isAiInvestigationEnabled: true,
      aiRemediationMode: "Disabled",
      aiCommandAllowlist: [],
      agent: null,
      gaps: [
        {
          code: "ai_agent_not_connected",
          title: "No AI agent is connected",
          nextStep: "Run the AI agent beside the Storage Array agent.",
          blocksInvestigation: true,
          blocksRemediation: true,
        },
      ],
      isInvestigationReady: false,
      isRemediationReady: false,
    });
  }

  fixture.unhandled.push({ kind: "api", method, url: parsed.pathname });
  return new HTTPErrorResponse(404, { message: "Not modelled." }, {});
}

API.get = async (options) => {
  return handleApi("GET", options);
};
API.post = async (options) => {
  return handleApi("POST", options);
};
API.put = async (options) => {
  return handleApi("PUT", options);
};
API.delete = async (options) => {
  return handleApi("DELETE", options);
};
API.fetch = async (options) => {
  return handleApi(options.method || "GET", options);
};

function subscribe() {
  return () => {};
}
Realtime.listenToAnalyticsModelEvent = subscribe;
Realtime.listenToModelEvent = subscribe;

/*
 * English, the fallback, is in the bundle; German and Persian are each a
 * chunk of its own, loaded only by a page drawn in that language, as the
 * Dashboard loads a locale (src/Utils/I18nLocaleLoader.ts), and built as the
 * Dashboard ships them (server.js, SuiteHelpers/FixtureLocalesBuild.js).
 * Imported whole, they were parsed on every page load of every test (#8366).
 */
const LOCALE_LOADERS = {
  de: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/de.json");
  },
  fa: () => {
    return import("../../../App/FeatureSet/Dashboard/src/Locales/fa.json");
  },
};

await i18next.use(initReactI18next).init({
  lng: LANGUAGE,
  fallbackLng: "en",
  resources: await localeResources({
    language: LANGUAGE,
    english: en,
    loaders: LOCALE_LOADERS,
  }),
  interpolation: { escapeValue: false },
});
// Dates in the page's language, as the Dashboard's i18n start-up has them.
followLanguageForDates(i18next);

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: RouteMap[pageKey],
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function withNavigation(Component, pageKey) {
  return function NavigatedPage() {
    useNavigationHooks();
    return <Component {...pageProps(pageKey)} />;
  };
}

const PAGES = [
  [PageMap.STORAGE_ARRAY_VIEW, StorageArrayOverview],
  [PageMap.STORAGE_ARRAY_VIEW_VOLUMES, StorageArrayVolumes],
  [PageMap.STORAGE_ARRAY_VIEW_VOLUME_DETAIL, StorageArrayVolumeDetail],
  [PageMap.STORAGE_ARRAY_VIEW_HOSTS, StorageArrayHosts],
  [PageMap.STORAGE_ARRAY_VIEW_HOST_DETAIL, StorageArrayHostDetail],
  [PageMap.STORAGE_ARRAY_VIEW_REPLICATION, StorageArrayReplication],
  [PageMap.STORAGE_ARRAY_VIEW_HARDWARE, StorageArrayHardware],
  [PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEMS, StorageArrayFileSystems],
  [PageMap.STORAGE_ARRAY_VIEW_FILE_SYSTEM_DETAIL, StorageArrayFileSystemDetail],
  [PageMap.STORAGE_ARRAY_VIEW_BUCKETS, StorageArrayBuckets],
  [PageMap.STORAGE_ARRAY_VIEW_BUCKET_DETAIL, StorageArrayBucketDetail],
  [PageMap.STORAGE_ARRAY_VIEW_INVENTORY, StorageArrayInventory],
].map(([pageKey, Component]) => {
  return {
    path: RouteMap[pageKey].toString(),
    Page: withNavigation(Component, pageKey),
  };
});

const StorageArrayFixtureLayout = withNavigation(
  StorageArrayLayout,
  PageMap.STORAGE_ARRAY_VIEW,
);

// A page the views link to that is not modelled: says where it is.
function StubPage() {
  useNavigationHooks();
  const location = useLocation();
  return (
    <main className="mx-auto max-w-3xl px-8 py-16">
      <h1 className="text-xl font-semibold text-gray-900">Not modelled</h1>
      <p
        data-testid="stub-page"
        className="mt-2 break-all font-mono text-sm text-gray-600"
      >
        {location.pathname}
        {location.search}
      </p>
    </main>
  );
}

function FixtureApp() {
  useNavigationHooks();

  return (
    <>
      <header
        data-testid="fixture-header"
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
          <span className="text-sm text-gray-500">Acme Storage</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<StorageArrayFixtureLayout />}>
          {PAGES.map((page) => {
            return (
              <Route key={page.path} path={page.path} element={<page.Page />} />
            );
          })}
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  // Synchronous navigation, as the Dashboard mounts it (Index.tsx).
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
