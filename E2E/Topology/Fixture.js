import React from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Outlet,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from "react-router-dom";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import TopologyPage from "../../App/FeatureSet/Dashboard/src/Pages/Topology/TopologyPage";
import InventoryLayout from "../../App/FeatureSet/Dashboard/src/Pages/Inventory/Layout";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import EntityType from "Common/Types/Telemetry/EntityType";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Navigation from "Common/UI/Utils/Navigation";

// These are deliberately synthetic records. Only data access is replaced:
// the page, filters, layout engines, graph components and drawers are real.
const entities = [];
const relationships = [];
let identifier = 1;
function addEntity(key, name, type) {
  const entity = new InventoryItem();
  entity._id = `00000000-0000-4000-8000-${String(identifier++).padStart(12, "0")}`;
  entity.entityKey = key;
  entity.displayName = name;
  entity.entityType = type;
  entity.firstSeenAt = new Date("2026-09-01T08:00:00Z");
  entity.lastSeenAt = new Date("2026-09-07T10:00:00Z");
  entities.push(entity);
  return entity;
}
function connect(from, to, type, metrics = {}) {
  const edge = new InventoryItemRelationship();
  edge.fromEntityKey = from;
  edge.toEntityKey = to;
  edge.relationshipType = type;
  Object.assign(edge, metrics);
  relationships.push(edge);
}

addEntity("cluster-europe", "Production Europe", EntityType.KubernetesCluster);
addEntity("cluster-us", "Production US", EntityType.KubernetesCluster);
for (let node = 1; node <= 3; node++) {
  const key = `node-europe-${node}`;
  addEntity(key, `eu-worker-0${node}`, EntityType.KubernetesNode);
  connect(key, "cluster-europe", EntityRelationshipType.MemberOf);
  for (let pod = 1; pod <= 20; pod++) {
    const podKey = `pod-${node}-${pod}`;
    addEntity(
      podKey,
      `${pod % 2 === 0 ? "checkout" : "catalog"}-${node}-${String(pod).padStart(2, "0")}`,
      EntityType.KubernetesPod,
    );
    connect(podKey, key, EntityRelationshipType.RunsOn);
  }
}
addEntity("node-us-1", "us-worker-01", EntityType.KubernetesNode);
connect("node-us-1", "cluster-us", EntityRelationshipType.MemberOf);
addEntity("pod-us-1", "payments-us-01", EntityType.KubernetesPod);
connect("pod-us-1", "node-us-1", EntityRelationshipType.RunsOn);
for (let host = 1; host <= 3; host++) {
  addEntity(
    `host-${host}`,
    ["database-primary", "cache-primary", "build-runner"][host - 1],
    EntityType.Host,
  );
}
connect("host-2", "unknown-cache-peer", EntityRelationshipType.MemberOf);
const services = [
  "web-frontend",
  "api-gateway",
  "checkout",
  "payments",
  "catalog",
  "notifications",
  "scheduled-reports",
  "audit-worker",
];
services.forEach((name) => {
  addEntity(`service-${name}`, name, EntityType.Service);
});
connect(
  "service-web-frontend",
  "service-api-gateway",
  EntityRelationshipType.DependsOn,
  { callCount: 45000, errorCount: 90, avgDurationMs: 42 },
);
connect(
  "service-api-gateway",
  "service-checkout",
  EntityRelationshipType.DependsOn,
  { callCount: 18000, errorCount: 180, avgDurationMs: 127 },
);
connect(
  "service-api-gateway",
  "service-catalog",
  EntityRelationshipType.DependsOn,
  { callCount: 27000, errorCount: 27, avgDurationMs: 24 },
);
connect(
  "service-checkout",
  "service-payments",
  EntityRelationshipType.DependsOn,
  { callCount: 15000, errorCount: 900, avgDurationMs: 340 },
);
connect(
  "service-payments",
  "service-notifications",
  EntityRelationshipType.DependsOn,
  { callCount: 12000, errorCount: 12, avgDurationMs: 18 },
);
connect("service-catalog", "host-2", EntityRelationshipType.HostedOn);

const networkNodes = [
  {
    id: "router-a",
    name: "London edge router",
    role: "router",
    status: "up",
    kind: "device",
    isManaged: true,
    vendor: "Cisco",
    sysName: "LON-EDGE-01",
    interfacesUp: 4,
    interfacesDown: 0,
  },
  {
    id: "switch-core",
    name: "London core switch",
    role: "switch",
    status: "up",
    kind: "device",
    isManaged: true,
    vendor: "Cisco",
    sysName: "LON-CORE-01",
    interfacesUp: 22,
    interfacesDown: 0,
  },
  {
    id: "switch-access",
    name: "Office access switch",
    role: "switch",
    status: "up",
    kind: "device",
    isManaged: true,
    vendor: "Aruba",
    sysName: "LON-ACCESS-01",
    interfacesUp: 16,
    interfacesDown: 2,
  },
  {
    id: "firewall",
    name: "Backup firewall",
    role: "firewall",
    status: "down",
    kind: "device",
    isManaged: true,
    vendor: "Fortinet",
    interfacesUp: 0,
    interfacesDown: 4,
  },
  {
    id: "phone",
    name: "Reception phone",
    role: "phone",
    status: "unknown",
    kind: "unmanaged",
    isManaged: false,
    vendor: "Cisco",
  },
  {
    id: "endpoint-10",
    name: "Design workstation",
    role: "host",
    status: "up",
    kind: "endpoint",
    isManaged: false,
    vlanId: 10,
  },
  {
    id: "endpoint-20",
    name: "Office printer",
    role: "host",
    status: "up",
    kind: "endpoint",
    isManaged: false,
    vlanId: 20,
  },
];
const networkEdges = [
  ["router-a", "switch-core", "Gi0/1", "Gi1/0/1"],
  ["switch-core", "switch-access", "Gi1/0/2", "Gi1/0/1"],
  ["switch-core", "firewall", "Gi1/0/3", "port1"],
  ["switch-access", "phone", "Gi1/0/4", "SW PORT"],
  ["switch-access", "endpoint-10", "Gi1/0/5", "eth0"],
  ["switch-access", "endpoint-20", "Gi1/0/6", "eth0"],
].map(([fromNodeId, toNodeId, fromPort, toPort]) => ({
  fromNodeId,
  toNodeId,
  fromPort,
  toPort,
  protocols: ["lldp"],
}));
// Monitored devices use the same UUID identity format as the API, so their
// real detail drawer can build inventory links without a fixture-only shortcut.
const managedIds = new Map(
  networkNodes
    .filter((node) => node.isManaged)
    .map((node, index) => [
      node.id,
      `00000000-0000-4000-8000-${String(index + 101).padStart(12, "0")}`,
    ]),
);
networkNodes.forEach((node) => {
  node.id = managedIds.get(node.id) || node.id;
});
networkEdges.forEach((edge) => {
  edge.fromNodeId = managedIds.get(edge.fromNodeId) || edge.fromNodeId;
  edge.toNodeId = managedIds.get(edge.toNodeId) || edge.toNodeId;
});

const stats = { total: 7, healthy: 4, down: 1, degraded: 1, unknown: 1 };
const site = (id, name) => ({
  id,
  name,
  siteType: "Office",
  isUnitLevel: true,
  childSiteCount: 0,
  deviceCount: 7,
  deviceStats: stats,
  unitStats: { totalUnits: 1, operationalUnits: 1 },
  uptimePercent: 99.96,
  dailyUptimePercent: 99.92,
});
const sites = [
  site("london", "London office"),
  site("new-york", "New York office"),
  site("singapore", "Singapore office"),
];

window.__topologyFixtureRequests = [];
ModelAPI.getList = async ({ modelType }) => {
  window.__topologyFixtureRequests.push({
    operation: "list",
    model: modelType.name,
  });
  const data =
    modelType === InventoryItem
      ? entities
      : modelType === InventoryItemRelationship
        ? relationships
        : [];
  return { data, count: data.length, skip: 0, limit: 10000 };
};
ModelAPI.getCommonHeaders = () => ({});
ModelAPI.getItem = async () => null;
API.post = async ({ url, data }) => {
  const route = url.toString();
  window.__topologyFixtureRequests.push({ operation: "post", route, data });
  if (route.includes("/network-site/children")) {
    const selected = sites.find((item) => item.id === data?.siteId);
    return {
      data: {
        children: selected ? [] : sites,
        breadcrumb: selected ? [selected] : [],
        links: [],
        ownDeviceStats: selected
          ? stats
          : { total: 0, healthy: 0, down: 0, degraded: 0, unknown: 0 },
        deviceScope: { attachedDeviceCount: 21, unattachedDeviceCount: 0 },
      },
    };
  }
  if (route.includes("/network-device/topology")) {
    return { data: { nodes: networkNodes, edges: networkEdges } };
  }
  return { data: { data: [], count: 0 } };
};
API.get = async () => ({ data: { data: [], count: 0 } });

await i18next.use(initReactI18next).init({
  lng: "en",
  fallbackLng: "en",
  resources: { en: { translation: {} } },
  interpolation: { escapeValue: false },
});
/*
 * The "Topology" title, description and side menu are not part of TopologyPage:
 * since the persistent side menu change they come from the Inventory layout
 * that App.tsx mounts around the topology routes. Mount the page the same way,
 * so the fixture shows the shell a user actually sees.
 */
function Fixture() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route element={<InventoryLayout />}>
          <Route
            path="/dashboard/:projectId/topology/*"
            element={<TopologyPage />}
          />
        </Route>
      </Route>
    </Routes>
  );
}

function Shell() {
  return (
    <>
      <div className="flex items-center justify-between border-b border-gray-200 bg-white px-6 py-4 text-sm">
        <span className="font-semibold text-gray-900">OneUptime</span>
        <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-600">
          Demo workspace · Synthetic data
        </span>
      </div>
      <main className="mx-auto max-w-screen-2xl pb-8">
        <Outlet />
      </main>
    </>
  );
}
createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Fixture />
  </BrowserRouter>,
);
