import ObjectID from "../ObjectID";
import FilterCondition from "../Filter/FilterCondition";
import { CheckOn, FilterType } from "./CriteriaFilter";
import MonitorCriteria from "./MonitorCriteria";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorStepLogMonitor from "./MonitorStepLogMonitor";
import { XcpNgAlertTemplateArgs } from "./XcpNgAlertTemplates";
import { XcpNgMessageAlert } from "../XcpNg/XcpNgMessageCatalog";
import {
  XcpNgBackupStatus,
  XcpNgEventKind,
  XcpNgEventLogAttribute,
  XcpNgMessageState,
} from "../XcpNg/XcpNgPoolEvents";
import { XCP_NG_POOL_ID_ATTRIBUTE } from "../XcpNg/XcpNgTelemetry";

/*
 * ALERTS ON WHAT XCP-NG SAYS ITSELF (#10997).
 *
 * A pool a probe reads - through Xen Orchestra's REST API, or straight from
 * XAPI - has its XAPI messages and its Xen Orchestra backup runs kept as
 * log records of the pool (XcpNgEventRecords): a VM that crashed, a host HA
 * lost, storage that failed to plug, a threshold alarm, a backup job that
 * failed. These templates are Logs monitors over those records, offered on
 * the pool's Recommendations page under their own headings (as Proxmox's
 * notifications are, ProxmoxNotificationAlertTemplates); an XCP-ng monitor
 * reads metrics, and its Quick Setup never lists them.
 *
 *   - One per message XAPI alerts on most (priority 1 to 3): a crash, HA
 *     losing a host, its state file or a protected VM, storage that failed
 *     to plug, storage garbage collection out of space - one alert per
 *     object, which stays open until XCP-ng no longer lists the message
 *     (someone dismissed it in Xen Orchestra or XenCenter) and resolves
 *     then (a "cleared" record, resolvedByAttributes).
 *   - XAPI Alarm: every other message of priority 1 to 3, threshold
 *     ALARMs included, one alert per object and message (and alarm
 *     variable). With every template turned on, each alerting message
 *     alerts exactly once: the record names the template it is for
 *     (xcp_ng.message.alert).
 *   - Pool Master Changed: XAPI's priority 4 notice that another host took
 *     the master's role - off by default, there to turn on; it resolves
 *     after half an hour without another.
 *   - Backup Job Failed: one alert per job and the VMs that failed (the
 *     alert names them), open until the job next succeeds for the pool -
 *     never just because time passed, so a job that stopped running keeps
 *     it open.
 *
 * Messages of priority 4 and 5 alert through no template but Pool Master
 * Changed: priority 1 to 4 land on the pool's feed, and all of them stay in
 * its Logs.
 *
 * These ids and attribute keys are stored in customers' monitors: never
 * rename one.
 */

export const XCP_NG_VM_CRASHED_TEMPLATE_ID: string = "xcp-ng-vm-crashed";
export const XCP_NG_HA_HOST_FAILED_TEMPLATE_ID: string =
  "xcp-ng-ha-host-failed";
export const XCP_NG_HA_STATEFILE_LOST_TEMPLATE_ID: string =
  "xcp-ng-ha-statefile-lost";
export const XCP_NG_HA_VM_RESTART_FAILED_TEMPLATE_ID: string =
  "xcp-ng-ha-protected-vm-restart-failed";
export const XCP_NG_PBD_PLUG_FAILED_TEMPLATE_ID: string =
  "xcp-ng-pbd-plug-failed";
export const XCP_NG_SR_GC_NO_SPACE_TEMPLATE_ID: string =
  "xcp-ng-sr-gc-no-space";
export const XCP_NG_POOL_MASTER_CHANGED_TEMPLATE_ID: string =
  "xcp-ng-pool-master-changed";
export const XCP_NG_XAPI_ALARM_TEMPLATE_ID: string = "xcp-ng-xapi-alarm";
export const XCP_NG_BACKUP_JOB_FAILED_TEMPLATE_ID: string =
  "xcp-ng-backup-job-failed";

// The resource attribute every record of a pool carries, as logs store it.
export const XCP_NG_POOL_ID_LOG_ATTRIBUTE: string = `resource.${XCP_NG_POOL_ID_ATTRIBUTE}`;

/*
 * How far back each check looks: a message or a failed run opens its alert
 * at the next check; what closes it is the message cleared, or the job's
 * next success - never the window moving on.
 */
export const XCP_NG_EVENT_WINDOW_SECONDS: number = 3600;

// A master change keeps its alert open for half an hour.
export const XCP_NG_POOL_MASTER_CHANGED_WINDOW_SECONDS: number = 1800;

// One alert per object a message is about.
export const XCP_NG_MESSAGE_GROUP_BY: Array<string> = [
  XcpNgEventLogAttribute.ObjectName,
  XcpNgEventLogAttribute.ObjectUuid,
];

// One alert per object, message and alarm variable.
export const XCP_NG_XAPI_ALARM_GROUP_BY: Array<string> = [
  XcpNgEventLogAttribute.ObjectName,
  XcpNgEventLogAttribute.MessageName,
  XcpNgEventLogAttribute.AlarmVariable,
  XcpNgEventLogAttribute.ObjectUuid,
];

// One alert per job and the VMs that failed in it.
export const XCP_NG_BACKUP_JOB_FAILED_GROUP_BY: Array<string> = [
  XcpNgEventLogAttribute.BackupJobName,
  XcpNgEventLogAttribute.BackupFailedVms,
  XcpNgEventLogAttribute.BackupJobId,
];

export type XcpNgEventAlertTemplateCategory = "Alarms" | "Backups";

export interface XcpNgEventAlertTemplate {
  id: string;
  name: string;
  // One plain sentence: when it fires (see XcpNgAlertTemplate.summary).
  summary: string;
  description: string;
  category: XcpNgEventAlertTemplateCategory;
  severity: "Critical" | "Warning";
  /*
   * Whether it alerts on what XAPI calls a priority 1 to 3 message - the
   * set OneUptime recommends turning on. Pool Master Changed does not.
   */
  isAlertingByDefault: boolean;
  getMonitorStep: (args: XcpNgAlertTemplateArgs) => MonitorStep;
}

// The Logs monitor's query: this pool's raised messages for one template.
export function buildXcpNgMessageLogMonitor(data: {
  poolIdentifier: string;
  alert: XcpNgMessageAlert;
  groupBy: Array<string>;
  // Absent: the alert resolves when the window passes with no new message.
  resolvesWhenCleared: boolean;
  windowSeconds?: number | undefined;
}): MonitorStepLogMonitor {
  const monitor: MonitorStepLogMonitor = {
    attributes: {
      [XCP_NG_POOL_ID_LOG_ATTRIBUTE]: data.poolIdentifier,
      [XcpNgEventLogAttribute.Kind]: XcpNgEventKind.Message,
      [XcpNgEventLogAttribute.MessageAlert]: data.alert,
      [XcpNgEventLogAttribute.MessageState]: XcpNgMessageState.Raised,
    },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: data.windowSeconds ?? XCP_NG_EVENT_WINDOW_SECONDS,
    groupByAttributes: [...data.groupBy],
  };

  if (data.resolvesWhenCleared) {
    /*
     * The record XCP-ng's forgetting of the group's last message writes. The
     * resolving query uses these attributes alone, so they name the pool too.
     */
    monitor.resolvedByAttributes = {
      [XCP_NG_POOL_ID_LOG_ATTRIBUTE]: data.poolIdentifier,
      [XcpNgEventLogAttribute.Kind]: XcpNgEventKind.Message,
      [XcpNgEventLogAttribute.MessageAlert]: data.alert,
      [XcpNgEventLogAttribute.MessageState]: XcpNgMessageState.Cleared,
    };
  }

  return monitor;
}

// The Logs monitor's query: this pool's failed backup runs, per job.
export function buildXcpNgBackupJobFailedLogMonitor(
  poolIdentifier: string,
): MonitorStepLogMonitor {
  return {
    attributes: {
      [XCP_NG_POOL_ID_LOG_ATTRIBUTE]: poolIdentifier,
      [XcpNgEventLogAttribute.Kind]: XcpNgEventKind.Backup,
      [XcpNgEventLogAttribute.BackupStatus]: XcpNgBackupStatus.Failure,
    },
    body: "",
    severityTexts: [],
    telemetryServiceIds: [],
    lastXSecondsOfLogs: XCP_NG_EVENT_WINDOW_SECONDS,
    groupByAttributes: [...XCP_NG_BACKUP_JOB_FAILED_GROUP_BY],
    // The same job's next success for this pool, on the same group.
    resolvedByAttributes: {
      [XCP_NG_POOL_ID_LOG_ATTRIBUTE]: poolIdentifier,
      [XcpNgEventLogAttribute.Kind]: XcpNgEventKind.Backup,
      [XcpNgEventLogAttribute.BackupStatus]: XcpNgBackupStatus.Success,
    },
  };
}

function buildCriteria(data: {
  args: XcpNgAlertTemplateArgs;
  title: string;
  description: string;
  criteriaName: string;
  criteriaDescription: string;
  healthyDescription: string;
}): MonitorCriteria {
  const unhealthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  unhealthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.offlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      },
    ],
    incidents: [
      {
        title: data.title,
        description: data.description,
        incidentSeverityId: data.args.defaultIncidentSeverityId,
        autoResolveIncident: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    alerts: [
      {
        title: data.title,
        description: data.description,
        alertSeverityId: data.args.defaultAlertSeverityId,
        autoResolveAlert: true,
        id: ObjectID.generate().toString(),
        onCallPolicyIds: [],
      },
    ],
    changeMonitorStatus: true,
    // Both, as every template ships (see ProxmoxNotificationAlertTemplates).
    createIncidents: true,
    createAlerts: true,
    name: data.criteriaName,
    description: data.criteriaDescription,
  };

  const healthy: MonitorCriteriaInstance = new MonitorCriteriaInstance();

  healthy.data = {
    id: ObjectID.generate().toString(),
    monitorStatusId: data.args.onlineMonitorStatusId,
    filterCondition: FilterCondition.Any,
    filters: [
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.EqualTo,
        value: 0,
      },
    ],
    incidents: [],
    alerts: [],
    changeMonitorStatus: true,
    createIncidents: false,
    createAlerts: false,
    name: "Healthy",
    description: data.healthyDescription,
  };

  const criteria: MonitorCriteria = new MonitorCriteria();

  criteria.data = {
    monitorCriteriaInstanceArray: [unhealthy, healthy],
  };

  return criteria;
}

function buildStep(data: {
  criteria: MonitorCriteria;
  logMonitor: MonitorStepLogMonitor;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();

  monitorStep.data = {
    id: ObjectID.generate().toString(),
    monitorDestination: undefined,
    doNotFollowRedirects: undefined,
    monitorDestinationPort: undefined,
    monitorCriteria: data.criteria,
    requestType: "GET" as any,
    requestHeaders: undefined,
    requestBody: undefined,
    customCode: undefined,
    screenSizeTypes: undefined,
    browserTypes: undefined,
    retryCountOnError: undefined,
    logMonitor: data.logMonitor,
    traceMonitor: undefined,
    metricMonitor: undefined,
    exceptionMonitor: undefined,
    snmpMonitor: undefined,
    dnsMonitor: undefined,
    domainMonitor: undefined,
    externalStatusPageMonitor: undefined,
    kubernetesMonitor: undefined,
  };

  return monitorStep;
}

// What every message template's description ends with.
const NEEDS_PROBE: string =
  "Needs the pool read by a probe, through Xen Orchestra's REST API with a Read only API token or straight from XAPI: the XCP-ng Agent reads metrics only. It is a Logs monitor over the pool's XCP-ng messages.";

interface MessageTemplateSpec {
  id: string;
  name: string;
  summary: string;
  description: string;
  severity: "Critical" | "Warning";
  alert: XcpNgMessageAlert;
  criteriaName: string;
  alertDescription: string;
}

function messageTemplate(spec: MessageTemplateSpec): XcpNgEventAlertTemplate {
  return {
    id: spec.id,
    name: spec.name,
    summary: spec.summary,
    description: `${spec.description} ${NEEDS_PROBE}`,
    category: "Alarms",
    severity: spec.severity,
    isAlertingByDefault: true,
    getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
      return buildStep({
        logMonitor: buildXcpNgMessageLogMonitor({
          poolIdentifier: args.poolIdentifier,
          alert: spec.alert,
          groupBy: XCP_NG_MESSAGE_GROUP_BY,
          resolvesWhenCleared: true,
        }),
        criteria: buildCriteria({
          args: args,
          title: `[XCP-ng] ${spec.name} - ${args.monitorName}`,
          description: spec.alertDescription,
          criteriaName: `${args.monitorName} - ${spec.criteriaName}`,
          criteriaDescription: `XCP-ng raised ${spec.criteriaName.toLowerCase()}, and still lists it.`,
          healthyDescription: `XCP-ng lists no ${spec.criteriaName.toLowerCase()}.`,
        }),
      });
    },
  };
}

const vmCrashedTemplate: XcpNgEventAlertTemplate = messageTemplate({
  id: XCP_NG_VM_CRASHED_TEMPLATE_ID,
  name: "VM Crashed",
  summary:
    "A VM crashes: one alert per VM, open until the message is dismissed.",
  description:
    "Alert when XAPI reports that a VM crashed (VM_CRASHED, priority 2): its guest stopped on a fault, and XCP-ng then did what the VM's crash action says - restarted it, destroyed it or left it halted. One alert per VM, which resolves once XCP-ng no longer lists the message (it was dismissed in Xen Orchestra or XenCenter).",
  severity: "Critical",
  alert: XcpNgMessageAlert.VmCrashed,
  criteriaName: "VM crashed",
  alertDescription:
    "XAPI reported that a VM of this XCP-ng pool crashed: its guest stopped on a fault. The VM is named on this alert. Check its console and its guest's logs for why, and whether XCP-ng restarted it (its crash action). Dismiss the message in Xen Orchestra once it is handled: the alert resolves when XCP-ng no longer lists it.",
});

const haHostFailedTemplate: XcpNgEventAlertTemplate = messageTemplate({
  id: XCP_NG_HA_HOST_FAILED_TEMPLATE_ID,
  name: "HA Host Failed",
  summary: "HA loses a host: one alert per host, open until dismissed.",
  description:
    "Alert when XAPI's high availability reports that it lost a host (HA_HOST_FAILED, priority 3): the host stopped heartbeating, so HA fenced it and restarted its protected VMs on the other hosts. One alert per host, which resolves once XCP-ng no longer lists the message.",
  severity: "Critical",
  alert: XcpNgMessageAlert.HaHostFailed,
  criteriaName: "HA host failed",
  alertDescription:
    "High availability lost a host of this XCP-ng pool: it stopped heartbeating, so HA fenced it and restarted its protected VMs elsewhere. The host is named on this alert. Check why it failed (power, the management network, a hang) before it rejoins, and that its VMs run where HA moved them. The alert resolves when XCP-ng no longer lists the message.",
});

const haStatefileLostTemplate: XcpNgEventAlertTemplate = messageTemplate({
  id: XCP_NG_HA_STATEFILE_LOST_TEMPLATE_ID,
  name: "HA State File Lost",
  summary:
    "A host loses HA's state file: one alert per host, open until dismissed.",
  description:
    "Alert when a host loses access to HA's state file on the heartbeat storage repository (HA_STATEFILE_LOST, priority 2). A host that cannot reach the state file and cannot reach the other hosts fences itself, so this is the step before VMs go down. One alert per host, which resolves once XCP-ng no longer lists the message.",
  severity: "Critical",
  alert: XcpNgMessageAlert.HaStatefileLost,
  criteriaName: "HA state file lost",
  alertDescription:
    "A host of this XCP-ng pool lost access to HA's state file on the heartbeat storage repository. A host that loses both the state file and the other hosts fences itself. Check the heartbeat storage (its paths, multipathing, the array) at once. The host is named on this alert; the alert resolves when XCP-ng no longer lists the message.",
});

const haVmRestartFailedTemplate: XcpNgEventAlertTemplate = messageTemplate({
  id: XCP_NG_HA_VM_RESTART_FAILED_TEMPLATE_ID,
  name: "HA Protected VM Restart Failed",
  summary:
    "HA cannot restart a protected VM: one alert per VM, open until dismissed.",
  description:
    "Alert when HA could not restart a VM it protects after a host failed (HA_PROTECTED_VM_RESTART_FAILED, priority 2): there was no host with room for it, or its storage was unreachable. The VM is down. One alert per VM, which resolves once XCP-ng no longer lists the message.",
  severity: "Critical",
  alert: XcpNgMessageAlert.HaProtectedVmRestartFailed,
  criteriaName: "HA could not restart a protected VM",
  alertDescription:
    "High availability could not restart a VM it protects after a host of this XCP-ng pool failed, so the VM is down. The VM is named on this alert. Free memory on a host, or bring its storage back, and start it. The alert resolves when XCP-ng no longer lists the message.",
});

const pbdPlugFailedTemplate: XcpNgEventAlertTemplate = messageTemplate({
  id: XCP_NG_PBD_PLUG_FAILED_TEMPLATE_ID,
  name: "Storage Failed to Plug",
  summary:
    "A host cannot plug a storage repository at start: one alert per host.",
  description:
    "Alert when a host could not plug a storage repository when it started (PBD_PLUG_FAILED_ON_SERVER_START, priority 3): the VMs whose disks live there cannot start on that host. One alert per host, which resolves once XCP-ng no longer lists the message.",
  severity: "Warning",
  alert: XcpNgMessageAlert.PbdPlugFailed,
  criteriaName: "Storage failed to plug at host start",
  alertDescription:
    "A host of this XCP-ng pool could not plug a storage repository when it started, so VMs whose disks live there cannot start on it. The host is named on this alert. Check the storage's network or paths from that host and plug it again in Xen Orchestra (the storage's page, the host's connection). The alert resolves when XCP-ng no longer lists the message.",
});

const srGcNoSpaceTemplate: XcpNgEventAlertTemplate = messageTemplate({
  id: XCP_NG_SR_GC_NO_SPACE_TEMPLATE_ID,
  name: "Storage GC Out of Space",
  summary:
    "A storage repository's garbage collection runs out of space: one alert per storage.",
  description:
    "Alert when a storage repository's garbage collector cannot coalesce disk chains for lack of space (SM_GC_NO_SPACE, priority 3). Snapshots and backups keep adding to the chains, so the repository fills faster and backups start being skipped (an unhealthy VDI chain). One alert per storage repository, which resolves once XCP-ng no longer lists the message.",
  severity: "Warning",
  alert: XcpNgMessageAlert.StorageGcNoSpace,
  criteriaName: "Storage garbage collection out of space",
  alertDescription:
    "The garbage collector of a storage repository of this XCP-ng pool has no space to coalesce disk chains. Until it does, the chains grow and backups of the VMs there are skipped to protect them. Free space on it (old snapshots, moving disks away). The storage repository is named on this alert; the alert resolves when XCP-ng no longer lists the message.",
});

const xapiAlarmTemplate: XcpNgEventAlertTemplate = {
  id: XCP_NG_XAPI_ALARM_TEMPLATE_ID,
  name: "XAPI Alarm",
  summary:
    "XCP-ng raises any other alarm of priority 1 to 3: one alert per object and alarm.",
  description: `Alert on every other XAPI message of priority 1 to 3 the named templates do not cover: threshold alarms perfmon raises (CPU, memory, disk, network, a storage repository's usage), certificates and licences expiring, a network bond or storage paths going down, clock skew, HA overcommitted. One alert per object, message and alarm, which resolves once XCP-ng no longer lists the message. With the named templates turned on too, every alerting message alerts exactly once. ${NEEDS_PROBE}`,
  category: "Alarms",
  severity: "Warning",
  isAlertingByDefault: true,
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    return buildStep({
      logMonitor: buildXcpNgMessageLogMonitor({
        poolIdentifier: args.poolIdentifier,
        alert: XcpNgMessageAlert.OtherAlarm,
        groupBy: XCP_NG_XAPI_ALARM_GROUP_BY,
        resolvesWhenCleared: true,
      }),
      criteria: buildCriteria({
        args: args,
        title: `[XCP-ng] XAPI Alarm - ${args.monitorName}`,
        description:
          "XCP-ng raised an alarm on this pool: the message, the object it is about and - for a threshold alarm - the variable perfmon watched are named on this alert, and the pool's Logs page has XAPI's own words. The alert resolves when XCP-ng no longer lists the message (dismissed in Xen Orchestra or XenCenter).",
        criteriaName: `${args.monitorName} - XAPI alarm`,
        criteriaDescription:
          "XCP-ng raised a priority 1 to 3 message, and still lists it.",
        healthyDescription: "XCP-ng lists no alarm of priority 1 to 3.",
      }),
    });
  },
};

const poolMasterChangedTemplate: XcpNgEventAlertTemplate = {
  id: XCP_NG_POOL_MASTER_CHANGED_TEMPLATE_ID,
  name: "Pool Master Changed",
  summary: "Another host becomes the pool master: one alert for the pool.",
  description: `Alert when another host takes over as the pool master (POOL_MASTER_TRANSITION, priority 4): someone designated a new master, or HA promoted one after the master failed. A notice rather than an alarm - it is on the pool's feed either way - so it is there to turn on when a master moving is news to you. It resolves after 30 minutes without another change. ${NEEDS_PROBE}`,
  category: "Alarms",
  severity: "Warning",
  isAlertingByDefault: false,
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    return buildStep({
      logMonitor: buildXcpNgMessageLogMonitor({
        poolIdentifier: args.poolIdentifier,
        alert: XcpNgMessageAlert.PoolMasterChanged,
        groupBy: [],
        resolvesWhenCleared: false,
        windowSeconds: XCP_NG_POOL_MASTER_CHANGED_WINDOW_SECONDS,
      }),
      criteria: buildCriteria({
        args: args,
        title: `[XCP-ng] Pool Master Changed - ${args.monitorName}`,
        description:
          "Another host of this XCP-ng pool became its master: someone designated it, or HA promoted it after the master failed. Check the old master, and that Xen Orchestra and the probe reach the new one. The pool's feed names both.",
        criteriaName: `${args.monitorName} - Pool master changed`,
        criteriaDescription:
          "XCP-ng reported a new pool master in the last 30 minutes.",
        healthyDescription: "The pool master has not changed in 30 minutes.",
      }),
    });
  },
};

const backupJobFailedTemplate: XcpNgEventAlertTemplate = {
  id: XCP_NG_BACKUP_JOB_FAILED_TEMPLATE_ID,
  name: "Backup Job Failed",
  summary:
    "A backup job fails: one alert per job and failed VMs, until the job succeeds again.",
  description:
    "Alert when a Xen Orchestra backup job fails for this pool's VMs - a VM it could not back up, a remote it could not reach. Each job raises its own alert, naming the VMs that failed, which resolves when the same job next succeeds for the pool, so a job that stops running keeps it open. Needs the pool's Xen Orchestra read by a probe with a Read only API token: XAPI knows nothing of Xen Orchestra's backups. It is a Logs monitor over the pool's backup runs.",
  category: "Backups",
  severity: "Warning",
  isAlertingByDefault: true,
  getMonitorStep: (args: XcpNgAlertTemplateArgs): MonitorStep => {
    return buildStep({
      logMonitor: buildXcpNgBackupJobFailedLogMonitor(args.poolIdentifier),
      criteria: buildCriteria({
        args: args,
        title: `[XCP-ng] Backup Job Failed - ${args.monitorName}`,
        /*
         * The job and the VMs that failed are the alert's group, named
         * under its title (SeriesContextEnricher); why each failed is in
         * the run's record and on the pool's Backups card.
         */
        description: `A Xen Orchestra backup job failed for VMs of ${args.monitorName}. The job and the VMs that failed are named on this alert; why each one failed is on the pool's Backups card and in the run's record on its Logs page, as Xen Orchestra wrote it. Fix the cause and run the job again from Xen Orchestra: the alert resolves when the job next succeeds for the pool.`,
        criteriaName: `${args.monitorName} - Backup job failed`,
        criteriaDescription:
          "A backup job failed for this pool's VMs and has not succeeded since.",
        healthyDescription: "Every backup job succeeded on its last run.",
      }),
    });
  },
};

// Every XCP-ng alert built on what XCP-ng and Xen Orchestra say themselves.
export function getAllXcpNgEventAlertTemplates(): Array<XcpNgEventAlertTemplate> {
  return [
    vmCrashedTemplate,
    haHostFailedTemplate,
    haStatefileLostTemplate,
    haVmRestartFailedTemplate,
    pbdPlugFailedTemplate,
    srGcNoSpaceTemplate,
    xapiAlarmTemplate,
    backupJobFailedTemplate,
    poolMasterChangedTemplate,
  ];
}

export function getXcpNgEventAlertTemplateById(
  id: string,
): XcpNgEventAlertTemplate | undefined {
  return getAllXcpNgEventAlertTemplates().find(
    (template: XcpNgEventAlertTemplate): boolean => {
      return template.id === id;
    },
  );
}
