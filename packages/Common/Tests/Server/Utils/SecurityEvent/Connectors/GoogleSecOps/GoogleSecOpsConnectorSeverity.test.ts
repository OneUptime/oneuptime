import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  ConnectorFetchResult,
  ConnectorFetchWindow,
} from "../../../../../../Server/Utils/SecurityEvent/Connectors/Types";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityConnectorSample } from "../../../../../../Types/SecurityEvent/Connectors/ConnectorDiagnostics";
import NormalizedSecurityEvent from "../../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../../../../../Types/SecurityEvent/OcsfSeverity";
import {
  FIXTURE_CURATED_RULE_ID,
  FakeClient,
  connectorWith,
  fetchOptions,
  fetched,
  makeFakeClient,
  page,
  secOpsSettings,
} from "./GoogleSecOpsConnectorFixtures";

/*
 * The severity a Google SecOps poll imports, end to end through the real
 * connector: its rule, curated and alerts-view passes feed Google's raw
 * Collections to the normalizer, and the events and samples come back
 * graded.
 *
 * A custom YARA-L rule carries its severity only in the rule's meta labels
 * (detection[].ruleLabels); a curated rule carries the one Google gave it
 * (detection[].severity). Before the fix a poll that read both imported the
 * curated detections graded and every custom-rule detection as Unknown.
 */

const WINDOW: ConnectorFetchWindow = {
  startTime: new Date("2026-09-14T11:54:00.000Z"),
  endTime: new Date("2026-09-14T12:00:00.000Z"),
};

function collection(id: string, entry: JSONObject): JSONObject {
  return {
    id,
    type: "RULE_DETECTION",
    detectionTime: "2026-09-14T11:56:00.000Z",
    createdTime: "2026-09-14T11:57:00.000Z",
    detection: [{ alertState: "ALERTING", ruleType: "SINGLE_EVENT", ...entry }],
  };
}

// A custom rule graded in its meta section, as the rule search returns it.
const LABELLED_CUSTOM_RULE: JSONObject = collection("de_custom_labelled", {
  ruleName: "rq_003096_Suspicious_LLMNR_Traffic_Observed",
  ruleId: "ru_custom_1",
  ruleLabels: [
    { key: "author", value: "Detection Engineering" },
    { key: "severity", value: "Medium" },
  ],
  riskScore: 40,
});

// A custom rule with no severity meta that scores itself with $risk_score.
const SCORED_CUSTOM_RULE: JSONObject = collection("de_custom_scored", {
  ruleName: "rq_003944_Inbound_Email_Wave_To_Single_User",
  ruleId: "ru_custom_2",
  ruleLabels: [{ key: "author", value: "Detection Engineering" }],
  outcomes: [
    { key: "risk_score", value: "85" },
    { key: "recipient", value: "user@example.com" },
  ],
  riskScore: 85,
});

// A custom rule that grades itself nowhere: Google's default score only.
const UNGRADED_CUSTOM_RULE: JSONObject = collection("de_custom_ungraded", {
  ruleName: "rq_000134_Allowed_Malicious_Email",
  ruleId: "ru_custom_3",
  ruleLabels: [{ key: "author", value: "Detection Engineering" }],
  riskScore: 40,
});

// A curated rule, as the curated search returns it.
const CURATED_RULE: JSONObject = collection("de_curated_ati", {
  ruleName: "ATI Medium Priority Rule Match for Ip Address IoCs (principal.ip)",
  ruleId: FIXTURE_CURATED_RULE_ID,
  severity: "MEDIUM",
  ruleLabels: [{ key: "rule_name", value: "ATI Medium Priority Rule Match" }],
  outcomes: [{ key: "risk_score", value: "60" }],
  riskScore: 60,
  ruleSetDisplayName: "Applied Threat Intelligence",
});

// A custom-rule alert that only the alerts view returned.
const ALERTS_VIEW_CUSTOM_RULE: JSONObject = collection("de_alerts_view", {
  ruleName: "rq_004120_Impossible_Travel",
  ruleId: "ru_custom_4",
  ruleLabels: [{ key: "severity", value: "HIGH" }],
  riskScore: 40,
});

async function pollOnce(): Promise<ConnectorFetchResult> {
  const fake: FakeClient = makeFakeClient({
    rule: [
      page([LABELLED_CUSTOM_RULE, SCORED_CUSTOM_RULE, UNGRADED_CUSTOM_RULE]),
    ],
    curated: [page([CURATED_RULE])],
    // The window's alerts view, then a late-alert sweep that finds nothing.
    alerts: [fetched([ALERTS_VIEW_CUSTOM_RULE]), fetched([])],
  });

  return connectorWith(fake.client).connector.fetchEvents(
    secOpsSettings(),
    WINDOW,
    fetchOptions(),
  );
}

function eventsById(
  result: ConnectorFetchResult,
): Map<string, NormalizedSecurityEvent> {
  return new Map(
    result.events.map(
      (event: NormalizedSecurityEvent): [string, NormalizedSecurityEvent] => {
        return [event.eventUid, event];
      },
    ),
  );
}

describe("GoogleSecOpsConnector.fetchEvents severity", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("custom-rule detections are imported graded, beside the curated ones", async () => {
    const result: ConnectorFetchResult = await pollOnce();
    const byId: Map<string, NormalizedSecurityEvent> = eventsById(result);

    expect([...byId.keys()].sort()).toEqual([
      "de_alerts_view",
      "de_curated_ati",
      "de_custom_labelled",
      "de_custom_scored",
      "de_custom_ungraded",
    ]);

    const expected: Array<[string, OcsfSeverity]> = [
      // meta: severity = "Medium"
      ["de_custom_labelled", OcsfSeverity.Medium],
      // $risk_score = 85, Google's 80-89 band
      ["de_custom_scored", OcsfSeverity.High],
      // nothing graded it; Google's default score of 40 is not a grade
      ["de_custom_ungraded", OcsfSeverity.Unknown],
      // Google's own grade
      ["de_curated_ati", OcsfSeverity.Medium],
      // meta: severity = "HIGH", read from the alerts view
      ["de_alerts_view", OcsfSeverity.High],
    ];

    for (const [id, severity] of expected) {
      expect({ id, severityName: byId.get(id)!.severityName }).toEqual({
        id,
        severityName: severity,
      });
      expect(byId.get(id)!.severityId).toBe(OcsfSeverityId[severity]);
    }
  });

  test("only the detection whose rule grades itself nowhere is Unknown", async () => {
    const result: ConnectorFetchResult = await pollOnce();

    expect(
      result.events
        .filter((event: NormalizedSecurityEvent): boolean => {
          return event.severityName === OcsfSeverity.Unknown;
        })
        .map((event: NormalizedSecurityEvent): string => {
          return event.ruleName;
        }),
    ).toEqual(["rq_000134_Allowed_Malicious_Email"]);
  });

  test("the samples the connection page shows carry the same grades", async () => {
    const result: ConnectorFetchResult = await pollOnce();
    const severities: Record<string, string> = {};

    for (const sample of result.samples) {
      severities[sample.id] = (sample as SecurityConnectorSample).severity!;
    }

    expect(severities).toEqual({
      de_custom_labelled: "Medium",
      de_custom_scored: "High",
      de_custom_ungraded: "Unknown",
      de_curated_ati: "Medium",
      de_alerts_view: "High",
    });
  });

  test("the rule's labels and outcomes are kept in the imported attributes", async () => {
    const result: ConnectorFetchResult = await pollOnce();
    const labelled: NormalizedSecurityEvent =
      eventsById(result).get("de_custom_labelled")!;
    const scored: NormalizedSecurityEvent =
      eventsById(result).get("de_custom_scored")!;

    expect(labelled.attributes).toMatchObject({
      "detection.0.ruleLabels.1.key": "severity",
      "detection.0.ruleLabels.1.value": "Medium",
      "detection.0.riskScore": "40",
    });
    expect(scored.attributes).toMatchObject({
      "detection.0.outcomes.0.key": "risk_score",
      "detection.0.outcomes.0.value": "85",
    });
  });
});
