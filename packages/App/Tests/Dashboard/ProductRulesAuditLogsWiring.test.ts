import { describe, expect, jest, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  getRuleAuditLogResourceTypes,
  RULE_AUDIT_LOGS_WORDS,
  RuleModelType,
} from "../../FeatureSet/Dashboard/src/Components/AuditLogs/RuleAuditLogTypes";
import {
  getPageSearchAreas,
  PageSearchArea,
  PageSearchPage,
  PageSearchSection,
} from "../../FeatureSet/Dashboard/src/Components/CommandPalette/PageSearchIndex";
import {
  ALERT_RULE_MODEL_TYPES,
  getAlertRuleResourceTypes,
} from "../../FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertRuleAuditLogTypes";
import {
  getIncidentRuleResourceTypes,
  INCIDENT_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentRuleAuditLogTypes";
import {
  getMonitorRuleResourceTypes,
  MONITOR_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorRuleAuditLogTypes";
import {
  getScheduledMaintenanceRuleResourceTypes,
  SCHEDULED_MAINTENANCE_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceRuleAuditLogTypes";
import {
  getStatusPageRuleResourceTypes,
  STATUS_PAGE_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageRuleAuditLogTypes";
import {
  getServiceRuleResourceTypes,
  SERVICE_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Service/Settings/RuleAuditLogTypes";
import {
  getHostRuleResourceTypes,
  HOST_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Host/Settings/RuleAuditLogTypes";
import {
  getKubernetesRuleResourceTypes,
  KUBERNETES_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Kubernetes/Settings/RuleAuditLogTypes";
import {
  DOCKER_RULE_MODEL_TYPES,
  getDockerRuleResourceTypes,
} from "../../FeatureSet/Dashboard/src/Pages/Docker/Settings/RuleAuditLogTypes";
import {
  DOCKER_SWARM_RULE_MODEL_TYPES,
  getDockerSwarmRuleResourceTypes,
} from "../../FeatureSet/Dashboard/src/Pages/DockerSwarm/Settings/RuleAuditLogTypes";
import {
  getPodmanRuleResourceTypes,
  PODMAN_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Podman/Settings/RuleAuditLogTypes";
import {
  getProxmoxRuleResourceTypes,
  PROXMOX_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Proxmox/Settings/RuleAuditLogTypes";
import {
  getOpenStackRuleResourceTypes,
  OPENSTACK_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/OpenStack/Settings/RuleAuditLogTypes";
import {
  getVMwareRuleResourceTypes,
  VMWARE_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/VMware/Settings/RuleAuditLogTypes";
import {
  CEPH_RULE_MODEL_TYPES,
  getCephRuleResourceTypes,
} from "../../FeatureSet/Dashboard/src/Pages/Ceph/Settings/RuleAuditLogTypes";
import {
  getStorageArrayRuleResourceTypes,
  STORAGE_ARRAY_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/StorageArray/Settings/RuleAuditLogTypes";
import {
  getNetworkRuleResourceTypes,
  NETWORK_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/NetworkDevice/Settings/RuleAuditLogTypes";
import {
  getIoTRuleResourceTypes,
  IOT_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/IoT/Settings/RuleAuditLogTypes";
import {
  getRunbookRuleResourceTypes,
  RUNBOOK_RULE_MODEL_TYPES,
} from "../../FeatureSet/Dashboard/src/Pages/Runbook/Settings/RuleAuditLogTypes";
import PageMap from "../../FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../FeatureSet/Dashboard/src/Utils/RouteMap";
import AllModelTypes from "Common/Models/DatabaseModels/Index";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import RunbookRule from "Common/Models/DatabaseModels/RunbookRule";
import Route from "Common/Types/API/Route";
import RunbookRuleTriggerEntity from "Common/Types/Runbook/RunbookRuleTriggerEntity";
import { getApiSingularName } from "Common/Utils/ModelApiName";

/*
 * EVERY PRODUCT'S RULES HAVE AN AUDIT LOGS PAGE (#10462), AS ALERTS > RULES
 * HAS (#10290).
 *
 * Most rules are rows on their list, with no page of their own to hang an
 * Audit Logs page off, so each product's rules keep their history on one
 * page at the end of the menu section that lists them: "Audit Logs" in a
 * Rules section, "Rule Audit Logs" in a Settings section that holds the
 * product's owner and label rules. A page lists the entries of its
 * product's kinds of rule by type (AuditLogsTable's resourceTypes), and the
 * shared table holds each entry to what its reader may read of the rule
 * (#10658).
 *
 * These hold each page to every kind of rule its product has - a new kind
 * is listed on its product's page or fails here - and to its product's
 * alone, and to its place in the Dashboard: its route, its trail, its entry
 * in Search and in its menu. The menus are drawn by their own suites
 * (IncidentsSideMenu, NetworkSideMenu, RulesAuditLogsSideMenus and the
 * rest).
 *
 * Runbook rules are one model for Alerts, Incidents and Scheduled
 * Maintenance, told apart by a column of the rule, never by its entries:
 * their history is one page under Runbooks, and the three products' pages
 * say where.
 */

// RouteMap fills in the current project from the address; only templates are read here.
jest.mock("Common/UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): null => {
        return null;
      },
    },
  };
});

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

// A source file with its white space collapsed.
function readDense(relative: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relative), "utf8")
    .replace(/\s+/g, " ");
}

type DescriptionWord = keyof typeof RULE_AUDIT_LOGS_WORDS;

interface RulesAuditLogsPage {
  name: string;
  modelTypes: ReadonlyArray<RuleModelType>;
  getResourceTypes: () => Array<string>;
  // What the page calls to name its types.
  typesFunction: string;
  // Every audited rule table of the product, and those it leaves to another page.
  tables: RegExp;
  leftOut?: Record<string, string> | undefined;
  // At least this many kinds: the sweep is not vacuous.
  atLeast: number;
  description: DescriptionWord;
  title: string;
  page: string;
  component: string;
  key: string;
  // A rule page of the same section, whose address it shares but the last part.
  sibling: string;
  routes: string;
  breadcrumbs: string;
  trail: Array<string>;
  menu: string;
  searchArea: string;
}

// A product's rules: its name, then "Owner", "Label" and the rest, then "Rule".
function rulesOf(prefix: string): RegExp {
  return new RegExp(`^${prefix}[A-Z][A-Za-z]*Rule$`);
}

const PAGES: Array<RulesAuditLogsPage> = [
  {
    name: "Incidents",
    modelTypes: INCIDENT_RULE_MODEL_TYPES,
    getResourceTypes: getIncidentRuleResourceTypes,
    typesFunction: "getIncidentRuleResourceTypes",
    // An incident's rules, its episodes' twins, and the teams picked to own one.
    tables: /^Incident(Episode)?[A-Z][A-Za-z]*Rule(OwningTeam)?$/,
    atLeast: 14,
    description: "descriptionWithRunbookRules",
    title: "Incident Rule Audit Logs",
    page: "Pages/Incidents/Settings/IncidentRulesAuditLogs.tsx",
    component: "IncidentRulesAuditLogs",
    key: "INCIDENTS_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "INCIDENTS_SETTINGS_REMINDER_RULES",
    routes: "Routes/IncidentsRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/IncidentBreadcrumbs.ts",
    trail: ["Project", "Incidents", "Rules", "Audit Logs"],
    menu: "Pages/Incidents/SideMenu.tsx",
    searchArea: "incidents",
  },
  {
    name: "Monitors",
    modelTypes: MONITOR_RULE_MODEL_TYPES,
    getResourceTypes: getMonitorRuleResourceTypes,
    typesFunction: "getMonitorRuleResourceTypes",
    tables: rulesOf("Monitor"),
    atLeast: 2,
    description: "description",
    title: "Monitor Rule Audit Logs",
    page: "Pages/Monitor/Settings/MonitorRulesAuditLogs.tsx",
    component: "MonitorRulesAuditLogs",
    key: "MONITORS_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "MONITORS_SETTINGS_LABEL_RULES",
    routes: "Routes/MonitorsRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/MonitorBreadcrumbs.ts",
    trail: ["Project", "Monitors", "Rules", "Audit Logs"],
    menu: "Pages/Monitor/SideMenu.tsx",
    searchArea: "monitors",
  },
  {
    name: "Scheduled Maintenance",
    modelTypes: SCHEDULED_MAINTENANCE_RULE_MODEL_TYPES,
    getResourceTypes: getScheduledMaintenanceRuleResourceTypes,
    typesFunction: "getScheduledMaintenanceRuleResourceTypes",
    tables: rulesOf("ScheduledMaintenance"),
    atLeast: 3,
    description: "descriptionWithRunbookRules",
    title: "Scheduled Maintenance Rule Audit Logs",
    page: "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceRulesAuditLogs.tsx",
    component: "ScheduledMaintenanceRulesAuditLogs",
    key: "SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_REMINDER_RULES",
    routes: "Routes/ScheduleMaintenanceEventsRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/ScheduledMaintenanceBreadcrumbs.ts",
    trail: ["Project", "Scheduled Maintenance", "Rules", "Audit Logs"],
    menu: "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
    searchArea: "scheduled-maintenance",
  },
  {
    name: "Status Pages",
    modelTypes: STATUS_PAGE_RULE_MODEL_TYPES,
    getResourceTypes: getStatusPageRuleResourceTypes,
    typesFunction: "getStatusPageRuleResourceTypes",
    tables: rulesOf("StatusPage"),
    leftOut: {
      StatusPageMonitorRule:
        "A status page's own monitor rules, set on the page itself: they roll up to it, on its Audit Logs page.",
      StatusPageHistoryChartBarColorRule:
        "A status page's own history chart colours, set on the page itself: they roll up to it, on its Audit Logs page.",
    },
    atLeast: 2,
    description: "description",
    title: "Status Page Rule Audit Logs",
    page: "Pages/StatusPages/Settings/StatusPageRulesAuditLogs.tsx",
    component: "StatusPageRulesAuditLogs",
    key: "STATUS_PAGES_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "STATUS_PAGES_SETTINGS_LABEL_RULES",
    routes: "Routes/StatusPagesRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/StatusPagesBreadcrumbs.ts",
    trail: ["Project", "Status Pages", "Rules", "Audit Logs"],
    menu: "Pages/StatusPages/SideMenu.tsx",
    searchArea: "status-pages",
  },
  {
    name: "Services",
    modelTypes: SERVICE_RULE_MODEL_TYPES,
    getResourceTypes: getServiceRuleResourceTypes,
    typesFunction: "getServiceRuleResourceTypes",
    // A service's own: an SLO's rules are named ServiceLevelObjective... too.
    tables: /^Service(Owner|Label)Rule$/,
    atLeast: 2,
    description: "description",
    title: "Service Rule Audit Logs",
    page: "Pages/Service/Settings/RulesAuditLogs.tsx",
    component: "ServiceRulesAuditLogs",
    key: "SERVICE_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "SERVICE_SETTINGS_LABEL_RULES",
    routes: "Routes/ServiceRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/ServiceBreadcrumbs.ts",
    trail: ["Project", "Services", "Settings", "Rule Audit Logs"],
    menu: "Pages/Service/SideMenu.tsx",
    searchArea: "services",
  },
  {
    name: "Hosts",
    modelTypes: HOST_RULE_MODEL_TYPES,
    getResourceTypes: getHostRuleResourceTypes,
    typesFunction: "getHostRuleResourceTypes",
    tables: rulesOf("Host"),
    atLeast: 2,
    description: "description",
    title: "Host Rule Audit Logs",
    page: "Pages/Host/Settings/RulesAuditLogs.tsx",
    component: "HostRulesAuditLogs",
    key: "HOST_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "HOST_SETTINGS_LABEL_RULES",
    routes: "Routes/HostRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/HostBreadcrumbs.ts",
    trail: ["Project", "Hosts", "Settings", "Rule Audit Logs"],
    menu: "Pages/Host/SideMenu.tsx",
    searchArea: "hosts",
  },
  {
    name: "Kubernetes",
    modelTypes: KUBERNETES_RULE_MODEL_TYPES,
    getResourceTypes: getKubernetesRuleResourceTypes,
    typesFunction: "getKubernetesRuleResourceTypes",
    tables: rulesOf("KubernetesCluster"),
    atLeast: 2,
    description: "description",
    title: "Kubernetes Cluster Rule Audit Logs",
    page: "Pages/Kubernetes/Settings/RulesAuditLogs.tsx",
    component: "KubernetesRulesAuditLogs",
    key: "KUBERNETES_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "KUBERNETES_SETTINGS_LABEL_RULES",
    routes: "Routes/KubernetesRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/KubernetesBreadcrumbs.ts",
    trail: ["Project", "Kubernetes", "Settings", "Rule Audit Logs"],
    menu: "Pages/Kubernetes/SideMenu.tsx",
    searchArea: "kubernetes",
  },
  {
    name: "Docker",
    modelTypes: DOCKER_RULE_MODEL_TYPES,
    getResourceTypes: getDockerRuleResourceTypes,
    typesFunction: "getDockerRuleResourceTypes",
    tables: rulesOf("DockerHost"),
    atLeast: 2,
    description: "description",
    title: "Docker Host Rule Audit Logs",
    page: "Pages/Docker/Settings/RulesAuditLogs.tsx",
    component: "DockerRulesAuditLogs",
    key: "DOCKER_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "DOCKER_SETTINGS_LABEL_RULES",
    routes: "Routes/DockerRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/DockerBreadcrumbs.ts",
    trail: ["Project", "Docker", "Settings", "Rule Audit Logs"],
    menu: "Pages/Docker/SideMenu.tsx",
    searchArea: "docker",
  },
  {
    name: "Docker Swarm",
    modelTypes: DOCKER_SWARM_RULE_MODEL_TYPES,
    getResourceTypes: getDockerSwarmRuleResourceTypes,
    typesFunction: "getDockerSwarmRuleResourceTypes",
    tables: rulesOf("DockerSwarmCluster"),
    atLeast: 2,
    description: "description",
    title: "Docker Swarm Cluster Rule Audit Logs",
    page: "Pages/DockerSwarm/Settings/RulesAuditLogs.tsx",
    component: "DockerSwarmRulesAuditLogs",
    key: "DOCKER_SWARM_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "DOCKER_SWARM_SETTINGS_LABEL_RULES",
    routes: "Routes/DockerSwarmRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/DockerSwarmBreadcrumbs.ts",
    trail: ["Project", "Docker Swarm", "Settings", "Rule Audit Logs"],
    menu: "Pages/DockerSwarm/SideMenu.tsx",
    searchArea: "docker-swarm",
  },
  {
    name: "Podman",
    modelTypes: PODMAN_RULE_MODEL_TYPES,
    getResourceTypes: getPodmanRuleResourceTypes,
    typesFunction: "getPodmanRuleResourceTypes",
    tables: rulesOf("PodmanHost"),
    atLeast: 2,
    description: "description",
    title: "Podman Host Rule Audit Logs",
    page: "Pages/Podman/Settings/RulesAuditLogs.tsx",
    component: "PodmanRulesAuditLogs",
    key: "PODMAN_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "PODMAN_SETTINGS_LABEL_RULES",
    routes: "Routes/PodmanRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/PodmanBreadcrumbs.ts",
    trail: ["Project", "Podman", "Settings", "Rule Audit Logs"],
    menu: "Pages/Podman/SideMenu.tsx",
    searchArea: "podman",
  },
  {
    name: "Proxmox",
    modelTypes: PROXMOX_RULE_MODEL_TYPES,
    getResourceTypes: getProxmoxRuleResourceTypes,
    typesFunction: "getProxmoxRuleResourceTypes",
    tables: rulesOf("ProxmoxCluster"),
    atLeast: 2,
    description: "description",
    title: "Proxmox Cluster Rule Audit Logs",
    page: "Pages/Proxmox/Settings/RulesAuditLogs.tsx",
    component: "ProxmoxRulesAuditLogs",
    key: "PROXMOX_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "PROXMOX_SETTINGS_LABEL_RULES",
    routes: "Routes/ProxmoxRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/ProxmoxBreadcrumbs.ts",
    trail: ["Project", "Proxmox", "Settings", "Rule Audit Logs"],
    menu: "Pages/Proxmox/SideMenu.tsx",
    searchArea: "proxmox",
  },
  {
    name: "OpenStack",
    modelTypes: OPENSTACK_RULE_MODEL_TYPES,
    getResourceTypes: getOpenStackRuleResourceTypes,
    typesFunction: "getOpenStackRuleResourceTypes",
    tables: rulesOf("OpenStackCloud"),
    atLeast: 2,
    description: "description",
    title: "OpenStack Cloud Rule Audit Logs",
    page: "Pages/OpenStack/Settings/RulesAuditLogs.tsx",
    component: "OpenStackRulesAuditLogs",
    key: "OPENSTACK_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "OPENSTACK_SETTINGS_LABEL_RULES",
    routes: "Routes/OpenStackRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/OpenStackBreadcrumbs.ts",
    trail: ["Project", "OpenStack", "Settings", "Rule Audit Logs"],
    menu: "Pages/OpenStack/SideMenu.tsx",
    searchArea: "openstack",
  },
  {
    name: "VMware",
    modelTypes: VMWARE_RULE_MODEL_TYPES,
    getResourceTypes: getVMwareRuleResourceTypes,
    typesFunction: "getVMwareRuleResourceTypes",
    tables: rulesOf("VMwareVCenter"),
    atLeast: 2,
    description: "description",
    title: "vCenter Rule Audit Logs",
    page: "Pages/VMware/Settings/RulesAuditLogs.tsx",
    component: "VMwareRulesAuditLogs",
    key: "VMWARE_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "VMWARE_SETTINGS_LABEL_RULES",
    routes: "Routes/VMwareRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/VMwareBreadcrumbs.ts",
    trail: ["Project", "VMware", "Settings", "Rule Audit Logs"],
    menu: "Pages/VMware/SideMenu.tsx",
    searchArea: "vmware",
  },
  {
    name: "Ceph",
    modelTypes: CEPH_RULE_MODEL_TYPES,
    getResourceTypes: getCephRuleResourceTypes,
    typesFunction: "getCephRuleResourceTypes",
    tables: rulesOf("CephCluster"),
    atLeast: 2,
    description: "description",
    title: "Ceph Cluster Rule Audit Logs",
    page: "Pages/Ceph/Settings/RulesAuditLogs.tsx",
    component: "CephRulesAuditLogs",
    key: "CEPH_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "CEPH_SETTINGS_LABEL_RULES",
    routes: "Routes/CephRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/CephBreadcrumbs.ts",
    trail: ["Project", "Ceph", "Settings", "Rule Audit Logs"],
    menu: "Pages/Ceph/SideMenu.tsx",
    searchArea: "ceph",
  },
  {
    name: "Storage Arrays",
    modelTypes: STORAGE_ARRAY_RULE_MODEL_TYPES,
    getResourceTypes: getStorageArrayRuleResourceTypes,
    typesFunction: "getStorageArrayRuleResourceTypes",
    tables: rulesOf("StorageArray"),
    atLeast: 2,
    description: "description",
    title: "Storage Array Rule Audit Logs",
    page: "Pages/StorageArray/Settings/RulesAuditLogs.tsx",
    component: "StorageArrayRulesAuditLogs",
    key: "STORAGE_ARRAYS_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "STORAGE_ARRAYS_SETTINGS_LABEL_RULES",
    routes: "Routes/StorageArrayRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/StorageArrayBreadcrumbs.ts",
    trail: ["Project", "Storage Arrays", "Settings", "Rule Audit Logs"],
    menu: "Pages/StorageArray/SideMenu.tsx",
    searchArea: "storage-arrays",
  },
  {
    name: "Network",
    modelTypes: NETWORK_RULE_MODEL_TYPES,
    getResourceTypes: getNetworkRuleResourceTypes,
    typesFunction: "getNetworkRuleResourceTypes",
    // Every rule the Network menu's Rules section lists: devices' and sites'.
    tables: /^Network(Device|Site)[A-Z][A-Za-z]*Rule$/,
    atLeast: 6,
    description: "description",
    title: "Network Rule Audit Logs",
    page: "Pages/NetworkDevice/Settings/RulesAuditLogs.tsx",
    component: "NetworkRulesAuditLogs",
    key: "NETWORK_DEVICE_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "NETWORK_DEVICE_SETTINGS_LINK_RULES",
    routes: "Routes/NetworkDeviceRoutes.tsx",
    breadcrumbs: "Pages/NetworkDevice/Utils/Breadcrumbs.ts",
    trail: ["Project", "Network", "Rules", "Audit Logs"],
    menu: "Components/Network/NetworkSideMenu.tsx",
    searchArea: "network",
  },
  {
    name: "IoT",
    modelTypes: IOT_RULE_MODEL_TYPES,
    getResourceTypes: getIoTRuleResourceTypes,
    typesFunction: "getIoTRuleResourceTypes",
    tables: rulesOf("IoTFleet"),
    atLeast: 2,
    description: "description",
    title: "IoT Fleet Rule Audit Logs",
    page: "Pages/IoT/Settings/RulesAuditLogs.tsx",
    component: "IoTRulesAuditLogs",
    key: "IOT_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "IOT_SETTINGS_LABEL_RULES",
    routes: "Routes/IoTRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/IoTBreadcrumbs.ts",
    trail: ["Project", "IoT", "Settings", "Rule Audit Logs"],
    menu: "Pages/IoT/SideMenu.tsx",
    searchArea: "iot",
  },
  {
    name: "Runbooks",
    modelTypes: RUNBOOK_RULE_MODEL_TYPES,
    getResourceTypes: getRunbookRuleResourceTypes,
    typesFunction: "getRunbookRuleResourceTypes",
    // Its own owner and label rules, and the runbook rules of three products.
    tables: /^Runbook[A-Za-z]*Rule$/,
    atLeast: 3,
    description: "runbooksDescription",
    title: "Runbook Rule Audit Logs",
    page: "Pages/Runbook/Settings/RulesAuditLogs.tsx",
    component: "RunbookRulesAuditLogs",
    key: "RUNBOOKS_SETTINGS_RULES_AUDIT_LOGS",
    sibling: "RUNBOOKS_SETTINGS_LABEL_RULES",
    routes: "Routes/RunbookRoutes.tsx",
    breadcrumbs: "Utils/Breadcrumbs/RunbooksBreadcrumbs.ts",
    trail: ["Project", "Runbooks", "Settings", "Rule Audit Logs"],
    menu: "Pages/Runbook/SideMenu.tsx",
    searchArea: "runbooks",
  },
];

const MODELS: Array<BaseModel> = (
  AllModelTypes as Array<{ new (): BaseModel }>
).map((modelType: { new (): BaseModel }): BaseModel => {
  return new modelType();
});

function tableOf(modelType: RuleModelType): string {
  return new modelType().tableName || "";
}

// The audited models whose table matches.
function auditedTables(tables: RegExp): Array<string> {
  return MODELS.filter((model: BaseModel): boolean => {
    return (
      tables.test(model.tableName || "") &&
      Boolean(model.enableAuditLogOn?.update)
    );
  })
    .map((model: BaseModel): string => {
      return model.tableName || "";
    })
    .sort();
}

// The menu's title for the page: the trail's last step.
function menuTitleOf(page: RulesAuditLogsPage): string {
  return page.trail[page.trail.length - 1]!;
}

// The section the page sits in: the trail's step before it.
function sectionOf(page: RulesAuditLogsPage): string {
  return page.trail[page.trail.length - 2]!;
}

describe.each(PAGES)(
  "$name's rules' Audit Logs page",
  (page: RulesAuditLogsPage) => {
    test("lists every kind of rule of the product the audit log records", () => {
      const recorded: Array<string> = auditedTables(page.tables).filter(
        (table: string): boolean => {
          return !Object.prototype.hasOwnProperty.call(
            page.leftOut || {},
            table,
          );
        },
      );

      const listed: Array<string> = page.modelTypes.map(tableOf).sort();

      expect(listed.length).toBeGreaterThanOrEqual(page.atLeast);
      expect(listed).toEqual(recorded);
    });

    test("leaves out only rules that are another page's, each still audited and matched", () => {
      for (const table of Object.keys(page.leftOut || {})) {
        expect(auditedTables(page.tables)).toContain(table);
        expect(page.modelTypes.map(tableOf)).not.toContain(table);

        // A rule that rolls up to the resource it is set on.
        const model: BaseModel | undefined = MODELS.find((item: BaseModel) => {
          return item.tableName === table;
        });

        expect(model?.enableAuditLogOn?.rootResource).toBeDefined();
      }
    });

    test("by the types their entries are stored under, each once, in its order", () => {
      const types: Array<string> = page.getResourceTypes();

      expect(new Set(types).size).toBe(types.length);
      expect(types).toEqual(
        page.modelTypes.map((modelType: RuleModelType): string => {
          return getApiSingularName(new modelType());
        }),
      );
      expect(types).toEqual(getRuleAuditLogResourceTypes(page.modelTypes));
    });

    test("the page asks for exactly those types through the shared table, and is no resource's", () => {
      const source: string = readDense(page.page);

      expect(source).toContain(
        'import AuditLogsTable from "../../../Components/AuditLogs/AuditLogsTable";',
      );
      expect(source).toContain(`title="${page.title}"`);
      expect(source).toContain(
        `description={RULE_AUDIT_LOGS_WORDS.${page.description}}`,
      );
      expect(source).toContain(`resourceTypes={${page.typesFunction}()}`);
      expect(source).not.toContain("rootResourceId");
      expect(source).not.toMatch(/\sresourceType=/);
      expect(source).not.toMatch(/\sresourceId=/);
      // It reads nothing of its own: every entry comes held to its reader.
      expect(source).not.toMatch(/ModelAPI|AnalyticsModelAPI|fetch\(/);
    });

    test("has a page map entry and a route in the product's settings, beside its rules", () => {
      expect((PageMap as unknown as Record<string, string>)[page.key]).toBe(
        page.key,
      );

      const route: Route | undefined = RouteMap[page.key];
      const sibling: Route | undefined = RouteMap[page.sibling];

      expect(route).toBeDefined();
      expect(sibling).toBeDefined();
      expect(route!.toString()).toMatch(/\/settings\/rules-audit-logs$/);

      // The same product's settings: only the last part of the address differs.
      const parentOf: (address: string) => string = (address: string) => {
        return address.replace(/\/[^/]+$/, "");
      };

      expect(parentOf(route!.toString())).toBe(parentOf(sibling!.toString()));
    });

    test("is routed to its page", () => {
      const routes: string = readDense(page.routes);
      const relativePage: string = page.page.replace(/\.tsx$/, "");

      expect(routes).toContain(
        `import ${page.component} from "../${relativePage}";`,
      );
      expect(routes).toMatch(
        new RegExp(
          `<PageRoute path=\\{ ?\\w+RoutePath\\[ ?PageMap\\.${page.key} ?\\] \\|\\| "" ?\\} element=\\{ <${page.component} \\{\\.\\.\\.props\\} pageRoute=\\{ ?RouteMap\\[ ?PageMap\\.${page.key} ?\\] as Route ?\\} /> \\} />`,
        ),
      );
    });

    test("has a trail back up to its product, through the section that lists it", () => {
      const breadcrumbs: string = readDense(page.breadcrumbs);
      const trail: string = page.trail
        .map((title: string): string => {
          return `"${title}",?`;
        })
        .join("\\s*");

      expect(breadcrumbs).toMatch(
        new RegExp(
          `BuildBreadcrumbLinksByTitles\\(\\s*PageMap\\.${page.key},\\s*\\[\\s*${trail}\\s*\\]`,
        ),
      );
    });

    test("is found by Search under its section, by the menu's name for it", () => {
      const area: PageSearchArea | undefined = getPageSearchAreas().find(
        (item: PageSearchArea): boolean => {
          return item.id === page.searchArea;
        },
      );

      expect(area).toBeDefined();

      const found: Array<{
        section: string | undefined;
        entry: PageSearchPage;
      }> = [];

      for (const section of area!.sections as Array<PageSearchSection>) {
        for (const entry of section.pages) {
          if (entry.page === page.key) {
            found.push({ section: section.title, entry });
          }
        }
      }

      expect(found).toHaveLength(1);
      expect(found[0]!.section).toBe(sectionOf(page));
      expect(found[0]!.entry.title).toBe(menuTitleOf(page));
      expect(found[0]!.entry.keywords).toEqual(
        expect.arrayContaining(["history", "who changed"]),
      );

      // Last in its section, after the rules it is the history of.
      const section: PageSearchSection = (
        area!.sections as Array<PageSearchSection>
      ).find((item: PageSearchSection): boolean => {
        return item.pages.some((entry: PageSearchPage): boolean => {
          return entry.page === page.key;
        });
      })!;
      const keys: Array<string> = section.pages.map(
        (entry: PageSearchPage): string => {
          return String(entry.page);
        },
      );

      expect(keys.indexOf(page.key)).toBeGreaterThan(
        keys.indexOf(page.sibling),
      );
    });

    test("is the last entry of the menu section that lists the product's rules", () => {
      const menu: string = readDense(page.menu);
      const entry: number = menu.indexOf(`PageMap.${page.key}`);
      const sibling: number = menu.indexOf(`PageMap.${page.sibling}`);

      expect(entry).toBeGreaterThan(-1);
      expect(sibling).toBeGreaterThan(-1);
      expect(entry).toBeGreaterThan(sibling);

      // The menu's own words for it, right before its route.
      const item: string = menu.slice(
        menu.lastIndexOf("{ link: {", entry),
        entry,
      );

      expect(item).toContain(`title: "${menuTitleOf(page)}"`);
      // Its section ends with it: no other page before the section's items close.
      const rest: string = menu.slice(entry);
      const sectionEnd: number = rest.indexOf("], }");

      expect(sectionEnd).toBeGreaterThan(-1);
      expect(rest.slice(0, sectionEnd).match(/PageMap\./g)).toHaveLength(1);
    });
  },
);

describe("each page lists only its own product's rules", () => {
  const ALL: Array<{ name: string; types: Array<string> }> = [
    { name: "Alerts", types: getAlertRuleResourceTypes() },
    ...PAGES.map((page: RulesAuditLogsPage) => {
      return { name: page.name, types: page.getResourceTypes() };
    }),
  ];

  test("no two pages share a type", () => {
    const owners: Map<string, string> = new Map();

    for (const page of ALL) {
      for (const type of page.types) {
        expect({ type, alreadyOn: owners.get(type) }).toEqual({
          type,
          alreadyOn: undefined,
        });
        owners.set(type, page.name);
      }
    }

    // Alerts' 13 kinds, and the 54 of the pages here.
    expect(owners.size).toBeGreaterThanOrEqual(67);
  });

  test.each(PAGES)(
    "every kind on $name's page is one of its product's tables, and no other product's",
    (page: RulesAuditLogsPage) => {
      for (const modelType of page.modelTypes) {
        const table: string = tableOf(modelType);

        expect({ table, ownProduct: page.tables.test(table) }).toEqual({
          table,
          ownProduct: true,
        });

        for (const other of PAGES) {
          if (other !== page) {
            expect({
              table,
              other: other.name,
              matches: other.tables.test(table),
            }).toEqual({
              table,
              other: other.name,
              matches: false,
            });
          }
        }
      }
    },
  );

  test("an incident's page holds no alert's rule, and an alert's no incident's", () => {
    for (const type of getIncidentRuleResourceTypes()) {
      expect(type).toMatch(/^Incident /);
    }

    for (const modelType of ALERT_RULE_MODEL_TYPES) {
      expect(tableOf(modelType)).toMatch(/^Alert/);
    }
  });

  test("a service's page holds no SLO's rules", () => {
    expect(SERVICE_RULE_MODEL_TYPES.map(tableOf)).toEqual([
      "ServiceOwnerRule",
      "ServiceLabelRule",
    ]);
  });
});

describe("the runbook rules' history is one page under Runbooks", () => {
  const RUNBOOK_RULE_TYPE: string = getApiSingularName(new RunbookRule());

  test("runbook rules are one kind for alerts, incidents and maintenance events, told apart by a column of the rule", () => {
    expect(Object.values(RunbookRuleTriggerEntity).sort()).toEqual(
      ["Alert", "Incident", "ScheduledMaintenance"].sort(),
    );

    const model: RunbookRule = new RunbookRule();

    expect(model.isTableColumn("triggerEntityType")).toBe(true);
    // Their entries are filed under the one type, with no product above them.
    expect(model.enableAuditLogOn?.update).toBe(true);
    expect(model.enableAuditLogOn?.rootResource).toBeUndefined();
    expect(RUNBOOK_RULE_TYPE).toBe("Runbook Rule");
  });

  test("Runbooks' page lists them, beside the runbooks' own owner and label rules", () => {
    expect(getRunbookRuleResourceTypes()).toEqual([
      "Runbook Rule",
      "Runbook Owner Rule",
      "Runbook Label Rule",
    ]);
  });

  test("no product's page lists them, so none shows another product's", () => {
    for (const types of [
      getAlertRuleResourceTypes(),
      getIncidentRuleResourceTypes(),
      getScheduledMaintenanceRuleResourceTypes(),
    ]) {
      expect(types).not.toContain(RUNBOOK_RULE_TYPE);
    }
  });

  test("the three products whose Rules list runbook rules say where their history is", () => {
    for (const [file, menu] of [
      [
        "Pages/Alerts/Settings/AlertRulesAuditLogs.tsx",
        "Pages/Alerts/SideMenu.tsx",
      ],
      [
        "Pages/Incidents/Settings/IncidentRulesAuditLogs.tsx",
        "Pages/Incidents/SideMenu.tsx",
      ],
      [
        "Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceRulesAuditLogs.tsx",
        "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
      ],
    ] as Array<[string, string]>) {
      expect(readDense(menu)).toContain('title: "Runbook Rules"');
      expect(readDense(file)).toContain(
        "description={RULE_AUDIT_LOGS_WORDS.descriptionWithRunbookRules}",
      );
    }

    // And no other product's page does: its Rules list no runbook rules.
    for (const page of PAGES) {
      if (page.description === "descriptionWithRunbookRules") {
        expect(readDense(page.menu)).toContain('title: "Runbook Rules"');
      } else if (page.name !== "Runbooks") {
        expect(readDense(page.menu)).not.toContain('title: "Runbook Rules"');
      }
    }
  });

  test("the path the description names is the menus' own: Runbooks > Settings > Rule Audit Logs", () => {
    expect(RULE_AUDIT_LOGS_WORDS.descriptionWithRunbookRules).toContain(
      "Runbooks > Settings > Rule Audit Logs",
    );

    const runbooks: RulesAuditLogsPage = PAGES.find(
      (page: RulesAuditLogsPage): boolean => {
        return page.name === "Runbooks";
      },
    )!;

    expect(runbooks.trail.slice(1)).toEqual([
      "Runbooks",
      "Settings",
      "Rule Audit Logs",
    ]);

    const menu: string = readDense(runbooks.menu);
    const settings: number = menu.indexOf('title: "Settings",');

    expect(menu).toContain('title: "Runbooks",');
    expect(settings).toBeGreaterThan(-1);
    expect(menu.indexOf('title: "Rule Audit Logs"')).toBeGreaterThan(settings);
  });

  test("every description is one sentence or two short ones, under a card's 210 characters", () => {
    for (const words of Object.values(RULE_AUDIT_LOGS_WORDS)) {
      expect(words.length).toBeLessThanOrEqual(210);
      expect(words).toMatch(/\.$/);
    }
  });
});
