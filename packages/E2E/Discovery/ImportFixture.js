/*
 * The discovered-devices import, offline (OneUptime issues #4811, #4812,
 * #4813, #4815): two scans at the size the reports describe - one
 * enterprise's 514 point-of-sale registers that answer ping only, and a
 * campus of 300 mixed hosts - and the import API answered in memory, the way
 * the server's import job answers it: an import is recorded, and every time
 * the dialog asks, a few more hosts are settled (devices first, then their
 * monitors), with the failures a test asks for.
 *
 * Nothing here draws random numbers: every host, name and outcome is worked
 * out from its position, so a test reads the same scan every run.
 */
import MonitorTemplate from "Common/Models/DatabaseModels/MonitorTemplate";
import MonitorStatus from "Common/Models/DatabaseModels/MonitorStatus";
import IncidentSeverity from "Common/Models/DatabaseModels/IncidentSeverity";
import AlertSeverity from "Common/Models/DatabaseModels/AlertSeverity";
import NetworkAlertPolicy from "Common/Models/DatabaseModels/NetworkAlertPolicy";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import MonitorType from "Common/Types/Monitor/MonitorType";
import NetworkAlertPolicyBootstrapUtil from "Common/Utils/NetworkDevice/NetworkAlertPolicyBootstrapUtil";
import {
  DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON,
  DISCOVERY_IMPORT_STOPPED_REASON,
  summarizeDiscoveryImportResults,
} from "Common/Types/NetworkDevice/DiscoveryImport";
import {
  buildDeviceName,
  buildNetworkDeviceFromDiscoveredHost,
} from "Common/Utils/NetworkDiscovery/DiscoveredDeviceBuilder";

// The project every fixture record belongs to (Fixture.js).
const PROJECT_ID = "10000000-0000-4000-8000-000000000001";

const pad = (value, length) => {
  return String(value).padStart(length, "0");
};

/*
 * Issue #4811's screenshot: WB Unit Franchise POS registers, two per store,
 * named by Windows (NetBIOS) and by DNS. Every seventeenth store's second
 * register answered nothing that names it, and the first three registers are
 * devices already.
 */
export function buildPosRegisters() {
  const hosts = [];
  for (let store = 0; store < 257; store++) {
    for (let register = 1; register <= 2; register++) {
      const storeNumber = 1100 + store;
      const ipAddress = `10.48.${11 + Math.floor(store / 4)}.${30 + register + (store % 4) * 4}`;
      const isUnnamed = store % 17 === 0 && register === 2;
      const name = `WB${storeNumber}REG${pad(register, 2)}`;
      hosts.push({
        ipAddress,
        snmpReachable: false,
        ...(isUnnamed
          ? { dnsHostnameStatus: "no-record", netbiosNameStatus: "no-reply" }
          : {
              netbiosName: name,
              dnsHostname: `${name.toLowerCase()}.wbz.wbhq.com`,
            }),
        ...(hosts.length < 3 ? { isAlreadyRegistered: true } : {}),
      });
    }
  }
  return hosts;
}

const VENDORS = [
  {
    sysObjectId: "1.3.6.1.4.1.9.1.2494",
    sysDescr:
      "Cisco IOS XE Software, Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4",
  },
  {
    sysObjectId: "1.3.6.1.4.1.2636.1.1.1.2.63",
    sysDescr:
      "Juniper Networks, Inc. ex4300-48p Ethernet Switch, kernel JUNOS 21.4R3",
  },
  {
    sysObjectId: "1.3.6.1.4.1.14823.1.1.37",
    sysDescr: "ArubaOS (MODEL: Aruba7210), Version 8.10.0.6",
  },
  {
    sysObjectId: "1.3.6.1.4.1.41112.1.6",
    sysDescr: "Linux 4.4.153 #1 SMP Ubiquiti UniFi AP",
  },
];

/*
 * A campus: 180 hosts that answered SNMP, named by their sysName, across four
 * vendors; 120 that answered ping only - printers and phones named by DNS,
 * and every fifth one by nothing at all.
 */
export function buildCampusHosts() {
  const hosts = [];
  for (let index = 0; index < 300; index++) {
    const ipAddress = `10.60.${Math.floor(index / 100)}.${10 + (index % 100)}`;
    if (index < 180) {
      const vendor = VENDORS[index % VENDORS.length];
      hosts.push({
        ipAddress,
        snmpReachable: true,
        sysName: `${["core", "dist", "acc", "ap"][index % 4]}-sw-${pad(index + 1, 3)}.corp.example.com`,
        sysObjectId: vendor.sysObjectId,
        sysDescr: vendor.sysDescr,
      });
      continue;
    }
    hosts.push({
      ipAddress,
      snmpReachable: false,
      ...(index % 5 === 0
        ? { dnsHostnameStatus: "no-record" }
        : {
            dnsHostname: `${index % 2 === 0 ? "printer" : "phone"}-${pad(index, 3)}.corp.example.com`,
          }),
    });
  }
  return hosts;
}

const TEMPLATE_IDS = {
  recommended: "60000000-0000-4000-8000-000000000001",
  ping: "60000000-0000-4000-8000-000000000002",
};

const STATUS_IDS = {
  operational: "61000000-0000-4000-8000-000000000001",
  offline: "61000000-0000-4000-8000-000000000002",
};

const SEVERITY_IDS = {
  incident: "62000000-0000-4000-8000-000000000001",
  alert: "63000000-0000-4000-8000-000000000001",
};

function seedIds() {
  return {
    projectId: new ObjectID("10000000-0000-4000-8000-000000000001"),
    incidentSeverityId: new ObjectID(SEVERITY_IDS.incident),
    alertSeverityId: new ObjectID(SEVERITY_IDS.alert),
    onlineMonitorStatusId: new ObjectID(STATUS_IDS.operational),
    offlineMonitorStatusId: new ObjectID(STATUS_IDS.offline),
  };
}

/*
 * The project's Network Device templates: the recommended alert pack, and a
 * "POS ping availability" template with its one reachability check - the
 * customer's own template, the way #4815 describes it.
 */
export function buildTemplates() {
  const recommended =
    NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate(seedIds());
  recommended._id = TEMPLATE_IDS.recommended;

  const ping =
    NetworkAlertPolicyBootstrapUtil.buildRecommendedMonitorTemplate(seedIds());
  ping._id = TEMPLATE_IDS.ping;
  ping.templateName = "POS ping availability";
  ping.templateDescription =
    "An incident when a register stops answering ping.";
  const criteria =
    ping.monitorSteps.data.monitorStepsInstanceArray[0].data.monitorCriteria
      .data;
  criteria.monitorCriteriaInstanceArray =
    criteria.monitorCriteriaInstanceArray.slice(0, 1);
  criteria.monitorCriteriaInstanceArray[0].data.name =
    "Register stops answering";

  return [recommended, ping].map((template) => {
    template.monitorType = MonitorType.NetworkDevice;
    return template;
  });
}

function named(Model, id, fields) {
  const item = new Model();
  Object.assign(item, { _id: id, ...fields });
  return item;
}

export function buildMonitorStatuses() {
  return [
    named(MonitorStatus, STATUS_IDS.operational, {
      name: "Operational",
      color: new Color("#10b981"),
      isOperationalState: true,
      isOfflineState: false,
    }),
    named(MonitorStatus, STATUS_IDS.offline, {
      name: "Offline",
      color: new Color("#ef4444"),
      isOperationalState: false,
      isOfflineState: true,
    }),
  ];
}

export function buildIncidentSeverities() {
  return [
    named(IncidentSeverity, SEVERITY_IDS.incident, {
      name: "Critical",
      color: new Color("#ef4444"),
    }),
  ];
}

export function buildAlertSeverities() {
  return [
    named(AlertSeverity, SEVERITY_IDS.alert, {
      name: "High",
      color: new Color("#f97316"),
    }),
  ];
}

export function buildPolicy(fields) {
  return named(NetworkAlertPolicy, "64000000-0000-4000-8000-000000000001", {
    name: "Alert on every device",
    isEnabled: true,
    scope: {},
    monitorTemplateId: new ObjectID(TEMPLATE_IDS.recommended),
    ...fields,
  });
}

const LATEST_ROUTE =
  /^\/network-device-discovery-import\/scan\/([^/]+)\/latest$/;
const IMPORT_ROUTE =
  /^\/network-device-discovery-import\/import\/([^/]+)(\/stop|\/retry)?$/;

const DEVICE_ID_PREFIX = "70000000-0000-4000-8000-";
const MONITOR_ID_PREFIX = "71000000-0000-4000-8000-";

/*
 * The import API, in memory. `control` is window.__discoveryFixture: its
 * importBatch (hosts settled per ask), failDevices / failMonitors (address
 * -> reason), monitorRoom (monitors the plan has room for), and the record
 * of every import asked for (importStarts) and every ask (importReads).
 *
 * Each device is built the way the server's import builds it - the shared
 * builder, from the scan, with the import's settings - and recorded on
 * control.creates, so a test reads the name, DNS name, name source, vendor
 * template switch and polling interval the server would create.
 */
export function createImportApi(control) {
  let nextId = 1;
  const imports = new Map();
  let deviceCounter = 0;
  let monitorCounter = 0;
  let monitorsCreated = 0;

  const view = (record, all) => {
    const results = record.results;
    const listed = all
      ? results
      : results.filter((result) => {
          return (
            result.device === "Failed" ||
            result.device === "NotReached" ||
            result.monitor === "Failed" ||
            result.monitor === "Skipped"
          );
        });
    return {
      id: record.id,
      scanId: record.scanId,
      status: record.status,
      settings: record.settings,
      ...(record.monitorTemplateName
        ? { monitorTemplateName: record.monitorTemplateName }
        : {}),
      progress: summarizeDiscoveryImportResults(results),
      createdAt: record.createdAt,
      ...(record.completedAt ? { completedAt: record.completedAt } : {}),
      isMine: true,
      createdByUserName: "Ops Engineer",
      ...(record.stopRequested &&
      (record.status === "Running" || record.status === "Queued")
        ? { isStopRequested: true }
        : {}),
      ...(record.retryOf ? { retryOfImportId: record.retryOf } : {}),
      results: listed,
    };
  };

  const settle = (record) => {
    if (record.status === "Queued") {
      record.status = "Running";
      return;
    }
    if (record.status !== "Running") {
      return;
    }
    let budget = control.importBatch;
    for (const result of record.results) {
      if (budget <= 0) {
        break;
      }
      if (record.stopRequested && result.device === "Pending") {
        continue;
      }
      if (result.device === "Pending") {
        budget--;
        const reason = control.failDevices[result.ipAddress];
        if (reason) {
          result.device = "Failed";
          result.deviceError = reason;
          if (result.monitor === "Pending") {
            result.monitor = "Skipped";
            result.monitorError = DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON;
          }
          continue;
        }
        deviceCounter++;
        result.device = control.alreadyAdded[result.ipAddress]
          ? "AlreadyAdded"
          : "Created";
        result.deviceId = `${DEVICE_ID_PREFIX}${pad(deviceCounter, 12)}`;
        const source = record.sourceHosts?.get(result.ipAddress);
        if (result.device === "Created" && source && record.scan) {
          const device = buildNetworkDeviceFromDiscoveredHost({
            projectId: new ObjectID(PROJECT_ID),
            host: source,
            scan: record.scan,
            autoApplyVendorHealthTemplate: record.settings.applyVendorTemplates,
            pollingIntervalInMinutes: record.settings.pollingIntervalInMinutes,
          });
          result.name = device.name || result.name;
          control.creates.push({
            hostname: device.hostname,
            name: device.name,
            autoApplyVendorHealthTemplate:
              device.autoApplyVendorHealthTemplate === true,
            dnsName: device.dnsName || null,
            discoveredName: device.discoveredName || null,
            discoveredNameSource: device.discoveredNameSource || null,
            pollingIntervalInMinutes: device.pollingIntervalInMinutes ?? null,
          });
        }
        continue;
      }
      if (result.monitor === "Pending") {
        budget--;
        const reason = control.failMonitors[result.ipAddress];
        const isBeyondRoom =
          control.monitorRoom !== null &&
          monitorsCreated >= control.monitorRoom;
        if (reason || isBeyondRoom) {
          result.monitor = "Failed";
          result.monitorError =
            reason ||
            "Your plan includes 100 active monitors, and this project has 100. All of its monitors keep running.";
          continue;
        }
        monitorCounter++;
        monitorsCreated++;
        result.monitor = "Created";
        result.monitorId = `${MONITOR_ID_PREFIX}${pad(monitorCounter, 12)}`;
      }
    }
    const isDone = record.results.every(
      (result) => result.device !== "Pending" && result.monitor !== "Pending",
    );
    if (record.stopRequested) {
      for (const result of record.results) {
        if (result.device === "Pending") {
          result.device = "NotReached";
          result.deviceError = DISCOVERY_IMPORT_STOPPED_REASON;
          if (result.monitor === "Pending") {
            result.monitor = "Skipped";
            result.monitorError = DISCOVERY_IMPORT_NO_DEVICE_NO_MONITOR_REASON;
          }
        } else if (result.monitor === "Pending") {
          result.monitor = "Failed";
          result.monitorError = DISCOVERY_IMPORT_STOPPED_REASON;
        }
      }
      record.status = "Stopped";
      record.completedAt = new Date().toISOString();
      return;
    }
    if (isDone) {
      record.status = "Completed";
      record.completedAt = new Date().toISOString();
    }
  };

  const create = (data) => {
    const id = `65000000-0000-4000-8000-${pad(nextId++, 12)}`;
    const scan = control.scanById(data.scanId);
    const record = {
      id,
      scanId: data.scanId,
      status: "Queued",
      settings: data.settings,
      monitorTemplateName: data.monitorTemplateName,
      createdAt: new Date().toISOString(),
      scan,
      sourceHosts: new Map(
        (scan?.discoveredDevices || []).map((host) => {
          return [host.ipAddress, host];
        }),
      ),
      results: data.hosts.map((host) => {
        return {
          ipAddress: host.ipAddress,
          name: host.name,
          isPingOnly: host.isPingOnly,
          device: "Pending",
          monitor:
            data.settings.alerting === "MonitorTemplate"
              ? "Pending"
              : "NotRequested",
        };
      }),
      ...(data.retryOf ? { retryOf: data.retryOf } : {}),
    };
    imports.set(id, record);
    return record;
  };

  return {
    imports,
    seed: (data) => {
      const record = create(data);
      record.status = data.status || "Completed";
      for (const result of record.results) {
        Object.assign(
          result,
          data.outcome ? data.outcome(result) : { device: "Created" },
        );
      }
      record.completedAt = new Date(Date.now() - 5 * 60000).toISOString();
      return record;
    },
    handle: async ({ method, path, body, query }) => {
      if (
        method === "POST" &&
        path === "/network-device-discovery-import/start"
      ) {
        control.importStarts.push(JSON.parse(JSON.stringify(body)));
        if (control.refuseStart) {
          throw new Error(control.refuseStart);
        }
        const scan = control.scanById(body.scanId);
        const wanted = new Set(body.ipAddresses);
        const hosts = (scan?.discoveredDevices || [])
          .filter((host) => wanted.has(host.ipAddress))
          .map((host) => {
            return {
              ipAddress: host.ipAddress,
              // The name the server records at start: the one the row showed.
              name: buildDeviceName(host, scan) || host.ipAddress,
              isPingOnly: host.snmpReachable === false,
            };
          });
        const template = control.templates.find(
          (item) => item._id === body.settings.monitorTemplateId,
        );
        const record = create({
          scanId: body.scanId,
          settings: body.settings,
          hosts,
          monitorTemplateName: template?.templateName,
        });
        return { import: view(record, false) };
      }
      if (
        method === "GET" &&
        path === "/network-device-discovery-import/active"
      ) {
        return {
          imports: [...imports.values()]
            .filter(
              (record) =>
                record.status === "Queued" || record.status === "Running",
            )
            .map((record) => view(record, false)),
        };
      }
      const latest = path.match(LATEST_ROUTE);
      if (method === "GET" && latest) {
        const records = [...imports.values()].filter(
          (record) => record.scanId === latest[1],
        );
        const last = records[records.length - 1];
        return { import: last ? view(last, false) : null };
      }
      const one = path.match(IMPORT_ROUTE);
      if (one) {
        const record = imports.get(one[1]);
        if (!record) {
          throw new Error("This import was not found.");
        }
        if (method === "GET") {
          control.importReads.push(record.id);
          if (!control.holdImports) {
            settle(record);
          }
          return { import: view(record, query.get("results") === "all") };
        }
        if (one[2] === "/stop") {
          record.stopRequested = true;
          if (record.status === "Queued") {
            settle({ ...record, status: "Running" });
            record.status = "Stopped";
          }
          return { import: view(record, false) };
        }
        if (one[2] === "/retry") {
          const retryable = record.results.filter((result) => {
            return (
              result.device === "Failed" ||
              result.device === "NotReached" ||
              result.monitor === "Failed"
            );
          });
          control.importRetries.push(
            retryable.map((result) => result.ipAddress),
          );
          for (const result of retryable) {
            delete control.failDevices[result.ipAddress];
            delete control.failMonitors[result.ipAddress];
            // A device the first import created is found, not created again.
            if (
              result.device === "Created" ||
              result.device === "AlreadyAdded"
            ) {
              control.alreadyAdded[result.ipAddress] = true;
            }
          }
          const retried = create({
            scanId: record.scanId,
            settings: record.settings,
            monitorTemplateName: record.monitorTemplateName,
            retryOf: record.id,
            hosts: retryable,
          });
          return { import: view(retried, false) };
        }
      }
      return null;
    },
  };
}
