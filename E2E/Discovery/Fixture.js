import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter, useLocation, useNavigate, useParams } from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import Discovery from "../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Discovery";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import { DISCOVERY_SCAN_STARTED_MESSAGE } from "Common/Utils/NetworkDiscovery/DiscoveryScanStatus";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
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
];
window.__discoveryFixture = {
  requests: [],
  fail: false,
  startAgain() {
    Object.assign(scans[0], { scannedHostCount: 15360, statusMessage: DISCOVERY_SCAN_STARTED_MESSAGE, startedAt: new Date() });
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
  const data = modelType === NetworkDeviceDiscoveryScan
    ? scans.map((item) => Object.assign(new NetworkDeviceDiscoveryScan(), item))
    : modelType === Probe && !requestOptions?.overrideRequestUrl ? [probe] : [];
  return { data, count: data.length, skip: 0, limit: 10 };
};
ModelAPI.getItem = async ({ modelType, id }) => modelType === NetworkDeviceDiscoveryScan ? scans.find((item) => item.id.toString() === id.toString()) : null;
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
    <main className="mx-auto max-w-screen-2xl p-6"><Discovery /></main>
  </>;
}
createRoot(document.getElementById("root")).render(<BrowserRouter><Fixture /></BrowserRouter>);
