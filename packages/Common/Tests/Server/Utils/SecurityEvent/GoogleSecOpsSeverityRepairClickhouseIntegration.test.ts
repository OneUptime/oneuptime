import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import {
  ClickhouseUsername,
  ClickhousePassword,
} from "../../../../Server/EnvironmentConfig";
import GoogleSecOpsSeverityRepair from "../../../../Server/Utils/SecurityEvent/GoogleSecOpsSeverityRepair";
import Projection from "../../../../Types/AnalyticsDatabase/Projection";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
  normalizeOcsfSeverity,
} from "../../../../Types/SecurityEvent/OcsfSeverity";
import GoogleSecOpsAlertNormalizer from "../../../../Utils/SecurityEvent/GoogleSecOpsAlertNormalizer";
import { readString } from "../../../../Utils/SecurityEvent/NormalizerHelpers";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The Google SecOps severity repair against a real ClickHouse server.
 *
 * The claim the repair makes is that, once it has run, a row stored before
 * the fix reads exactly as if the fixed normalizer had imported it. This
 * suite checks that claim directly: every payload in a broad corpus is
 * normalized by the fixed GoogleSecOpsAlertNormalizer, stored the way the
 * old normalizer stored it (same attributes, the old severity), repaired,
 * and compared with what the fixed normalizer says.
 *
 * The table carries the model's real severity projection, so the suite also
 * shows ClickHouse keeps the projection in step with the rewritten rows.
 *
 * Opt in against a local development ClickHouse server. The suite creates and
 * removes only its own uniquely named database, never application tables.
 * Load local credentials with DOTENV_CONFIG_PATH=../../config.env node -r dotenv/config.
 * Set SECOPS_TEST_CLICKHOUSE_URL=http://localhost:8189 to enable the suite.
 */
const endpoint: string | undefined = process.env["SECOPS_TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `secops_severity_repair_${process.pid}_${Date.now()}`;
const model: SecurityEvent = new SecurityEvent();
const table: string = `${database}.${model.tableName}Local`;
let client: ClickHouseClient;

// What the normalizer did before the fix: detection severity, then the Collection's.
function legacySeverity(payload: JSONObject): OcsfSeverity {
  const detections: JSONValue = payload["detection"] as JSONValue;
  const first: JSONValue = Array.isArray(detections)
    ? (detections[0] as JSONValue)
    : detections;
  const detection: JSONObject | null =
    first && typeof first === "object" && !Array.isArray(first)
      ? (first as JSONObject)
      : null;

  return (
    (detection && normalizeOcsfSeverity(readString(detection, "severity"))) ||
    normalizeOcsfSeverity(readString(payload, "severity")) ||
    OcsfSeverity.Unknown
  );
}

interface Case {
  uid: string;
  payload: JSONObject;
  vendorName?: string | undefined;
  classUid?: number | undefined;
}

function rule(uid: string, entry: JSONObject, top: JSONObject = {}): Case {
  return {
    uid,
    payload: {
      id: uid,
      type: "RULE_DETECTION",
      detectionTime: "2026-09-17T11:00:00Z",
      detection: [
        { ruleName: `rule ${uid}`, alertState: "ALERTING", ...entry },
      ],
      ...top,
    },
  };
}

function corpus(): Array<Case> {
  const cases: Array<Case> = [];

  const labelValues: Array<string> = [
    "Info",
    "Informational",
    "low",
    "Low",
    "Medium",
    "MEDIUM",
    "High",
    " high ",
    "\thigh\n",
    "Critical",
    "CRITICAL",
    "warning",
    "Error",
    "Emergency",
    "Unknown",
    "UNKNOWN_SEVERITY",
    "P1",
    "",
    "Sev 3",
  ];

  labelValues.forEach((value: string, index: number): void => {
    cases.push(
      rule(`label-${index}`, {
        ruleLabels: [
          { key: "author", value: "Detection Engineering" },
          { key: "severity", value },
        ],
        riskScore: 40,
      }),
    );
  });

  ["Severity", "SEVERITY", " severity ", "priority", "severity_notes"].forEach(
    (key: string, index: number): void => {
      cases.push(
        rule(`label-key-${index}`, {
          ruleLabels: [{ key, value: "High" }],
        }),
      );
    },
  );

  const scores: Array<JSONValue> = [
    100,
    90,
    89.99,
    80,
    79,
    50,
    49.5,
    20,
    19,
    1,
    0.5,
    0,
    -3,
    250,
    "35",
    " 85 ",
    "9.5e1",
    "",
    "n/a",
    "Infinity",
  ];

  scores.forEach((value: JSONValue, index: number): void => {
    cases.push(
      rule(`risk-${index}`, {
        outcomes: [
          { key: "hostname", value: "ws-1" },
          { key: "risk_score", value },
        ],
      }),
    );
  });

  // Order and precedence between the sources.
  cases.push(
    rule("label-beats-risk", {
      ruleLabels: [{ key: "severity", value: "Low" }],
      outcomes: [{ key: "risk_score", value: "95" }],
    }),
    rule("first-grading-label", {
      ruleLabels: [
        { key: "severity", value: "tbd" },
        { key: "severity", value: "High" },
        { key: "severity", value: "Low" },
      ],
    }),
    rule("unknown-label-falls-to-risk", {
      ruleLabels: [{ key: "severity", value: "Unknown" }],
      outcomes: [{ key: "risk_score", value: "55" }],
    }),
    rule("first-grading-risk", {
      outcomes: [
        { key: "risk_score", value: "n/a" },
        { key: "risk_score", value: "85" },
      ],
    }),
    rule("unknown-detection-severity", {
      severity: "UNKNOWN_SEVERITY",
      ruleLabels: [{ key: "severity", value: "Critical" }],
    }),
    rule("unspecified-detection-severity", {
      severity: "SEVERITY_UNSPECIFIED",
      outcomes: [{ key: "risk_score", value: "25" }],
    }),
    rule(
      "unknown-detection-then-collection",
      {
        severity: "UNKNOWN",
        ruleLabels: [{ key: "severity", value: "Low" }],
      },
      { severity: "HIGH" },
    ),
    rule("bare-risk-score-only", { riskScore: 95 }),
    rule("nothing-at-all", {}),
  );

  // A label past index 9: list order, not the map's key order, decides.
  const manyLabels: Array<JSONObject> = [];
  for (let i: number = 0; i < 12; i++) {
    manyLabels.push({ key: `meta_${i}`, value: String(i) });
  }
  manyLabels[3] = { key: "severity", value: "Medium" };
  manyLabels[11] = { key: "severity", value: "Critical" };
  cases.push(rule("many-labels", { ruleLabels: manyLabels }));

  const lateLabels: Array<JSONObject> = [];
  for (let i: number = 0; i < 12; i++) {
    lateLabels.push({ key: `meta_${i}`, value: String(i) });
  }
  lateLabels[10] = { key: "severity", value: "High" };
  cases.push(rule("late-label", { ruleLabels: lateLabels }));

  // Only the first detection entry is graded.
  cases.push({
    uid: "second-entry-ignored",
    payload: {
      id: "second-entry-ignored",
      detection: [
        { ruleName: "first" },
        {
          ruleName: "second",
          ruleLabels: [{ key: "severity", value: "High" }],
        },
      ],
    },
  });

  // A webhook body with detection as an object and snake_case labels.
  cases.push({
    uid: "snake-webhook",
    payload: {
      detection: {
        rule_name: "webhook",
        rule_labels: [{ key: "severity", value: "Critical" }],
      },
      detection_time: 1789000000,
    },
  });

  // Already graded before the fix: the repair must leave them alone.
  cases.push(
    rule("curated-graded", {
      severity: "MEDIUM",
      ruleLabels: [{ key: "severity", value: "Critical" }],
      outcomes: [{ key: "risk_score", value: "95" }],
    }),
    rule(
      "collection-graded",
      { ruleLabels: [{ key: "severity", value: "Critical" }] },
      { severity: "LOW" },
    ),
  );

  // A Google-shaped row from another source or class is not the repair's.
  cases.push(
    {
      ...rule("other-vendor", {
        ruleLabels: [{ key: "severity", value: "High" }],
      }),
      vendorName: "Elastic",
    },
    {
      ...rule("other-class", {
        ruleLabels: [{ key: "severity", value: "High" }],
      }),
      classUid: 1001,
    },
  );

  return cases;
}

interface StoredRow {
  eventUid: string;
  severityName: string;
  severityId: number;
}

async function storedRows(): Promise<Map<string, StoredRow>> {
  const result: { data: Array<StoredRow> } = (await (
    await client.query({
      query: `SELECT eventUid, severityName, severityId FROM ${table}`,
      format: "JSON",
    })
  ).json()) as { data: Array<StoredRow> };

  return new Map(
    result.data.map((row: StoredRow): [string, StoredRow] => {
      return [row.eventUid, { ...row, severityId: Number(row.severityId) }];
    }),
  );
}

async function countCandidates(): Promise<number> {
  const result: { data: Array<{ candidates: string }> } = (await (
    await client.query({
      query: `SELECT count() AS candidates FROM ${table} WHERE ${GoogleSecOpsSeverityRepair.condition()}`,
      format: "JSON",
    })
  ).json()) as { data: Array<{ candidates: string }> };

  return Number(result.data[0]!.candidates);
}

async function repair(): Promise<void> {
  await client.command({
    query: `${GoogleSecOpsSeverityRepair.repairStatement({
      storageTable: table,
      onCluster: "",
    })} SETTINGS mutations_sync = 2`,
  });
}

integration("Google SecOps severity repair against ClickHouse", () => {
  const cases: Array<Case> = corpus();
  const expected: Map<string, NormalizedSecurityEvent> = new Map();
  const legacy: Map<string, OcsfSeverity> = new Map();

  beforeAll(async (): Promise<void> => {
    // The real ClickHouse HTTP client needs Node timers with unref().
    jest.spyOn(globalThis, "setTimeout").mockImplementation(nodeSetTimeout);
    jest.spyOn(globalThis, "clearTimeout").mockImplementation(nodeClearTimeout);
    const url: URL = new URL(endpoint!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
      throw new Error(
        "This integration suite requires a local ClickHouse server.",
      );
    }
    client = createClient({
      url: endpoint!,
      username: ClickhouseUsername,
      password: ClickhousePassword,
      request_timeout: 120000,
    });

    const projections: string = model.projections
      .map((projection: Projection): string => {
        return `, PROJECTION ${projection.name} (${projection.query})`;
      })
      .join("");

    await client.command({ query: `CREATE DATABASE ${database}` });
    await client.command({
      query: `CREATE TABLE ${table} (projectId String, primaryEntityId String, time DateTime64(9), eventUid String, classUid Int32, className LowCardinality(String), severityId Int32, severityName LowCardinality(String), vendorName LowCardinality(String), productName LowCardinality(String), attributes Map(String, String)${projections}) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) ORDER BY (projectId, time, primaryEntityId)`,
    });

    const rows: Array<JSONObject> = [];

    for (const testCase of cases) {
      const normalized: NormalizedSecurityEvent =
        GoogleSecOpsAlertNormalizer.normalize(testCase.payload);
      const before: OcsfSeverity = legacySeverity(testCase.payload);

      expected.set(testCase.uid, normalized);
      legacy.set(testCase.uid, before);

      rows.push({
        projectId: "project",
        primaryEntityId: "entity",
        time: "2026-09-17 11:00:00",
        eventUid: testCase.uid,
        classUid: testCase.classUid ?? normalized.classUid,
        className: normalized.className,
        severityId: OcsfSeverityId[before],
        severityName: before,
        vendorName: testCase.vendorName ?? normalized.vendorName,
        productName: normalized.productName,
        /*
         * Stored in reverse key order: which list entry comes first must
         * be decided by its index, never by the map's key order.
         */
        attributes: Object.fromEntries(
          Object.entries(normalized.attributes).reverse(),
        ),
      });
    }

    await client.insert({
      table,
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });
  });

  afterAll(async (): Promise<void> => {
    if (client) {
      try {
        await client.command({
          query: `DROP DATABASE IF EXISTS ${database} SYNC`,
        });
      } finally {
        await client.close();
        jest.restoreAllMocks();
      }
    }
  });

  test("the corpus exercises rows the fix re-grades and rows it must not", () => {
    const regraded: Array<string> = cases
      .filter((testCase: Case): boolean => {
        return (
          legacy.get(testCase.uid) === OcsfSeverity.Unknown &&
          expected.get(testCase.uid)!.severityName !== OcsfSeverity.Unknown
        );
      })
      .map((testCase: Case): string => {
        return testCase.uid;
      });

    expect(regraded.length).toBeGreaterThan(40);
    expect(regraded).toContain("label-4");
    expect(regraded).toContain("risk-2");
    expect(legacy.get("curated-graded")).toBe(OcsfSeverity.Medium);
  });

  test("after the repair every Google SecOps finding reads as the fixed normalizer grades it", async (): Promise<void> => {
    expect(await countCandidates()).toBeGreaterThan(0);

    await repair();

    const stored: Map<string, StoredRow> = await storedRows();
    const mismatches: Array<JSONObject> = [];

    for (const testCase of cases) {
      if (testCase.vendorName || testCase.classUid) {
        continue;
      }

      const want: NormalizedSecurityEvent = expected.get(testCase.uid)!;
      const got: StoredRow = stored.get(testCase.uid)!;

      if (
        got.severityName !== want.severityName ||
        got.severityId !== want.severityId
      ) {
        mismatches.push({
          uid: testCase.uid,
          stored: `${got.severityName}/${got.severityId}`,
          normalizer: `${want.severityName}/${want.severityId}`,
        });
      }
    }

    expect(mismatches).toEqual([]);
  });

  test("the rows from another vendor or class keep their Unknown", async (): Promise<void> => {
    const stored: Map<string, StoredRow> = await storedRows();

    expect(stored.get("other-vendor")).toEqual({
      eventUid: "other-vendor",
      severityName: "Unknown",
      severityId: 0,
    });
    expect(stored.get("other-class")).toEqual({
      eventUid: "other-class",
      severityName: "Unknown",
      severityId: 0,
    });
  });

  test("spot checks read as the customer would expect", async (): Promise<void> => {
    const stored: Map<string, StoredRow> = await storedRows();
    const severityOf: (uid: string) => string = (uid: string): string => {
      return stored.get(uid)!.severityName;
    };

    expect(severityOf("label-4")).toBe("Medium");
    expect(severityOf("late-label")).toBe("High");
    expect(severityOf("many-labels")).toBe("Medium");
    expect(severityOf("snake-webhook")).toBe("Critical");
    expect(severityOf("second-entry-ignored")).toBe("Unknown");
    expect(severityOf("bare-risk-score-only")).toBe("Unknown");
    expect(severityOf("nothing-at-all")).toBe("Unknown");
    expect(severityOf("curated-graded")).toBe("Medium");
    expect(severityOf("collection-graded")).toBe("Low");
    expect(severityOf("unknown-detection-then-collection")).toBe("High");
  });

  test("nothing is left to repair, so running it again changes nothing", async (): Promise<void> => {
    const before: Map<string, StoredRow> = await storedRows();

    expect(await countCandidates()).toBe(0);
    await repair();

    expect(await storedRows()).toEqual(before);
  });

  test("the severity projection is rebuilt in step with the rows", async (): Promise<void> => {
    const byProjection: { data: Array<{ severityName: string; cnt: string }> } =
      (await (
        await client.query({
          query: `SELECT severityName, count() AS cnt FROM ${table} GROUP BY projectId, severityName, className, toStartOfInterval(time, INTERVAL 1 MINUTE) ORDER BY severityName`,
          format: "JSON",
          clickhouse_settings: {
            force_optimize_projection: 1,
            force_optimize_projection_name: "proj_severity_histogram",
          },
        })
      ).json()) as { data: Array<{ severityName: string; cnt: string }> };

    const byRows: Map<string, number> = new Map();
    for (const row of (await storedRows()).values()) {
      byRows.set(row.severityName, (byRows.get(row.severityName) || 0) + 1);
    }

    const projected: Map<string, number> = new Map();
    for (const row of byProjection.data) {
      projected.set(
        row.severityName,
        (projected.get(row.severityName) || 0) + Number(row.cnt),
      );
    }

    expect(projected).toEqual(byRows);
  });
});
