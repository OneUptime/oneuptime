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
import SnmpWalkCard from "../../App/FeatureSet/Dashboard/src/Components/NetworkDevice/SnmpWalkCard";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import DE from "../../App/FeatureSet/Dashboard/src/Locales/de.json";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiagnostic from "Common/Models/DatabaseModels/NetworkDeviceDiagnostic";
import NetworkDeviceOidTemplate from "Common/Models/DatabaseModels/NetworkDeviceOidTemplate";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import ObjectID from "Common/Types/ObjectID";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";

/*
 * The fixture page: the real SNMP Walk card of a network device, with the
 * API answered from an in-page store (window.__snmpWalkFixture) that the
 * specs read - what a walk was asked for with, what Collect wrote - and
 * move along - a walk the probe has not finished. Nothing else is stubbed.
 *
 *   ?scenario=  done (default) | empty | more | auth | timeout | partial
 *               | running | noprobe | refused | upgrade | nothing | template
 *               | busy
 *   ?role=      owner (default) | viewer | walker
 *   ?frame=     the card's width in pixels, as the device page's side menu
 *               leaves it (430 at a 768-pixel window, 634 at 1024)
 *   ?theme=dark   ?lang=ja|de
 */

const params = new URLSearchParams(window.location.search);
const scenario = params.get("scenario") || "done";
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
const DEVICE_ID = "40000000-0000-4000-8000-000000000001";
const TEMPLATE_ID = "50000000-0000-4000-8000-000000000001";

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
  owner: {
    canWalk: true,
    canEditDevice: true,
    canEditTemplate: true,
    canCreateMonitor: true,
  },
  viewer: {
    canWalk: false,
    canEditDevice: false,
    canEditTemplate: false,
    canCreateMonitor: false,
  },
  walker: {
    canWalk: true,
    canEditDevice: false,
    canEditTemplate: false,
    canCreateMonitor: false,
  },
};
const may = ROLES[role] || ROLES.owner;

const probe = new Probe();
probe._id = PROBE_ID;
probe.name = "Frankfurt DC2 probe";

const device = {
  name: "edge-sw-01",
  hostname: "10.20.0.2",
  monitoringMethod: "Probe",
  probeId: scenario === "noprobe" ? undefined : new ObjectID(PROBE_ID),
  probe: scenario === "noprobe" ? undefined : probe,
  snmpOids: [{ oid: "1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", name: "CPU 5-min %" }],
  oidTemplateId: undefined,
  oidTemplate: undefined,
};

const template = {
  name: "Cisco Catalyst 9300",
  oids: [{ oid: "1.3.6.1.2.1.1.3.0", name: "sysUpTime.0" }],
};

if (scenario === "template") {
  device.oidTemplateId = new ObjectID(TEMPLATE_ID);
  device.oidTemplate = { name: template.name, oids: template.oids };
}

function readDevice() {
  const item = new NetworkDevice();
  item._id = DEVICE_ID;
  Object.assign(item, {
    ...device,
    snmpOids: device.snmpOids.slice(),
    oidTemplate: device.oidTemplate
      ? { name: device.oidTemplate.name, oids: device.oidTemplate.oids.slice() }
      : undefined,
  });
  return item;
}

function row(oid, type, value, extra) {
  return { oid: oid, type: type, value: value, ...(extra || {}) };
}

// What a Catalyst answers, as the probe writes it (SnmpWalkRow).
const SAMPLE_ROWS = [
  row(
    "1.3.6.1.2.1.1.1.0",
    "OctetString",
    "Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a, RELEASE SOFTWARE (fc3)\r\nTechnical Support: http://www.cisco.com/techsupport\r\nCopyright (c) 1986-2023 by Cisco Systems, Inc.",
  ),
  row("1.3.6.1.2.1.1.2.0", "ObjectIdentifier", "1.3.6.1.4.1.9.1.2494"),
  row("1.3.6.1.2.1.1.3.0", "TimeTicks", 104524500),
  row("1.3.6.1.2.1.1.4.0", "OctetString", "netops@acme.example"),
  row("1.3.6.1.2.1.1.5.0", "OctetString", "edge-sw-01"),
  row("1.3.6.1.2.1.1.6.0", "OctetString", "Frankfurt DC2, Raum 3.14"),
  row("1.3.6.1.2.1.1.7.0", "Integer", 6),
  row("1.3.6.1.2.1.2.1.0", "Integer", 3),
  row("1.3.6.1.2.1.2.2.1.2.1", "OctetString", "GigabitEthernet1/0/1"),
  row("1.3.6.1.2.1.2.2.1.2.2", "OctetString", "GigabitEthernet1/0/2"),
  row("1.3.6.1.2.1.2.2.1.2.3", "OctetString", "Vlan100"),
  row("1.3.6.1.2.1.2.2.1.5.1", "Gauge32", 1000000000),
  row("1.3.6.1.2.1.2.2.1.6.1", "OctetString", "00 1A 2B 3C 4D 5E", {
    isHex: true,
  }),
  row("1.3.6.1.2.1.2.2.1.8.1", "Integer", 1),
  row("1.3.6.1.2.1.2.2.1.8.2", "Integer", 2),
  row("1.3.6.1.2.1.2.2.1.10.1", "Counter32", 3418237763),
  row("1.3.6.1.2.1.4.20.1.1.10.20.0.2", "IpAddress", "10.20.0.2"),
  row("1.3.6.1.2.1.25.3.3.1.2.196608", "Integer", 12),
  row("1.3.6.1.2.1.31.1.1.1.6.1", "Counter64", "18446744073709551615"),
  row("1.3.6.1.2.1.31.1.1.1.18.1", "OctetString", "uplink to core-01"),
  row("1.3.6.1.2.1.47.1.1.1.1.11.1", "OctetString", "FOC2318X0ZQ"),
  row("1.3.6.1.4.1.9.9.48.1.1.1.5.1", "Gauge32", 412839216),
  row("1.3.6.1.4.1.9.9.109.1.1.1.1.8.1", "Gauge32", 7),
  row("1.3.6.1.4.1.9.9.13.1.3.1.3.1", "Gauge32", 41),
  row("1.3.6.1.4.1.9.9.999.1.0", "OctetString", ""),
  row("1.3.6.1.4.1.9.9.999.2.0", "Null", null),
];

function isUnder(oid, root) {
  return oid === root || oid.startsWith(`${root}.`);
}

function compareOids(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < Math.max(a.length, b.length); index++) {
    if (a[index] === undefined) {
      return -1;
    }
    if (b[index] === undefined) {
      return 1;
    }
    if (a[index] !== b[index]) {
      return a[index] - b[index];
    }
  }
  return 0;
}

function counters(from, to) {
  const rows = [];
  for (let index = from; index <= to; index++) {
    rows.push(
      row(`1.3.6.1.2.1.2.2.1.10.${index}`, "Counter32", 1000 * index + 7),
    );
  }
  return rows;
}

function result(fields) {
  return {
    rootOid: "1.3.6.1",
    rows: SAMPLE_ROWS,
    stopReason: "complete",
    snmpVersion: "2c",
    requestCount: 4,
    durationInMs: 812,
    ...fields,
  };
}

let nextId = 1;

function diagnosticId() {
  const id = `70000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`;
  nextId++;
  return id;
}

const walks = [];

function walk(fields) {
  const item = {
    id: diagnosticId(),
    status: "Completed",
    statusMessage: undefined,
    createdAt: new Date(Date.now() - 4 * 60 * 1000),
    snmpWalkRootOid: "1.3.6.1",
    snmpWalkAfterOid: undefined,
    snmpWalkResult: undefined,
    ...fields,
  };
  walks.unshift(item);
  return item;
}

if (scenario === "done" || scenario === "template" || scenario === "busy") {
  walk({ snmpWalkResult: result({}) });
} else if (scenario === "more") {
  walk({
    snmpWalkRootOid: "1.3.6.1.2.1.2",
    snmpWalkResult: result({
      rootOid: "1.3.6.1.2.1.2",
      rows: counters(1, 1000),
      stopReason: "oidLimit",
      nextOid: "1.3.6.1.2.1.2.2.1.10.1000",
      requestCount: 41,
      durationInMs: 6120,
    }),
  });
} else if (scenario === "auth") {
  walk({
    snmpWalkResult: result({
      rows: [],
      stopReason: "failed",
      snmpVersion: "3",
      requestCount: 1,
      failure: {
        kind: "authentication",
        authenticationReason: "wrongDigest",
        message: "Wrong Digest (incorrect password, community or key)",
      },
    }),
  });
} else if (scenario === "timeout") {
  walk({
    snmpWalkResult: result({
      rows: [],
      stopReason: "failed",
      requestCount: 1,
      failure: { kind: "timeout", message: "Request timed out" },
    }),
  });
} else if (scenario === "partial") {
  walk({
    snmpWalkResult: result({
      rows: SAMPLE_ROWS.slice(0, 12),
      stopReason: "failed",
      nextOid: SAMPLE_ROWS[11].oid,
      failure: { kind: "timeout", message: "Request timed out" },
    }),
  });
} else if (scenario === "nothing") {
  walk({
    snmpWalkRootOid: "1.3.6.1.2.1.25",
    snmpWalkResult: result({
      rootOid: "1.3.6.1.2.1.25",
      rows: [],
      requestCount: 1,
    }),
  });
} else if (scenario === "running") {
  walk({
    status: "In Progress",
    snmpWalkRootOid: "1.3.6.1.4.1",
    createdAt: new Date(Date.now() - 20 * 1000),
  });
}

const state = {
  // The columns each walk was asked for with, as ModelAPI.create sends them.
  sent: [],
  creates: [],
  // What Collect wrote: { model, data }.
  updates: [],
  polls: 0,
  // While set, a walk the page asked for stays In Progress.
  isProbeBusy: false,
};

// What the probe writes for a walk once it has run it.
function finishWalk(item) {
  if (scenario === "upgrade") {
    item.status = "Failed";
    item.statusMessage =
      "This device's probe runs a version that cannot walk SNMP. Update the probe to the latest version, then walk again.";
    return;
  }

  const root = item.snmpWalkRootOid || "1.3.6.1";

  if (scenario === "more" && item.snmpWalkAfterOid) {
    item.status = "Completed";
    item.snmpWalkResult = result({
      rootOid: root,
      afterOid: item.snmpWalkAfterOid,
      rows: counters(1001, 1200),
      requestCount: 8,
    });
    return;
  }

  const rows = SAMPLE_ROWS.filter((entry) => {
    return (
      isUnder(entry.oid, root) &&
      (!item.snmpWalkAfterOid ||
        compareOids(entry.oid, item.snmpWalkAfterOid) > 0)
    );
  });

  item.status = "Completed";
  item.snmpWalkResult = result({
    rootOid: root,
    afterOid: item.snmpWalkAfterOid,
    rows: rows,
    requestCount: Math.max(1, Math.ceil(rows.length / 25)),
  });
}

function toModel(item) {
  const model = new NetworkDeviceDiagnostic();
  model._id = item.id;
  Object.assign(model, {
    status: item.status,
    statusMessage: item.statusMessage,
    createdAt: item.createdAt,
    snmpWalkRootOid: item.snmpWalkRootOid,
    snmpWalkAfterOid: item.snmpWalkAfterOid,
    snmpWalkResult: item.snmpWalkResult,
  });
  return model;
}

window.__snmpWalkFixture = {
  state: state,
  // The probe finishes every walk still running.
  finishRunning: () => {
    for (const item of walks) {
      if (item.status !== "Completed" && item.status !== "Failed") {
        finishWalk(item);
      }
    }
  },
};

ModelAPI.getItem = async (args) => {
  if (args.modelType === NetworkDevice) {
    return readDevice();
  }

  if (args.modelType === NetworkDeviceOidTemplate) {
    const item = new NetworkDeviceOidTemplate();
    item._id = TEMPLATE_ID;
    item.name = template.name;
    item.oids = template.oids.slice();
    return item;
  }

  if (args.modelType === NetworkDeviceDiagnostic) {
    state.polls++;
    const item = walks.find((entry) => {
      return entry.id === args.id.toString();
    });

    if (!item) {
      return null;
    }

    if (
      !state.isProbeBusy &&
      item.status !== "Completed" &&
      item.status !== "Failed"
    ) {
      finishWalk(item);
    }

    return toModel(item);
  }

  return null;
};

ModelAPI.getList = async (args) => {
  if (args.modelType === NetworkDeviceDiagnostic) {
    const data = walks.slice(0, args.limit).map(toModel);
    return { data: data, count: data.length, skip: 0, limit: args.limit };
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

  if (scenario === "refused") {
    throw new HTTPErrorResponse(
      400,
      {
        message:
          "This device has no SNMP credentials to walk it with. Add a community string or an SNMPv3 user in its Settings, or give it (or its site) an SNMP credential profile.",
      },
      {},
    );
  }

  // Another tab, or another person, is walking the device right now.
  if (scenario === "busy") {
    throw new HTTPErrorResponse(
      400,
      {
        message:
          "This device is already being walked. Wait for that walk to finish, then walk it again.",
      },
      {},
    );
  }

  const item = walk({
    status: "Pending",
    createdAt: new Date(),
    snmpWalkRootOid: model.snmpWalkRootOid,
    snmpWalkAfterOid: model.snmpWalkAfterOid,
  });

  return new HTTPResponse(200, { _id: item.id }, {});
};

ModelAPI.updateById = async (args) => {
  state.updates.push({
    model: args.modelType === NetworkDevice ? "NetworkDevice" : "Template",
    id: args.id.toString(),
    data: JSON.parse(JSON.stringify(args.data)),
  });

  if (args.modelType === NetworkDevice) {
    device.snmpOids = args.data.snmpOids;
  } else {
    template.oids = args.data.oids;
    if (device.oidTemplate) {
      device.oidTemplate = { name: template.name, oids: args.data.oids };
    }
  }

  return new HTTPResponse(200, {}, {});
};

ModelAPI.getCommonHeaders = () => {
  return {};
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
        <SnmpWalkCard
          networkDeviceId={new ObjectID(DEVICE_ID)}
          canWalk={may.canWalk}
          canEditDevice={may.canEditDevice}
          canEditTemplate={may.canEditTemplate}
          canCreateMonitor={may.canCreateMonitor}
        />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")).render(
  <BrowserRouter>
    <Shell />
  </BrowserRouter>,
);
