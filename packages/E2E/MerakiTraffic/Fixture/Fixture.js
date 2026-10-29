/*
 * Offline fixture for the real Network > Traffic page and its Meraki side
 * (issue #5140): the network's traffic as a Meraki connection read it from
 * the Meraki dashboard API, the Flows | Meraki switch, Connect Meraki and
 * the connections at the page's foot.
 *
 * The Network Layout (Page + the Network side menu) and the Traffic page are
 * the production components from this branch, mounted under their real
 * RouteMap patterns. Only the data boundary (ModelAPI / API) and the
 * signed-in user are replaced. Every record is fabricated for an "Acme
 * Networks" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?state=    none (default): no connection, nothing sends flow records
 *              meraki: one organization read, no flow records
 *              both: an organization read, and flow records too
 *              flows: flow records, and no connection
 *              failing: the organization's key was revoked
 *              partial: a large organization read in part
 *              waiting: just connected, its first read to come
 *              stale: its reads stopped three hours ago
 *              off: the connection is turned off
 *   ?verdict=  pass (default: the key reads one organization)
 *              | several (two) | auth (Meraki refuses the key) - for the
 *              connect dialog's test and the edit dialog's test of a new key
 *   ?role=     owner (default) | member: a project member, who may read
 *              connections but not add, change or read them
 *   ?devices=  counted: the last read listed the organization's 6 devices,
 *              and filled in 5 network devices here | one: 1 of them | absent
 *              (default): a read from before reads counted devices
 *   ?lang=     de reads the German locale file
 *   ?theme=    dark adds html.dark (handled by server.js)
 *
 * The device's and the site's Traffic pages are the production pages at
 * their own addresses (DEVICE_TRAFFIC, SITE_TRAFFIC below): the Head
 * Office MX, a device in OneUptime, and the Branches site of two networks.
 *
 * Every read and write is recorded on window.__merakiTrafficFixture:
 * usageRequests, flowRequests, tests, readNows, creates, updates, deletes
 * and unhandled - anything the fixture does not model. The spec asserts
 * `unhandled` is empty. finishRead() ends the read a connection is waiting
 * for, as the worker would.
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
import en from "../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import de from "../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import NetworkLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Network/Layout";
import NetworkTraffic from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Traffic";
import NetworkDeviceViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Layout";
import NetworkDeviceTraffic from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/View/Traffic";
import NetworkSiteViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/Layout";
import NetworkSiteTraffic from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkSite/View/Traffic";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import ScheduledMaintenanceState from "Common/Models/DatabaseModels/ScheduledMaintenanceState";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const STATES = [
  "none",
  "meraki",
  "both",
  "flows",
  "failing",
  "partial",
  "waiting",
  "stale",
  "off",
];
let dataState = STATES.includes(params.get("state"))
  ? params.get("state")
  : "none";
const verdict = ["pass", "several", "auth"].includes(params.get("verdict"))
  ? params.get("verdict")
  : "pass";
const language = params.get("lang") === "de" ? "de" : "en";
const role = params.get("role") === "member" ? "member" : "owner";

/*
 * What the last read counted of the organization's device list: every device,
 * and how many are network devices here (NetworkControllerInventory). A read
 * from before reads counted them has neither.
 */
const DEVICE_COUNTS = {
  counted: { deviceCount: 6, describedDeviceCount: 5 },
  one: { deviceCount: 6, describedDeviceCount: 1 },
};
const deviceCounts = DEVICE_COUNTS[params.get("devices")] || {};

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const projectPermission =
  role === "member" ? Permission.ProjectMember : Permission.ProjectOwner;
const rolePermissions = [...GLOBAL_PERMISSIONS, projectPermission];

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);
const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Networks",
});

/*
 * ---------------------------------------------------------------------------
 * The organization Meraki reports, and what its networks carry
 * ---------------------------------------------------------------------------
 */
const ORGANIZATION = { id: "549236", name: "Acme Networks" };

// The Head Office MX is a device in OneUptime; Branches is a site of two networks.
const DEVICE_ID = "40000000-0000-4000-8000-000000000001";
const SITE_ID = "50000000-0000-4000-8000-000000000001";
const DEVICE_SERIAL = "Q2PN-HQ01-0001";
const SITE_NETWORKS = ["L_646829496481105434", "L_646829496481105435"];
const SECOND_ORGANIZATION = { id: "777001", name: "Acme Networks (Labs)" };

// Bytes a second, down and up, per network's MX.
const NETWORKS = [
  {
    id: "L_646829496481105433",
    name: "Head Office",
    serial: "Q2PN-HQ01-0001",
    appliance: "HQ MX250",
    down: 4_800_000,
    up: 1_100_000,
  },
  {
    id: "L_646829496481105434",
    name: "Branch 012 · Leeds",
    serial: "Q2PN-LDS0-0012",
    appliance: "LDS MX68",
    down: 2_300_000,
    up: 520_000,
  },
  {
    id: "L_646829496481105435",
    name: "Branch 047 · Bristol",
    serial: "Q2PN-BRS0-0047",
    appliance: "BRS MX68",
    down: 1_400_000,
    up: 310_000,
  },
  {
    id: "L_646829496481105436",
    name: "Warehouse · Coventry",
    serial: "Q2PN-COV0-0003",
    appliance: "COV MX67C",
    down: 650_000,
    up: 140_000,
  },
];

const APPLICATIONS = [
  ["Microsoft 365", "outlook.office365.com", 0.31],
  ["Microsoft Teams", "teams.microsoft.com", 0.22],
  ["YouTube", "www.youtube.com", 0.12],
  ["Zoom", "zoom.us", 0.08],
  ["Windows Update", "update.microsoft.com", 0.06],
  ["Dropbox", "dropbox.com", 0.04],
];

const CLIENTS = [
  [
    "k5f1c2a",
    "Front desk kiosk",
    "10.10.20.15",
    "00:1b:63:84:45:e6",
    "Dell",
    0,
  ],
  [
    "k7a90d4",
    "Meeting room 2 display",
    "10.10.20.42",
    "3c:22:fb:91:0a:7d",
    "Samsung",
    0,
  ],
  [
    "k3b44e1",
    "POS terminal 3",
    "10.20.12.31",
    "a4:5e:60:c2:19:08",
    "Ingenico",
    1,
  ],
  [
    "k9c0213",
    "Laptop LDS-0457",
    "10.20.12.88",
    "f8:ff:c2:4b:7e:91",
    "Lenovo",
    1,
  ],
  ["k2d77f0", "", "10.30.4.17", "b8:27:eb:5d:33:a2", "Raspberry Pi", 2],
];

const READ_AT = new Date(Date.now() - 2 * 60 * 1000);

function connectionRecord(fields) {
  return Object.assign(new NetworkControllerConnection(), {
    _id: "30000000-0000-4000-8000-000000000001",
    projectId: projectObjectId,
    name: "Acme Networks",
    provider: "meraki",
    isEnabled: true,
    config: {
      region: "global",
      organizationId: ORGANIZATION.id,
      organizationName: ORGANIZATION.name,
      readIntervalInMinutes: 5,
    },
    createdAt: new Date("2026-10-20T08:00:00.000Z"),
    lastPulledAt: READ_AT,
    lastSuccessfulPullAt: READ_AT,
    lastPullResult: {
      status: "success",
      organizationName: ORGANIZATION.name,
      networkCount: 4,
      applianceCount: 4,
      matchedDeviceCount: 0,
      uplinkWindows: 1,
      analyticsNetworks: 0,
      analyticsNetworksWaiting: 0,
      trafficAnalysisOffNetworks: 0,
      rowsWritten: 8,
      requestCount: 4,
      wasRateLimited: false,
      warnings: [],
      durationMs: 1800,
      finishedAt: READ_AT.toISOString(),
      ...deviceCounts,
    },
    ...fields,
  });
}

function initialConnections() {
  if (dataState === "none" || dataState === "flows") {
    return [];
  }

  if (dataState === "waiting") {
    return [
      connectionRecord({
        createdAt: new Date(),
        lastPulledAt: undefined,
        lastSuccessfulPullAt: undefined,
        lastPullResult: undefined,
      }),
    ];
  }

  if (dataState === "failing") {
    return [
      connectionRecord({
        lastSuccessfulPullAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        lastError:
          "Meraki answered the organization with HTTP 401: Invalid API key",
        lastPullResult: {
          status: "failed",
          organizationName: ORGANIZATION.name,
          networkCount: 4,
          applianceCount: 4,
          failureKind: "authentication",
          warnings: [],
          requestCount: 0,
        },
      }),
    ];
  }

  if (dataState === "stale") {
    const lastRead = new Date(Date.now() - 3 * 60 * 60 * 1000);
    return [
      connectionRecord({
        lastPulledAt: lastRead,
        lastSuccessfulPullAt: lastRead,
      }),
    ];
  }

  if (dataState === "off") {
    return [connectionRecord({ isEnabled: false })];
  }

  if (dataState === "partial") {
    return [
      connectionRecord({
        name: "Acme Retail estate",
        config: {
          region: "global",
          organizationId: ORGANIZATION.id,
          organizationName: "Acme Retail",
          readIntervalInMinutes: 5,
        },
        lastPullResult: {
          status: "partial",
          organizationName: "Acme Retail",
          networkCount: 1240,
          applianceCount: 1180,
          matchedDeviceCount: 0,
          uplinkWindows: 34,
          analyticsNetworks: 430,
          analyticsNetworksWaiting: 810,
          trafficAnalysisOffNetworks: 12,
          rowsWritten: 81_600,
          requestCount: 900,
          wasRateLimited: true,
          warnings: [
            "Traffic analysis is off on 12 networks, so Meraki keeps no applications for them.",
          ],
          durationMs: 300_000,
          finishedAt: READ_AT.toISOString(),
        },
      }),
    ];
  }

  return [connectionRecord({})];
}

let connections = initialConnections();

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: { state: dataState, verdict, language, role },
  usageRequests: [],
  flowRequests: [],
  tests: [],
  readNows: [],
  creates: [],
  updates: [],
  deletes: [],
  itemAsks: 0,
  deviceAsks: 0,
  unhandled: [],
  // The read a connection waits for ends, as the worker's would.
  finishRead: () => {
    for (const connection of connections) {
      const now = new Date();
      connection.lastPulledAt = now;
      connection.lastSuccessfulPullAt = now;
      connection.lastError = undefined;
      connection.lastPullResult = connectionRecord({}).lastPullResult;
    }

    if (["waiting", "failing", "stale", "off"].includes(dataState)) {
      dataState = "meraki";
    }
  },
};
window.__merakiTrafficFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function ok(data) {
  return new HTTPResponse(200, serialize(data), {});
}

function tableName(modelType) {
  return new modelType().tableName;
}

/*
 * ---------------------------------------------------------------------------
 * What the page reads
 * ---------------------------------------------------------------------------
 */
function isRead(connection) {
  return Boolean(connection.lastSuccessfulPullAt);
}

function pageConnection(connection) {
  const summary = connection.lastPullResult || null;
  const lastRead = connection.lastSuccessfulPullAt
    ? new Date(connection.lastSuccessfulPullAt).getTime()
    : 0;
  const status = !connection.isEnabled
    ? "off"
    : connection.lastError
      ? "failing"
      : !connection.lastPulledAt
        ? "waiting"
        : Date.now() - lastRead > 30 * 60 * 1000
          ? "stale"
          : summary && summary.status === "partial"
            ? "partial"
            : "healthy";

  return {
    id: connection._id,
    name: connection.name,
    provider: "meraki",
    organizationName:
      (summary && summary.organizationName) ||
      connection.config.organizationName,
    status,
    readIntervalInMinutes: connection.config.readIntervalInMinutes,
    ...(connection.lastPulledAt
      ? { lastPulledAt: new Date(connection.lastPulledAt).toISOString() }
      : {}),
    ...(connection.lastSuccessfulPullAt
      ? {
          lastSuccessfulPullAt: new Date(
            connection.lastSuccessfulPullAt,
          ).toISOString(),
        }
      : {}),
    ...(connection.lastError ? { lastError: connection.lastError } : {}),
    ...(status === "partial" && summary.warnings[0]
      ? { warning: summary.warnings[0] }
      : {}),
  };
}

function emptyUsage(body) {
  return {
    // The network's page as soon as there is a connection; a device's or a
    // site's only once something of it was read (as the server answers).
    isAvailable:
      connections.length > 0 && !body.networkDeviceId && !body.networkSiteId,
    windowStartAt: body.startTime,
    windowEndAt: body.endTime,
    bucketSeconds: 300,
    totals: { sentOctets: 0, receivedOctets: 0, flows: 0 },
    primaryKind: "uplink",
    applicationTotals: { sentOctets: 0, receivedOctets: 0 },
    clientTotals: { sentOctets: 0, receivedOctets: 0 },
    series: [],
    topNetworks: [],
    topUplinks: [],
    topApplications: [],
    topDestinations: [],
    topClients: [],
    lastUplinkAt: null,
    lastAnalyticsAt: null,
    connections: connections.map(pageConnection),
  };
}

// The page's window, as the Meraki side answers it: known rates, a gentle wave.
function usageFor(body) {
  const answer = emptyUsage(body);

  if (!connections.some(isRead)) {
    return answer;
  }

  const filters = body.filters || {};
  const start = new Date(body.startTime).getTime();
  const end = new Date(body.endTime).getTime();
  /*
   * Traffic stops where the reads stopped: a connection that failed or
   * went stale two or three hours ago has nothing in the past hour.
   */
  const lastReadAt = Math.max(
    ...connections.filter(isRead).map((connection) => {
      return new Date(connection.lastSuccessfulPullAt).getTime();
    }),
  );

  if (lastReadAt < start) {
    return {
      ...answer,
      isAvailable: true,
      lastUplinkAt: new Date(lastReadAt).toISOString(),
      lastAnalyticsAt: new Date(lastReadAt - 60 * 60 * 1000).toISOString(),
    };
  }
  const seconds = Math.max(300, (end - start) / 1000);
  // A device's page is its MX's network; a site's page its networks.
  const inScope = (network) => {
    if (body.networkDeviceId) {
      return (
        body.networkDeviceId === DEVICE_ID && network.serial === DEVICE_SERIAL
      );
    }
    if (body.networkSiteId) {
      return (
        body.networkSiteId === SITE_ID && SITE_NETWORKS.includes(network.id)
      );
    }
    return true;
  };
  const networks = NETWORKS.filter((network) => {
    return (
      inScope(network) &&
      (!filters.controllerNetworkId ||
        filters.controllerNetworkId === network.id)
    );
  });

  // A device or a site Meraki read nothing of has no Meraki side at all.
  if (networks.length === 0 && (body.networkDeviceId || body.networkSiteId)) {
    return { ...answer, isAvailable: false, connections: [] };
  }
  const share = (network) => {
    return filters.deviceSerial && filters.deviceSerial !== network.serial
      ? 0
      : 1;
  };

  let down = 0;
  let up = 0;
  for (const network of networks) {
    down += network.down * seconds * share(network);
    up += network.up * seconds * share(network);
  }

  /*
   * Buckets as the server makes them: whole multiples of the bucket from
   * the epoch (toStartOfInterval), the first one holding the range's start.
   */
  const bucketSeconds = Math.max(
    300,
    Math.round(seconds / Math.min(288, Math.max(1, seconds / 300)) / 60) * 60,
  );
  const bucketMs = bucketSeconds * 1000;
  const firstBucket = Math.floor(start / bucketMs) * bucketMs;
  const buckets = Math.max(1, Math.ceil((end - firstBucket) / bucketMs));
  const series = [];
  let weights = 0;
  for (let index = 0; index < buckets; index++) {
    weights += 0.8 + 0.35 * Math.sin(index / 2.2) + 0.1 * Math.cos(index);
  }
  for (let index = 0; index < buckets; index++) {
    const weight =
      (0.8 + 0.35 * Math.sin(index / 2.2) + 0.1 * Math.cos(index)) / weights;
    series.push({
      time: new Date(firstBucket + index * bucketMs).toISOString(),
      sentOctets: Math.round(up * weight),
      receivedOctets: Math.round(down * weight),
    });
  }

  const applicationBytes = (down + up) * 0.82;
  // The part of the organization's traffic the filters keep: its flows too.
  const everything = NETWORKS.filter(inScope).reduce((total, network) => {
    return total + (network.down + network.up) * seconds;
  }, 0);
  const kept = everything > 0 ? (down + up) / everything : 0;
  const topApplications = APPLICATIONS.map(([application, , weight]) => {
    return {
      application,
      sentOctets: Math.round(applicationBytes * weight * 0.18),
      receivedOctets: Math.round(applicationBytes * weight * 0.82),
      flows: Math.round(seconds * weight * 0.9 * kept),
    };
  });
  const topDestinations = APPLICATIONS.map(
    ([application, destination, weight]) => {
      return {
        destination,
        application,
        sentOctets: Math.round(applicationBytes * weight * 0.16),
        receivedOctets: Math.round(applicationBytes * weight * 0.74),
      };
    },
  );
  const topClients = CLIENTS.filter(([, , , , , networkIndex]) => {
    return networks.includes(NETWORKS[networkIndex]);
  }).map(([clientKey, name, ip, mac, manufacturer, networkIndex], index) => {
    const bytes =
      (NETWORKS[networkIndex].down + NETWORKS[networkIndex].up) *
      seconds *
      (0.09 - index * 0.012);
    return {
      clientKey,
      name,
      ip,
      mac,
      manufacturer,
      controllerNetworkName: NETWORKS[networkIndex].name,
      sentOctets: Math.round(bytes * 0.2),
      receivedOctets: Math.round(bytes * 0.8),
    };
  });

  return {
    ...answer,
    isAvailable: true,
    bucketSeconds,
    totals: {
      sentOctets: Math.round(up),
      receivedOctets: Math.round(down),
      flows: topApplications.reduce((total, row) => {
        return total + row.flows;
      }, 0),
    },
    applicationTotals: {
      sentOctets: Math.round(applicationBytes * 0.18),
      receivedOctets: Math.round(applicationBytes * 0.82),
    },
    clientTotals: {
      sentOctets: Math.round((down + up) * 0.12),
      receivedOctets: Math.round((down + up) * 0.48),
    },
    series,
    topNetworks: networks.map((network) => {
      return {
        controllerNetworkId: network.id,
        name: network.name,
        sentOctets: Math.round(network.up * seconds * share(network)),
        receivedOctets: Math.round(network.down * seconds * share(network)),
      };
    }),
    topUplinks: networks
      .flatMap((network) => {
        return [
          ["wan1", 0.91],
          ["wan2", 0.09],
        ].map(([interfaceName, part]) => {
          return {
            deviceSerial: network.serial,
            deviceName: network.appliance,
            controllerNetworkId: network.id,
            controllerNetworkName: network.name,
            // The Head Office MX is a device in OneUptime.
            ...(network.serial === DEVICE_SERIAL
              ? { networkDeviceId: DEVICE_ID }
              : {}),
            interfaceName,
            sentOctets: Math.round(
              network.up * seconds * part * share(network),
            ),
            receivedOctets: Math.round(
              network.down * seconds * part * share(network),
            ),
          };
        });
      })
      .filter((row) => {
        return row.sentOctets + row.receivedOctets > 0;
      })
      .slice(0, 10),
    topApplications,
    topDestinations,
    topClients,
    lastUplinkAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    lastAnalyticsAt: new Date(Date.now() - 70 * 60 * 1000).toISOString(),
  };
}

// The flow side: nothing sends flow records, unless the scenario says so.
function flowsFor(body) {
  const start = body.startTime;
  const end = body.endTime;

  if (
    (dataState !== "both" && dataState !== "flows") ||
    body.networkDeviceId ||
    body.networkSiteId
  ) {
    return {
      windowStartAt: start,
      windowEndAt: end,
      bucketSeconds: 60,
      totals: { octets: 0, packets: 0, flows: 0 },
      maxSamplingRate: 1,
      series: [],
      topSources: [],
      topDestinations: [],
      topConversations: [],
      topApplications: [],
      topInterfaces: [],
      topDevices: [],
      sources: [],
      lastFlowAt: null,
    };
  }

  return {
    windowStartAt: start,
    windowEndAt: end,
    bucketSeconds: 60,
    totals: { octets: 2_400_000_000, packets: 2_100_000, flows: 18_400 },
    maxSamplingRate: 1,
    series: [
      { time: start, octets: 1_200_000_000 },
      { time: end, octets: 1_200_000_000 },
    ],
    topSources: [
      { ip: "10.10.20.15", octets: 900_000_000, packets: 700_000 },
      { ip: "10.20.12.31", octets: 400_000_000, packets: 300_000 },
    ],
    topDestinations: [
      { ip: "52.112.0.10", octets: 1_100_000_000, packets: 900_000 },
    ],
    topConversations: [
      {
        sourceIp: "10.10.20.15",
        destinationIp: "52.112.0.10",
        octets: 900_000_000,
        packets: 700_000,
      },
    ],
    topApplications: [
      {
        protocolNumber: 6,
        port: 443,
        octets: 2_000_000_000,
        packets: 1_600_000,
      },
    ],
    topInterfaces: [],
    topDevices: [],
    sources: [
      {
        exporterIp: "10.0.0.1",
        flowFormat: "netflow-v9",
        octets: 2_400_000_000,
        flows: 18_400,
        lastFlowAt: end,
      },
    ],
    lastFlowAt: end,
  };
}

function testAnswer(body) {
  const config = body.config || {};

  // A saved connection's new key (the edit dialog): its own organization.
  if (body.connectionId) {
    if (verdict === "auth") {
      return {
        provider: "meraki",
        status: "fail",
        message:
          "Meraki answered the list of organizations with HTTP 401: Invalid API key",
        failureKind: "authentication",
        organizations: [],
        durationMs: 300,
      };
    }

    return {
      provider: "meraki",
      status: "pass",
      message: `Reads 4 networks and 4 appliances in ${ORGANIZATION.name}.`,
      organizations: [ORGANIZATION],
      organizationId: ORGANIZATION.id,
      networkCount: 4,
      applianceCount: 4,
      durationMs: 900,
    };
  }

  if (verdict === "auth") {
    return {
      provider: "meraki",
      status: "fail",
      message:
        "The Meraki dashboard (dashboard.meraki.com) did not accept this API key.",
      remediation:
        "Copy the key again from the Meraki dashboard (Organization > API & Webhooks > API keys and access), and check the region is the dashboard you sign in to.",
      failureKind: "authentication",
      organizations: [],
      durationMs: 300,
    };
  }

  const organizations =
    verdict === "several"
      ? [ORGANIZATION, SECOND_ORGANIZATION]
      : [ORGANIZATION];

  if (verdict === "several" && !config.organizationId) {
    return {
      provider: "meraki",
      status: "pass",
      message: "The key reads 2 organizations. Pick the one to read.",
      organizations,
      durationMs: 600,
    };
  }

  const picked =
    organizations.find((organization) => {
      return organization.id === config.organizationId;
    }) || ORGANIZATION;

  return {
    provider: "meraki",
    status: "pass",
    message: `Reads 4 networks and 4 appliances in ${picked.name}.`,
    organizations,
    organizationId: picked.id,
    networkCount: picked.id === ORGANIZATION.id ? 4 : 2,
    applianceCount: picked.id === ORGANIZATION.id ? 4 : 1,
    durationMs: 900,
  };
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.getUserId = () => {
  return new ObjectID("80000000-0000-4000-8000-000000000001");
};
UserUtil.getName = () => {
  return "Sam Patel";
};
UserUtil.getEmail = () => {
  return "sam@acme-networks.example";
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
    permissions: [
      {
        _type: "UserPermission",
        permission: projectPermission,
        labelIds: [],
      },
    ],
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

function copy(connection) {
  return Object.assign(new NetworkControllerConnection(), connection);
}

ModelAPI.getList = async (options) => {
  if (options.modelType === NetworkControllerConnection) {
    const data = connections.map(copy);
    return { data, count: data.length, skip: 0, limit: options.limit };
  }

  // The site's side menu counts its maintenance by state: none here.
  if (options.modelType === ScheduledMaintenanceState) {
    return { data: [], count: 0, skip: 0, limit: options.limit };
  }

  /*
   * A device's side menu counts its open incidents and alerts by state
   * (issue #5341): none here.
   */
  if (options.modelType === IncidentState || options.modelType === AlertState) {
    return { data: [], count: 0, skip: 0, limit: options.limit };
  }

  fixture.unhandled.push({
    kind: "getList",
    modelName: tableName(options.modelType),
  });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

ModelAPI.getItem = async (options) => {
  // The Branches site: the Leeds and Bristol networks.
  if (options.modelType === NetworkSite) {
    return options.id.toString() === SITE_ID
      ? Object.assign(new NetworkSite(), { _id: SITE_ID, name: "Branches" })
      : null;
  }

  // The Head Office MX: a device in OneUptime, polled by no probe here.
  if (options.modelType === NetworkDevice) {
    fixture.deviceAsks += 1;
    return options.id.toString() === DEVICE_ID
      ? Object.assign(new NetworkDevice(), {
          _id: DEVICE_ID,
          name: "HQ MX250",
          hostname: "10.0.0.1",
        })
      : null;
  }

  if (options.modelType === NetworkControllerConnection) {
    fixture.itemAsks += 1;
    const found = connections.find((connection) => {
      return connection._id === options.id.toString();
    });
    return found ? copy(found) : null;
  }

  fixture.unhandled.push({
    kind: "getItem",
    modelName: tableName(options.modelType),
  });
  return null;
};

ModelAPI.create = async (options) => {
  if (options.modelType !== NetworkControllerConnection) {
    fixture.unhandled.push({
      kind: "create",
      modelName: tableName(options.modelType),
    });
    return ok({});
  }

  const model = options.model;
  fixture.creates.push({
    name: model.name,
    provider: model.provider,
    config: serialize(model.config),
    secrets: model.secrets,
    projectId: model.projectId?.toString(),
  });

  connections = [
    connectionRecord({
      name: model.name,
      config: serialize(model.config),
      createdAt: new Date(),
      lastPulledAt: undefined,
      lastSuccessfulPullAt: undefined,
      lastPullResult: undefined,
    }),
  ];
  dataState = "waiting";

  return ok({ _id: connections[0]._id });
};

ModelAPI.updateById = async (options) => {
  if (options.modelType !== NetworkControllerConnection) {
    fixture.unhandled.push({
      kind: "updateById",
      modelName: tableName(options.modelType),
    });
    return ok({});
  }

  fixture.updates.push({
    id: options.id.toString(),
    data: serialize(options.data),
  });
  const found = connections.find((connection) => {
    return connection._id === options.id.toString();
  });
  if (found) {
    const data = { ...options.data };
    delete data.secrets;
    if (data.config) {
      data.config = { ...found.config, ...data.config };
    }
    Object.assign(found, data);
  }
  return ok({});
};

ModelAPI.deleteItem = async (options) => {
  fixture.deletes.push(options.id.toString());
  connections = connections.filter((connection) => {
    return connection._id !== options.id.toString();
  });
  if (connections.length === 0) {
    dataState = "none";
  }
};

async function handleApi(method, options) {
  const url = options.url.toString();

  if (method === "POST" && url.endsWith("/network-traffic/usage-summary")) {
    fixture.usageRequests.push(serialize(options.data));
    return ok(usageFor(options.data || {}));
  }

  if (method === "POST" && url.endsWith("/network-traffic/summary")) {
    fixture.flowRequests.push(serialize(options.data));
    return ok(flowsFor(options.data || {}));
  }

  if (
    method === "POST" &&
    url.endsWith("/network-controller-connection/test")
  ) {
    fixture.tests.push(serialize(options.data));
    return ok(testAnswer(options.data || {}));
  }

  // The site's side menu counts the site's maintenance events: none.
  if (method === "POST" && url.endsWith("/scheduled-maintenance/count")) {
    return ok({ count: 0 });
  }

  // A device's side menu counts its open incidents and alerts: none.
  if (
    method === "POST" &&
    (url.endsWith("/incident/count") || url.endsWith("/alert/count"))
  ) {
    return ok({ count: 0 });
  }

  if (method === "POST" && url.endsWith("/read-now")) {
    fixture.readNows.push(new URL(url).pathname);
    return ok({ queued: true });
  }

  fixture.unhandled.push({ kind: "api", method, url });
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

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
  },
  interpolation: { escapeValue: false },
});

/*
 * ---------------------------------------------------------------------------
 * Router
 * ---------------------------------------------------------------------------
 */
function pageProps(pageKey) {
  return {
    pageRoute: pageKey ? RouteMap[pageKey] : undefined,
    currentProject: project,
    hasPaymentMethod: true,
  };
}

function useNavigationHooks() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());
}

function FixtureNetworkLayout() {
  useNavigationHooks();
  return <NetworkLayout {...pageProps(PageMap.NETWORK_TRAFFIC)} />;
}

function TrafficPage() {
  useNavigationHooks();
  return <NetworkTraffic {...pageProps(PageMap.NETWORK_TRAFFIC)} />;
}

function DeviceLayout() {
  useNavigationHooks();
  return (
    <NetworkDeviceViewLayout
      {...pageProps(PageMap.NETWORK_DEVICE_VIEW_TRAFFIC)}
    />
  );
}

function DeviceTrafficPage() {
  useNavigationHooks();
  return (
    <NetworkDeviceTraffic {...pageProps(PageMap.NETWORK_DEVICE_VIEW_TRAFFIC)} />
  );
}

function SiteLayout() {
  useNavigationHooks();
  return (
    <NetworkSiteViewLayout {...pageProps(PageMap.NETWORK_SITE_VIEW_TRAFFIC)} />
  );
}

function SiteTrafficPage() {
  useNavigationHooks();
  return (
    <NetworkSiteTraffic {...pageProps(PageMap.NETWORK_SITE_VIEW_TRAFFIC)} />
  );
}

// A page the Traffic page links to that is not modelled: says where it is.
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
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6 dark:border-gray-800 dark:bg-gray-900"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            OneUptime
          </span>
          <span className="text-sm text-gray-500">Acme Networks</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureNetworkLayout />}>
          <Route
            path={RouteMap[PageMap.NETWORK_TRAFFIC].toString()}
            element={<TrafficPage />}
          />
          {/* A device's and a site's page, in their own model layouts. */}
          <Route element={<DeviceLayout />}>
            <Route
              path={RouteMap[PageMap.NETWORK_DEVICE_VIEW_TRAFFIC].toString()}
              element={<DeviceTrafficPage />}
            />
          </Route>
          <Route element={<SiteLayout />}>
            <Route
              path={RouteMap[PageMap.NETWORK_SITE_VIEW_TRAFFIC].toString()}
              element={<SiteTrafficPage />}
            />
          </Route>
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <FixtureApp />
  </BrowserRouter>,
);
