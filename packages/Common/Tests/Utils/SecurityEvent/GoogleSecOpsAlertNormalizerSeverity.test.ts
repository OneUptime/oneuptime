import { describe, expect, test } from "@jest/globals";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import NormalizedSecurityEvent from "../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OCSF_SEVERITY_ALIASES,
  OcsfSeverityId,
} from "../../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventFormat from "../../../Types/SecurityEvent/SecurityEventFormat";
import GoogleSecOpsAlertNormalizer, {
  GOOGLE_SECOPS_RISK_SCORE_BANDS,
} from "../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import SecurityEventNormalizer from "../../../Utils/SecurityEvent/SecurityEventNormalizer";

/*
 * Where a Google SecOps detection's severity comes from.
 *
 * Google grades its curated rules itself, in detection[].severity. A custom
 * YARA-L rule is graded by its author in the rule's meta section
 * (`severity = "Medium"`), and Google returns that meta as
 * detection[].ruleLabels, leaving detection[].severity empty. Reading only
 * detection[].severity made every custom-rule detection "Unknown" while the
 * curated ones beside it were graded — the mix a customer saw on the
 * Security Events page. These tests pin every source, the order they are
 * read in, and that a detection which already graded grades exactly as it
 * did before.
 *
 * The payloads are shaped the way Google's detection search returns them.
 */

// A custom YARA-L rule detection: severity only in the rule's meta labels.
function customRuleDetection(
  detectionChanges: JSONObject = {},
  collectionChanges: JSONObject = {},
): JSONObject {
  return {
    type: "RULE_DETECTION",
    id: "de_2f9c4a6e-0b1d-4c55-9e3a-7d1f0c2b8a41",
    createdTime: "2026-09-17T11:40:12.512Z",
    detectionTime: "2026-09-17T11:39:00Z",
    timeWindow: {
      startTime: "2026-09-17T11:39:00Z",
      endTime: "2026-09-17T11:39:00Z",
    },
    detection: [
      {
        ruleName: "rq_003096_Suspicious_LLMNR_Traffic_Observed",
        description: "LLMNR traffic from a host that should not broadcast it",
        urlBackToProduct:
          "https://example.backstory.chronicle.security/ruleDetections?ruleId=ru_1",
        ruleId: "ru_7b0c1e5a-3f7e-4a0d-8c1e-5d2b9f6a4c10",
        ruleVersion: "ru_7b0c1e5a-3f7e-4a0d-8c1e-5d2b9f6a4c10@v_1757000000_0",
        alertState: "ALERTING",
        ruleType: "SINGLE_EVENT",
        detectionFields: [{ key: "hostname", value: "ws-042" }],
        ruleLabels: [
          { key: "author", value: "Detection Engineering" },
          { key: "description", value: "Suspicious LLMNR traffic" },
          { key: "severity", value: "Medium" },
        ],
        // Google's default for an alerting rule that sets no $risk_score.
        riskScore: 40,
        ...detectionChanges,
      },
    ],
    collectionElements: [
      {
        label: "e",
        references: [
          {
            event: {
              metadata: { eventType: "NETWORK_CONNECTION" },
              principal: { hostname: "ws-042", ip: ["10.20.0.42"] },
            },
          },
        ],
      },
    ],
    ...collectionChanges,
  };
}

// A curated (Google-authored) rule detection: Google fills severity itself.
function curatedRuleDetection(detectionChanges: JSONObject = {}): JSONObject {
  return {
    type: "RULE_DETECTION",
    id: "de_8d0e3b7c-5a91-4f2e-b6c4-1e9a7d3f5b20",
    createdTime: "2026-09-17T03:14:40.100Z",
    lastUpdatedTime: "2026-09-17T03:14:40.100Z",
    detectionTime: "2026-09-17T03:14:00Z",
    detection: [
      {
        ruleName:
          "ATI Medium Priority Rule Match for Ip Address IoCs (principal.ip)",
        summary: "Rule Detection",
        description: "Matches an IP address IoC from Applied Threat Intel",
        severity: "MEDIUM",
        ruleId: "ur_ati_ip_medium",
        alertState: "ALERTING",
        ruleType: "SINGLE_EVENT",
        ruleLabels: [
          { key: "rule_name", value: "ATI Medium Priority Rule Match" },
          { key: "false_positives", value: "Shared infrastructure" },
        ],
        outcomes: [
          { key: "risk_score", value: "60" },
          { key: "ip", value: "203.0.113.7", source: "udm.principal.ip" },
        ],
        ruleSet: "ati-ioc-rules",
        ruleSetDisplayName: "Applied Threat Intelligence",
        riskScore: 60,
        ...detectionChanges,
      },
    ],
  };
}

function severityOf(payload: JSONObject): OcsfSeverity {
  return GoogleSecOpsAlertNormalizer.normalize(payload).severityName;
}

// A custom rule detection carrying only the labels and outcomes given.
function ruleWith(signals: {
  ruleLabels?: JSONValue;
  outcomes?: JSONValue;
  severity?: JSONValue;
  riskScore?: JSONValue;
}): JSONObject {
  const entry: JSONObject = { ruleName: "custom", alertState: "ALERTING" };

  for (const key of Object.keys(signals)) {
    entry[key] = (signals as JSONObject)[key] as JSONValue;
  }

  return { id: "de_signals", type: "RULE_DETECTION", detection: [entry] };
}

describe("GoogleSecOpsAlertNormalizer severity: the customer's two rule kinds", () => {
  test("a custom YARA-L rule is graded by its meta severity label (was Unknown)", () => {
    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(customRuleDetection());

    expect(result.severityName).toBe(OcsfSeverity.Medium);
    expect(result.severityId).toBe(OcsfSeverityId[OcsfSeverity.Medium]);
    // Nothing else about the row moves.
    expect(result.message).toBe("rq_003096_Suspicious_LLMNR_Traffic_Observed");
    expect(result.ruleName).toBe("rq_003096_Suspicious_LLMNR_Traffic_Observed");
    expect(result.statusName).toBe("ALERTING");
    expect(result.principalHost).toBe("ws-042");
  });

  test("a curated rule keeps the severity Google graded it with", () => {
    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(curatedRuleDetection());

    expect(result.severityName).toBe(OcsfSeverity.Medium);
    expect(result.severityId).toBe(3);
  });

  test("the labels stay in the stored attributes so the detail view still shows them", () => {
    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(customRuleDetection());

    expect(result.attributes["detection.0.ruleLabels.2.key"]).toBe("severity");
    expect(result.attributes["detection.0.ruleLabels.2.value"]).toBe("Medium");
  });

  test("a custom rule with no severity label and no risk score is honestly Unknown", () => {
    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(
        customRuleDetection({
          ruleLabels: [{ key: "author", value: "Detection Engineering" }],
        }),
      );

    expect(result.severityName).toBe(OcsfSeverity.Unknown);
    expect(result.severityId).toBe(0);
  });
});

describe("GoogleSecOpsAlertNormalizer severity: the meta severity label", () => {
  test.each([
    ["Info", OcsfSeverity.Informational],
    ["Informational", OcsfSeverity.Informational],
    ["INFORMATIONAL", OcsfSeverity.Informational],
    ["Low", OcsfSeverity.Low],
    ["low", OcsfSeverity.Low],
    ["Medium", OcsfSeverity.Medium],
    ["MEDIUM", OcsfSeverity.Medium],
    ["High", OcsfSeverity.High],
    [" high ", OcsfSeverity.High],
    ["Critical", OcsfSeverity.Critical],
    ["CRITICAL", OcsfSeverity.Critical],
  ])("severity = %p grades %s", (value: string, expected: OcsfSeverity) => {
    const result: NormalizedSecurityEvent =
      GoogleSecOpsAlertNormalizer.normalize(
        ruleWith({ ruleLabels: [{ key: "severity", value }] }),
      );

    expect(result.severityName).toBe(expected);
    expect(result.severityId).toBe(OcsfSeverityId[expected]);
  });

  test.each(["Severity", "SEVERITY", " severity "])(
    "the label key %p matches regardless of case and padding",
    (key: string) => {
      expect(
        severityOf(ruleWith({ ruleLabels: [{ key, value: "High" }] })),
      ).toBe(OcsfSeverity.High);
    },
  );

  test("a label that is not called severity is not read as one", () => {
    expect(
      severityOf(
        ruleWith({
          ruleLabels: [
            { key: "priority", value: "High" },
            { key: "severity_notes", value: "Critical" },
            { key: "description", value: "Low" },
          ],
        }),
      ),
    ).toBe(OcsfSeverity.Unknown);
  });

  test("an unrecognised severity label grades nothing rather than guessing", () => {
    expect(
      severityOf(ruleWith({ ruleLabels: [{ key: "severity", value: "P1" }] })),
    ).toBe(OcsfSeverity.Unknown);
    expect(
      severityOf(ruleWith({ ruleLabels: [{ key: "severity", value: "" }] })),
    ).toBe(OcsfSeverity.Unknown);
    expect(
      severityOf(ruleWith({ ruleLabels: [{ key: "severity", value: 3 }] })),
    ).toBe(OcsfSeverity.Unknown);
  });

  test("the first severity label that names a grade wins", () => {
    expect(
      severityOf(
        ruleWith({
          ruleLabels: [
            { key: "severity", value: "tbd" },
            { key: "severity", value: "High" },
            { key: "severity", value: "Low" },
          ],
        }),
      ),
    ).toBe(OcsfSeverity.High);
  });

  test("a label of Unknown does not stop the search for a real grade", () => {
    expect(
      severityOf(
        ruleWith({
          ruleLabels: [{ key: "severity", value: "Unknown" }],
          outcomes: [{ key: "risk_score", value: "85" }],
        }),
      ),
    ).toBe(OcsfSeverity.High);
  });

  test("snake_case rule_labels in a webhook body are read too", () => {
    expect(
      severityOf({
        detection: {
          rule_name: "Webhook rule",
          rule_labels: [{ key: "severity", value: "Critical" }],
        },
      }),
    ).toBe(OcsfSeverity.Critical);
  });

  test("labels given as a plain object map are read too", () => {
    expect(
      severityOf(ruleWith({ ruleLabels: { author: "me", Severity: "Low" } })),
    ).toBe(OcsfSeverity.Low);
  });

  test("only the first detection entry — the one whose rule names the row — is graded", () => {
    expect(
      severityOf({
        id: "de_two_entries",
        detection: [
          { ruleName: "first", ruleLabels: [{ key: "author", value: "a" }] },
          {
            ruleName: "second",
            ruleLabels: [{ key: "severity", value: "Critical" }],
          },
        ],
      }),
    ).toBe(OcsfSeverity.Unknown);
  });
});

describe("GoogleSecOpsAlertNormalizer severity: the $risk_score outcome", () => {
  test("the published bands are contiguous, highest first, and end at zero", () => {
    const minimums: Array<number> = GOOGLE_SECOPS_RISK_SCORE_BANDS.map(
      (band: { minimum: number }): number => {
        return band.minimum;
      },
    );

    expect(minimums).toEqual([90, 80, 50, 20, 0]);
    expect(
      GOOGLE_SECOPS_RISK_SCORE_BANDS.map(
        (band: { severity: OcsfSeverity }): OcsfSeverity => {
          return band.severity;
        },
      ),
    ).toEqual([
      OcsfSeverity.Critical,
      OcsfSeverity.High,
      OcsfSeverity.Medium,
      OcsfSeverity.Low,
      OcsfSeverity.Informational,
    ]);
  });

  test.each([
    [100, OcsfSeverity.Critical],
    [90, OcsfSeverity.Critical],
    [89.99, OcsfSeverity.High],
    [80, OcsfSeverity.High],
    [79, OcsfSeverity.Medium],
    [50, OcsfSeverity.Medium],
    [49.5, OcsfSeverity.Low],
    [20, OcsfSeverity.Low],
    [19, OcsfSeverity.Informational],
    [1, OcsfSeverity.Informational],
    [0.5, OcsfSeverity.Informational],
    [250, OcsfSeverity.Critical],
    ["35", OcsfSeverity.Low],
    [" 85 ", OcsfSeverity.High],
    ["9.5e1", OcsfSeverity.Critical],
  ])(
    "risk_score %p grades %s",
    (value: number | string, expected: OcsfSeverity) => {
      const result: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize(
          ruleWith({ outcomes: [{ key: "risk_score", value }] }),
        );

      expect(result.severityName).toBe(expected);
      expect(result.severityId).toBe(OcsfSeverityId[expected]);
    },
  );

  test.each([
    [0],
    [-10],
    [""],
    ["  "],
    ["high-ish"],
    ["Infinity"],
    [null],
    [{}],
  ])("risk_score %p grades nothing", (value: JSONValue) => {
    expect(
      severityOf(ruleWith({ outcomes: [{ key: "risk_score", value }] })),
    ).toBe(OcsfSeverity.Unknown);
  });

  test("the bare riskScore field is not graded: Google fills it with a default", () => {
    // 40 is what Google stores for an alerting rule that sets no score.
    expect(severityOf(ruleWith({ riskScore: 40 }))).toBe(OcsfSeverity.Unknown);
    expect(severityOf(ruleWith({ riskScore: 15 }))).toBe(OcsfSeverity.Unknown);
    expect(severityOf(ruleWith({ riskScore: 95 }))).toBe(OcsfSeverity.Unknown);
  });

  test("the outcome key matches regardless of case", () => {
    expect(
      severityOf(ruleWith({ outcomes: [{ key: "RISK_SCORE", value: "92" }] })),
    ).toBe(OcsfSeverity.Critical);
  });

  test("other outcome variables are not read as a score", () => {
    expect(
      severityOf(
        ruleWith({
          outcomes: [
            { key: "risk_score_reason", value: "95" },
            { key: "failed_login_count", value: "99" },
          ],
        }),
      ),
    ).toBe(OcsfSeverity.Unknown);
  });

  test("the first risk_score that grades wins", () => {
    expect(
      severityOf(
        ruleWith({
          outcomes: [
            { key: "risk_score", value: "n/a" },
            { key: "risk_score", value: "55" },
            { key: "risk_score", value: "95" },
          ],
        }),
      ),
    ).toBe(OcsfSeverity.Medium);
  });
});

describe("GoogleSecOpsAlertNormalizer severity: the order sources are read in", () => {
  test("Google's own grade beats the rule's label and its score", () => {
    expect(
      severityOf(
        curatedRuleDetection({
          severity: "LOW",
          ruleLabels: [{ key: "severity", value: "Critical" }],
          outcomes: [{ key: "risk_score", value: "95" }],
        }),
      ),
    ).toBe(OcsfSeverity.Low);
  });

  test("the Collection's own severity beats the label", () => {
    expect(severityOf(customRuleDetection({}, { severity: "HIGH" }))).toBe(
      OcsfSeverity.High,
    );
  });

  test("the label beats the risk score", () => {
    expect(
      severityOf(
        ruleWith({
          ruleLabels: [{ key: "severity", value: "Low" }],
          outcomes: [{ key: "risk_score", value: "95" }],
        }),
      ),
    ).toBe(OcsfSeverity.Low);
  });

  test("an Unknown grade from Google falls through to the rule's own", () => {
    expect(
      severityOf(
        ruleWith({
          severity: "UNKNOWN_SEVERITY",
          ruleLabels: [{ key: "severity", value: "High" }],
        }),
      ),
    ).toBe(OcsfSeverity.High);
    expect(
      severityOf(
        ruleWith({
          severity: "SEVERITY_UNSPECIFIED",
          outcomes: [{ key: "risk_score", value: "20" }],
        }),
      ),
    ).toBe(OcsfSeverity.Low);
  });

  /*
   * The fix only fills in severities that were Unknown. Every grade the
   * two old sources produced must survive, whatever the new sources say.
   */
  describe("every detection that already graded grades exactly as before", () => {
    const gradedAliases: Array<[string, OcsfSeverity]> = Object.entries(
      OCSF_SEVERITY_ALIASES,
    ).filter((entry: [string, OcsfSeverity]): boolean => {
      return entry[1] !== OcsfSeverity.Unknown;
    });

    const contradictingSignals: JSONObject = {
      ruleLabels: [{ key: "severity", value: "Informational" }],
      outcomes: [{ key: "risk_score", value: "99" }],
    };

    test.each(gradedAliases)(
      "detection severity %p stays %s",
      (alias: string, expected: OcsfSeverity) => {
        expect(
          severityOf(ruleWith({ severity: alias, ...contradictingSignals })),
        ).toBe(expected);
      },
    );

    test.each(gradedAliases)(
      "collection severity %p stays %s",
      (alias: string, expected: OcsfSeverity) => {
        const payload: JSONObject = ruleWith(contradictingSignals);
        payload["severity"] = alias;

        expect(severityOf(payload)).toBe(expected);
      },
    );
  });
});

describe("GoogleSecOpsAlertNormalizer severity: malformed input", () => {
  test.each([
    ["a string", "severity=High"],
    ["a number", 7],
    ["null entries", [null, null]],
    ["scalar entries", ["severity", "High"]],
    ["nested arrays", [[{ key: "severity", value: "High" }]]],
    ["a non-string key", [{ key: 1, value: "High" }]],
    ["a missing key", [{ value: "High" }]],
    ["an object value", [{ key: "severity", value: { level: "High" } }]],
    ["an array value", [{ key: "severity", value: ["High"] }]],
  ])(
    "ruleLabels as %s grades nothing and does not throw",
    (_label: string, ruleLabels: JSONValue) => {
      expect(severityOf(ruleWith({ ruleLabels }))).toBe(OcsfSeverity.Unknown);
    },
  );

  test.each([
    ["a string", "risk_score=95"],
    ["null entries", [null]],
    ["a missing value", [{ key: "risk_score" }]],
  ])(
    "outcomes as %s grades nothing and does not throw",
    (_label: string, outcomes: JSONValue) => {
      expect(severityOf(ruleWith({ outcomes }))).toBe(OcsfSeverity.Unknown);
    },
  );

  test("a Collection with no detection entry still grades from its own severity only", () => {
    expect(
      severityOf({
        id: "soar_9",
        type: "SOAR_ALERT",
        severity: "LOW",
        ruleLabels: [{ key: "severity", value: "Critical" }],
      }),
    ).toBe(OcsfSeverity.Low);
    expect(
      severityOf({
        id: "tel_9",
        type: "TELEMETRY_ALERT",
        outcomes: [{ key: "risk_score", value: "95" }],
      }),
    ).toBe(OcsfSeverity.Unknown);
  });
});

describe("GoogleSecOpsAlertNormalizer severity: through the ingest entry point", () => {
  test("a webhook body sniffed as a SecOps alert is graded by its label", () => {
    const payload: JSONObject = customRuleDetection({
      ruleLabels: [{ key: "severity", value: "High" }],
    });

    expect(SecurityEventNormalizer.detectFormat(payload)).toBe(
      SecurityEventFormat.GoogleSecOpsAlert,
    );

    const result: NormalizedSecurityEvent | null =
      SecurityEventNormalizer.normalize(payload);

    expect(result!.severityName).toBe(OcsfSeverity.High);
    expect(result!.severityId).toBe(4);
  });

  test("a body sent with the detection format named is graded the same way", () => {
    const result: NormalizedSecurityEvent | null =
      SecurityEventNormalizer.normalize(
        customRuleDetection(),
        SecurityEventFormat.GoogleSecOpsAlert,
      );

    expect(result!.severityName).toBe(OcsfSeverity.Medium);
  });
});
