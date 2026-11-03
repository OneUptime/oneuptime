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
import MultiDeviceSnmpWalkCard from "../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkCard";
import {
  MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM,
  MULTI_DEVICE_SNMP_WALK_OID_PARAM,
  parseMultiDeviceSnmpWalkQuery,
} from "../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/MultiDeviceSnmpWalkViewModel";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "Common/Models/DatabaseModels/Label";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * The fixture page: the real card of the Network's SNMP Walk page (issue
 * #5548), with the API answered from an in-page store
 * (window.__multiDeviceSnmpWalkFixture) that the specs read - what each
 * walk was asked for with, what Collect wrote - and move along. Nothing else
 * is stubbed: the card parses the address, asks for the walks, reads them
 * back and compares what the devices answered as it would in production.
 *
 * Seven Meraki routers, each in a state a fleet has:
 *
 *   mx-amsterdam  answers everything
 *   mx-berlin     answers everything but sysLocation
 *   mx-cardiff    has no SNMP credentials: the server refuses its walk
 *   mx-dublin     has no probe: the page does not ask for its walk
 *   mx-edinburgh  does not answer: its walk fails with a timeout
 *   mx-frankfurt  linked to the "Edge routers" template; its walk stops at
 *                 its limit after sysName, so it never reads sysLocation
 *   mx-geneva     answers everything, but is monitor-backed: nothing is
 *                 collected on it
 *
 *   ?devices= &oid=  what the page's address names, as in production
 *   ?scenario=  fleet (default) | walked (the last walk of the devices the
 *               address names, read back as after a reload)
 *   ?role=      owner (default) | viewer | walker
 *   ?frame=     the card's width in pixels
 *   ?theme=dark   ?lang=ja|de
 */

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") || "fleet";
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
const PROBE_ID = "30000000-0000-4000-8000-000000000001";
const TEMPLATE_ID = "50000000-0000-4000-8000-000000000001";
const LABEL_ID = "60000000-0000-4000-8000-000000000001";

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

// What each role may do on the page, as the page's permission gates say.
const ROLES = {
  owner: { canWalk: true, canEditDevice: true, canEditTemplate: true },
  viewer: { canWalk: false, canEditDevice: false, canEditTemplate: false },
  walker: { canWalk: true, canEditDevice: false, canEditTemplate: false },
};
const may = ROLES[role] || ROLES.owner;

const probe = new Probe();
probe._id = PROBE_ID;
probe.name = "Frankfurt DC2 probe";

function deviceId(index) {
  return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const SYS_DESCR = "1.3.6.1.2.1.1.1.0";
const SYS_OBJECT_ID = "1.3.6.1.2.1.1.2.0";
const SYS_UP_TIME = "1.3.6.1.2.1.1.3.0";
const SYS_CONTACT = "1.3.6.1.2.1.1.4.0";
const SYS_NAME = "1.3.6.1.2.1.1.5.0";
const SYS_LOCATION = "1.3.6.1.2.1.1.6.0";
const MERAKI_STATUS = "1.3.6.1.4.1.29671.1.1.4.1.3.1";
const MERAKI_CLIENTS = "1.3.6.1.4.1.29671.1.1.4.1.5.1";

const template = {
  name: "Edge routers",
  oids: [{ oid: SYS_UP_TIME, name: "sysUpTime.0" }],
};

const devices = [
  {
    id: deviceId(1),
    name: "mx-amsterdam",
    city: "Amsterdam, Herengracht 182",
    uptime: 104524500,
    clients: 41,
    answers: "all",
  },
  {
    id: deviceId(2),
    name: "mx-berlin",
    city: "",
    uptime: 8640000,
    clients: 17,
    answers: "noLocation",
  },
  {
    id: deviceId(3),
    name: "mx-cardiff",
    answers: "noCredentials",
  },
  { id: deviceId(4), name: "mx-dublin", answers: "noProbe" },
  { id: deviceId(5), name: "mx-edinburgh", answers: "silent" },
  {
    id: deviceId(6),
    name: "mx-frankfurt",
    city: "Frankfurt DC2, Raum 3.14",
    uptime: 30000,
    clients: 88,
    answers: "limit",
    templateId: TEMPLATE_ID,
  },
  {
    id: deviceId(7),
    name: "mx-geneva",
    city: "Geneva, Rue du Rhône 14",
    uptime: 451234500,
    clients: 9,
    answers: "all",
    monitorBacked: true,
  },
].map((entry) => {
  return { snmpOids: [], ...entry };
});

function readDevice(entry) {
  const item = new NetworkDevice();
  item._id = entry.id;
  Object.assign(item, {
    name: entry.name,
    monitoringMethod: entry.monitorBacked ? "Monitor" : "Probe",
    probeId: entry.answers === "noProbe" ? undefined : new ObjectID(PROBE_ID),
    probe: entry.answers === "noProbe" ? undefined : probe,
    snmpOids: entry.snmpOids.slice(),
    oidTemplateId: entry.templateId ? new ObjectID(entry.templateId) : undefined,
    oidTemplate: entry.templateId
      ? { name: template.name, oids: template.oids.slice() }
      : undefined,
  });
  return item;
}

function row(oid, type, value, extra) {
  return { oid: oid, type: type, value: value, ...(extra || {}) };
}

// What a device answers under the whole tree, as the probe writes it.
function rowsOf(entry) {
  const rows = [
    row(
      SYS_DESCR,
      "OctetString",
      "Meraki MX67 Cloud Managed Security Appliance",
    ),
    row(SYS_OBJECT_ID, "ObjectIdentifier", "1.3.6.1.4.1.29671.2.109"),
    row(SYS_UP_TIME, "TimeTicks", entry.uptime),
    row(SYS_CONTACT, "OctetString", "netops@acme.example"),
    row(SYS_NAME, "OctetString", entry.name),
  ];

  if (entry.answers !== "noLocation") {
    rows.push(row(SYS_LOCATION, "OctetString", entry.city));
  }

  rows.push(row(MERAKI_STATUS, "Integer", 1));
  rows.push(row(MERAKI_CLIENTS, "Gauge32", entry.clients));

  return rows;
}

function isUnder(oid, root) {
  return oid === root || oid.startsWith(`${root}.`);
}

function result(entry, root) {
  const base = {
    rootOid: root,
    snmpVersion: "2c",
    requestCount: 2,
    durationInMs: 640,
  };

  if (entry.answers === "silent") {
    return {
      ...base,
      rows: [],
      stopReason: "failed",
      requestCount: 1,
      failure: { kind: "timeout", message: "Request timed out" },
    };
  }

  const rows = rowsOf(entry).filter((item) => {
    return isUnder(item.oid, root);
  });

  if (entry.answers === "limit") {
    const upToName = rows.filter((item) => {
      return item.oid <= SYS_NAME && item.oid.startsWith("1.3.6.1.2.1.1.");
    });
    const kept = upToName.length > 0 ? upToName : rows.slice(0, 1);

    return {
      ...base,
      rows: kept,
      stopReason: kept.length < rows.length ? "oidLimit" : "complete",
      nextOid:
        kept.length < rows.length ? kept[kept.length - 1].oid : undefined,
    };
  }

  return { ...base, rows: rows, stopReason: "complete" };
}

let nextId = 1 + Math.floor(Date.now() % 100000) * 100;

function newDiagnosticId() {
  const id = `70000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
  nextId++;
  return id;
}

/*
 * The walks are the server's: kept across a reload of the page, as the
 * server keeps them two days, so a reload reads the same walk back.
 */
const WALKS_KEY = "multi-device-snmp-walk-fixture-walks";

function loadWalks() {
  try {
    return JSON.parse(sessionStorage.getItem(WALKS_KEY) || "[]").map(
      (item) => {
        return { ...item, createdAt: new Date(item.createdAt) };
      },
    );
  } catch {
    return [];
  }
}

function saveWalks() {
  try {
    sessionStorage.setItem(WALKS_KEY, JSON.stringify(walks));
  } catch {
    // A store that cannot be written keeps the walks for this page only.
  }
}

const walks = scenario === "walked" ? [] : loadWalks();

const state = {
  // What each walk was asked for with, as ModelAPI.create sends it.
  sent: [],
  creates: [],
  // What Collect wrote: { model, id, data }.
  updates: [],
  polls: 0,
  // Devices whose walks stay on their way until finishRunning is called.
  slowDeviceIds: [],
};

function finishWalk(item) {
  const entry = devices.find((candidate) => {
    return candidate.id === item.networkDeviceId;
  });

  item.status = "Completed";
  item.snmpWalkResult = result(entry, item.snmpWalkRootOid || "1.3.6.1");
  saveWalks();
}

if (scenario === "walked") {
  const query = parseMultiDeviceSnmpWalkQuery({
    devices: params.get(MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM),
    oid: params.get(MULTI_DEVICE_SNMP_WALK_OID_PARAM),
  });

  for (const id of query.deviceIds) {
    const entry = devices.find((candidate) => {
      return candidate.id === id;
    });

    if (!entry || entry.answers === "noProbe" || entry.answers === "noCredentials") {
      continue;
    }

    const item = {
      id: newDiagnosticId(),
      networkDeviceId: entry.id,
      status: "Pending",
      statusMessage: undefined,
      createdAt: new Date(Date.now() - 2 * 60 * 1000),
      snmpWalkRootOid: query.startOid || "1.3.6.1",
      snmpWalkAfterOid: undefined,
      snmpWalkResult: undefined,
    };
    finishWalk(item);
    walks.push(item);
  }
}

function toModel(item) {
  const model = new NetworkDeviceDiagnostic();
  model._id = item.id;
  Object.assign(model, {
    networkDeviceId: new ObjectID(item.networkDeviceId),
    status: item.status,
    statusMessage: item.statusMessage,
    createdAt: item.createdAt,
    snmpWalkRootOid: item.snmpWalkRootOid,
    snmpWalkAfterOid: item.snmpWalkAfterOid,
    snmpWalkResult: item.snmpWalkResult,
  });
  return model;
}

function idsIn(value) {
  if (value instanceof Includes) {
    return value.values.map((id) => {
      return id.toString();
    });
  }

  return value === undefined || value === null ? [] : [value.toString()];
}

window.__multiDeviceSnmpWalkFixture = {
  state: state,
  // The probes finish every walk still on its way.
  finishRunning: () => {
    state.slowDeviceIds = [];
    for (const item of walks) {
      if (item.status !== "Completed" && item.status !== "Failed") {
        finishWalk(item);
      }
    }
  },
};

ModelAPI.getItem = async (args) => {
  if (args.modelType === NetworkDeviceOidTemplate) {
    const item = new NetworkDeviceOidTemplate();
    item._id = TEMPLATE_ID;
    item.name = template.name;
    item.oids = template.oids.slice();
    return item;
  }

  return null;
};

ModelAPI.getList = async (args) => {
  const query = args.query || {};

  if (args.modelType === NetworkDevice) {
    const ids = idsIn(query._id);
    const search = query.name ? String(query.name.value || "") : "";
    const data = devices
      .filter((entry) => {
        if (ids.length > 0) {
          return ids.includes(entry.id);
        }

        return entry.name.toLowerCase().includes(search.toLowerCase());
      })
      .map(readDevice);

    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  if (args.modelType === NetworkDeviceDiagnostic) {
    // The last walk, found again after a reload.
    if (query.networkDeviceId !== undefined) {
      const deviceIds = idsIn(query.networkDeviceId);
      const data = walks
        .filter((item) => {
          return (
            deviceIds.includes(item.networkDeviceId) &&
            item.snmpWalkRootOid === query.snmpWalkRootOid
          );
        })
        .slice(0, args.limit)
        .map(toModel);

      return { data: data, count: data.length, skip: 0, limit: args.limit };
    }

    // The walks still on their way, read back: each probe answers.
    state.polls++;
    const ids = idsIn(query._id);
    const data = walks
      .filter((item) => {
        return ids.includes(item.id);
      })
      .map((item) => {
        if (
          item.status !== "Completed" &&
          item.status !== "Failed" &&
          !state.slowDeviceIds.includes(item.networkDeviceId)
        ) {
          finishWalk(item);
        }

        return toModel(item);
      });

    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }

  if (args.modelType === Label) {
    const label = new Label();
    label._id = LABEL_ID;
    label.name = "Type: Router";
    return { data: [label], count: 1, skip: 0, limit: args.limit };
  }

  return { data: [], count: 0, skip: 0, limit: args.limit };
};

ModelAPI.create = async (args) => {
  const model = args.model;
  state.sent.push(Object.keys(BaseModel.toJSON(model, args.modelType)).sort());
  state.creates.push({
    networkDeviceId: model.networkDeviceId
      ? model.networkDeviceId.toString()
      : null,
    diagnosticType: model.diagnosticType,
    snmpWalkRootOid: model.snmpWalkRootOid,
    snmpWalkAfterOid: model.snmpWalkAfterOid || null,
  });

  const entry = devices.find((candidate) => {
    return candidate.id === model.networkDeviceId.toString();
  });

  if (entry.answers === "noCredentials") {
    throw new HTTPErrorResponse(
      400,
      {
        message:
          "This device has no SNMP credentials to walk it with. Add a community string or an SNMPv3 user in its Settings, or give it (or its site) an SNMP credential profile.",
      },
      {},
    );
  }

  const item = {
    id: newDiagnosticId(),
    networkDeviceId: entry.id,
    status: "Pending",
    statusMessage: undefined,
    createdAt: new Date(),
    snmpWalkRootOid: model.snmpWalkRootOid,
    snmpWalkAfterOid: undefined,
    snmpWalkResult: undefined,
  };
  walks.unshift(item);
  saveWalks();

  return new HTTPResponse(200, { _id: item.id }, {});
};

ModelAPI.updateById = async (args) => {
  state.updates.push({
    model: args.modelType === NetworkDevice ? "NetworkDevice" : "Template",
    id: args.id.toString(),
    data: JSON.parse(JSON.stringify(args.data)),
  });

  if (args.modelType === NetworkDevice) {
    const entry = devices.find((candidate) => {
      return candidate.id === args.id.toString();
    });
    entry.snmpOids = args.data.snmpOids;
  } else {
    template.oids = args.data.oids;
  }

  return new HTTPResponse(200, {}, {});
};

ModelAPI.getCommonHeaders = () => {
  return {};
};

/*
 * As the page does (Pages/NetworkDevice/SnmpWalk.tsx): the walk is read from
 * the address once, and written back in place when a walk starts.
 */
const initialQuery = parseMultiDeviceSnmpWalkQuery({
  devices: params.get(MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM),
  oid: params.get(MULTI_DEVICE_SNMP_WALK_OID_PARAM),
});

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
        <MultiDeviceSnmpWalkCard
          initialQuery={initialQuery}
          canWalk={may.canWalk}
          canEditDevice={may.canEditDevice}
          canEditTemplate={may.canEditTemplate}
          onQueryChange={(query) => {
            Navigation.setQueryString({
              [MULTI_DEVICE_SNMP_WALK_DEVICES_PARAM]: query.deviceIds.join(","),
              [MULTI_DEVICE_SNMP_WALK_OID_PARAM]: query.startOid,
            });
          }}
        />
      </div>
    </div>
  );
}

/*
 * Navigates as the Dashboard does (its src/Index.tsx): each navigation renders
 * at once, not in a React transition (Tests/Ops/E2EFixtureRouters).
 */
createRoot(document.getElementById("root")).render(
  <BrowserRouter useTransitions={false}>
    <Shell />
  </BrowserRouter>,
);
