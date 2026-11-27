import {
  XCP_NG_BACKUP_JOB_FAILED_GROUP_BY,
  XCP_NG_BACKUP_JOB_FAILED_TEMPLATE_ID,
  XCP_NG_EVENT_WINDOW_SECONDS,
  XCP_NG_MESSAGE_GROUP_BY,
  XCP_NG_POOL_ID_LOG_ATTRIBUTE,
  XCP_NG_POOL_MASTER_CHANGED_TEMPLATE_ID,
  XCP_NG_POOL_MASTER_CHANGED_WINDOW_SECONDS,
  XCP_NG_XAPI_ALARM_GROUP_BY,
  XCP_NG_XAPI_ALARM_TEMPLATE_ID,
  XcpNgEventAlertTemplate,
  getAllXcpNgEventAlertTemplates,
  getXcpNgEventAlertTemplateById,
} from "../../../Types/Monitor/XcpNgEventAlertTemplates";
import { XcpNgAlertTemplateArgs } from "../../../Types/Monitor/XcpNgAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import { CheckOn, FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import SeriesLabelDisplay from "../../../Types/Monitor/SeriesContext/SeriesLabelDisplay";
import MonitorRecommendationCatalog from "../../../Types/Monitor/Recommendation/MonitorRecommendationCatalog";
import {
  MonitorRecommendation,
  MonitorRecommendationResourceType,
} from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  XcpNgPoolEventsOutput,
  XcpNgStoredResource,
  processXcpNgPoolEvents,
} from "../../../Server/Utils/XcpNg/XcpNgPoolEventsProcessing";
import {
  XcpNgEventSource,
  XcpNgPoolEventState,
} from "../../../Types/XcpNg/XcpNgPoolEventState";
import { XcpNgBackupStatus } from "../../../Types/XcpNg/XcpNgPoolEvents";
import { XcpNgPoolMessage } from "../../../Types/XcpNg/XcpNgProbeCollection";
import XcpNgResourceKind from "../../../Types/XcpNg/XcpNgResourceKind";
import FakeXenOrchestraRest, {
  FAKE_XO_TOKEN,
  FakeXoResponse,
  LAB_POOL_PRODUCTION,
} from "../../Helpers/XcpNg/FakeXenOrchestraRest";
import {
  readXoAlarms,
  readXoBackupRun,
  readXoMessages,
} from "../../../Utils/XcpNg/XenOrchestraRest";
import { describe, expect, test } from "@jest/globals";

/*
 * The alert templates over what XCP-ng and Xen Orchestra say themselves
 * (XcpNgEventAlertTemplates), held to the records the events ingest really
 * writes for the recorded lab: each alerting message is matched by exactly
 * one template, each record carries what its template groups by, and the
 * record that clears or resolves an alert lands in that alert's own group.
 */

const POOL: string = LAB_POOL_PRODUCTION;

const ARGS: XcpNgAlertTemplateArgs = {
  poolIdentifier: POOL,
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Production",
};

function logMonitorOf(
  template: XcpNgEventAlertTemplate,
): MonitorStepLogMonitor {
  const step: MonitorStep = template.getMonitorStep(ARGS);
  return step.data?.logMonitor as MonitorStepLogMonitor;
}

// A record as the logs store keeps it: resource attributes prefixed.
function storedAttributes(record: JSONObject): Record<string, string> {
  const out: Record<string, string> = {
    [XCP_NG_POOL_ID_LOG_ATTRIBUTE]: POOL,
  };
  for (const entry of (record["attributes"] || []) as JSONArray) {
    const attribute: JSONObject = entry as JSONObject;
    out[String(attribute["key"])] = String(
      ((attribute["value"] || {}) as JSONObject)["stringValue"],
    );
  }
  return out;
}

function matches(
  filter: Record<string, string | number | boolean>,
  record: Record<string, string>,
): boolean {
  return Object.keys(filter).every((key: string): boolean => {
    return record[key] === String(filter[key]);
  });
}

function labRows(): Array<XcpNgStoredResource> {
  const base: Omit<XcpNgStoredResource, "kind" | "externalId" | "name"> = {
    isUp: true,
    isEnabled: true,
    isControlDomain: false,
    lastSuccessfulBackupAt: null,
    backupIntervalSeconds: null,
    missingPatchCount: null,
  };
  return [
    [
      "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
      "xcp-prod-01",
      XcpNgResourceKind.Host,
    ],
    [
      "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
      "xcp-prod-02",
      XcpNgResourceKind.Host,
    ],
    [
      "f0e1d2c3-b4a5-4968-8776-655443322110",
      "xcp-prod-03",
      XcpNgResourceKind.Host,
    ],
    ["e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c", "web-01", XcpNgResourceKind.VM],
    ["3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f", "db-01", XcpNgResourceKind.VM],
    ["7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e", "app-02", XcpNgResourceKind.VM],
    [
      "1d2c3b4a-5e6f-4789-9abc-def012345678",
      "NFS VM store",
      XcpNgResourceKind.StorageRepository,
    ],
  ].map(([externalId, name, kind]: Array<string>) => {
    return {
      ...base,
      kind: kind as string,
      externalId: externalId as string,
      name: name as string,
    };
  });
}

async function labGet(
  xo: FakeXenOrchestraRest,
  path: string,
): Promise<unknown> {
  const response: FakeXoResponse = await xo.handle({
    method: "GET",
    path: path,
    headers: { Cookie: `authenticationToken=${FAKE_XO_TOKEN}` },
  });
  return JSON.parse(response.body) as unknown;
}

// Every message of the lab's first three minutes, as the probe reports them.
async function labMessages(): Promise<Array<XcpNgPoolMessage>> {
  const xo: FakeXenOrchestraRest = new FakeXenOrchestraRest();
  xo.setNowSeconds(1795000200);
  const filter: string = encodeURIComponent(`$pool:${POOL}`);
  return [
    ...readXoMessages(
      await labGet(
        xo,
        `/rest/v0/messages?fields=id,name,time,$object,$pool,body&filter=${filter}`,
      ),
    ),
    ...readXoAlarms(
      await labGet(
        xo,
        `/rest/v0/alarms?fields=id,name,time,object,$pool,body&filter=${filter}`,
      ),
    ),
  ];
}

function process(
  data: Partial<Parameters<typeof processXcpNgPoolEvents>[0]>,
): XcpNgPoolEventsOutput {
  return processXcpNgPoolEvents({
    now: new Date(1795000200 * 1000),
    source: XcpNgEventSource.XenOrchestra,
    pool: {
      xcpNgPoolId: "6b3f2a10-0000-4000-8000-0000000000aa",
      poolIdentifier: POOL,
      name: "Production",
      reportedName: "Production",
      xenOrchestraName: null,
      isHaEnabled: null,
      haHostFailuresToTolerate: null,
      haPlanExistsFor: null,
      isHaOvercommitted: null,
      masterHostExternalId: null,
      backupJobs: null,
      eventState: null,
    },
    inventory: labRows(),
    messagesRead: true,
    messages: [],
    clearedMessageIds: [],
    patchesChecked: false,
    problems: {},
    ...data,
  });
}

describe("every template", () => {
  test("ids, names and words", () => {
    const templates: Array<XcpNgEventAlertTemplate> =
      getAllXcpNgEventAlertTemplates();
    expect(
      templates.map((template: XcpNgEventAlertTemplate) => {
        return template.id;
      }),
    ).toEqual([
      "xcp-ng-vm-crashed",
      "xcp-ng-ha-host-failed",
      "xcp-ng-ha-statefile-lost",
      "xcp-ng-ha-protected-vm-restart-failed",
      "xcp-ng-pbd-plug-failed",
      "xcp-ng-sr-gc-no-space",
      "xcp-ng-xapi-alarm",
      "xcp-ng-backup-job-failed",
      "xcp-ng-pool-master-changed",
    ]);
    for (const template of templates) {
      expect(template.name.length).toBeGreaterThan(5);
      expect(template.summary.length).toBeGreaterThan(20);
      expect(template.summary.length).toBeLessThanOrEqual(150);
      // Drawn as plain text on the recommendation card.
      expect(template.description).not.toContain("`");
      expect(template.summary).not.toContain("`");
      expect(getXcpNgEventAlertTemplateById(template.id)).toBe(template);
    }
    expect(getXcpNgEventAlertTemplateById("nope")).toBeUndefined();
  });

  test("priority 1 to 3 alert by default; Pool Master Changed is there to turn on", () => {
    for (const template of getAllXcpNgEventAlertTemplates()) {
      expect({ id: template.id, on: template.isAlertingByDefault }).toEqual({
        id: template.id,
        on: template.id !== XCP_NG_POOL_MASTER_CHANGED_TEMPLATE_ID,
      });
    }
  });

  test("a Logs monitor scoped to the pool, alerting and opening an incident", () => {
    for (const template of getAllXcpNgEventAlertTemplates()) {
      const step: MonitorStep = template.getMonitorStep(ARGS);
      const monitor: MonitorStepLogMonitor = step.data
        ?.logMonitor as MonitorStepLogMonitor;
      expect(monitor.attributes[XCP_NG_POOL_ID_LOG_ATTRIBUTE]).toBe(POOL);
      expect(monitor.lastXSecondsOfLogs).toBe(
        template.id === XCP_NG_POOL_MASTER_CHANGED_TEMPLATE_ID
          ? XCP_NG_POOL_MASTER_CHANGED_WINDOW_SECONDS
          : XCP_NG_EVENT_WINDOW_SECONDS,
      );
      expect(step.data?.metricMonitor).toBeUndefined();

      const [offline, online] = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<MonitorCriteriaInstance>;
      expect(offline?.data?.filters).toEqual([
        {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 0,
        },
      ]);
      expect(offline?.data?.createAlerts).toBe(true);
      expect(offline?.data?.createIncidents).toBe(true);
      expect(offline?.data?.alerts[0]?.title).toBe(
        `[XCP-ng] ${template.name} - Production`,
      );
      expect(offline?.data?.alerts[0]?.autoResolveAlert).toBe(true);
      expect(online?.data?.filters).toEqual([
        { checkOn: CheckOn.LogCount, filterType: FilterType.EqualTo, value: 0 },
      ]);
    }
  });

  test("every key a template groups by has a name an alert can show", () => {
    for (const key of [
      ...XCP_NG_MESSAGE_GROUP_BY,
      ...XCP_NG_XAPI_ALARM_GROUP_BY,
      ...XCP_NG_BACKUP_JOB_FAILED_GROUP_BY,
    ]) {
      expect({ key, known: SeriesLabelDisplay.isKnownLabelKey(key) }).toEqual({
        key,
        known: true,
      });
    }
    // An object and a job by name first, in the alert's title.
    expect(
      SeriesLabelDisplay.getLabelPriority("xcp_ng.object.name"),
    ).toBeLessThan(SeriesLabelDisplay.getLabelPriority("xcp_ng.object.uuid"));
    expect(
      SeriesLabelDisplay.getLabelPriority("xcp_ng.backup.job.name"),
    ).toBeLessThan(SeriesLabelDisplay.getLabelPriority("xcp_ng.backup.job.id"));
  });
});

describe("held to the records the ingest writes for the lab", () => {
  test("each alerting message is matched by exactly one template; the rest by none", async () => {
    const output: XcpNgPoolEventsOutput = process({
      messages: await labMessages(),
    });

    const templates: Array<XcpNgEventAlertTemplate> =
      getAllXcpNgEventAlertTemplates();
    let alerting: number = 0;

    for (const record of output.records) {
      const stored: Record<string, string> = storedAttributes(record);
      const matching: Array<string> = templates
        .filter((template: XcpNgEventAlertTemplate) => {
          return matches(logMonitorOf(template).attributes, stored);
        })
        .map((template: XcpNgEventAlertTemplate) => {
          return template.id;
        });

      const priority: number = Number(stored["xcp_ng.message.priority"]);
      const name: string = stored["xcp_ng.message.name"] as string;

      if (name === "POOL_MASTER_TRANSITION") {
        expect(matching).toEqual([XCP_NG_POOL_MASTER_CHANGED_TEMPLATE_ID]);
      } else if (priority <= 3) {
        alerting++;
        expect({ name, matching: matching.length }).toEqual({
          name,
          matching: 1,
        });
      } else {
        expect({ name, matching }).toEqual({ name, matching: [] });
      }

      // What its template groups by, it carries.
      for (const id of matching) {
        const template: XcpNgEventAlertTemplate =
          getXcpNgEventAlertTemplateById(id) as XcpNgEventAlertTemplate;
        for (const key of MonitorStepLogMonitorUtil.getGroupByAttributes(
          logMonitorOf(template),
        )) {
          expect(Object.prototype.hasOwnProperty.call(stored, key)).toBe(true);
        }
      }
    }

    /*
     * The lab's alerting messages to its third minute: the history's fs_usage
     * ALARM, a crash, HA losing a host, its state file and a protected VM,
     * storage failing to plug and running out of GC space, the HA plan
     * dropping, two threshold alarms, a bond and storage paths down.
     */
    expect(alerting).toBe(12);
  });

  test("the record that clears a message lands in its alert's group, and resolves it", async () => {
    const messages: Array<XcpNgPoolMessage> = await labMessages();
    const raised: XcpNgPoolEventsOutput = process({ messages: messages });
    const state: XcpNgPoolEventState = raised.columns.eventState;

    const cleared: XcpNgPoolEventsOutput = process({
      pool: {
        xcpNgPoolId: "6b3f2a10-0000-4000-8000-0000000000aa",
        poolIdentifier: POOL,
        name: "Production",
        reportedName: "Production",
        xenOrchestraName: null,
        isHaEnabled: null,
        haHostFailuresToTolerate: null,
        haPlanExistsFor: null,
        isHaOvercommitted: null,
        masterHostExternalId: null,
        backupJobs: null,
        eventState: state,
      },
      clearedMessageIds: state.openMessages.map((open: { id: string }) => {
        return open.id;
      }),
    });

    expect(cleared.records.length).toBe(state.openMessages.length);

    for (const template of getAllXcpNgEventAlertTemplates()) {
      const monitor: MonitorStepLogMonitor = logMonitorOf(template);
      const resolvedBy: Record<string, string> =
        MonitorStepLogMonitorUtil.getResolvedByAttributes(monitor);
      if (Object.keys(resolvedBy).length === 0) {
        continue;
      }
      const groupBy: Array<string> =
        MonitorStepLogMonitorUtil.getGroupByAttributes(monitor);

      for (const record of raised.records) {
        const opened: Record<string, string> = storedAttributes(record);
        if (!matches(monitor.attributes, opened)) {
          continue;
        }
        // The cleared record of the same group: the same group values.
        const resolving: Array<Record<string, string>> = cleared.records
          .map(storedAttributes)
          .filter((candidate: Record<string, string>) => {
            return (
              matches(resolvedBy, candidate) &&
              groupBy.every((key: string): boolean => {
                return candidate[key] === opened[key];
              })
            );
          });
        expect({
          template: template.id,
          name: opened["xcp_ng.message.name"],
          resolving: resolving.length,
        }).toEqual({
          template: template.id,
          name: opened["xcp_ng.message.name"],
          resolving: 1,
        });
      }
    }
  });

  test("Backup Job Failed names the failed VMs, and the job's next success resolves it", async () => {
    const xo: FakeXenOrchestraRest = new FakeXenOrchestraRest();
    const failedRun: ReturnType<typeof readXoBackupRun> = readXoBackupRun(
      await labGet(xo, "/rest/v0/backup-logs/1794996000000"),
    );
    const failed: XcpNgPoolEventsOutput = process({
      backupRuns: [failedRun as NonNullable<typeof failedRun>],
    });

    const template: XcpNgEventAlertTemplate = getXcpNgEventAlertTemplateById(
      XCP_NG_BACKUP_JOB_FAILED_TEMPLATE_ID,
    ) as XcpNgEventAlertTemplate;
    const monitor: MonitorStepLogMonitor = logMonitorOf(template);

    const opened: Array<Record<string, string>> = failed.records
      .map(storedAttributes)
      .filter((stored: Record<string, string>) => {
        return matches(monitor.attributes, stored);
      });
    expect(opened).toHaveLength(1);
    expect(opened[0]?.["xcp_ng.backup.failed_vms"]).toBe("web-01, app-02");

    const success: NonNullable<typeof failedRun> = {
      ...(failedRun as NonNullable<typeof failedRun>),
      runId: "1795082400000",
      status: XcpNgBackupStatus.Success,
      startedAt: new Date(1795082400000).toISOString(),
      endedAt: new Date(1795083000000).toISOString(),
      vms: (failedRun as NonNullable<typeof failedRun>).vms.map(
        (vm: { vmId: string; vmName?: string | undefined }) => {
          return {
            vmId: vm.vmId,
            vmName: vm.vmName,
            status: XcpNgBackupStatus.Success,
          };
        },
      ),
    };
    const resolved: XcpNgPoolEventsOutput = process({
      now: new Date(1795083060000),
      pool: {
        xcpNgPoolId: "6b3f2a10-0000-4000-8000-0000000000aa",
        poolIdentifier: POOL,
        name: "Production",
        reportedName: "Production",
        xenOrchestraName: null,
        isHaEnabled: null,
        haHostFailuresToTolerate: null,
        haPlanExistsFor: null,
        isHaOvercommitted: null,
        masterHostExternalId: null,
        backupJobs: failed.columns.backupJobs || null,
        eventState: failed.columns.eventState,
      },
      backupRuns: [success],
    });

    const resolvedBy: Record<string, string> =
      MonitorStepLogMonitorUtil.getResolvedByAttributes(monitor);
    const groupBy: Array<string> =
      MonitorStepLogMonitorUtil.getGroupByAttributes(monitor);
    const closing: Array<Record<string, string>> = resolved.records
      .map(storedAttributes)
      .filter((stored: Record<string, string>) => {
        return (
          matches(resolvedBy, stored) &&
          groupBy.every((key: string): boolean => {
            return stored[key] === opened[0]?.[key];
          })
        );
      });
    expect(closing).toHaveLength(1);
  });
});

describe("offered on the pool's Recommendations page", () => {
  test("beside the metric templates, as Logs monitors", () => {
    const recommendations: Array<MonitorRecommendation> =
      MonitorRecommendationCatalog.getRecommendations(
        MonitorRecommendationResourceType.XcpNg,
      );
    const logs: Array<MonitorRecommendation> = recommendations.filter(
      (recommendation: MonitorRecommendation) => {
        return recommendation.monitorType === MonitorType.Logs;
      },
    );
    expect(
      logs.map((recommendation: MonitorRecommendation) => {
        return recommendation.templateId;
      }),
    ).toEqual(
      getAllXcpNgEventAlertTemplates().map(
        (template: XcpNgEventAlertTemplate) => {
          return template.id;
        },
      ),
    );
    expect(
      recommendations.some((recommendation: MonitorRecommendation) => {
        return (
          recommendation.templateId === "xcp-ng-ha-cannot-tolerate-host-failure"
        );
      }),
    ).toBe(true);
    expect(
      MonitorRecommendationCatalog.getResourceTypeDefinition(
        MonitorRecommendationResourceType.XcpNg,
      )?.monitorTypes,
    ).toEqual([MonitorType.XcpNg, MonitorType.Logs]);

    const alarm: MonitorRecommendation = logs.find(
      (recommendation: MonitorRecommendation) => {
        return recommendation.templateId === XCP_NG_XAPI_ALARM_TEMPLATE_ID;
      },
    ) as MonitorRecommendation;
    expect(alarm.category).toBe("Alarms");
  });
});
