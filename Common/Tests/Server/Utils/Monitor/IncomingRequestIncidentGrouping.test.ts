import IncomingRequestIncidentGrouping from "../../../../Server/Utils/Monitor/IncomingRequestIncidentGrouping";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import IncidentGroupingConfig from "../../../../Types/Monitor/IncomingMonitor/IncidentGroupingConfig";
import IncomingMonitorRequest from "../../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { PerSeriesCriteriaMatch } from "../../../../Types/Probe/ProbeApiIngestResponse";

function makeRequest(
  requestBody: JSONObject | string | undefined,
  overrides?: Partial<IncomingMonitorRequest>,
): DataToProcess {
  const request: IncomingMonitorRequest = {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    requestBody: requestBody,
    incomingRequestReceivedAt: new Date(0),
    checkedAt: new Date(0),
    ...overrides,
  };

  return request as unknown as DataToProcess;
}

function makeCriteria(
  grouping: IncidentGroupingConfig | undefined,
  id: string = "criteria-1",
): MonitorCriteriaInstance {
  const criteria: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  criteria.data!.id = id;
  criteria.data!.incidentGrouping = grouping;
  return criteria;
}

// Grafana / Alertmanager-shaped payloads.
function firingAlertmanagerPayload(): JSONObject {
  return {
    status: "firing",
    alerts: [
      { status: "firing", labels: { alertname: "High RAM Usage" } },
      { status: "firing", labels: { alertname: "High CPU Usage" } },
      { status: "firing", labels: { alertname: "High Disk Usage" } },
    ],
  };
}

describe("IncomingRequestIncidentGrouping", () => {
  describe("collectFiringMatches", () => {
    it("returns one firing match per array element (Grafana alerts[*])", () => {
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(firingAlertmanagerPayload()),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "alerts[*].labels.alertname",
          }),
        });

      expect(matches).toHaveLength(3);
      expect(
        matches.map((m: PerSeriesCriteriaMatch) => {
          return m.labels;
        }),
      ).toEqual([
        { alertname: "High RAM Usage" },
        { alertname: "High CPU Usage" },
        { alertname: "High Disk Usage" },
      ]);
      // Distinct keys produce distinct fingerprints (=> concurrent incidents).
      const fingerprints: Set<string> = new Set<string>(
        matches.map((m: PerSeriesCriteriaMatch) => {
          return m.fingerprint;
        }),
      );
      expect(fingerprints.size).toBe(3);
      expect(
        matches.every((m: PerSeriesCriteriaMatch) => {
          return m.criteriaMetId === "criteria-1";
        }),
      ).toBe(true);
    });

    it("supports a simple (non-array) group-by path", () => {
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest({
            commonLabels: { alertname: "Disk Full" },
          }),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "commonLabels.alertname",
          }),
        });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Disk Full" });
    });

    it("returns [] when grouping is not configured (legacy behaviour)", () => {
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(firingAlertmanagerPayload()),
          criteriaInstance: makeCriteria(undefined),
        });

      expect(matches).toEqual([]);
    });

    it("returns [] on the heartbeat-timeout re-evaluation (no fresh body)", () => {
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(firingAlertmanagerPayload(), {
            onlyCheckForIncomingRequestReceivedAt: true,
          }),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "alerts[*].labels.alertname",
          }),
        });

      expect(matches).toEqual([]);
    });

    it("parses a raw JSON string body", () => {
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(
            JSON.stringify({ commonLabels: { alertname: "Stringified" } }),
          ),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "commonLabels.alertname",
          }),
        });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Stringified" });
    });

    it("excludes elements classified as resolved (per-element status)", () => {
      const payload: JSONObject = {
        status: "firing",
        alerts: [
          { status: "firing", labels: { alertname: "Still Firing" } },
          { status: "resolved", labels: { alertname: "Recovered" } },
        ],
      };

      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(payload),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "alerts[*].labels.alertname",
            resolvedWhenJSONPath: "alerts[*].status",
            resolvedWhenValue: "resolved",
          }),
        });

      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "Still Firing" });
    });

    it("excludes everything when the whole payload is resolved (payload-level status)", () => {
      const payload: JSONObject = {
        status: "resolved",
        commonLabels: { alertname: "High CPU Usage" },
      };

      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(payload),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "commonLabels.alertname",
            resolvedWhenJSONPath: "status",
            resolvedWhenValue: "resolved",
          }),
        });

      expect(matches).toEqual([]);
    });

    it("dedupes the same key appearing twice in one payload", () => {
      const payload: JSONObject = {
        alerts: [
          { labels: { alertname: "Dup" } },
          { labels: { alertname: "Dup" } },
        ],
      };

      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(payload),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "alerts[*].labels.alertname",
          }),
        });

      expect(matches).toHaveLength(1);
    });

    it("caps the number of keys at maxKeysPerPayload", () => {
      const payload: JSONObject = {
        alerts: Array.from({ length: 10 }, (_unused: unknown, i: number) => {
          return { labels: { alertname: `alert-${i}` } };
        }),
      };

      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest(payload),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "alerts[*].labels.alertname",
            maxKeysPerPayload: 3,
          }),
        });

      expect(matches).toHaveLength(3);
    });
  });

  describe("collectResolvedFingerprints", () => {
    it("returns the fingerprints the payload marks resolved", () => {
      const payload: JSONObject = {
        alerts: [
          { status: "firing", labels: { alertname: "Still Firing" } },
          { status: "resolved", labels: { alertname: "Recovered" } },
        ],
      };

      const grouping: IncidentGroupingConfig = {
        groupByJSONPath: "alerts[*].labels.alertname",
        resolvedWhenJSONPath: "alerts[*].status",
        resolvedWhenValue: "resolved",
      };

      const resolved: Array<string> =
        IncomingRequestIncidentGrouping.collectResolvedFingerprints({
          dataToProcess: makeRequest(payload),
          criteriaInstances: [makeCriteria(grouping)],
        });

      expect(resolved).toHaveLength(1);

      /*
       * The resolved fingerprint must equal the firing fingerprint for the
       * same key — otherwise resolution would target the wrong incident.
       */
      const firingForRecovered: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest({
            alerts: [{ status: "firing", labels: { alertname: "Recovered" } }],
          }),
          criteriaInstance: makeCriteria(grouping),
        });

      expect(resolved[0]).toBe(firingForRecovered[0]!.fingerprint);
    });

    it("returns [] when no resolve classifier is configured", () => {
      const resolved: Array<string> =
        IncomingRequestIncidentGrouping.collectResolvedFingerprints({
          dataToProcess: makeRequest({ status: "resolved" }),
          criteriaInstances: [
            makeCriteria({ groupByJSONPath: "commonLabels.alertname" }),
          ],
        });

      expect(resolved).toEqual([]);
    });
  });

  describe("isGroupingConfigured", () => {
    it("is true only when a group-by path is set", () => {
      expect(
        IncomingRequestIncidentGrouping.isGroupingConfigured(
          makeCriteria({ groupByJSONPath: "commonLabels.alertname" }),
        ),
      ).toBe(true);
      expect(
        IncomingRequestIncidentGrouping.isGroupingConfigured(
          makeCriteria(undefined),
        ),
      ).toBe(false);
    });
  });

  describe("array-of-scalars fan-out (`prefix[*]`)", () => {
    it("fans out one match per scalar array element", () => {
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest({ tags: ["RAM", "CPU", "Disk"] }),
          criteriaInstance: makeCriteria({ groupByJSONPath: "tags[*]" }),
        });

      expect(matches).toHaveLength(3);
      expect(
        matches.map((m: PerSeriesCriteriaMatch) => {
          return m.labels;
        }),
      ).toEqual([{ tags: "RAM" }, { tags: "CPU" }, { tags: "Disk" }]);
    });
  });

  describe("mixed-mode resolve config (resolve has [*], group-by does not)", () => {
    it("does not silently mis-scope a [*] resolve path onto a top-level field", () => {
      /*
       * Self-contradictory config: group-by is non-array but resolve uses [*].
       * The top-level `status: resolved` must NOT be treated as a per-element
       * resolve — otherwise this single key would be wrongly classified.
       */
      const matches: Array<PerSeriesCriteriaMatch> =
        IncomingRequestIncidentGrouping.collectFiringMatches({
          dataToProcess: makeRequest({
            status: "resolved",
            commonLabels: { alertname: "High CPU Usage" },
          }),
          criteriaInstance: makeCriteria({
            groupByJSONPath: "commonLabels.alertname",
            resolvedWhenJSONPath: "alerts[*].status",
            resolvedWhenValue: "resolved",
          }),
        });

      // Treated as firing (not mis-scoped to top-level status) ⇒ stays open.
      expect(matches).toHaveLength(1);
      expect(matches[0]!.labels).toEqual({ alertname: "High CPU Usage" });
    });
  });
});
