import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "Common/UI/Styles/Theme.css";
import InventoryAssetDetailsCard from "../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard";
import DeviceInventoryCard from "../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/DeviceInventoryCard";
import NetworkDeviceView from "../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Index";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import NetworkControllerProvider from "Common/Types/NetworkController/NetworkControllerProvider";
import {
  NetworkDeviceDiscoveryReaderType,
  buildControllerReading,
} from "Common/Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import {
  INVENTORY_ASSET_ATTRIBUTE_KEYS,
  INVENTORY_SITE_ATTRIBUTE_KEY,
  InventoryAssetField,
} from "Common/Utils/Inventory/InventoryAssetDetails";
import { getNetworkDeviceAssetFacts } from "Common/Utils/NetworkDevice/NetworkDeviceAssetFacts";

/*
 * The fixture page: the real Asset Details card of an Inventory item, the
 * real Inventory card of a network device's Overview, and the real Overview
 * page itself (OneUptime issue #5185), with the API answered from an in-page
 * store (window.__assetDetailsFixture) the specs read - which reads each
 * card made.
 *
 *   ?page=      item (default: Inventory's Asset Details card)
 *               | device (the device Overview's Inventory card)
 *               | overview (the device's Overview page, opened at
 *               /network-devices/<device id>; server.js stands its other
 *               cards in with placeholders, each a story of its own)
 *   ?scenario=  pinged (default: a switch OneUptime only pings, its details
 *               from a discovery scan, its MAC from a router's ARP table)
 *               | refound (the same, found at its address again ten
 *               minutes ago without answering SNMP)
 *               | walked (a switch walked over SNMP three minutes ago)
 *               | stale (a switch walked three days ago, scanned since)
 *               | disagree (a MAC and a DNS name someone saved, which
 *               discovery reads differently)
 *               | typed (a MAC and a DNS name typed on the device, and
 *               nothing discovery read)
 *               | other (a scan found another machine at the address)
 *               | dns (a firewall polled at a DNS name; its probe resolved
 *               the address)
 *               | host (a Windows host its collector reports)
 *               | noread (the device cannot be read: the item's own facts)
 *               | meraki (a Meraki access point its probe pings, which a
 *               Meraki connection describes: Refresh is offered)
 *   ?refresh=   read (default: a refresh is read again by its probe and
 *               the Meraki dashboard) | unreachable (its probe polls it and
 *               cannot reach it)
 *   ?role=      owner (default) | reader (may read network devices, not
 *               edit them: no Refresh)
 *   ?frame=     the card's width in pixels   ?theme=dark   ?lang=ja|de
 */

const params = new URLSearchParams(window.location.search);
const page = params.get("page") || "item";
const scenario = params.get("scenario") || "pinged";
const refreshOutcome = params.get("refresh") || "read";
const role = params.get("role") || "owner";
const frameWidth = Number(params.get("frame")) || undefined;
const language = ["ja", "de"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    ja: { translation: JA },
    de: { translation: DE },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const DEVICE_ID = "40000000-0000-4000-8000-000000000001";
const ITEM_ID = "60000000-0000-4000-8000-000000000001";
const SCAN_ID = "80000000-0000-4000-8000-000000000001";
const ROUTER_ID = "40000000-0000-4000-8000-000000000099";
const PROBE_ID = "30000000-0000-4000-8000-000000000001";

const project = new Project();
project._id = PROJECT_ID;
project.name = "Network operations";
ProjectUtil.getCurrentProjectId = () => {
  return new ObjectID(PROJECT_ID);
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
UserUtil.getUserId = () => {
  return new ObjectID("10000000-0000-4000-8000-000000000002");
};
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};

// An owner may edit network devices; a reader may only read them.
const heldPermission =
  role === "reader" ? Permission.ReadNetworkDevice : Permission.ProjectOwner;

PermissionUtil.getAllPermissions = () => {
  return [heldPermission];
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: [
      {
        _type: "UserPermission",
        permission: heldPermission,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

/*
 * One "now" for every reading: a scan stamps all it read with its one
 * completedAt, and the card says a source once only for readings of the very
 * same time (isSameAssetFactSource). Reading the clock per call let two
 * readings of one scan land a millisecond apart on a slow runner, and the
 * card then named the scan again under one of them.
 */
const FIXTURE_NOW = Date.now();

function minutesAgo(minutes) {
  return new Date(FIXTURE_NOW - minutes * 60 * 1000).toISOString();
}

const scan = {
  type: "discoveryScan",
  id: SCAN_ID,
  name: "Store subnets",
};
const router = {
  type: "networkDevice",
  id: ROUTER_ID,
  name: "core-rtr-01",
};
const probeReader = {
  type: "probe",
  id: PROBE_ID,
  name: "Frankfurt DC2 probe",
};

// The Meraki connection that reads the branch organization.
const merakiConnection = {
  type: NetworkDeviceDiscoveryReaderType.NetworkController,
  id: "22222222-2222-4222-8222-222222222222",
  name: "Acme Retail",
};

// What the Meraki dashboard's device list says about the lobby access point.
function merakiReading(readAt) {
  return buildControllerReading({
    provider: NetworkControllerProvider.Meraki,
    readBy: merakiConnection,
    readAt: readAt,
    values: {
      name: "Lobby AP",
      model: "MR46",
      serialNumber: "Q2KD-ABCD-1234",
      macAddress: "e0:55:3d:12:34:56",
      ipAddress: "10.20.30.41",
      firmwareVersion: "wireless-29-7",
      productType: "wireless",
      networkName: "Branch 12",
      address: "1600 Amphitheatre Pkwy, Mountain View",
    },
  });
}

function discovered(value, method, readBy, minutes) {
  return {
    value: value,
    method: method,
    readBy: readBy,
    readAt: minutesAgo(minutes),
  };
}

const CATALYST_DESCR =
  "Cisco IOS Software, C2960X Software (C2960X-UNIVERSALK9-M), Version 15.2(7)E8, RELEASE SOFTWARE (fc3)";

// What the scan of the store subnets read about a switch it only pings.
function scanDetails() {
  return {
    sysName: discovered("edge-sw-07", "snmp", scan, 125),
    sysDescr: discovered(CATALYST_DESCR, "snmp", scan, 125),
    sysObjectId: discovered("1.3.6.1.4.1.9.1.1208", "snmp", scan, 125),
    sysLocation: discovered("Store 12, back office rack", "snmp", scan, 125),
    sysContact: discovered("netops@acme.example", "snmp", scan, 125),
    dnsName: discovered(
      "edge-sw-07.store-12.acme.example",
      "reverseDns",
      scan,
      125,
    ),
    macAddress: discovered("00:1b:54:c2:7a:07", "arpTable", router, 190),
    foundBy: { readBy: scan, readAt: minutesAgo(125) },
  };
}

const DEVICES = {
  pinged: {
    name: "edge-sw-07",
    hostname: "10.20.12.7",
    description: "Access switch in the store's back office.",
    site: { name: "Store 12" },
    discoveredDetails: scanDetails(),
  },
  refound: {
    name: "edge-sw-07",
    hostname: "10.20.12.7",
    site: { name: "Store 12" },
    discoveredDetails: {
      ...scanDetails(),
      foundBy: { readBy: scan, readAt: minutesAgo(10) },
    },
  },
  walked: {
    name: "core-sw-01",
    hostname: "10.20.0.1",
    dnsName: "core-sw-01.dc1.acme.example",
    sysName: "core-sw-01",
    sysDescr:
      "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysLocation: "DC1, Rack 14",
    sysContact: "netops@acme.example",
    vendor: "Cisco",
    deviceModel: "WS-C3850-48P",
    serialNumber: "FOC1840X0AB",
    firmwareVersion: "16.12.4",
    softwareVersion: "16.12.04",
    macAddress: "00:1b:54:c2:7a:01",
    isMacAddressLearned: true,
    lastSnmpSeenAt: minutesAgo(3),
    lastRebootedAt: new Date(Date.now() - 41 * 24 * 60 * 60 * 1000),
    lastSeenAt: new Date(Date.now() - 3 * 60 * 1000),
    site: { name: "London DC1" },
    networkDeviceRole: { key: "coreSwitch", name: "Core Switch" },
    discoveredDetails: {
      macAddress: discovered("00:1b:54:c2:7a:01", "arpTable", router, 22),
      dnsName: discovered(
        "core-sw-01.dc1.acme.example",
        "reverseDns",
        scan,
        70,
      ),
      foundBy: { readBy: scan, readAt: minutesAgo(70) },
    },
  },
  // Walked three days ago (its credentials changed since); scanned since.
  stale: {
    name: "core-sw-02",
    hostname: "10.20.0.2",
    sysName: "core-sw-02",
    sysDescr:
      "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.9.1, RELEASE SOFTWARE (fc2)",
    sysObjectId: "1.3.6.1.4.1.9.1.1745",
    sysLocation: "DC1, Rack 12",
    vendor: "Cisco",
    deviceModel: "WS-C3850-48P",
    serialNumber: "FOC1840X0AC",
    firmwareVersion: "16.9.1",
    softwareVersion: "16.09.01",
    lastSnmpSeenAt: minutesAgo(3 * 24 * 60),
    site: { name: "London DC1" },
    discoveredDetails: {
      sysName: discovered("core-sw-02", "snmp", scan, 120),
      sysDescr: discovered(
        "Cisco IOS Software [Gibraltar], Catalyst L3 Switch Software (CAT3K_CAA-UNIVERSALK9-M), Version 16.12.4, RELEASE SOFTWARE (fc5)",
        "snmp",
        scan,
        120,
      ),
      sysObjectId: discovered("1.3.6.1.4.1.9.1.1745", "snmp", scan, 120),
      sysLocation: discovered("DC1, Rack 12", "snmp", scan, 120),
      sysContact: discovered("netops@acme.example", "snmp", scan, 120),
      foundBy: { readBy: scan, readAt: minutesAgo(120) },
    },
  },
  typed: {
    name: "lab-fw",
    hostname: "10.99.0.1",
    dnsName: "lab-fw.lab.acme.example",
    macAddress: "00:1b:54:c2:7a:99",
    isMacAddressLearned: false,
  },
  disagree: {
    name: "printer-3",
    hostname: "10.20.12.43",
    dnsName: "printer-3.old.acme.example",
    macAddress: "00:1b:54:c2:7a:43",
    isMacAddressLearned: false,
    discoveredDetails: {
      sysName: discovered("PRN-3-HP", "snmp", scan, 95),
      sysDescr: discovered(
        "HP ETHERNET MULTI-ENVIRONMENT,ROM none,JETDIRECT,JD153,EEPROM JSI24090012",
        "snmp",
        scan,
        95,
      ),
      dnsName: discovered("printer-3.acme.example", "reverseDns", scan, 95),
      macAddress: discovered("00:1b:54:c2:7a:44", "arpTable", router, 15),
      foundBy: { readBy: scan, readAt: minutesAgo(95) },
    },
  },
  other: {
    name: "kiosk-04",
    hostname: "10.20.12.84",
    discoveredDetails: {
      sysName: discovered("kiosk-04", "snmp", scan, 4 * 24 * 60),
      sysDescr: discovered(
        "Linux kiosk-04 5.15.0-91-generic",
        "snmp",
        scan,
        4 * 24 * 60,
      ),
      foundBy: { readBy: scan, readAt: minutesAgo(4 * 24 * 60) },
      otherMachine: {
        readBy: scan,
        readAt: minutesAgo(65),
        sysName: "LAPTOP-12",
        dnsName: "laptop-12.acme.example",
      },
    },
  },
  /*
   * A Meraki access point its probe pings at its address: no SNMP, so its
   * serial number, model and firmware come from the Meraki dashboard. Its
   * probe polls it and a Meraki connection describes it: Refresh is offered.
   */
  meraki: {
    name: "10.20.30.41",
    hostname: "10.20.30.41",
    probeId: PROBE_ID,
    isPollingEnabled: true,
    lastPolledAt: new Date(FIXTURE_NOW - 4 * 60 * 1000),
    isReachable: true,
    site: { name: "Branch 12" },
    discoveredDetails: { controller: merakiReading(minutesAgo(4)) },
  },
  dns: {
    name: "core-fw-01",
    hostname: "core-fw-01.acme.example",
    sysName: "core-fw-01",
    sysDescr: "Palo Alto Networks PA-3220 series firewall",
    sysObjectId: "1.3.6.1.4.1.25461.2.3.38",
    vendor: "Palo Alto Networks",
    deviceModel: "PA-3220",
    serialNumber: "013201028945",
    softwareVersion: "10.2.4",
    lastSnmpSeenAt: minutesAgo(2),
    discoveredDetails: {
      ipAddress: discovered("10.0.0.1", "dns", probeReader, 2),
    },
  },
};

const deviceFields = DEVICES[scenario] || DEVICES.pinged;

const state = {
  // Every read a card made: { model, id?, select? }.
  reads: [],
  // Every Refresh asked of the server: { path, at }.
  refreshAsks: [],
  // How often the item page read its item again after a refresh landed.
  itemReloads: 0,
};

/*
 * A refresh's readers answer a few seconds after the ask: a read of the
 * device before then is the device as it was (the card says who reads it
 * again), and one after it the device read again - by its probe, which
 * reached it or did not (?refresh=), and by the Meraki dashboard.
 */
const READ_AGAIN_AFTER_MS = 2500;
let refreshAskedAt = null;

window.__assetDetailsFixture = { state: state };

function readDevice() {
  const item = new NetworkDevice();
  item._id = DEVICE_ID;
  Object.assign(item, {
    monitoringMethod: "Probe",
    ...deviceFields,
  });

  if (refreshAskedAt !== null) {
    item.refreshRequestedAt = new Date(refreshAskedAt);

    if (Date.now() - refreshAskedAt >= READ_AGAIN_AFTER_MS) {
      const readAt = new Date(refreshAskedAt + 1000);
      item.lastPolledAt = readAt;
      item.isReachable = refreshOutcome !== "unreachable";

      if (deviceFields.discoveredDetails?.controller) {
        item.discoveredDetails = {
          ...deviceFields.discoveredDetails,
          controller: merakiReading(readAt.toISOString()),
        };
      }
    }
  }

  return item;
}

// The Inventory item the mirror writes for the device, from the same facts.
function mirroredItem() {
  const facts = getNetworkDeviceAssetFacts(readDevice());
  const key = (field) => {
    return INVENTORY_ASSET_ATTRIBUTE_KEYS[field];
  };
  const attributes = {};
  const put = (attribute, value) => {
    if (value) {
      attributes[attribute] = value;
    }
  };
  put(key(InventoryAssetField.Hostname), facts.hostname);
  put(key(InventoryAssetField.IpAddress), facts.ipAddress);
  put(key(InventoryAssetField.DnsName), facts.dnsName);
  put(key(InventoryAssetField.MacAddress), facts.macAddress);
  put(key(InventoryAssetField.SerialNumber), facts.serialNumber);
  put(key(InventoryAssetField.Manufacturer), facts.manufacturer);
  put(key(InventoryAssetField.Model), facts.model);
  put(key(InventoryAssetField.FirmwareVersion), facts.firmwareVersion);
  put(key(InventoryAssetField.OperatingSystem), facts.operatingSystem);
  put(key(InventoryAssetField.OsVersion), facts.osVersion);
  put(key(InventoryAssetField.DeviceType), facts.deviceType);
  put(key(InventoryAssetField.Location), facts.location);
  put(INVENTORY_SITE_ATTRIBUTE_KEY, facts.site);

  const item = new InventoryItem();
  item._id = ITEM_ID;
  Object.assign(item, {
    entityType: EntityType.NetworkDevice,
    source: EntitySource.Inventory,
    displayName: deviceFields.name,
    entityKey: "6a1f0c2e9b7d4a13",
    identifyingAttributes: { "oneuptime.resource.id": DEVICE_ID },
    descriptiveAttributes: attributes,
    resourceType: "NetworkDevice",
    resourceId: new ObjectID(DEVICE_ID),
  });
  return item;
}

function hostItem() {
  const item = new InventoryItem();
  item._id = ITEM_ID;
  Object.assign(item, {
    entityType: EntityType.Host,
    source: EntitySource.Discovered,
    displayName: "wbqajdebsv001",
    entityKey: "c39ab1f24e7d9a02",
    identifyingAttributes: { "host.name": "wbqajdebsv001" },
    descriptiveAttributes: {
      "host.arch": "amd64",
      "host.ip": "10.210.72.109",
      "host.mac": "00-15-5D-4A-21-07",
      "os.description": "Windows Server 2022 10.0",
      "os.type": "windows",
      "os.version": "10.0.20348",
      "cloud.provider": "azure",
      "cloud.region": "westeurope",
    },
    lastSeenAt: new Date(Date.now() - 2 * 60 * 1000),
  });
  return item;
}

ModelAPI.getItem = async (args) => {
  state.reads.push({
    model: args.modelType.name || "unknown",
    id: args.id ? args.id.toString() : null,
    select: Object.keys(args.select || {}).sort(),
  });

  if (args.modelType === NetworkDevice) {
    if (scenario === "noread") {
      throw new HTTPErrorResponse(
        403,
        { message: "You do not have permission to read Network Devices." },
        {},
      );
    }
    return readDevice();
  }

  throw new Error(`The fixture models no read of ${args.modelType.name}.`);
};

ModelAPI.getList = async (args) => {
  state.reads.push({
    model: args.modelType.name || "unknown",
    select: Object.keys(args.select || {}).sort(),
  });

  if (args.modelType === NetworkDeviceRole) {
    const role = new NetworkDeviceRole();
    role.key = "coreSwitch";
    role.name = "Core Switch";
    const access = new NetworkDeviceRole();
    access.key = "accessSwitch";
    access.name = "Access Switch";
    return { data: [role, access], count: 2, skip: 0, limit: args.limit };
  }

  throw new Error(`The fixture models no list of ${args.modelType.name}.`);
};

ModelAPI.getCommonHeaders = () => {
  return {};
};

/*
 * The device Overview's Security card asks what Security Events found
 * about the device this week. This project uses no Security Events - no
 * event arrived this week - so the server says so and the card draws
 * nothing. Every other API call goes where it went before.
 */
const originalApiPost = API.post.bind(API);
API.post = async (options) => {
  const url = options.url.toString();

  /*
   * Refresh (NetworkDeviceRefreshAPI): the device goes to the front of its
   * probe's queue and its Meraki connection is read again - who reads it is
   * what the server answers.
   */
  const pathname = new URL(url).pathname;

  if (pathname === `/api/network-device/${DEVICE_ID}/refresh`) {
    refreshAskedAt = Date.now();
    state.refreshAsks.push({
      path: pathname,
      at: new Date(refreshAskedAt).toISOString(),
    });

    return new HTTPResponse(
      200,
      {
        requestedAt: new Date(refreshAskedAt).toISOString(),
        isProbeReading: true,
        probeName: "Branch 12 probe",
        isControllerReading: Boolean(
          deviceFields.discoveredDetails?.controller,
        ),
        controllerName: merakiConnection.name,
        wasAlreadyRequested: false,
      },
      {},
    );
  }

  if (url.endsWith("/security-case/resource-security")) {
    return new HTTPResponse(
      200,
      {
        kind: options.data?.kind,
        id: options.data?.id,
        name: "",
        isInUse: false,
        windowDays: 7,
        values: [],
        entity: null,
        eventCount: 0,
        findingCount: 0,
        maxSeverityId: 0,
        lastSeen: null,
        openCases: null,
        risk: null,
      },
      {},
    );
  }

  return originalApiPost(options);
};

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-8">
      <div
        className="mx-auto max-w-6xl space-y-6"
        data-testid="fixture-page"
        style={frameWidth ? { maxWidth: `${frameWidth}px` } : undefined}
      >
        {page === "device" ? (
          <DeviceInventoryCard modelId={new ObjectID(DEVICE_ID)} />
        ) : page === "overview" ? (
          <NetworkDeviceView />
        ) : (
          <InventoryAssetDetailsCard
            item={scenario === "host" ? hostItem() : mirroredItem()}
            onRefreshed={() => {
              state.itemReloads += 1;
            }}
          />
        )}
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
