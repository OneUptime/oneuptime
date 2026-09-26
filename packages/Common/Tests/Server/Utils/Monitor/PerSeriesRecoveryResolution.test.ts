import MonitorIncident from "../../../../Server/Utils/Monitor/MonitorIncident";
import MonitorAlert from "../../../../Server/Utils/Monitor/MonitorAlert";
import PerSeriesResolutionRootCause from "../../../../Server/Utils/Monitor/PerSeriesResolutionRootCause";
import AlertService from "../../../../Server/Services/AlertService";
import AlertStateTimelineService from "../../../../Server/Services/AlertStateTimelineService";
import IncidentService from "../../../../Server/Services/IncidentService";
import IncidentStateTimelineService from "../../../../Server/Services/IncidentStateTimelineService";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Alert from "../../../../Models/DatabaseModels/Alert";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * Regression tests for per-series offline/online auto-resolve.
 *
 * Per-series offline monitors (Host / Proxmox / Ceph / IoTDevice) pair
 * an OFFLINE criteria that creates incidents (e.g. Min(device_up) < 1)
 * with a RECOVERY criteria that does not (Min(device_up) >= 1), grouped
 * by a device/host key. Exactly one criteria wins per evaluation tick,
 * and the breaching-series set handed to shouldClose{Incident,Alert} is
 * that winning criteria's per-series matches.
 *
 * On the recovery tick the RECOVERY criteria wins, so its matches are
 * the healthy series — NOT breaches. The bug: membership in that set was
 * treated as "still breaching", so the open offline incident's own
 * fingerprint kept it pinned open forever once no other series was down.
 * The fix only counts membership when the matched criteria actually
 * creates incidents/alerts.
 */

const CREATED_CRITERIA_ID: string = "offline-criteria";
const TEMPLATE_ID: string = "template-1";
const DEVICE_FP: string = "fp-device-1";

const INCIDENT_AUTO_RESOLVE: Dictionary<Array<string>> = {
  [CREATED_CRITERIA_ID]: [TEMPLATE_ID],
};
const ALERT_AUTO_RESOLVE: Dictionary<Array<string>> = {
  [CREATED_CRITERIA_ID]: [TEMPLATE_ID],
};

function incident(fingerprint: string): Incident {
  const i: Incident = new Incident();
  i.createdCriteriaId = CREATED_CRITERIA_ID;
  i.createdIncidentTemplateId = TEMPLATE_ID;
  i.seriesFingerprint = fingerprint;
  return i;
}

function alert(fingerprint: string): Alert {
  const a: Alert = new Alert();
  a.createdCriteriaId = CREATED_CRITERIA_ID;
  a.seriesFingerprint = fingerprint;
  return a;
}

function criteria(id: string, creates: boolean): MonitorCriteriaInstance {
  const c: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  c.data!.id = id;
  // Same flag drives both — the templates set createIncidents/createAlerts together.
  c.data!.createIncidents = creates;
  c.data!.createAlerts = creates;
  return c;
}

function shouldCloseIncident(input: Record<string, unknown>): boolean {
  return (
    MonitorIncident as unknown as {
      shouldCloseIncident: (i: Record<string, unknown>) => boolean;
    }
  ).shouldCloseIncident(input);
}
function shouldCloseAlert(input: Record<string, unknown>): boolean {
  return (
    MonitorAlert as unknown as {
      shouldCloseAlert: (i: Record<string, unknown>) => boolean;
    }
  ).shouldCloseAlert(input);
}

describe("Per-series offline/online auto-resolve", () => {
  describe("MonitorIncident.shouldCloseIncident", () => {
    it("RESOLVES on the recovery tick even though the recovered series is in the matched (recovery) criteria's set", () => {
      /*
       * The device is back up: the RECOVERY criteria won, its match set
       * contains the now-healthy device. It must NOT keep the incident open.
       */
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("keeps the incident open while the device is still down (offline criteria won, series still breaching)", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("resolves when this device recovered but another device is still down (offline criteria won, fp absent)", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          // Only some OTHER device is still breaching the offline criteria.
          breachingSeriesFingerprints: new Set<string>(["fp-device-2"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("does not resolve on recovery when the creating criteria did not opt into auto-resolve", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary: {}, // not configured
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("still respects the event-driven guard (incoming-request) over recovery resolution", () => {
      expect(
        shouldCloseIncident({
          openIncident: incident(DEVICE_FP),
          autoResolveCriteriaInstanceIdIncidentIdsDictionary:
            INCIDENT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });
  });

  describe("MonitorAlert.shouldCloseAlert", () => {
    it("RESOLVES on the recovery tick even though the recovered series is in the matched (recovery) criteria's set", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("keeps the alert open while the device is still down", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(false);
    });

    it("resolves when this device recovered but another is still down", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria(CREATED_CRITERIA_ID, true),
          breachingSeriesFingerprints: new Set<string>(["fp-device-2"]),
          disableSeriesAbsenceResolution: false,
        }),
      ).toBe(true);
    });

    it("still respects the event-driven guard over recovery resolution", () => {
      expect(
        shouldCloseAlert({
          openAlert: alert(DEVICE_FP),
          autoResolveCriteriaInstanceIdAlertIdsDictionary: ALERT_AUTO_RESOLVE,
          criteriaInstance: criteria("recovery-criteria", false),
          breachingSeriesFingerprints: new Set<string>([DEVICE_FP]),
          disableSeriesAbsenceResolution: true,
        }),
      ).toBe(false);
    });
  });
});

/*
 * What the resolved state timeline says, which is what the owners'
 * "resolved" email prints under "Root Cause".
 *
 * A per-series resolve happens on a tick where other series can still be
 * breaching, and that tick's root cause describes THEM. It used to be
 * written onto the recovered series' timeline verbatim, so node A's
 * "resolved" email listed the nodes that were still down. A per-series
 * resolve must describe the series that recovered; a whole-monitor
 * resolve keeps the caller's root cause.
 *
 * Driven through the real resolve pass with the services stubbed, and
 * run for alerts and incidents alike so the two cannot drift apart.
 */
describe("Per-series auto-resolve root cause", () => {
  const PROJECT_ID: ObjectID = new ObjectID(
    "11111111-1111-4111-8111-111111111111",
  );
  const MONITOR_ID: ObjectID = new ObjectID(
    "22222222-2222-4222-8222-222222222222",
  );
  const RESOLVED_STATE_ID: ObjectID = new ObjectID(
    "99999999-9999-4999-8999-999999999999",
  );

  const CPU_CRITERIA_ID: string = "cpu-criteria";
  const CPU_CRITERIA_NAME: string = "CPU above 90%";
  const MEMORY_CRITERIA_ID: string = "memory-criteria";
  const OFFLINE_CRITERIA_ID: string = "offline-criteria";
  const OFFLINE_CRITERIA_NAME: string = "Host offline";
  const RECOVERY_CRITERIA_ID: string = "recovery-criteria";

  const FP_NODE_A: string = "fp-node-a";
  const FP_NODE_B: string = "fp-node-b";

  // The monitor-wide root cause of a tick where node-b is still breaching.
  const BREACH_ROOT_CAUSE: string =
    "**CPU usage is above 90%** on host node-b (97.2%).";

  const dataToProcess: ProbeMonitorResponse = {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitoredAt: new Date("2026-09-25T03:33:00.000Z"),
  } as unknown as ProbeMonitorResponse;

  function namedCriteria(options: {
    id: string;
    name: string;
    creates: boolean;
  }): MonitorCriteriaInstance {
    const instance: MonitorCriteriaInstance = criteria(
      options.id,
      options.creates,
    );
    instance.data!.name = options.name;
    return instance;
  }

  const CPU_CRITERIA: MonitorCriteriaInstance = namedCriteria({
    id: CPU_CRITERIA_ID,
    name: CPU_CRITERIA_NAME,
    creates: true,
  });
  const MEMORY_CRITERIA: MonitorCriteriaInstance = namedCriteria({
    id: MEMORY_CRITERIA_ID,
    name: "Memory above 90%",
    creates: true,
  });
  const OFFLINE_CRITERIA: MonitorCriteriaInstance = namedCriteria({
    id: OFFLINE_CRITERIA_ID,
    name: OFFLINE_CRITERIA_NAME,
    creates: true,
  });
  const RECOVERY_CRITERIA: MonitorCriteriaInstance = namedCriteria({
    id: RECOVERY_CRITERIA_ID,
    name: "Host online",
    creates: false,
  });

  // What MonitorResource hands the resolve pass: every criteria by id.
  const CRITERIA_BY_ID: Dictionary<MonitorCriteriaInstance> = {
    [CPU_CRITERIA_ID]: CPU_CRITERIA,
    [MEMORY_CRITERIA_ID]: MEMORY_CRITERIA,
    [OFFLINE_CRITERIA_ID]: OFFLINE_CRITERIA,
    [RECOVERY_CRITERIA_ID]: RECOVERY_CRITERIA,
  };

  const AUTO_RESOLVE: Dictionary<Array<string>> = {
    [CPU_CRITERIA_ID]: [TEMPLATE_ID],
    [OFFLINE_CRITERIA_ID]: [TEMPLATE_ID],
  };

  interface OpenRecord {
    id: string;
    criteriaId: string;
    fingerprint?: string | undefined;
    labels?: JSONObject | undefined;
  }

  interface ResolvePassInput {
    open: Array<OpenRecord>;
    rootCause: string;
    criteriaInstance: MonitorCriteriaInstance | null;
    breachingSeriesFingerprints?: Set<string> | undefined;
    breachingSeriesFingerprintsByCriteriaId?:
      | Dictionary<Set<string>>
      | undefined;
    criteriaInstancesById?: Dictionary<MonitorCriteriaInstance> | undefined;
  }

  interface ResolvePassResult {
    // Root cause written to each resolved record's state timeline, by id.
    rootCauses: Dictionary<string | undefined>;
    // Ids of the records the pass left open.
    survivorIds: Array<string>;
  }

  interface RecordKind {
    label: string;
    prefix: string;
    run: (input: ResolvePassInput) => Promise<ResolvePassResult>;
  }

  let openAlerts: Array<Alert> = [];
  let openIncidents: Array<Incident> = [];
  let alertRootCauses: Dictionary<string | undefined> = {};
  let incidentRootCauses: Dictionary<string | undefined> = {};

  beforeEach(() => {
    openAlerts = [];
    openIncidents = [];
    alertRootCauses = {};
    incidentRootCauses = {};

    jest.spyOn(AlertService, "findBy").mockImplementation(async () => {
      return openAlerts as never;
    });
    jest.spyOn(IncidentService, "findBy").mockImplementation(async () => {
      return openIncidents as never;
    });

    jest
      .spyOn(AlertStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);
    jest
      .spyOn(IncidentStateTimelineService, "getResolvedStateIdForProject")
      .mockResolvedValue(RESOLVED_STATE_ID);

    jest
      .spyOn(AlertStateTimelineService, "create")
      .mockImplementation(async (createBy: unknown): Promise<never> => {
        const timeline: { alertId?: ObjectID; rootCause?: string } = (
          createBy as { data: { alertId?: ObjectID; rootCause?: string } }
        ).data;
        alertRootCauses[String(timeline.alertId)] = timeline.rootCause;
        return undefined as never;
      });

    jest
      .spyOn(IncidentStateTimelineService, "create")
      .mockImplementation(async (createBy: unknown): Promise<never> => {
        const timeline: { incidentId?: ObjectID; rootCause?: string } = (
          createBy as { data: { incidentId?: ObjectID; rootCause?: string } }
        ).data;
        incidentRootCauses[String(timeline.incidentId)] = timeline.rootCause;
        return undefined as never;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const ALERTS: RecordKind = {
    label: "alerts",
    prefix:
      "Alert autoresolved because autoresolve is set to true in monitor criteria. ",
    run: async (input: ResolvePassInput): Promise<ResolvePassResult> => {
      openAlerts = input.open.map((record: OpenRecord) => {
        const model: Alert = new Alert();
        model._id = record.id;
        model.projectId = PROJECT_ID;
        model.createdCriteriaId = record.criteriaId;
        if (record.fingerprint) {
          model.seriesFingerprint = record.fingerprint;
        }
        if (record.labels) {
          model.seriesLabels = record.labels;
        }
        return model;
      });

      const survivors: Array<Alert> =
        await MonitorAlert.checkOpenAlertsAndCloseIfResolved({
          monitorId: MONITOR_ID,
          autoResolveCriteriaInstanceIdAlertIdsDictionary: AUTO_RESOLVE,
          rootCause: input.rootCause,
          criteriaInstance: input.criteriaInstance,
          dataToProcess: dataToProcess,
          breachingSeriesFingerprints: input.breachingSeriesFingerprints,
          breachingSeriesFingerprintsByCriteriaId:
            input.breachingSeriesFingerprintsByCriteriaId,
          criteriaInstancesById: input.criteriaInstancesById,
        });

      return {
        rootCauses: alertRootCauses,
        survivorIds: survivors.map((survivor: Alert) => {
          return survivor.id!.toString();
        }),
      };
    },
  };

  const INCIDENTS: RecordKind = {
    label: "incidents",
    prefix:
      "Incident autoresolved because autoresolve is set to true in monitor criteria. ",
    run: async (input: ResolvePassInput): Promise<ResolvePassResult> => {
      openIncidents = input.open.map((record: OpenRecord) => {
        const model: Incident = new Incident();
        model._id = record.id;
        model.projectId = PROJECT_ID;
        model.createdCriteriaId = record.criteriaId;
        model.createdIncidentTemplateId = TEMPLATE_ID;
        if (record.fingerprint) {
          model.seriesFingerprint = record.fingerprint;
        }
        if (record.labels) {
          model.seriesLabels = record.labels;
        }
        return model;
      });

      const survivors: Array<Incident> =
        await MonitorIncident.checkOpenIncidentsAndCloseIfResolved({
          monitorId: MONITOR_ID,
          autoResolveCriteriaInstanceIdIncidentIdsDictionary: AUTO_RESOLVE,
          rootCause: input.rootCause,
          criteriaInstance: input.criteriaInstance,
          dataToProcess: dataToProcess,
          breachingSeriesFingerprints: input.breachingSeriesFingerprints,
          breachingSeriesFingerprintsByCriteriaId:
            input.breachingSeriesFingerprintsByCriteriaId,
          criteriaInstancesById: input.criteriaInstancesById,
        });

      return {
        rootCauses: incidentRootCauses,
        survivorIds: survivors.map((survivor: Incident) => {
          return survivor.id!.toString();
        }),
      };
    },
  };

  describe.each([ALERTS, INCIDENTS])("$label", (kind: RecordKind) => {
    it("node A's resolve names node A and its criteria, not node B's breach (the reported bug)", async () => {
      const result: ResolvePassResult = await kind.run({
        open: [
          {
            id: "node-a",
            criteriaId: CPU_CRITERIA_ID,
            fingerprint: FP_NODE_A,
            labels: { "host.name": "node-a" },
          },
          {
            id: "node-b",
            criteriaId: CPU_CRITERIA_ID,
            fingerprint: FP_NODE_B,
            labels: { "host.name": "node-b" },
          },
        ],
        rootCause: BREACH_ROOT_CAUSE,
        criteriaInstance: CPU_CRITERIA,
        breachingSeriesFingerprints: new Set<string>([FP_NODE_B]),
        breachingSeriesFingerprintsByCriteriaId: {
          [CPU_CRITERIA_ID]: new Set<string>([FP_NODE_B]),
        },
        criteriaInstancesById: CRITERIA_BY_ID,
      });

      expect(Object.keys(result.rootCauses)).toEqual(["node-a"]);
      expect(result.rootCauses["node-a"]).toBe(
        `${kind.prefix}Series "Host: node-a" no longer satisfies criteria "${CPU_CRITERIA_NAME}".`,
      );
      expect(result.rootCauses["node-a"]).not.toContain("node-b");
      expect(result.rootCauses["node-a"]).not.toContain(BREACH_ROOT_CAUSE);
      // Node B is still breaching: untouched, and handed on to the create path.
      expect(result.survivorIds).toEqual(["node-b"]);
    });

    it("the recovery tick describes the recovered series, not the recovery criteria's matches", async () => {
      // Offline/online pair: the recovery criteria won, its matches are healthy hosts.
      const result: ResolvePassResult = await kind.run({
        open: [
          {
            id: "node-a",
            criteriaId: OFFLINE_CRITERIA_ID,
            fingerprint: FP_NODE_A,
            labels: { "host.name": "node-a" },
          },
        ],
        rootCause: "Hosts node-a, node-b are reporting device_up >= 1.",
        criteriaInstance: RECOVERY_CRITERIA,
        breachingSeriesFingerprints: new Set<string>([FP_NODE_A, FP_NODE_B]),
        criteriaInstancesById: CRITERIA_BY_ID,
      });

      expect(result.rootCauses["node-a"]).toBe(
        `${kind.prefix}Series "Host: node-a" no longer satisfies criteria "${OFFLINE_CRITERIA_NAME}".`,
      );
    });

    it("names the criteria generically when the caller has no criteria map", async () => {
      const result: ResolvePassResult = await kind.run({
        open: [
          {
            id: "node-a",
            criteriaId: CPU_CRITERIA_ID,
            fingerprint: FP_NODE_A,
            labels: { "host.name": "node-a" },
          },
        ],
        rootCause: BREACH_ROOT_CAUSE,
        criteriaInstance: CPU_CRITERIA,
        breachingSeriesFingerprints: new Set<string>([FP_NODE_B]),
        breachingSeriesFingerprintsByCriteriaId: {
          [CPU_CRITERIA_ID]: new Set<string>([FP_NODE_B]),
        },
      });

      expect(result.rootCauses["node-a"]).toBe(
        `${kind.prefix}Series "Host: node-a" no longer satisfies the criteria that raised it.`,
      );
    });

    it("still records a per-series reason for a series with no usable labels", async () => {
      const result: ResolvePassResult = await kind.run({
        open: [
          {
            id: "node-a",
            criteriaId: CPU_CRITERIA_ID,
            fingerprint: FP_NODE_A,
          },
        ],
        rootCause: BREACH_ROOT_CAUSE,
        criteriaInstance: CPU_CRITERIA,
        breachingSeriesFingerprints: new Set<string>([FP_NODE_B]),
        breachingSeriesFingerprintsByCriteriaId: {
          [CPU_CRITERIA_ID]: new Set<string>([FP_NODE_B]),
        },
        criteriaInstancesById: CRITERIA_BY_ID,
      });

      expect(result.rootCauses["node-a"]).toBe(
        `${kind.prefix}This series no longer satisfies criteria "${CPU_CRITERIA_NAME}".`,
      );
    });

    describe("whole-monitor resolves keep the caller's root cause", () => {
      it("a whole-monitor record resolved because another criteria took over", async () => {
        const result: ResolvePassResult = await kind.run({
          open: [{ id: "whole-monitor", criteriaId: CPU_CRITERIA_ID }],
          rootCause: "Memory usage is above 90%.",
          criteriaInstance: MEMORY_CRITERIA,
          criteriaInstancesById: CRITERIA_BY_ID,
        });

        expect(result.rootCauses["whole-monitor"]).toBe(
          `${kind.prefix}Memory usage is above 90%.`,
        );
      });

      it("a series record resolved on the no-criteria-met path", async () => {
        const result: ResolvePassResult = await kind.run({
          open: [
            {
              id: "node-a",
              criteriaId: CPU_CRITERIA_ID,
              fingerprint: FP_NODE_A,
              labels: { "host.name": "node-a" },
            },
          ],
          rootCause: "No monitoring criteria met. Change to default status.",
          criteriaInstance: null,
          criteriaInstancesById: CRITERIA_BY_ID,
        });

        expect(result.rootCauses["node-a"]).toBe(
          `${kind.prefix}No monitoring criteria met. Change to default status.`,
        );
      });

      it("a pre-grouping whole-monitor record resolved on a per-series tick", async () => {
        const result: ResolvePassResult = await kind.run({
          open: [{ id: "whole-monitor", criteriaId: CPU_CRITERIA_ID }],
          rootCause: BREACH_ROOT_CAUSE,
          criteriaInstance: CPU_CRITERIA,
          breachingSeriesFingerprints: new Set<string>([FP_NODE_B]),
          breachingSeriesFingerprintsByCriteriaId: {
            [CPU_CRITERIA_ID]: new Set<string>([FP_NODE_B]),
          },
          criteriaInstancesById: CRITERIA_BY_ID,
        });

        expect(result.rootCauses["whole-monitor"]).toBe(
          `${kind.prefix}${BREACH_ROOT_CAUSE}`,
        );
      });
    });
  });

  describe("PerSeriesResolutionRootCause.build", () => {
    it("names every identifying label, most identifying first, and skips empty ones", () => {
      expect(
        PerSeriesResolutionRootCause.build({
          seriesLabels: {
            "resource.k8s.namespace.name": "prod",
            "resource.k8s.pod.name": "checkout-7d9f-2xk",
            "resource.k8s.node.name": "",
          },
          createdCriteriaId: CPU_CRITERIA_ID,
          criteriaInstancesById: CRITERIA_BY_ID,
        }),
      ).toBe(
        `Series "Pod: checkout-7d9f-2xk | Namespace: prod" no longer satisfies criteria "${CPU_CRITERIA_NAME}".`,
      );
    });

    it("falls back to a generic criteria reference for a blank or unknown criteria", () => {
      const blank: MonitorCriteriaInstance = namedCriteria({
        id: "blank-criteria",
        name: "   ",
        creates: true,
      });

      for (const createdCriteriaId of [
        "blank-criteria",
        "deleted-criteria",
        undefined,
      ]) {
        expect(
          PerSeriesResolutionRootCause.build({
            seriesLabels: { "host.name": "node-a" },
            createdCriteriaId,
            criteriaInstancesById: { "blank-criteria": blank },
          }),
        ).toBe(
          'Series "Host: node-a" no longer satisfies the criteria that raised it.',
        );
      }
    });
  });
});
