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
import PacketCapturesTable from "../../App/FeatureSet/Dashboard/src/Components/PacketCapture/PacketCapturesTable";
import DevicePacketCaptures from "../../App/FeatureSet/Dashboard/src/Components/PacketCapture/DevicePacketCaptures";
import JA from "../../App/FeatureSet/Dashboard/src/Locales/ja.json";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import PacketCapture from "Common/Models/DatabaseModels/PacketCapture";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
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
 * The fixture page: the real packet capture components, with the API
 * answered from an in-page store (window.__packetCaptureFixture) that the
 * specs read - what was created, stopped, downloaded - and move along - a
 * capture the probe picked up, one that finished. Nothing else is stubbed.
 *
 *   ?view=  ready (default) | off | notreported | notool | global
 *           | device | device-noprobe
 *   ?role=  admin (default) | member | starter | downloader
 *   ?theme=dark   ?lang=ja
 */

const params = new URLSearchParams(window.location.search);
const view = params.get("view") || "ready";
const role = params.get("role") || "admin";
const language = params.get("lang") === "ja" ? "ja" : "en";

if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
}

await i18next.use(initReactI18next).init({
  lng: language,
  fallbackLng: language,
  resources: {
    en: { translation: {} },
    ja: { translation: JA },
  },
  interpolation: { escapeValue: false },
  keySeparator: false,
  nsSeparator: false,
});

const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const PROBE_ID = "30000000-0000-4000-8000-000000000001";
const DEVICE_ID = "40000000-0000-4000-8000-000000000001";

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

const ROLES = {
  admin: [Permission.ProjectOwner, Permission.ProjectAdmin],
  member: [Permission.ProjectMember],
  starter: [Permission.ProjectMember, Permission.CreatePacketCapture],
  downloader: [Permission.ProjectMember, Permission.DownloadPacketCapture],
};
const granted = ROLES[role] || ROLES.admin;

PermissionUtil.getAllPermissions = () => {
  return granted;
};
PermissionUtil.getProjectPermissions = () => {
  return {
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: granted.map((permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    }),
  };
};
PermissionUtil.getGlobalPermissions = () => {
  return null;
};

const READY = {
  isEnabled: true,
  isToolAvailable: true,
  toolVersion: "tcpdump version 4.99.3",
  interfaces: [
    { name: "any", addresses: [], isUp: true, isLoopback: false },
    {
      name: "ens192",
      addresses: ["10.20.0.15/24"],
      isUp: true,
      isLoopback: false,
    },
    { name: "ens224", addresses: [], isUp: true, isLoopback: false },
    { name: "ens256", addresses: [], isUp: false, isLoopback: false },
  ],
  limits: {
    maxDurationInSeconds: 1800,
    maxPackets: 1000000,
    maxFileSizeInMB: 25,
  },
};

const REPORTS = {
  off: {
    isEnabled: false,
    isToolAvailable: false,
    interfaces: [],
    limits: READY.limits,
  },
  notreported: undefined,
  notool: { ...READY, isToolAvailable: false },
};

const probe = new Probe();
probe._id = PROBE_ID;
probe.name = "Contoso HQ probe";
probe.projectId = new ObjectID(PROJECT_ID);
probe.isGlobalProbe = view === "global";
probe.packetCaptureCapability = view in REPORTS ? REPORTS[view] : READY;

const alice = new User();
alice.name = "Alice Martin";

function captureRow(index, fields) {
  const item = new PacketCapture();
  Object.assign(item, {
    _id: `60000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    projectId: new ObjectID(PROJECT_ID),
    probeId: new ObjectID(PROBE_ID),
    probe: probe,
    interfaceName: "ens224",
    bpfFilter: "host 10.20.0.31 and udp port 5060",
    maxDurationInSeconds: 300,
    maxPackets: 100000,
    maxFileSizeInMB: 10,
    createdAt: new Date(Date.now() - (index + 1) * 7 * 60 * 1000),
    createdByUser: alice,
    ...fields,
  });
  return item;
}

const hasHistory = view === "ready" || view === "device" || view === "notool";

const state = {
  captures: hasHistory
    ? [
        captureRow(1, {
          status: "Running",
          interfaceName: "any",
          bpfFilter: "host 10.20.0.1",
          maxDurationInSeconds: 120,
          startedAt: new Date(Date.now() - 47 * 1000),
          createdAt: new Date(Date.now() - 50 * 1000),
        }),
        captureRow(2, {
          status: "Completed",
          endReason: "DurationReached",
          packetCount: 18342,
          fileSizeInBytes: 4912345,
          networkDeviceId: new ObjectID(DEVICE_ID),
        }),
        captureRow(3, {
          status: "Completed",
          bpfFilter: "icmp or icmp6",
          endReason: "StoppedFromDashboard",
          packetCount: 0,
          fileSizeInBytes: 0,
        }),
        captureRow(4, {
          status: "Failed",
          interfaceName: "ens256",
          bpfFilter: "",
          statusMessage:
            'The interface "ens256" is down. tcpdump said: ens256: That device is not up',
        }),
      ]
    : [],
  created: [],
  stops: [],
  downloads: [],
  deletes: [],
  listReads: 0,
  refuseNextCreate: null,
};

// A pcap file of two packets, as the probe would have uploaded it.
function pcapBase64() {
  const bytes = new Uint8Array(24 + 2 * (16 + 60));
  const view32 = new DataView(bytes.buffer);
  view32.setUint32(0, 0xa1b2c3d4, true);
  view32.setUint16(4, 2, true);
  view32.setUint16(6, 4, true);
  view32.setUint32(16, 262144, true);
  view32.setUint32(20, 1, true);
  for (let index = 0; index < 2; index++) {
    const offset = 24 + index * 76;
    view32.setUint32(offset + 8, 60, true);
    view32.setUint32(offset + 12, 60, true);
  }
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function matches(item, query) {
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) {
      continue;
    }
    if (String(item[key] || "") !== String(value)) {
      return false;
    }
  }
  return true;
}

function copy(item) {
  return Object.assign(new PacketCapture(), item);
}

window.__packetCaptureFixture = {
  state: state,
  // What the probe and the server did meanwhile.
  update: (id, fields) => {
    const item = state.captures.find((capture) => {
      return capture.id.toString() === id;
    });
    Object.assign(item, fields);
  },
  lastCreatedId: () => {
    const last = state.captures[0];
    return last ? last.id.toString() : null;
  },
};

ModelAPI.getList = async (args) => {
  if (args.modelType === PacketCapture) {
    state.listReads++;
    const data = state.captures
      .filter((item) => {
        return matches(item, args.query);
      })
      .map(copy);
    return { data: data, count: data.length, skip: 0, limit: args.limit };
  }
  return { data: [], count: 0, skip: 0, limit: args.limit };
};

ModelAPI.count = async (args) => {
  return state.captures.filter((item) => {
    return matches(item, args.query);
  }).length;
};

ModelAPI.getItem = async (args) => {
  if (args.modelType === NetworkDevice) {
    const device = new NetworkDevice();
    device._id = DEVICE_ID;
    device.hostname = "10.20.0.31";
    if (view !== "device-noprobe") {
      device.probeId = new ObjectID(PROBE_ID);
      device.probe = probe;
    }
    return device;
  }
  return probe;
};

ModelAPI.getCommonHeaders = () => {
  return {};
};

ModelAPI.create = async (args) => {
  if (state.refuseNextCreate) {
    const message = state.refuseNextCreate;
    state.refuseNextCreate = null;
    throw new HTTPErrorResponse(400, { message: message }, {});
  }

  const model = args.model;
  state.created.push({
    probeId: model.probeId ? model.probeId.toString() : null,
    networkDeviceId: model.networkDeviceId
      ? model.networkDeviceId.toString()
      : null,
    interfaceName: model.interfaceName,
    bpfFilter: model.bpfFilter,
    maxDurationInSeconds: model.maxDurationInSeconds,
    maxPackets: model.maxPackets,
    maxFileSizeInMB: model.maxFileSizeInMB,
  });

  const row = captureRow(100 + state.created.length, {
    interfaceName: model.interfaceName,
    bpfFilter: model.bpfFilter,
    maxDurationInSeconds: model.maxDurationInSeconds,
    maxPackets: model.maxPackets,
    maxFileSizeInMB: model.maxFileSizeInMB,
    networkDeviceId: model.networkDeviceId,
    status: "Pending",
    createdAt: new Date(),
  });
  state.captures.unshift(row);

  return new HTTPResponse(200, {}, {});
};

ModelAPI.deleteItem = async (args) => {
  state.deletes.push(args.id.toString());
  state.captures = state.captures.filter((item) => {
    return item.id.toString() !== args.id.toString();
  });
};

API.post = async (options) => {
  const url = options.url.toString();
  const id = url.split("/packet-capture/")[1]?.split("/")[0];

  if (url.endsWith("/stop")) {
    state.stops.push(id);
    window.__packetCaptureFixture.update(id, { stopRequestedAt: new Date() });
    return new HTTPResponse(200, { result: "ok" }, {});
  }

  if (url.endsWith("/download")) {
    state.downloads.push(id);
    return new HTTPResponse(
      200,
      {
        fileName:
          "packet-capture-contoso-hq-probe-ens224-2026-10-09T08-30-00Z.pcap",
        fileType: "application/vnd.tcpdump.pcap",
        sizeInBytes: 176,
        base64: pcapBase64(),
      },
      {},
    );
  }

  return new HTTPResponse(200, {}, {});
};

function Shell() {
  Navigation.setNavigateHook(useNavigate());
  Navigation.setLocation(useLocation());
  Navigation.setParams(useParams());

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-6 sm:px-8">
      <div className="mx-auto max-w-6xl space-y-6" data-testid="fixture-page">
        {view.startsWith("device") ? (
          <DevicePacketCaptures networkDeviceId={new ObjectID(DEVICE_ID)} />
        ) : (
          <PacketCapturesTable probe={probe} />
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
