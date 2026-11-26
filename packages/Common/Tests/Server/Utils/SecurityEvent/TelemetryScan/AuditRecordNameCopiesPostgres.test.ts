import { Client } from "pg";
import AuditRecordNameCopies, {
  AuditRecordNameCopiesManager,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNameCopies";
import AuditLogAction from "../../../../../Types/AuditLog/AuditLogAction";
import { JSONObject } from "../../../../../Types/JSON";
import Permission from "../../../../../Types/Permission";
import {
  buildSecurityCaseEventSnapshot,
  getSecurityCaseEventEvidenceName,
} from "../../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import { buildSecurityDetectionMatchedEvent } from "../../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { markdownCodeSpan } from "../../../../../Utils/Markdown/MarkdownEscape";
import { detectionRuleMatchMarkdown } from "../../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import {
  AuditRecordNameReaders,
  AuditResourceType,
  AuditScanRecord,
  buildAuditRecordEvent,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT WAS MADE OF THE AUDIT LOG'S EVENTS, REWORDED ON A REAL POSTGRES
 * (#10663).
 *
 * The tables are made here with the columns the rewording reads and
 * writes, as their models keep them (uuid ids, text, jsonb), in a schema of
 * the suite's own. A project that has had the audit log as a security
 * source has a detection, a case, an alert, an incident, their feed items
 * and a case's evidence that quote an event naming its record; another
 * project has the same text and never had the source. The rewording runs
 * twice: the names go from the first project's copies, every other row and
 * line stays as it was, and the second run changes nothing.
 *
 * Opt in against a local Postgres: AUDIT_NAMES_TEST_POSTGRES_URL=
 * postgres://user:password@localhost:5400/database. The suite drops its
 * schema afterwards, and never touches the application's tables.
 */
const endpoint: string | undefined =
  process.env["AUDIT_NAMES_TEST_POSTGRES_URL"];
jest.setTimeout(120000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const schema: string = `audit_names_copies_${process.pid}_${Date.now()}`;
let client: Client;

const WITH_SOURCE: string = "0192f1a0-0000-7000-8000-0000000a0001";
const WITHOUT_SOURCE: string = "0192f1b0-0000-7000-8000-0000000b0001";

const NAMED_AS_BEFORE: AuditRecordNameReaders = {
  eventReaders: [Permission.ProjectOwner],
  getRecordReaders: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
};

function record(overrides: Partial<AuditScanRecord> = {}): AuditScanRecord {
  return {
    id: "0192f1a0-0000-7000-8000-0000000c0001",
    createdAt: new Date("2026-11-10T10:00:00.000Z"),
    resourceType: AuditResourceType.ApiKey,
    resourceId: "0192f1a0-0000-7000-8000-0000000c0002",
    resourceName: "terraform-prod",
    action: AuditLogAction.Create,
    userId: "0192f1a0-0000-7000-8000-0000000c0003",
    userName: "",
    userEmail: "alice@example.com",
    userType: "User",
    apiKeyId: "",
    apiKeyName: "",
    mcpClientName: "",
    workflowId: "",
    workflowName: "",
    workflowRunAs: "",
    workflowRunAsCustomRoleName: "",
    workflowRunAsGiverName: "",
    workflowRunAsGiverApiKeyId: "",
    ...overrides,
  };
}

const STORED: NormalizedSecurityEvent = buildAuditRecordEvent(
  record(),
  NAMED_AS_BEFORE,
)!;
const NOW: NormalizedSecurityEvent = buildAuditRecordEvent(record())!;
const OTHER: string = "Failed password for root from 203.0.113.9 port 22";
const STATE_CHANGED: string =
  '🔴 **Alert State** changed to Acknowledged by "alice@example.com"';

const ROW: JSONObject = {
  eventUid: STORED.eventUid,
  time: "2026-11-10 10:00:00.000",
  severityName: STORED.severityName,
  className: STORED.className,
  activityName: STORED.activityName,
  message: STORED.message,
  vendorName: STORED.vendorName,
  productName: STORED.productName,
  principalUser: STORED.principalUser,
  attributes: STORED.attributes,
  retentionDate: "2026-11-25",
};

function alertDescription(sample: string): string {
  return `Detection rule matched 1 security event between 10:00 and 10:15.\n\nSample event: ${sample}\n\nObservables: alice@example.com`;
}

// Each table, as many of its columns as the rewording reads and writes.
const TABLES: Array<string> = [
  `"SecurityTelemetrySource" ("_id" uuid PRIMARY KEY, "projectId" uuid, "kind" varchar(100))`,
  `"SecurityDetection" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "sampleMessage" text, "description" text, "matchedEvents" jsonb)`,
  `"SecurityCase" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "description" text)`,
  `"Alert" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "description" text)`,
  `"AlertFeed" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "alertFeedEventType" varchar(100), "feedInfoInMarkdown" text)`,
  `"Incident" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "description" text)`,
  `"IncidentFeed" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "incidentFeedEventType" varchar(100), "feedInfoInMarkdown" text)`,
  `"SecurityCaseEvidence" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "name" varchar(500), "eventSnapshot" jsonb)`,
  `"SecurityCaseFeed" ("_id" uuid PRIMARY KEY, "projectId" uuid NOT NULL, "securityCaseFeedEventType" varchar(100), "moreInformationInMarkdown" text)`,
];

function id(project: string, index: number): string {
  return `${project.slice(0, 24)}${String(index).padStart(12, "0")}`;
}

async function insertCopies(project: string): Promise<void> {
  const snapshot: JSONObject = buildSecurityCaseEventSnapshot({
    event: ROW,
  }) as unknown as JSONObject;

  await client.query(
    `INSERT INTO "SecurityDetection" VALUES ($1, $2, $3, $4, $5::jsonb), ($6, $2, $7, NULL, NULL)`,
    [
      id(project, 1),
      project,
      STORED.message,
      detectionRuleMatchMarkdown({
        ruleName: "New API key or MCP client in OneUptime",
        matchCount: 1,
        windowStart: "10:00",
        windowEnd: "10:15",
        sampleMessage: STORED.message,
        observables: [],
      }).toString(),
      JSON.stringify({ events: [buildSecurityDetectionMatchedEvent(ROW)] }),
      id(project, 2),
      OTHER,
    ],
  );
  await client.query(`INSERT INTO "SecurityCase" VALUES ($1, $2, $3)`, [
    id(project, 3),
    project,
    `Opened by hand from a Account Change security event.\n\n**Message:** ${markdownCodeSpan(STORED.message)}`,
  ]);
  await client.query(`INSERT INTO "Alert" VALUES ($1, $2, $3), ($4, $2, $5)`, [
    id(project, 4),
    project,
    alertDescription(STORED.message),
    id(project, 5),
    alertDescription(OTHER),
  ]);
  await client.query(
    `INSERT INTO "AlertFeed" VALUES ($1, $2, 'AlertCreated', $3), ($4, $2, 'AlertStateChanged', $5)`,
    [
      id(project, 6),
      project,
      `#### 🚨 Alert #3 Created:\n\n${alertDescription(STORED.message)}\n     \n`,
      id(project, 7),
      STATE_CHANGED,
    ],
  );
  await client.query(`INSERT INTO "Incident" VALUES ($1, $2, $3)`, [
    id(project, 8),
    project,
    alertDescription(STORED.message),
  ]);
  await client.query(
    `INSERT INTO "IncidentFeed" VALUES ($1, $2, 'IncidentCreated', $3)`,
    [id(project, 9), project, alertDescription(STORED.message)],
  );
  await client.query(
    `INSERT INTO "SecurityCaseEvidence" VALUES ($1, $2, $3, $4::jsonb)`,
    [
      id(project, 10),
      project,
      getSecurityCaseEventEvidenceName({
        message: STORED.message,
        className: STORED.className,
        activityName: STORED.activityName,
      }),
      JSON.stringify(snapshot),
    ],
  );
  await client.query(
    `INSERT INTO "SecurityCaseFeed" VALUES ($1, $2, 'Evidence', $3)`,
    [
      id(project, 11),
      project,
      `- Nov 10, 2026 10:00 UTC · Low · ${STORED.message}\n- Nov 10, 2026 10:01 UTC · High · ${OTHER}`,
    ],
  );
}

async function everyText(project: string): Promise<string> {
  const texts: Array<string> = [];

  for (const table of [
    "SecurityDetection",
    "SecurityCase",
    "Alert",
    "AlertFeed",
    "Incident",
    "IncidentFeed",
    "SecurityCaseEvidence",
    "SecurityCaseFeed",
  ]) {
    const result: { rows: Array<JSONObject> } = await client.query(
      `SELECT * FROM "${table}" WHERE "projectId" = $1 ORDER BY "_id"`,
      [project],
    );

    texts.push(JSON.stringify(result.rows));
  }

  return texts.join("\n");
}

integration(
  "the rewording of what was made of audit log events, on Postgres",
  () => {
    const manager: AuditRecordNameCopiesManager = {
      query: async (query: string, parameters?: Array<unknown>) => {
        return (await client.query(query, parameters as Array<unknown>)).rows;
      },
    };
    let untouched: string = "";
    let firstRun: number = 0;

    beforeAll(async (): Promise<void> => {
      const url: URL = new URL(endpoint!);

      if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) {
        throw new Error("This integration suite requires a local Postgres.");
      }

      client = new Client({ connectionString: endpoint! });
      await client.connect();
      await client.query(`CREATE SCHEMA "${schema}"`);
      await client.query(`SET search_path TO "${schema}"`);

      for (const table of TABLES) {
        await client.query(`CREATE TABLE ${table}`);
      }

      await client.query(
        `INSERT INTO "SecurityTelemetrySource" VALUES ($1, $2, 'audit-log'), ($3, $4, 'traces')`,
        [
          id(WITH_SOURCE, 99),
          WITH_SOURCE,
          id(WITHOUT_SOURCE, 99),
          WITHOUT_SOURCE,
        ],
      );

      await insertCopies(WITH_SOURCE);
      await insertCopies(WITHOUT_SOURCE);

      untouched = await everyText(WITHOUT_SOURCE);
      firstRun = await AuditRecordNameCopies.rewordEveryProject({ manager });
    });

    afterAll(async (): Promise<void> => {
      if (client) {
        try {
          await client.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        } finally {
          await client.end();
        }
      }
    });

    test("every copy of the project that had the audit log as a source loses the name", async (): Promise<void> => {
      expect(firstRun).toBe(8);

      const texts: string = await everyText(WITH_SOURCE);

      expect(texts).not.toContain("terraform-prod");
      expect(texts).toContain("alice@example.com created an API key");
      expect(texts).toContain(OTHER);
    });

    test("each copy reads as the event the scan writes now", async (): Promise<void> => {
      const detection: { rows: Array<JSONObject> } = await client.query(
        `SELECT * FROM "SecurityDetection" WHERE "_id" = $1`,
        [id(WITH_SOURCE, 1)],
      );
      const kept: JSONObject = (
        (detection.rows[0]!["matchedEvents"] as JSONObject)[
          "events"
        ] as Array<JSONObject>
      )[0]!;

      expect(detection.rows[0]!["sampleMessage"]).toBe(NOW.message);
      expect(kept["message"]).toBe(NOW.message);
      expect(
        (kept["attributes"] as JSONObject)["audit.resource_name"],
      ).toBeUndefined();
      expect(String(detection.rows[0]!["description"])).toContain(
        `Sample event: ${markdownCodeSpan(NOW.message)}`,
      );

      const evidence: { rows: Array<JSONObject> } = await client.query(
        `SELECT * FROM "SecurityCaseEvidence" WHERE "_id" = $1`,
        [id(WITH_SOURCE, 10)],
      );

      expect(evidence.rows[0]!["name"]).toBe(NOW.message);
      expect(
        (evidence.rows[0]!["eventSnapshot"] as JSONObject)["message"],
      ).toBe(NOW.message);

      // A feed item that is not an alert's creation was never a candidate.
      const feed: { rows: Array<JSONObject> } = await client.query(
        `SELECT * FROM "AlertFeed" WHERE "_id" = $1`,
        [id(WITH_SOURCE, 7)],
      );

      expect(feed.rows[0]!["feedInfoInMarkdown"]).toBe(STATE_CHANGED);
    });

    test("a project that never had the audit log as a source is left as it was", async (): Promise<void> => {
      expect(await everyText(WITHOUT_SOURCE)).toBe(untouched);
    });

    test("a second run changes nothing", async (): Promise<void> => {
      const before: string = await everyText(WITH_SOURCE);

      expect(await AuditRecordNameCopies.rewordEveryProject({ manager })).toBe(
        0,
      );
      expect(await everyText(WITH_SOURCE)).toBe(before);
    });
  },
);
