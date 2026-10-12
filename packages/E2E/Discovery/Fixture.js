import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate, useParams } from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Discovery from "../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import Devices from "../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Devices";
import ProbeUtil from "../../App/FeatureSet/Dashboard/src/Utils/Probe";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkDeviceRole from "Common/Models/DatabaseModels/NetworkDeviceRole";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { DISCOVERY_SCAN_STARTED_MESSAGE } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import User from "Common/UI/Utils/User";

// Exercise the actual page, table, review dialog and polling hook with synthetic
// data. Only the API boundary/session is replaced; no network is scanned.
const project = new Project();
project._id = "10000000-0000-4000-8000-000000000001";
project.name = "Network operations";
ProjectUtil.getCurrentProjectId = () => project.id;
ProjectUtil.getCurrentProject = () => project;
User.isMasterAdmin = () => true;
User.getUserId = () => new ObjectID("10000000-0000-4000-8000-000000000002");

const probe = new Probe();
probe._id = "10000000-0000-4000-8000-000000000003";
probe.name = "London datacenter";
probe.isGlobalProbe = false;
const startedAt = new Date(Date.now() - 4 * 60000);
const hosts = [
  { ipAddress: "10.240.0.220", sysName: "WBHQ-Core-01", sysDescr: "Core switch", snmpReachable: true },
  { ipAddress: "10.240.0.221", sysName: "WBHQ-Core-02", sysDescr: "Core switch", snmpReachable: true },
  { ipAddress: "10.240.0.222", snmpReachable: false },
];
/*
 * Issue #4518: Windows kitchen displays whose reverse zone spells them
 * differently from the names their owners use. One answers SNMP, two answer
 * NetBIOS, one answers nothing.
 */
const kitchenDisplays = [
  { ipAddress: "10.16.42.52", snmpReachable: false, dnsHostnameStatus: "no-record", netbiosNameStatus: "no-reply" },
  { ipAddress: "10.16.42.53", snmpReachable: true, sysName: "WB0024KDS03", dnsHostname: "wb-0024-kds03.wbhq.com", sysDescr: "Kitchen display, store 24" },
  { ipAddress: "10.16.42.54", snmpReachable: false, dnsHostname: "wb-0024-kds04.wbhq.com", netbiosName: "WB0024KDS04" },
  { ipAddress: "10.16.42.55", snmpReachable: false, dnsHostname: "wb-0024-kds05.wbhq.com", netbiosName: "WB0024KDS05" },
];
function scan(index, fields) {
  const item = new NetworkDeviceDiscoveryScan();
  Object.assign(item, {
    _id: `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: "Switch Discovery — WBHQ Unit/Core Switches",
    cidr: "10.240-249.0-255.220-225",
    status: "In Progress",
    probeId: probe.id,
    probe,
    projectId: project.id,
    startedAt,
    createdAt: new Date(startedAt.getTime() - 60000),
    updatedAt: new Date(),
    isSnmpEnabled: true,
    scannedHostCount: 6144,
    respondedHostCount: hosts.length,
    discoveredDevices: hosts,
    statusMessage: "Scan in progress: 6,144 of 15,360 addresses swept so far. Checking SNMP credentials (176 of 256). 3 answered ICMP ping, 2 answered SNMP. These results update as the sweep continues.",
    ...fields,
  });
  return item;
}
const scans = [
  scan(1, {}),
  scan(2, { name: "Branch offices — Ping sweep", cidr: "192.0.2.0/24", isSnmpEnabled: false, scannedHostCount: 96, respondedHostCount: 0, discoveredDevices: [], statusMessage: "Scan in progress: 96 of 254 addresses swept so far. Checking ping reachability (96 of 254). No hosts have answered yet." }),
  scan(3, { name: "Guest network", cidr: "198.51.100.0/24", status: "Pending", startedAt: undefined, scannedHostCount: 0, respondedHostCount: 0, discoveredDevices: [], statusMessage: "Waiting for the assigned probe to start this scan." }),
  scan(4, { name: "Datacenter routers", cidr: "203.0.113.0/28", status: "Completed", scannedHostCount: 14, completedAt: new Date(), statusMessage: "Scan complete. 3 hosts responded, including 2 SNMP devices." }),
  scan(5, { name: "Remote office — Partial results", cidr: "192.0.2.0/24", status: "Failed", scannedHostCount: 128, completedAt: new Date(), statusMessage: "The scan reached its deadline. Results found before the timeout have been preserved." }),
  // Issue #3842: the probe's summary of a healthy sweep, which fits in the two-line preview.
  scan(6, { name: "Router Discovery — WBHQ Unit/Core Routers", cidr: "10.240-249.0-255.1", status: "Completed", scannedHostCount: 2560, completedAt: new Date(), statusMessage: "Swept 2560 hosts: 917 answered ICMP ping, 460 answered SNMP." }),
  // A summary with diagnostics, which the two-line preview has to cut short.
  scan(7, { name: "Access Discovery — WBHQ Unit/Access Switches", cidr: "10.250.0.0/24", status: "Completed", scannedHostCount: 254, completedAt: new Date(), statusMessage: "Swept 254 hosts: 41 answered ICMP ping, 3 answered SNMP. 12 host(s) replied with an SNMP error rather than silence; most common: Authentication failure (incorrect password, community or key). Answered by credentials: Core v3 on 3. No host answered: Legacy v2c community." }),
  // Issue #4518: each display named by its own hostname.
  scan(8, { name: "Kitchen displays — Store 24", cidr: "10.16.42.51-65", status: "Completed", scannedHostCount: 15, respondedHostCount: kitchenDisplays.length, completedAt: new Date(), isNetbiosLookupEnabled: true, useShortDeviceNames: true, discoveredDevices: kitchenDisplays, statusMessage: "Swept 15 hosts: 4 answered ICMP ping, 1 answered SNMP." }),
];
/*
 * The Devices list, for what happens after an import: setting a site, a role
 * or a vendor template on many devices at once. Answered only on the Devices
 * route, so the Discovery page's own requests are answered exactly as before.
 */
const isDevicesRoute = () => window.location.pathname.endsWith("/network-devices");
function networkSite(index, name) {
  const item = new NetworkSite();
  item._id = `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  item.name = name;
  return item;
}
const sites = [networkSite(1, "Contoso - Building A"), networkSite(2, "Contoso - Building B")];
function deviceRole(index, name) {
  const item = new NetworkDeviceRole();
  item._id = `70000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  item.name = name;
  return item;
}
const roles = [deviceRole(1, "Core Switch"), deviceRole(2, "Access Switch")];
const linkedTemplate = new NetworkDeviceOidTemplate();
linkedTemplate._id = "80000000-0000-4000-8000-000000000001";
linkedTemplate.name = "Cisco Catalyst 9300";
const CNMATRIX_OID = "1.3.6.1.4.1.17713.24.1.2";
function device(index, fields) {
  const item = new NetworkDevice();
  Object.assign(item, {
    _id: `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    name: `cnmatrix-sw-${String(index).padStart(2, "0")}`,
    hostname: `10.20.0.${index}`,
    projectId: project.id,
    isReachable: true,
    isSnmpReachable: true,
    lastPolledAt: new Date(),
    lastSeenAt: new Date(),
    lastSnmpSeenAt: new Date(),
    monitoringMethod: "Probe",
    probeId: probe.id,
    probe,
    isPollingEnabled: true,
    interfacesUp: 26,
    interfacesDown: 0,
    vendor: "Cambium Networks",
    deviceModel: "cnMatrix EX2028-P",
    sysObjectId: CNMATRIX_OID,
    sysDescr: "Cambium cnMatrix EX2028-P",
    snmpOids: [],
    snmpTables: [],
    ...fields,
  });
  return item;
}
const devices = [
  device(1, {}),
  device(2, {}),
  device(3, { siteId: sites[0].id, site: sites[0] }),
  device(4, { name: "lab-sw-04", vendor: undefined, deviceModel: undefined, sysObjectId: undefined, sysDescr: undefined }),
  device(5, { name: "dist-sw-05", vendor: "Cisco", deviceModel: "C9300-48P", sysObjectId: "1.3.6.1.4.1.9.1.2494", sysDescr: "Cisco IOS XE Software", oidTemplateId: linkedTemplate.id, oidTemplate: linkedTemplate }),
  device(6, { name: "lobby-camera", vendor: undefined, deviceModel: undefined, sysObjectId: undefined, sysDescr: undefined, monitoringMethod: "Monitor", probeId: undefined, probe: undefined }),
];
const fixtureDevices = () => devices.map((item) => Object.assign(new NetworkDevice(), item));
window.__discoveryFixture = {
  requests: [],
  // Every device write and every device created by an import, in order.
  updates: [],
  creates: [],
  // A device whose update the server refuses, by id; none unless a test sets it.
  refuseUpdateOf: "",
  fail: false,
  stall: false,
  startAgain() {
    Object.assign(scans[0], { status: "In Progress", scannedHostCount: 15360, statusMessage: DISCOVERY_SCAN_STARTED_MESSAGE, startedAt: new Date() });
  },
  scheduleAgain() {
    Object.assign(scans[0], { isRecurring: true, nextScanAt: new Date(Date.now() + 30000) });
  },
  advance() {
    Object.assign(scans[0], { scannedHostCount: 12288, statusMessage: "Scan in progress: 12,288 of 15,360 addresses swept so far. Checking SNMP credentials (200 of 256)." });
  },
  complete() {
    for (const item of scans) {
      if (item.status === "In Progress" || item.status === "Pending") {
        Object.assign(item, { status: "Completed", scannedHostCount: item === scans[0] ? 15360 : 254, completedAt: new Date(), statusMessage: "Scan complete. Results are ready to review." });
      }
    }
  },
};
ModelAPI.getList = async ({ modelType, query, requestOptions }) => {
  window.__discoveryFixture.requests.push({ model: modelType.name, query });
  if (modelType === NetworkDeviceDiscoveryScan && window.__discoveryFixture.fail) {
    throw new Error("The connection was interrupted. Please try again.");
  }
  if (modelType === NetworkDeviceDiscoveryScan && window.__discoveryFixture.stall) {
    // Playwright holds this local request open. Use the real shared transport so
    // its configured timeout, rather than a fabricated rejection, drives recovery.
    await API.fetch({
      method: HTTPMethod.GET,
      url: URL.fromString(`${window.location.origin}/discovery-stalled-poll`),
      options: requestOptions?.apiRequestOptions,
    });
  }
  if (isDevicesRoute() && modelType === NetworkDevice) {
    const ids = query?._id?.values;
    const data = Array.isArray(ids)
      ? fixtureDevices().filter((item) => ids.map(String).includes(item._id))
      : fixtureDevices();
    return { data, count: data.length, skip: 0, limit: 10 };
  }
  if (isDevicesRoute() && modelType === NetworkSite) {
    return { data: sites, count: sites.length, skip: 0, limit: 10 };
  }
  if (isDevicesRoute() && modelType === NetworkDeviceRole) {
    return { data: roles, count: roles.length, skip: 0, limit: 10 };
  }
  const data = modelType === NetworkDeviceDiscoveryScan
    ? scans.map((item) => Object.assign(new NetworkDeviceDiscoveryScan(), item))
    : modelType === Probe && !requestOptions?.overrideRequestUrl ? [probe] : [];
  return { data, count: data.length, skip: 0, limit: 10 };
};
ModelAPI.getItem = async ({ modelType, id }) => modelType === NetworkDeviceDiscoveryScan ? scans.find((item) => item.id.toString() === id.toString()) : null;
const originalCount = ModelAPI.count.bind(ModelAPI);
ModelAPI.count = async (args) => (isDevicesRoute() ? 0 : originalCount(args));
ModelAPI.updateById = async ({ id, data }) => {
  const write = { id: id.toString(), data: JSON.parse(JSON.stringify(data)), startedAt: performance.now(), endedAt: 0 };
  window.__discoveryFixture.updates.push(write);
  await new Promise((resolve) => setTimeout(resolve, 40));
  write.endedAt = performance.now();
  if (write.id === window.__discoveryFixture.refuseUpdateOf) {
    throw new Error("You do not have permission to edit this Network Device.");
  }
  return { data: {} };
};
ModelAPI.create = async ({ model }) => {
  window.__discoveryFixture.creates.push({
    hostname: model.hostname,
    name: model.name,
    autoApplyVendorHealthTemplate: model.autoApplyVendorHealthTemplate === true,
    // Issue #4518: what the device is named after, as the import posts it.
    dnsName: model.dnsName || null,
    discoveredName: model.discoveredName || null,
    discoveredNameSource: model.discoveredNameSource || null,
  });
  return { data: model };
};
ProbeUtil.getAllProbes = async () => [probe];
ModelAPI.getCommonHeaders = () => ({});
API.post = async () => ({ data: { data: [], count: 0 } });
API.get = async () => ({ data: { data: [], count: 0 } });

await i18next.use(initReactI18next).init({ lng: "en", fallbackLng: "en", resources: { en: { translation: {} } }, interpolation: { escapeValue: false } });
function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return <>
    <div className="flex items-center justify-between border-b border-gray-200 bg-white px-8 py-4 text-sm">
      <span className="font-semibold text-gray-900">OneUptime <span className="ml-6 font-normal text-gray-500">Network operations</span></span>
      <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">Review workspace · Synthetic data</span>
    </div>
    <main className="mx-auto max-w-screen-2xl p-6">{isDevicesRoute() ? <Devices /> : <Discovery />}</main>
  </>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><Fixture /></BrowserRouter>);
