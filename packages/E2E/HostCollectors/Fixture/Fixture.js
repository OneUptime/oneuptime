/*
 * Offline fixture for adding hosts the way OneUptime does it by default and
 * for the collectors OneUptime manages on them:
 *
 *   - Hosts: the list, its Add Host dialog (the one command, the key, the
 *     live "wait for the host" step) and the showcase an empty list shows;
 *   - Hosts > Collector Configs: the list, OneUptime's defaults, creating one;
 *   - a Collector Config's page: who it is for, config.yaml and its edit
 *     dialog, the Versions list with Put back, the hosts that run it;
 *   - a host's Collector page: a managed host (state, config, Change config,
 *     Try again, the commands on the host) and one set up by hand (the
 *     command that hands it over, the manual guide);
 *   - Hosts > Documentation.
 *
 * The layouts (Page + the Hosts side menus) and the pages are the
 * production components from this branch, mounted under their real RouteMap
 * patterns. Only the data boundary (ModelAPI / API) and the signed-in user
 * are replaced, and a save of a config's YAML is checked by the real
 * HostCollectorConfigPolicy, as the server checks it. Every record is
 * fabricated for an "Acme Infrastructure" workspace.
 *
 * Scenarios, picked with query parameters parsed once at load:
 *
 *   ?hosts=none    the project has no host (four by default: web-01 runs a
 *                  Collector Config, db-01's config failed, win-01 reports a
 *                  collector error, legacy-01 was set up by hand)
 *   ?configs=none  the project has no Collector Config (two by default)
 *   ?keys=none     the project has no ingestion key (one by default)
 *   ?role=member   a Project Member: may read configs, not change them
 *   ?lang=de       the German locale file
 *   ?theme=dark    html.dark (handled by server.js)
 *
 * window.__hostCollectorsFixture:
 *   - register(name, osType): a host's collector registers, as the one
 *     command makes it do: a host with that name is in the project from then
 *     on, managed, with collectorRegisteredAt now;
 *   - state: what the pages sent - creates, updates, deletes - and every
 *     read (listRequests, countRequests, itemRequests), with `unhandled` for
 *     anything the fixture does not model. The spec asserts it is empty.
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
import HostLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Layout";
import HostsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Hosts";
import CollectorConfigsPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/CollectorConfigs";
import CollectorConfigViewPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/CollectorConfigView";
import HostDocumentationPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/Documentation";
import HostViewLayout from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Layout";
import HostCollectorPage from "../../../App/FeatureSet/Dashboard/src/Pages/Host/View/Collector";
import RouteMap from "../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import PageMap from "../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "Common/Models/DatabaseModels/Host";
import HostCollectorConfig from "Common/Models/DatabaseModels/HostCollectorConfig";
import HostCollectorConfigVersion from "Common/Models/DatabaseModels/HostCollectorConfigVersion";
import Label from "Common/Models/DatabaseModels/Label";
import Project from "Common/Models/DatabaseModels/Project";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import User from "Common/Models/DatabaseModels/User";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import {
  HOST_COLLECTOR_CONFIG_CHANGED_NOTE,
  HOST_COLLECTOR_CONFIG_CREATED_NOTE,
  HostCollectorConfigStatus,
  HostCollectorOsType,
  getHostCollectorConfigRestoredNote,
} from "Common/Types/HostCollector/HostCollector";
import { getHostCollectorDefaultConfig } from "Common/Utils/HostCollector/HostCollectorDefaultConfig";
import HostCollectorConfigPolicy from "Common/Server/Utils/HostCollector/HostCollectorConfigPolicy";
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

const hasHosts = params.get("hosts") !== "none";
const hasConfigs = params.get("configs") !== "none";
const hasKeys = params.get("keys") !== "none";
const role = params.get("role") === "member" ? "member" : "owner";
const language = params.get("lang") === "de" ? "de" : "en";

const GLOBAL_PERMISSIONS = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
];
const rolePermissions = [
  ...GLOBAL_PERMISSIONS,
  role === "member" ? Permission.ProjectMember : Permission.ProjectOwner,
];

/*
 * ---------------------------------------------------------------------------
 * Ids and records
 * ---------------------------------------------------------------------------
 */
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";
const projectObjectId = new ObjectID(PROJECT_ID);

function uuid(prefix, number) {
  return `${prefix}-0000-4000-8000-${String(number).padStart(12, "0")}`;
}

const project = Object.assign(new Project(), {
  _id: PROJECT_ID,
  name: "Acme Infrastructure",
});

const USER = Object.assign(new User(), {
  _id: uuid("80000000", 1),
  name: "Sam Patel",
  email: "sam@acme-infrastructure.example",
});

const MINUTE = 60 * 1000;
const now = Date.now();

function ago(minutes) {
  return new Date(now - minutes * MINUTE);
}

// A config's hash, as stable as the server's SHA-256 for what the spec needs.
function hashOf(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `fnv1a-${hash.toString(16).padStart(8, "0")}-${text.length}`;
}

const LABELS = [
  Object.assign(new Label(), {
    _id: uuid("40000000", 1),
    name: "env:production",
    color: "#2563eb",
  }),
  Object.assign(new Label(), {
    _id: uuid("40000000", 2),
    name: "team:web",
    color: "#16a34a",
  }),
];

const LINUX_DEFAULT = getHostCollectorDefaultConfig(HostCollectorOsType.Linux);
const WEB_SERVERS_V2 = LINUX_DEFAULT.replace(
  "collection_interval: 30s",
  "collection_interval: 60s",
);
const WINDOWS_DEFAULT = getHostCollectorDefaultConfig(
  HostCollectorOsType.Windows,
);

const WEB_SERVERS_ID = uuid("50000000", 1);
const WINDOWS_SERVERS_ID = uuid("50000000", 2);

const CONFIGS = hasConfigs
  ? [
      {
        _id: WEB_SERVERS_ID,
        name: "Web servers",
        description: "Host metrics, the journal and nginx logs",
        osType: HostCollectorOsType.Linux,
        labels: [LABELS[0]],
        order: 1,
        configYaml: WEB_SERVERS_V2,
        configHash: hashOf(WEB_SERVERS_V2),
        currentVersionNumber: 2,
        createdAt: ago(3 * 24 * 60),
      },
      {
        _id: WINDOWS_SERVERS_ID,
        name: "Windows servers",
        description: "",
        osType: HostCollectorOsType.Windows,
        labels: [],
        order: 2,
        configYaml: WINDOWS_DEFAULT,
        configHash: hashOf(WINDOWS_DEFAULT),
        currentVersionNumber: 1,
        createdAt: ago(2 * 24 * 60),
      },
    ]
  : [];

const VERSIONS = hasConfigs
  ? [
      {
        _id: uuid("51000000", 1),
        hostCollectorConfigId: WEB_SERVERS_ID,
        versionNumber: 1,
        configYaml: LINUX_DEFAULT,
        configHash: hashOf(LINUX_DEFAULT),
        changeNote: HOST_COLLECTOR_CONFIG_CREATED_NOTE,
        createdByUser: USER,
        createdAt: ago(3 * 24 * 60),
      },
      {
        _id: uuid("51000000", 2),
        hostCollectorConfigId: WEB_SERVERS_ID,
        versionNumber: 2,
        configYaml: WEB_SERVERS_V2,
        configHash: hashOf(WEB_SERVERS_V2),
        changeNote: HOST_COLLECTOR_CONFIG_CHANGED_NOTE,
        createdByUser: USER,
        createdAt: ago(26 * 60),
      },
      {
        _id: uuid("51000000", 3),
        hostCollectorConfigId: WINDOWS_SERVERS_ID,
        versionNumber: 1,
        configYaml: WINDOWS_DEFAULT,
        configHash: hashOf(WINDOWS_DEFAULT),
        changeNote: HOST_COLLECTOR_CONFIG_CREATED_NOTE,
        createdByUser: USER,
        createdAt: ago(2 * 24 * 60),
      },
    ]
  : [];

// What a supervisor reports when the collector does not start with a config.
const FAILED_START = [
  "Collector failed to start with the new config, rolled back to the last working one.",
  "Collector log:",
  '2026-10-21T09:12:03.114Z\tinfo\tservice@v0.161.0/service.go:216\tStarting otelcol-contrib...\t{"Version": "0.161.0"}',
  '2026-10-21T09:12:03.233Z\terror\tgraph/graph.go:439\tFailed to start component\t{"error": "open /var/log/nginx/access.log: permission denied"}',
  'Error: cannot start pipelines: failed to start "filelog/nginx" receiver: open /var/log/nginx/access.log: permission denied',
].join("\n");

function managedHost(fields) {
  return Object.assign(
    {
      osType: "linux",
      hostArch: "amd64",
      agentVersion: "0.161.0",
      otelCollectorStatus: "connected",
      lastSeenAt: ago(1),
      isArchived: false,
      collectorLastContactAt: ago(1),
      collectorRegisteredAt: ago(3 * 24 * 60),
      collectorConfigStatus: HostCollectorConfigStatus.Applied,
      isCollectorHealthy: true,
      isCollectorConfigPinned: false,
      labels: [],
      cpuCores: 4,
      totalMemoryBytes: 16 * 1024 * 1024 * 1024,
      processCount: 180,
      hostIpAddresses: "10.0.0.11",
    },
    fields,
  );
}

const HOSTS = hasHosts
  ? [
      managedHost({
        _id: uuid("30000000", 1),
        name: "web-01",
        hostIdentifier: "web-01",
        collectorInstanceUid: "0190a1c2-77d4-7c11-8a3e-5b1f00000001",
        collectorConfigId: hasConfigs ? WEB_SERVERS_ID : undefined,
        collectorConfigVersionId: hasConfigs ? uuid("51000000", 2) : undefined,
        labels: [LABELS[0]],
      }),
      managedHost({
        _id: uuid("30000000", 2),
        name: "db-01",
        hostIdentifier: "db-01",
        hostIpAddresses: "10.0.0.21",
        collectorInstanceUid: "0190a1c2-77d4-7c11-8a3e-5b1f00000002",
        collectorConfigId: hasConfigs ? WEB_SERVERS_ID : undefined,
        collectorConfigVersionId: hasConfigs ? uuid("51000000", 1) : undefined,
        collectorConfigStatus: HostCollectorConfigStatus.Failed,
        collectorConfigError: FAILED_START,
        collectorFailedConfigHash: hashOf(WEB_SERVERS_V2),
        labels: [LABELS[0]],
      }),
      managedHost({
        _id: uuid("30000000", 3),
        name: "win-01",
        hostIdentifier: "win-01",
        osType: "windows",
        hostIpAddresses: "10.0.0.31",
        collectorInstanceUid: "0190a1c2-77d4-7c11-8a3e-5b1f00000003",
        isCollectorHealthy: false,
        collectorHealthError:
          'Error: failed to export metrics: Post "https://oneuptime.acme-infrastructure.example/otlp/v1/metrics": context deadline exceeded',
      }),
      {
        _id: uuid("30000000", 4),
        name: "legacy-01",
        hostIdentifier: "legacy-01",
        osType: "linux",
        hostArch: "arm64",
        otelCollectorStatus: "connected",
        lastSeenAt: ago(2),
        isArchived: false,
        hostIpAddresses: "10.0.0.41",
        labels: [],
      },
    ]
  : [];

const KEYS = hasKeys
  ? [
      {
        _id: uuid("60000000", 1),
        name: "Hosts key",
        description: "",
        secretKey: "a1b2c3d4-0000-4000-8000-00000000f00d",
        keyType: "Server",
        projectId: projectObjectId,
      },
    ]
  : [];

/*
 * The project's records, by table. The tables the pages read that this
 * project has nothing in are modelled as empty; a read of any other is
 * `unhandled`.
 */
const store = {
  Host: HOSTS,
  HostCollectorConfig: CONFIGS,
  HostCollectorConfigVersion: VERSIONS,
  Label: LABELS,
  TelemetryIngestionKey: KEYS,
  HostOwnerUser: [],
  HostOwnerTeam: [],
  TableView: [],
  Incident: [],
  IncidentState: [],
  Alert: [],
  AlertState: [],
  ScheduledMaintenance: [],
  ScheduledMaintenanceState: [],
  MonitorRecommendation: [],
  // The host's side menu: its recommendations, and the monitors behind them.
  Monitor: [],
  RecommendationDismissal: [],
};

/*
 * ---------------------------------------------------------------------------
 * Recorder
 * ---------------------------------------------------------------------------
 */
const fixture = {
  scenario: { hasHosts, hasConfigs, hasKeys, role, language },
  creates: [],
  updates: [],
  deletes: [],
  countRequests: [],
  listRequests: [],
  itemRequests: [],
  apiRequests: [],
  unhandled: [],
  /*
   * A host's collector registers: the one command ran on it. A host of
   * that name already in the project is that host, handed over to
   * OneUptime (HostService.findOrCreateByHostIdentifier).
   */
  register: (name, osType) => {
    const existing = store.Host.find((host) => {
      return host.hostIdentifier === name;
    });
    if (existing) {
      Object.assign(existing, {
        collectorInstanceUid: "0190a1c2-77d4-7c11-8a3e-5b1f00000999",
        collectorRegisteredAt: new Date(),
        collectorLastContactAt: new Date(),
        collectorConfigStatus: HostCollectorConfigStatus.Waiting,
        isCollectorHealthy: true,
        isCollectorConfigPinned: false,
        agentVersion: "0.161.0",
      });
      return;
    }
    const index = store.Host.length + 1;
    store.Host.push(
      managedHost({
        _id: uuid("30000000", 100 + index),
        name: name,
        hostIdentifier: name,
        osType: osType || "linux",
        lastSeenAt: undefined,
        otelCollectorStatus: undefined,
        collectorInstanceUid: `0190a1c2-77d4-7c11-8a3e-5b1f${String(
          100 + index,
        ).padStart(8, "0")}`,
        collectorRegisteredAt: new Date(),
        collectorLastContactAt: new Date(),
        collectorConfigStatus: HostCollectorConfigStatus.Waiting,
      }),
    );
  },
  // A host's record as the page last saved it, for the spec to read.
  host: (name) => {
    return serialize(
      store.Host.find((host) => {
        return host.name === name;
      }) || null,
    );
  },
  config: (name) => {
    return serialize(
      store.HostCollectorConfig.find((config) => {
        return config.name === name;
      }) || null,
    );
  },
  versions: (configName) => {
    const config = store.HostCollectorConfig.find((candidate) => {
      return candidate.name === configName;
    });
    return serialize(
      store.HostCollectorConfigVersion.filter((version) => {
        return config && version.hostCollectorConfigId === config._id;
      }).map((version) => {
        return {
          versionNumber: version.versionNumber,
          changeNote: version.changeNote,
          configHash: version.configHash,
        };
      }),
    );
  },
};
window.__hostCollectorsFixture = fixture;

function serialize(value) {
  return JSON.parse(JSON.stringify(value === undefined ? null : value));
}

function tableName(modelType) {
  return new modelType().tableName;
}

function idOf(value) {
  return value ? value.toString().toLowerCase() : "";
}

/*
 * ---------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------------
 */

// A stored value and a query's value, compared as the server would.
function matchesValue(stored, wanted) {
  if (wanted instanceof ObjectID) {
    return idOf(stored) === idOf(wanted);
  }

  if (wanted instanceof GreaterThanOrEqual) {
    if (!stored) {
      return false;
    }
    return new Date(stored).getTime() >= new Date(wanted.value).getTime();
  }

  if (
    typeof wanted === "string" ||
    typeof wanted === "boolean" ||
    typeof wanted === "number"
  ) {
    if (typeof wanted === "string" && /^[0-9a-f-]{36}$/i.test(wanted)) {
      return idOf(stored) === idOf(wanted);
    }
    return (stored ?? false) === wanted;
  }

  // The facet chips' richer filters are not set by any test.
  return true;
}

function matches(record, query) {
  for (const [field, wanted] of Object.entries(query || {})) {
    if (field === "projectId") {
      continue;
    }
    if (!matchesValue(record[field], wanted)) {
      return false;
    }
  }
  return true;
}

function sorted(records, sort) {
  const [column, direction] = Object.entries(sort || {})[0] || [];

  if (!column) {
    return records;
  }

  const sign = direction === SortOrder.Descending ? -1 : 1;

  return [...records].sort((first, second) => {
    const a = first[column];
    const b = second[column];
    if (typeof a === "number" && typeof b === "number") {
      return (a - b) * sign;
    }
    if (a instanceof Date || b instanceof Date) {
      return (new Date(a || 0).getTime() - new Date(b || 0).getTime()) * sign;
    }
    return String(a ?? "").localeCompare(String(b ?? "")) * sign;
  });
}

// A host as the API returns it: its config and version as relations.
function withRelations(name, record) {
  if (name === "Host") {
    const config = store.HostCollectorConfig.find((candidate) => {
      return idOf(candidate._id) === idOf(record.collectorConfigId);
    });
    const version = store.HostCollectorConfigVersion.find((candidate) => {
      return idOf(candidate._id) === idOf(record.collectorConfigVersionId);
    });
    return Object.assign({}, record, {
      collectorConfigId: record.collectorConfigId
        ? new ObjectID(record.collectorConfigId)
        : undefined,
      collectorConfig: config
        ? Object.assign(new HostCollectorConfig(), {
            _id: config._id,
            name: config.name,
          })
        : undefined,
      collectorConfigVersion: version
        ? Object.assign(new HostCollectorConfigVersion(), {
            _id: version._id,
            versionNumber: version.versionNumber,
          })
        : undefined,
    });
  }
  return record;
}

function rows(modelType, query, sort) {
  const name = tableName(modelType);
  if (!store[name]) {
    return null;
  }
  return sorted(
    store[name].filter((record) => {
      return matches(record, query);
    }),
    sort,
  ).map((record) => {
    return Object.assign(new modelType(), withRelations(name, record));
  });
}

/*
 * ---------------------------------------------------------------------------
 * Writes, kept as the server keeps them
 * ---------------------------------------------------------------------------
 */

// The server's check of a config's YAML (HostCollectorConfigService).
function refuseConfigYaml(configYaml) {
  if (typeof configYaml !== "string") {
    return;
  }

  if (!configYaml.trim()) {
    throw new HTTPErrorResponse(
      400,
      {
        message:
          "A config cannot be empty. To go back to OneUptime's default, delete the config.",
      },
      {},
    );
  }

  const result = HostCollectorConfigPolicy.check(configYaml);

  if (!result.isValid) {
    throw new HTTPErrorResponse(
      400,
      {
        message: `This config cannot be sent to hosts. ${HostCollectorConfigPolicy.describeProblems(
          result.problems,
        )}`,
      },
      {},
    );
  }
}

// A changed YAML is the next version; an older version's YAML says so.
function writeConfigYaml(config, configYaml) {
  const configHash = hashOf(configYaml);

  if (configHash === config.configHash) {
    return;
  }

  const older = store.HostCollectorConfigVersion.filter((version) => {
    return (
      version.hostCollectorConfigId === config._id &&
      version.configHash === configHash
    );
  }).sort((a, b) => {
    return b.versionNumber - a.versionNumber;
  })[0];

  config.currentVersionNumber = (config.currentVersionNumber || 1) + 1;
  config.configHash = configHash;
  config.configYaml = configYaml;

  store.HostCollectorConfigVersion.push({
    _id: uuid("51000000", 100 + store.HostCollectorConfigVersion.length),
    hostCollectorConfigId: config._id,
    versionNumber: config.currentVersionNumber,
    configYaml: configYaml,
    configHash: configHash,
    changeNote: older
      ? getHostCollectorConfigRestoredNote(older.versionNumber)
      : HOST_COLLECTOR_CONFIG_CHANGED_NOTE,
    createdByUser: USER,
    createdAt: new Date(),
  });
}

function plainValue(value) {
  if (value instanceof ObjectID) {
    return value.toString();
  }
  return value;
}

function applyChanges(name, record, data) {
  if (name === "HostCollectorConfig") {
    refuseConfigYaml(data.configYaml);

    if (typeof data.order === "number") {
      // The list keeps its numbers whole: the rows from there move down one.
      for (const other of store.HostCollectorConfig) {
        if (other !== record && other.order >= data.order) {
          other.order += 1;
        }
      }
    }

    if (Array.isArray(data.labels)) {
      record.labels = data.labels.map((label) => {
        return LABELS.find((candidate) => {
          return idOf(candidate._id) === idOf(label._id || label);
        });
      });
    }

    for (const [key, value] of Object.entries(data)) {
      if (key === "configYaml" || key === "labels" || key === "_id") {
        continue;
      }
      record[key] = plainValue(value);
    }

    if (typeof data.configYaml === "string") {
      writeConfigYaml(record, data.configYaml);
    }
    return;
  }

  for (const [key, value] of Object.entries(data)) {
    if (key === "_id") {
      continue;
    }
    record[key] = plainValue(value);
  }
}

/*
 * ---------------------------------------------------------------------------
 * Identity and data-layer stubs
 * ---------------------------------------------------------------------------
 */
UserUtil.isMasterAdmin = () => {
  return false;
};
UserUtil.isLoggedIn = () => {
  return true;
};
UserUtil.getUserId = () => {
  return new ObjectID(USER._id);
};
UserUtil.getName = () => {
  return USER.name;
};
UserUtil.getEmail = () => {
  return USER.email;
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
        return {
          _type: "UserPermission",
          permission,
          labelIds: [],
          isBlockPermission: false,
        };
      }),
  };
};
ProjectUtil.getCurrentProjectId = () => {
  return projectObjectId;
};
ProjectUtil.getCurrentProject = () => {
  return project;
};
ProjectUtil.getCurrentPlan = () => {
  return null;
};
ModelAPI.getCommonHeaders = () => {
  return { tenantid: PROJECT_ID };
};

ModelAPI.getList = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.listRequests.push({ modelName, query: serialize(options.query) });

  const data = rows(options.modelType, options.query, options.sort);
  if (!data) {
    fixture.unhandled.push({ kind: "getList", modelName });
    return { data: [], count: 0, skip: 0, limit: 0 };
  }
  const skip = Number(options.skip || 0);
  const limit = Number(options.limit || 10);
  return {
    data: data.slice(skip, skip + limit),
    count: data.length,
    skip,
    limit,
  };
};

ModelAPI.count = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.countRequests.push({ modelName, query: serialize(options.query) });

  const data = rows(options.modelType, options.query);
  if (!data) {
    fixture.unhandled.push({ kind: "count", modelName });
    return 0;
  }
  return data.length;
};
ModelAPI.getCount = ModelAPI.count;

ModelAPI.getItem = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.itemRequests.push({ modelName, id: idOf(options.id) });

  const data = rows(options.modelType, {}, undefined);
  if (!data) {
    fixture.unhandled.push({ kind: "getItem", modelName });
    return null;
  }
  return (
    data.find((record) => {
      return idOf(record._id) === idOf(options.id);
    }) || null
  );
};

ModelAPI.updateById = async (options) => {
  const modelName = tableName(options.modelType);
  const data = options.data || {};
  fixture.updates.push({
    modelName,
    id: idOf(options.id),
    data: serialize(data),
  });

  const record = (store[modelName] || []).find((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });

  if (!record) {
    fixture.unhandled.push({ kind: "updateById", modelName });
    throw new HTTPErrorResponse(404, { message: "Not found." }, {});
  }

  applyChanges(modelName, record, data);
  return new HTTPResponse(200, {}, {});
};

ModelAPI.createOrUpdate = async (options) => {
  const modelName = tableName(options.modelType);
  const json = BaseModel.toJSON(options.model, options.modelType);
  const table = store[modelName];

  if (!table) {
    fixture.unhandled.push({ kind: "createOrUpdate", modelName });
    throw new HTTPErrorResponse(404, { message: "Not modelled." }, {});
  }

  if (options.model._id) {
    fixture.updates.push({
      modelName,
      id: idOf(options.model._id),
      data: serialize(json),
    });
    const record = table.find((candidate) => {
      return idOf(candidate._id) === idOf(options.model._id);
    });
    if (!record) {
      throw new HTTPErrorResponse(404, { message: "Not found." }, {});
    }
    applyChanges(modelName, record, json);
    return new HTTPResponse(200, serialize(json), {});
  }

  fixture.creates.push({ modelName, data: serialize(json) });

  if (modelName !== "HostCollectorConfig") {
    fixture.unhandled.push({ kind: "create", modelName });
    throw new HTTPErrorResponse(400, { message: "Not modelled." }, {});
  }

  // What HostCollectorConfigService does with a new config.
  const osType = json.osType || HostCollectorOsType.Linux;
  const configYaml =
    typeof json.configYaml === "string" && json.configYaml.trim()
      ? json.configYaml
      : getHostCollectorDefaultConfig(osType);
  refuseConfigYaml(configYaml);

  const created = {
    _id: uuid("50000000", 10 + table.length),
    name: String(json.name || "").trim(),
    description: json.description || "",
    osType: osType,
    labels: [],
    order: table.length + 1,
    configYaml: configYaml,
    configHash: hashOf(configYaml),
    currentVersionNumber: 1,
    createdAt: new Date(),
  };
  applyChanges(modelName, created, { labels: json.labels || [] });
  table.push(created);
  store.HostCollectorConfigVersion.push({
    _id: uuid("51000000", 200 + store.HostCollectorConfigVersion.length),
    hostCollectorConfigId: created._id,
    versionNumber: 1,
    configYaml: configYaml,
    configHash: created.configHash,
    changeNote: HOST_COLLECTOR_CONFIG_CREATED_NOTE,
    createdByUser: USER,
    createdAt: new Date(),
  });

  return new HTTPResponse(
    200,
    BaseModel.toJSON(
      Object.assign(new HostCollectorConfig(), {
        _id: created._id,
        name: created.name,
        osType: created.osType,
      }),
      HostCollectorConfig,
    ),
    {},
  );
};
ModelAPI.create = ModelAPI.createOrUpdate;

ModelAPI.deleteItem = async (options) => {
  const modelName = tableName(options.modelType);
  fixture.deletes.push({ modelName, id: idOf(options.id) });

  const table = store[modelName] || [];
  const index = table.findIndex((candidate) => {
    return idOf(candidate._id) === idOf(options.id);
  });
  if (index !== -1) {
    table.splice(index, 1);
  }

  if (modelName === "HostCollectorConfig") {
    // The hosts that ran it go back to the list (ON DELETE SET NULL).
    for (const host of store.Host) {
      if (idOf(host.collectorConfigId) === idOf(options.id)) {
        host.collectorConfigId = undefined;
        host.isCollectorConfigPinned = false;
      }
    }
  }
};

async function handleApi(method, options) {
  const url = options.url.toString();
  fixture.apiRequests.push({ method, url });
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

const FixtureHostLayout = withNavigation(HostLayout, PageMap.HOSTS);
const FixtureHosts = withNavigation(HostsPage, PageMap.HOSTS);
const FixtureCollectorConfigs = withNavigation(
  CollectorConfigsPage,
  PageMap.HOST_COLLECTOR_CONFIGS,
);
const FixtureCollectorConfigView = withNavigation(
  CollectorConfigViewPage,
  PageMap.HOST_COLLECTOR_CONFIG_VIEW,
);
const FixtureHostDocumentation = withNavigation(
  HostDocumentationPage,
  PageMap.HOST_DOCUMENTATION,
);
const FixtureHostViewLayout = withNavigation(HostViewLayout, PageMap.HOST_VIEW);
const FixtureHostCollector = withNavigation(
  HostCollectorPage,
  PageMap.HOST_VIEW_DOCUMENTATION,
);

// A page the pages link to that is not modelled: says where it is.
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
          <span className="text-sm text-gray-500">Acme Infrastructure</span>
        </div>
        <span data-testid="synthetic-banner" className="text-xs text-gray-500">
          Preview workspace · Synthetic data
        </span>
      </header>
      <Routes>
        <Route element={<FixtureHostLayout />}>
          <Route
            path={RouteMap[PageMap.HOSTS].toString()}
            element={<FixtureHosts />}
          />
          <Route
            path={RouteMap[PageMap.HOST_COLLECTOR_CONFIGS].toString()}
            element={<FixtureCollectorConfigs />}
          />
          <Route
            path={RouteMap[PageMap.HOST_COLLECTOR_CONFIG_VIEW].toString()}
            element={<FixtureCollectorConfigView />}
          />
          <Route
            path={RouteMap[PageMap.HOST_DOCUMENTATION].toString()}
            element={<FixtureHostDocumentation />}
          />
        </Route>
        <Route element={<FixtureHostViewLayout />}>
          <Route
            path={RouteMap[PageMap.HOST_VIEW_DOCUMENTATION].toString()}
            element={<FixtureHostCollector />}
          />
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
