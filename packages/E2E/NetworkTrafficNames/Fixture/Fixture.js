/*
 * Offline fixture for names on the real Network > Traffic page (issue
 * #5340): the top sources, destinations and conversations (both views) by
 * name with the address beside it, the filter chips, the card a page
 * narrowed to one address opens with, "find" by a name, "Name this
 * address", and Network > Settings > Address Names.
 *
 * The Network Layout (Page + the Network side menu), the Traffic page and
 * the Address Names page are the production components from this branch,
 * mounted under their real RouteMap patterns. Only the data boundary
 * (ModelAPI / API) and the signed-in user are replaced. Every record is
 * fabricated for an "Acme Networks" workspace.
 *
 * Scenarios are picked with query parameters, parsed once at load:
 *
 *   ?names=    all (default): names from every source - a host, a network
 *              device, a cloud resource, a Kubernetes node and pod, DNS,
 *              Address Names - and two named subnets
 *              none: the project knows no name (the page as it was)
 *              long: the longest names a page meets (a 70-character DNS
 *              name, an Address Name of 90 characters, a long pod name)
 *   ?role=     owner (default) | viewer: a project viewer, who may read
 *              names but not add or change them
 *   ?lang=     de | fa reads the German or the Persian locale file (and a
 *              Persian workspace names two places in Persian)
 *   ?theme=    dark adds html.dark (handled by server.js)
 *   ?fail=     find: "find an address" answers 500
 *
 * Every read and write is recorded on window.__networkTrafficNamesFixture:
 * flowRequests, findRequests, creates, updates, deletes and unhandled -
 * anything the fixture does not model. The spec asserts `unhandled` is
 * empty.
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
import fa from "../../../App/FeatureSet/Dashboard/src/Locales/fa.json";
import NetworkLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Network/Layout";
import NetworkTraffic from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Traffic";
import AddressNamesPage from "../../../App/FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/AddressNames";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import NetworkAddressName from "Common/Models/DatabaseModels/NetworkAddressName";
import NetworkControllerConnection from "Common/Models/DatabaseModels/NetworkControllerConnection";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import { followLanguageForPage } from "Common/UI/Utils/PageLanguage";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionUtil from "Common/UI/Utils/Permission";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import NetworkAddressBlockUtil from "Common/Utils/NetworkTraffic/NetworkAddressBlock";
import { FormType } from "Common/UI/Components/Forms/ModelForm";

/*
 * ---------------------------------------------------------------------------
 * Scenario switches
 * ---------------------------------------------------------------------------
 */
const params = new URLSearchParams(window.location.search);
const namesScenario = ["all", "none", "long"].includes(params.get("names"))
  ? params.get("names")
  : "all";
const language = ["de", "fa"].includes(params.get("lang"))
  ? params.get("lang")
  : "en";
const role = params.get("role") === "viewer" ? "viewer" : "owner";
const failFind = params.get("fail") === "find";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const projectPermission =
  role === "viewer" ? Permission.Viewer : Permission.ProjectOwner;
const rolePermissions = [...GLOBAL_PERMISSIONS, projectPermission];

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);
const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Networks",
});

/*
 * ---------------------------------------------------------------------------
 * The estate: what each address is called, and what it carried
 * ---------------------------------------------------------------------------
 */
const HOST_ID = "60000000-0000-4000-8000-000000000001";
const SECOND_HOST_ID = "60000000-0000-4000-8000-000000000002";
const DEVICE_ID = "40000000-0000-4000-8000-000000000002";
const CLOUD_RESOURCE_ID = "70000000-0000-4000-8000-000000000001";
const BACKUP_NAME_ID = "90000000-0000-4000-8000-000000000001";
const PAYROLL_NAME_ID = "90000000-0000-4000-8000-000000000002";
const MUMBAI_SUBNET_ID = "90000000-0000-4000-8000-000000000003";
const LEEDS_SUBNET_ID = "90000000-0000-4000-8000-000000000004";

const isPersian = language === "fa";

/*
 * The Address Names the workspace keeps (Network > Settings): two
 * addresses and two subnets. A Persian workspace wrote two of them in
 * Persian, which the page must draw right to left beside left-to-right
 * addresses.
 */
function initialAddressNames() {
  if (namesScenario === "none") {
    return [];
  }

  return [
    {
      _id: BACKUP_NAME_ID,
      name: "Backup appliance",
      address: "10.18.167.20",
    },
    {
      _id: PAYROLL_NAME_ID,
      name:
        namesScenario === "long"
          ? "Payroll and benefits SaaS (Northwind Payroll, production tenant for EMEA and APAC)"
          : isPersian
            ? "حقوق و دستمزد"
            : "Payroll SaaS",
      address: "158.115.141.143",
    },
    {
      _id: MUMBAI_SUBNET_ID,
      name: "Mumbai office",
      address: "10.18.167.0/24",
    },
    {
      _id: LEEDS_SUBNET_ID,
      name: isPersian ? "دفتر لیدز" : "Leeds branch",
      address: "10.114.167.0/24",
    },
  ];
}

let addressNameRows = initialAddressNames();

// Names that come from somewhere other than Address Names.
function otherNames() {
  if (namesScenario === "none") {
    return {};
  }

  const long = namesScenario === "long";

  return {
    "10.18.167.35": {
      name: long
        ? "mumbai-fileserver-primary-replica-01.storage.corp.acme-networks.example"
        : "mumbai-fs01",
      source: long ? "dns" : "host",
      ...(long ? {} : { resourceId: HOST_ID }),
    },
    "10.18.167.31": {
      name: "mum-print-02.corp.acme.example",
      source: "dns",
    },
    "10.200.221.245": {
      name: "core-sw-01",
      source: "network-device",
      resourceId: DEVICE_ID,
    },
    "10.34.167.20": {
      name: "ip-10-34-167-20.ec2.internal",
      source: "kubernetes-node",
    },
    "10.242.167.220": {
      name: long
        ? "checkout-api-canary-deployment-7f9c6d8b4-xkz2p-eu-central-1a"
        : "checkout-api-7f9c6d-xkz2p",
      source: "kubernetes-pod",
    },
    "10.114.167.16": {
      name: "orders-db-primary",
      source: "cloud-resource",
      resourceId: CLOUD_RESOURCE_ID,
    },
    "10.114.167.38": {
      name: "lds-ws-0457.corp.acme.example",
      source: "dns",
    },
    "10.16.1.20": {
      name: "build-runner-03",
      source: "host",
      resourceId: SECOND_HOST_ID,
    },
    "20.150.94.132": {
      name: "blob.ams23prdstr05a.store.core.windows.net",
      source: "dns",
    },
  };
}

// The order the server picks names in (NETWORK_ADDRESS_NAME_SOURCES).
const SOURCE_ORDER = [
  "address-name",
  "network-device",
  "host",
  "cloud-resource",
  "kubernetes-node",
  "kubernetes-pod",
  "dns",
];

// What the server answers for these addresses, from the current Address Names.
function namesFor(addresses) {
  const others = otherNames();
  const answer = {};

  for (const address of addresses) {
    const candidates = [];

    if (others[address]) {
      candidates.push(others[address]);
    }

    let subnet = null;
    let subnetPrefix = -1;

    for (const row of addressNameRows) {
      const block = NetworkAddressBlockUtil.parse(row.address);

      if (!block) {
        continue;
      }

      if (NetworkAddressBlockUtil.isSingleAddress(block)) {
        if (block.text === address) {
          candidates.push({
            name: row.name,
            source: "address-name",
            resourceId: row._id,
          });
        }
        continue;
      }

      if (
        block.prefixLength > subnetPrefix &&
        NetworkAddressBlockUtil.contains(block, address)
      ) {
        subnet = { name: row.name, text: block.text };
        subnetPrefix = block.prefixLength;
      }
    }

    candidates.sort((a, b) => {
      return SOURCE_ORDER.indexOf(a.source) - SOURCE_ORDER.indexOf(b.source);
    });

    const picked = candidates[0];

    if (!picked && !subnet) {
      continue;
    }

    answer[address] = {
      ...(picked
        ? {
            name: picked.name,
            source: picked.source,
            ...(picked.resourceId ? { resourceId: picked.resourceId } : {}),
          }
        : {}),
      ...(subnet ? { subnetName: subnet.name, subnet: subnet.text } : {}),
    };
  }

  return answer;
}

const MB = 1_000_000;

const SOURCES = [
  ["10.18.167.35", 12.5],
  ["10.18.167.36", 8.3],
  ["10.18.167.31", 8.11],
  ["10.200.221.245", 7.12],
  ["10.18.167.20", 6.94],
  ["10.34.167.20", 3.22],
  ["10.242.167.220", 2.42],
  ["10.242.167.221", 2.38],
  ["10.242.167.222", 2.33],
  ["20.150.94.132", 2.24],
];

const DESTINATIONS = [
  ["10.18.167.20", 6.81],
  ["10.200.221.245", 4.17],
  ["158.115.141.143", 3.74],
  ["10.114.167.11", 3.51],
  ["10.114.167.16", 3.38],
  ["10.114.167.21", 3.37],
  ["10.114.167.38", 3.28],
  ["10.114.167.12", 3.26],
  ["10.16.1.20", 3.24],
  ["10.114.167.26", 3.18],
];

const CONVERSATIONS = [
  ["10.18.167.35", "10.18.167.20", 6.2],
  ["10.18.167.36", "158.115.141.143", 3.7],
  ["10.18.167.31", "10.114.167.11", 3.4],
  ["10.200.221.245", "10.114.167.16", 3.3],
  ["10.18.167.20", "10.200.221.245", 3.1],
  ["10.34.167.20", "10.114.167.38", 2.9],
  ["10.242.167.220", "10.16.1.20", 2.4],
  ["10.242.167.221", "10.114.167.21", 2.3],
  ["10.242.167.222", "10.114.167.12", 2.2],
  ["20.150.94.132", "10.114.167.26", 2.1],
];

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: { names: namesScenario, language, role },
  flowRequests: [],
  findRequests: [],
  creates: [],
  updates: [],
  deletes: [],
  unhandled: [],
};
window.__networkTrafficNamesFixture = fixture;

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
function sends(address) {
  return SOURCES.find(([ip]) => {
    return ip === address;
  });
}

function receives(address) {
  return DESTINATIONS.find(([ip]) => {
    return ip === address;
  });
}

// The window's flows, narrowed to the page's filters the way the server does.
function flowsFor(body) {
  const filters = body.filters || {};
  const start = body.startTime;
  const end = body.endTime;
  const host = filters.hostIp;
  const keepsSource = (ip) => {
    return (
      (!filters.sourceIp || filters.sourceIp === ip) && (!host || host === ip)
    );
  };
  const keepsDestination = (ip) => {
    return (
      (!filters.destinationIp || filters.destinationIp === ip) &&
      (!host || host === ip)
    );
  };
  const conversations = CONVERSATIONS.filter(([source, destination]) => {
    return (
      (!filters.sourceIp || filters.sourceIp === source) &&
      (!filters.destinationIp || filters.destinationIp === destination) &&
      (!host || host === source || host === destination)
    );
  });
  const narrowed = Boolean(filters.sourceIp || filters.destinationIp || host);
  const topSources = narrowed
    ? SOURCES.filter(([ip]) => {
        return (
          keepsSource(ip) ||
          conversations.some(([source]) => {
            return source === ip;
          })
        );
      })
    : SOURCES;
  const topDestinations = narrowed
    ? DESTINATIONS.filter(([ip]) => {
        return (
          keepsDestination(ip) ||
          conversations.some(([, destination]) => {
            return destination === ip;
          })
        );
      })
    : DESTINATIONS;
  const octets = Math.round(
    (narrowed
      ? conversations.reduce((total, [, , mb]) => {
          return total + mb;
        }, 0) ||
        (sends(host || filters.sourceIp || "")?.[1] || 0) +
          (receives(host || filters.destinationIp || "")?.[1] || 0)
      : 120) * MB,
  );
  const addresses = [
    ...[filters.sourceIp, filters.destinationIp, host].filter(Boolean),
    ...topSources.map(([ip]) => {
      return ip;
    }),
    ...topDestinations.map(([ip]) => {
      return ip;
    }),
    ...conversations.flatMap(([source, destination]) => {
      return [source, destination];
    }),
  ];

  return {
    windowStartAt: start,
    windowEndAt: end,
    bucketSeconds: 60,
    totals: {
      octets,
      packets: Math.round(octets / 900),
      flows: Math.round(octets / 60_000),
    },
    maxSamplingRate: 1,
    series: [
      { time: start, octets: Math.round(octets / 2) },
      { time: end, octets: Math.round(octets / 2) },
    ],
    topSources: topSources.map(([ip, mb]) => {
      return {
        ip,
        octets: Math.round(mb * MB),
        packets: Math.round((mb * MB) / 900),
      };
    }),
    topDestinations: topDestinations.map(([ip, mb]) => {
      return {
        ip,
        octets: Math.round(mb * MB),
        packets: Math.round((mb * MB) / 900),
      };
    }),
    topConversations: conversations.map(([sourceIp, destinationIp, mb]) => {
      return {
        sourceIp,
        destinationIp,
        octets: Math.round(mb * MB),
        packets: Math.round((mb * MB) / 900),
      };
    }),
    topApplications: [
      {
        protocolNumber: 6,
        port: 445,
        octets: Math.round(octets * 0.6),
        packets: Math.round((octets * 0.6) / 900),
      },
      {
        protocolNumber: 6,
        port: 443,
        octets: Math.round(octets * 0.4),
        packets: Math.round((octets * 0.4) / 900),
      },
    ],
    topInterfaces: [],
    topDevices: [
      {
        networkDeviceId: DEVICE_ID,
        name: "core-sw-01",
        exporterIp: "10.200.221.245",
        octets,
        packets: Math.round(octets / 900),
      },
    ],
    sources: [
      {
        networkDeviceId: DEVICE_ID,
        name: "core-sw-01",
        exporterIp: "10.200.221.245",
        flowFormat: "IPFIX",
        samplingRate: 1,
        octets,
        flows: Math.round(octets / 60_000),
        lastFlowAt: end,
      },
    ],
    lastFlowAt: end,
    addressNames: namesFor(addresses),
  };
}

// "Find an address": the addresses whose name holds the text, busiest first.
function findFor(body) {
  const text = String(body.query || "").toLowerCase();
  const all = Array.from(
    new Set([
      ...SOURCES.map(([ip]) => {
        return ip;
      }),
      ...DESTINATIONS.map(([ip]) => {
        return ip;
      }),
    ]),
  );
  const names = namesFor(all);
  const matches = all
    .filter((address) => {
      const named = names[address];
      return named && named.name && named.name.toLowerCase().includes(text);
    })
    .map((address) => {
      return {
        address,
        name: names[address].name,
        source: names[address].source,
        octets: Math.round(
          ((sends(address)?.[1] || 0) + (receives(address)?.[1] || 0)) * MB,
        ),
      };
    })
    .sort((a, b) => {
      return b.octets - a.octets;
    })
    .slice(0, 10);

  return { matches };
}

function emptyUsage(body) {
  return {
    isAvailable: false,
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
    connections: [],
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

function toModel(row) {
  return Object.assign(new NetworkAddressName(), {
    ...row,
    projectId: projectObjectId,
  });
}

// The server's own checks, as NetworkAddressNameService makes them.
function checkedRow(data, exceptId) {
  const block = NetworkAddressBlockUtil.parse(data.address);
  const name = String(data.name || "").trim();

  if (!block) {
    return {
      error:
        "That is not an IP address or a subnet. Enter one address, like 10.0.0.5 or 2001:db8::5, or a subnet, like 10.18.167.0/24.",
    };
  }

  if (!name) {
    return { error: "Enter a name for the address." };
  }

  const taken = addressNameRows.find((row) => {
    return row.address === block.text && row._id !== exceptId;
  });

  if (taken) {
    return {
      error: `${block.text} already has a name: ${taken.name}. Change that one instead.`,
    };
  }

  return { row: { name, address: block.text } };
}

let nextId = 10;

ModelAPI.getList = async (options) => {
  if (options.modelType === NetworkAddressName) {
    const data = addressNameRows.map(toModel);
    return { data, count: data.length, skip: 0, limit: options.limit };
  }

  // The Meraki connections at the network page's foot: none.
  if (options.modelType === NetworkControllerConnection) {
    return { data: [], count: 0, skip: 0, limit: options.limit };
  }

  fixture.unhandled.push({
    kind: "getList",
    modelName: tableName(options.modelType),
  });
  return { data: [], count: 0, skip: 0, limit: 0 };
};

ModelAPI.count = async (options) => {
  if (options.modelType === NetworkAddressName) {
    return addressNameRows.length;
  }

  fixture.unhandled.push({
    kind: "count",
    modelName: tableName(options.modelType),
  });
  return 0;
};

ModelAPI.getItem = async (options) => {
  if (options.modelType === NetworkAddressName) {
    const found = addressNameRows.find((row) => {
      return row._id === options.id.toString();
    });
    return found ? toModel(found) : null;
  }

  fixture.unhandled.push({
    kind: "getItem",
    modelName: tableName(options.modelType),
  });
  return null;
};

ModelAPI.create = async (options) => {
  if (options.modelType !== NetworkAddressName) {
    fixture.unhandled.push({
      kind: "create",
      modelName: tableName(options.modelType),
    });
    return ok({});
  }

  const model = options.model;
  fixture.creates.push({ name: model.name, address: model.address });
  const checked = checkedRow({ name: model.name, address: model.address });

  if (checked.error) {
    throw new HTTPErrorResponse(400, { message: checked.error }, {});
  }

  const _id = `90000000-0000-4000-8000-0000000000${nextId++}`;
  addressNameRows = [...addressNameRows, { _id, ...checked.row }];

  return ok({ _id, ...checked.row });
};

ModelAPI.updateById = async (options) => {
  if (options.modelType !== NetworkAddressName) {
    fixture.unhandled.push({
      kind: "updateById",
      modelName: tableName(options.modelType),
    });
    return ok({});
  }

  const id = options.id.toString();
  const data = serialize(options.data);
  fixture.updates.push({ id, data });
  const found = addressNameRows.find((row) => {
    return row._id === id;
  });
  const checked = checkedRow({ ...found, ...data }, id);

  if (checked.error) {
    throw new HTTPErrorResponse(400, { message: checked.error }, {});
  }

  addressNameRows = addressNameRows.map((row) => {
    return row._id === id ? { ...row, ...checked.row } : row;
  });

  return ok({});
};

/*
 * What the Address Name form saves through (ModelForm): a new name, or a
 * name changed on Address Names - with the server's own checks, so a
 * refused one says what the server would.
 */
ModelAPI.createOrUpdate = async (options) => {
  if (options.modelType !== NetworkAddressName) {
    fixture.unhandled.push({
      kind: "createOrUpdate",
      modelName: tableName(options.modelType),
    });
    return ok({});
  }

  const model = options.model;
  const isUpdate = options.formType === FormType.Update;
  const id = model._id ? model._id.toString() : null;

  if (isUpdate && id) {
    const found = addressNameRows.find((row) => {
      return row._id === id;
    });
    const data = serialize({ name: model.name, address: model.address });
    fixture.updates.push({ id, data });
    const checked = checkedRow({ ...found, ...data }, id);

    if (checked.error) {
      throw new HTTPErrorResponse(400, { message: checked.error }, {});
    }

    addressNameRows = addressNameRows.map((row) => {
      return row._id === id ? { ...row, ...checked.row } : row;
    });

    return ok({ _id: id, ...checked.row });
  }

  fixture.creates.push({ name: model.name, address: model.address });
  const checked = checkedRow({ name: model.name, address: model.address });

  if (checked.error) {
    throw new HTTPErrorResponse(400, { message: checked.error }, {});
  }

  const newId = `90000000-0000-4000-8000-0000000000${nextId++}`;
  addressNameRows = [...addressNameRows, { _id: newId, ...checked.row }];

  return ok({ _id: newId, ...checked.row });
};

ModelAPI.deleteItem = async (options) => {
  fixture.deletes.push(options.id.toString());
  addressNameRows = addressNameRows.filter((row) => {
    return row._id !== options.id.toString();
  });
};

async function handleApi(method, options) {
  const url = options.url.toString();

  if (method === "POST" && url.endsWith("/network-traffic/summary")) {
    fixture.flowRequests.push(serialize(options.data));
    return ok(flowsFor(options.data || {}));
  }

  if (method === "POST" && url.endsWith("/network-traffic/find-address")) {
    fixture.findRequests.push(serialize(options.data));

    if (failFind) {
      return new HTTPErrorResponse(
        500,
        { message: "Searching names failed. Try again in a moment." },
        {},
      );
    }

    return ok(findFor(options.data || {}));
  }

  if (method === "POST" && url.endsWith("/network-traffic/usage-summary")) {
    return ok(emptyUsage(options.data || {}));
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

// The production helper, handed the page's i18next instance before it starts.
followLanguageForPage(i18next);

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: "en",
  resources: {
    en: { translation: en },
    de: { translation: de },
    fa: { translation: fa },
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

function AddressNamesSettingsPage() {
  useNavigationHooks();
  return (
    <AddressNamesPage
      {...pageProps(PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES)}
    />
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
        className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-4 sm:px-6"
      >
        <div className="flex items-center gap-5">
          <span className="text-lg font-semibold text-gray-900">OneUptime</span>
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
          <Route
            path={RouteMap[
              PageMap.NETWORK_DEVICE_SETTINGS_ADDRESS_NAMES
            ].toString()}
            element={<AddressNamesSettingsPage />}
          />
        </Route>
        <Route path="*" element={<StubPage />} />
      </Routes>
    </>
  );
}

// As the Dashboard routes (Index.tsx): no transitions for pages to race.
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <FixtureApp />
  </BrowserRouter>,
);
