import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import LogMonitorCriteria from "../../../Server/Utils/Monitor/Criteria/LogMonitorCriteria";
import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import LogMonitorResponse from "../../../Types/Monitor/LogMonitor/LogMonitorResponse";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import {
  STORAGE_ARRAY_NAME_LOG_ATTRIBUTE,
  StorageArrayLogAlertTemplate,
  getAllStorageArrayLogAlertTemplates,
  getStorageArrayLogAlertTemplateById,
  getStorageArrayLogAlertTemplatesForSystem,
} from "../../../Types/Monitor/StorageArrayLogAlertTemplates";
import { StorageArrayAlertTemplateArgs } from "../../../Types/Monitor/StorageArrayAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import {
  POWERSTORE_ALERT_STATE_CLEARED,
  POWERSTORE_LOG_ATTRIBUTES,
  POWERSTORE_PORT_LINK_DOWN_EVENT_CODE,
} from "../../../Types/StorageArray/Platforms/Dell/PowerStore/PowerStoreSyslog";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";

/*
 * THE ALERTS AN ARRAY SENDS AS LOGS (#11002).
 *
 * A PowerStore sends its alerts by syslog; the agent's syslog collector
 * reads each line into flat attributes (agents/StorageArrayAgent/
 * powerstore-syslog.yaml), and these templates are Logs monitors over them:
 * one alert per PowerStore alert, resolved by its Cleared line. Each is
 * built and validated as a Logs monitor here, and then run on what the
 * shipped collector made of PowerStore lines
 * (Fixtures/DellPowerStoreExporter/v1.0.3/collector/syslog.jsonl): the
 * records each template's query reads, the group each falls in, the line
 * that resolves it.
 */

const ARRAY_NAME: string = "ps-prod-01";

function args(): StorageArrayAlertTemplateArgs {
  return {
    arrayIdentifier: ARRAY_NAME,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "ps-prod-01 alerts",
  };
}

interface Built {
  template: StorageArrayLogAlertTemplate;
  step: MonitorStep;
  logMonitor: MonitorStepLogMonitor;
  unhealthy: MonitorCriteriaInstance;
  healthy: MonitorCriteriaInstance;
}

function build(template: StorageArrayLogAlertTemplate): Built {
  const step: MonitorStep = template.getMonitorStep(args());
  const instances: Array<MonitorCriteriaInstance> =
    step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray;
  expect(instances).toHaveLength(2);
  return {
    template,
    step,
    logMonitor: step.data!.logMonitor!,
    unhealthy: instances[0]!,
    healthy: instances[1]!,
  };
}

function byId(id: string): Built {
  const template: StorageArrayLogAlertTemplate | undefined =
    getStorageArrayLogAlertTemplateById(id);
  expect(template).toBeDefined();
  return build(template!);
}

const ALL: Array<StorageArrayLogAlertTemplate> =
  getAllStorageArrayLogAlertTemplates();

const CASES: Array<[string, StorageArrayLogAlertTemplate]> = ALL.map(
  (
    template: StorageArrayLogAlertTemplate,
  ): [string, StorageArrayLogAlertTemplate] => {
    return [template.id, template];
  },
);

/* --------------------------------------------------------- the templates */

describe("every storage array log template", () => {
  test("is a PowerStore's for now: three of them, each id once", () => {
    expect(
      ALL.map((template: StorageArrayLogAlertTemplate) => {
        return template.id;
      }),
    ).toEqual([
      "powerstore-critical-alert",
      "powerstore-major-alert",
      "powerstore-port-link-down",
    ]);
  });

  test.each(CASES)(
    "%s builds a valid Logs monitor step, and survives a JSON round trip",
    (_id: string, template: StorageArrayLogAlertTemplate) => {
      const built: Built = build(template);
      expect(
        MonitorStep.getValidationError(built.step, MonitorType.Logs),
      ).toBeNull();
      // Only the logs sub-config is populated.
      expect(built.step.data?.storageArrayMonitor).toBeUndefined();
      expect(built.step.data?.metricMonitor).toBeUndefined();

      const restored: MonitorStep = MonitorStep.fromJSON(
        JSON.parse(JSON.stringify(built.step.toJSON())) as JSONObject,
      );
      // Read back, a step names its entity filter, empty.
      expect(restored.data?.logMonitor).toEqual({
        ...built.logMonitor,
        entityKeys: [],
      });
      expect(
        MonitorStep.getValidationError(restored, MonitorType.Logs),
      ).toBeNull();
    },
  );

  test.each(CASES)(
    "%s reads its array's lines alone, opening and resolving on them",
    (_id: string, template: StorageArrayLogAlertTemplate) => {
      const { logMonitor } = build(template);
      expect(logMonitor.attributes[STORAGE_ARRAY_NAME_LOG_ATTRIBUTE]).toBe(
        ARRAY_NAME,
      );
      expect(
        logMonitor.resolvedByAttributes![STORAGE_ARRAY_NAME_LOG_ATTRIBUTE],
      ).toBe(ARRAY_NAME);
      // No text, severity, service or entity filter: the attributes say it.
      expect(logMonitor.body).toBe("");
      expect(logMonitor.severityTexts).toEqual([]);
      expect(logMonitor.telemetryServiceIds).toEqual([]);
      // A group per alert, which a line closes, never the window moving on.
      expect(
        MonitorStepLogMonitorUtil.getGroupByAttributes(logMonitor).length,
      ).toBeGreaterThan(0);
      expect(MonitorStepLogMonitorUtil.isResolvedByLog(logMonitor)).toBe(true);
      expect(logMonitor.lastXSecondsOfLogs).toBeGreaterThanOrEqual(600);
    },
  );

  test.each(CASES)(
    "%s fires on a line and is healthy on none, raising an alert and an incident that resolve themselves",
    async (_id: string, template: StorageArrayLogAlertTemplate) => {
      const built: Built = build(template);
      const fire: CriteriaFilter = built.unhealthy.data!.filters[0]!;
      const recover: CriteriaFilter = built.healthy.data!.filters[0]!;
      expect(fire).toMatchObject({
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 0,
      });
      expect(recover).toMatchObject({
        checkOn: CheckOn.LogCount,
        filterType: FilterType.EqualTo,
        value: 0,
      });

      const response: (logCount: number) => LogMonitorResponse = (
        logCount: number,
      ): LogMonitorResponse => {
        return {
          projectId: ObjectID.generate(),
          logCount,
          logQuery: {},
          monitorId: ObjectID.generate(),
        } as unknown as LogMonitorResponse;
      };
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(1),
          criteriaFilter: fire,
        }),
      ).not.toBeNull();
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(0),
          criteriaFilter: fire,
        }),
      ).toBeNull();
      expect(
        await LogMonitorCriteria.isMonitorInstanceCriteriaFilterMet({
          dataToProcess: response(0),
          criteriaFilter: recover,
        }),
      ).not.toBeNull();

      expect(built.unhealthy.data!.createAlerts).toBe(true);
      expect(built.unhealthy.data!.createIncidents).toBe(true);
      expect(built.unhealthy.data!.alerts![0]!.autoResolveAlert).toBe(true);
      expect(built.unhealthy.data!.incidents![0]!.autoResolveIncident).toBe(
        true,
      );
      expect(built.unhealthy.data!.alerts![0]!.title).toMatch(
        /^\[Storage Array\] .* - ps-prod-01 alerts$/,
      );
      expect(built.healthy.data!.createAlerts).toBe(false);
      expect(built.healthy.data!.name).toBe("Healthy");
    },
  );

  test.each(CASES)(
    "%s is filed under Array Alerts, with a severity the recommendation mapper knows",
    (_id: string, template: StorageArrayLogAlertTemplate) => {
      expect(template.category).toBe("Array Alerts");
      expect(["Critical", "Warning"]).toContain(template.severity);
      expect(template.summary.length).toBeGreaterThan(20);
      expect(template.description).toContain("syslog");
      expect(template.storageSystems).toEqual([StorageSystem.DellPowerStore]);
      const { unhealthy } = build(template);
      if (template.severity === "Critical") {
        expect(unhealthy.data!.incidents![0]!.title).toContain("CRITICAL:");
      } else {
        expect(unhealthy.data!.incidents![0]!.title).not.toContain("CRITICAL:");
      }
    },
  );
});

describe("which arrays are offered them", () => {
  test("a PowerStore, all three", () => {
    expect(
      getStorageArrayLogAlertTemplatesForSystem(StorageSystem.DellPowerStore),
    ).toEqual(ALL);
  });

  test.each([
    ["a FlashArray", StorageSystem.PureStorageFlashArray],
    ["a FlashBlade", StorageSystem.PureStorageFlashBlade],
    ["a platform OneUptime does not know", "netapp.ontap"],
    ["an array that has not said", null],
    ["an empty platform", ""],
  ])("%s, none", (_label: string, system: string | null) => {
    expect(getStorageArrayLogAlertTemplatesForSystem(system)).toEqual([]);
  });

  test("an alias is not a platform: an array's row holds the canonical value", () => {
    expect(getStorageArrayLogAlertTemplatesForSystem("powerstore")).toEqual([]);
  });

  test("a template is found by its id, and only by it", () => {
    for (const template of ALL) {
      expect(getStorageArrayLogAlertTemplateById(template.id)).toBe(template);
    }
    expect(
      getStorageArrayLogAlertTemplateById("purefa-critical-alerts"),
    ).toBeUndefined();
    expect(getStorageArrayLogAlertTemplateById("")).toBeUndefined();
  });
});

/* ---------------------------------------------- on what PowerStore sent */

interface StoredLog {
  body: string;
  // As OneUptime stores a log: its attributes, and its resource's as resource.*.
  attributes: Record<string, string>;
}

function readStoredLogs(): Array<StoredLog> {
  const logs: Array<StoredLog> = [];
  const text: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../Fixtures/DellPowerStoreExporter/v1.0.3/collector/syslog.jsonl",
    ),
    "utf8",
  );
  for (const line of text.split("\n").filter(Boolean)) {
    for (const resourceLogs of ((JSON.parse(line) as JSONObject)[
      "resourceLogs"
    ] || []) as JSONArray) {
      const rl: JSONObject = resourceLogs as JSONObject;
      const resource: Record<string, string> = {};
      for (const attribute of ((rl["resource"] as JSONObject)["attributes"] ||
        []) as JSONArray) {
        const a: JSONObject = attribute as JSONObject;
        resource[`resource.${a["key"] as string}`] = String(
          Object.values(a["value"] as JSONObject)[0],
        );
      }
      for (const scopeLogs of (rl["scopeLogs"] || []) as JSONArray) {
        for (const record of ((scopeLogs as JSONObject)["logRecords"] ||
          []) as JSONArray) {
          const r: JSONObject = record as JSONObject;
          const attributes: Record<string, string> = { ...resource };
          for (const attribute of (r["attributes"] || []) as JSONArray) {
            const a: JSONObject = attribute as JSONObject;
            attributes[a["key"] as string] = String(
              Object.values(a["value"] as JSONObject)[0],
            );
          }
          logs.push({
            body: String(
              Object.values((r["body"] || {}) as JSONObject)[0] ?? "",
            ),
            attributes,
          });
        }
      }
    }
  }
  return logs;
}

const LOGS: Array<StoredLog> = readStoredLogs();

function matches(
  query: Record<string, string | number | boolean>,
  log: StoredLog,
): boolean {
  return Object.entries(query).every(
    ([key, value]: [string, string | number | boolean]): boolean => {
      return log.attributes[key] === String(value);
    },
  );
}

// The bodies of the lines a template's query reads.
function opened(id: string): Array<string> {
  const { logMonitor } = byId(id);
  return LOGS.filter((log: StoredLog): boolean => {
    return matches(logMonitor.attributes, log);
  })
    .map((log: StoredLog): string => {
      return log.body;
    })
    .sort();
}

function groupOf(id: string, log: StoredLog): Array<string | undefined> {
  return MonitorStepLogMonitorUtil.getGroupByAttributes(
    byId(id).logMonitor,
  ).map((key: string): string | undefined => {
    return log.attributes[key];
  });
}

function logWithBody(body: string): StoredLog {
  const found: Array<StoredLog> = LOGS.filter((log: StoredLog): boolean => {
    return log.body === body;
  });
  expect({ body, found: found.length }).toEqual({ body, found: 1 });
  return found[0]!;
}

describe("on the lines the shipped syslog collector read from a PowerStore", () => {
  test("every line is the array's, as the Logs page and the templates read it", () => {
    expect(LOGS.length).toBeGreaterThanOrEqual(9);
    for (const log of LOGS) {
      expect(log.attributes[STORAGE_ARRAY_NAME_LOG_ATTRIBUTE]).toBe(ARRAY_NAME);
    }
  });

  test("Critical Array Alert opens on the Critical alerts: the failed drive and the failed node", () => {
    expect(opened("powerstore-critical-alert")).toEqual([
      "Drive in bus 0 enclosure 0 slot 7 has failed for this reason: media failure.",
      "The Node has failed to start services.",
    ]);
  });

  test("Major Array Alert opens on the Major ones: the port down, the full appliance, the code Dell's guide does not list", () => {
    expect(opened("powerstore-major-alert")).toEqual([
      "An event code Dell's guide of February 2025 does not list.",
      "Physical capacity utilization is above 90 percent.",
      "Port link is down.",
    ]);
  });

  test("Port Link Down opens on the port that lost its link, and only on it", () => {
    expect(opened("powerstore-port-link-down")).toEqual(["Port link is down."]);
    const down: StoredLog = logWithBody("Port link is down.");
    expect(down.attributes[POWERSTORE_LOG_ATTRIBUTES.eventCode]).toBe(
      POWERSTORE_PORT_LINK_DOWN_EVENT_CODE,
    );
  });

  test("the audit log and a line that is not PowerStore's open nothing", () => {
    for (const body of [
      'User "admin" logged in successfully.',
      "This line is not PowerStore's at all.",
    ]) {
      const log: StoredLog = logWithBody(body);
      for (const template of ALL) {
        expect({
          template: template.id,
          opens: matches(build(template).logMonitor.attributes, log),
        }).toEqual({ template: template.id, opens: false });
      }
    }
  });

  test("the Cleared line resolves the port's alert, in the very group its Active line opened", () => {
    const down: StoredLog = logWithBody("Port link is down.");
    const up: StoredLog = logWithBody(
      "Port state has changed from Down to Up.",
    );
    expect(up.attributes[POWERSTORE_LOG_ATTRIBUTES.alertState]).toBe(
      POWERSTORE_ALERT_STATE_CLEARED,
    );
    for (const id of ["powerstore-port-link-down", "powerstore-major-alert"]) {
      const { logMonitor } = byId(id);
      // It opens nothing itself (a Cleared line has no severity)...
      expect(matches(logMonitor.attributes, up)).toBe(false);
      // ...and is the line that resolves the group.
      expect(
        matches(
          MonitorStepLogMonitorUtil.getResolvedByAttributes(logMonitor),
          up,
        ),
      ).toBe(true);
      expect(groupOf(id, up)).toEqual(groupOf(id, down));
      expect(groupOf(id, down).every(Boolean)).toBe(true);
    }
  });

  test("an Active line never resolves its own alert", () => {
    for (const template of ALL) {
      const resolvedBy: Record<string, string> =
        MonitorStepLogMonitorUtil.getResolvedByAttributes(
          build(template).logMonitor,
        );
      for (const log of LOGS.filter((candidate: StoredLog): boolean => {
        return (
          candidate.attributes[POWERSTORE_LOG_ATTRIBUTES.alertState] ===
          "Active"
        );
      })) {
        expect(matches(resolvedBy, log)).toBe(false);
      }
    }
  });

  test("two alerts of the same object are two groups, the same alert's lines one", () => {
    const groups: Set<string> = new Set(
      LOGS.filter((log: StoredLog): boolean => {
        return matches(
          byId("powerstore-major-alert").logMonitor.attributes,
          log,
        );
      }).map((log: StoredLog): string => {
        return JSON.stringify(groupOf("powerstore-major-alert", log));
      }),
    );
    // Three Major alerts, three groups.
    expect(groups.size).toBe(3);
  });
});
