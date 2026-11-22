import {
  setTimeout as nodeSetTimeout,
  clearTimeout as nodeClearTimeout,
} from "timers";
import { createClient, ClickHouseClient } from "@clickhouse/client";
import SecurityEvent from "../../../../../Models/AnalyticsModels/SecurityEvent";
import {
  ClickhouseUsername,
  ClickhousePassword,
} from "../../../../../Server/EnvironmentConfig";
import AuditRecordNamesRepair from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNamesRepair";
import AuditLogAction from "../../../../../Types/AuditLog/AuditLogAction";
import Projection from "../../../../../Types/AnalyticsDatabase/Projection";
import { JSONObject } from "../../../../../Types/JSON";
import Permission from "../../../../../Types/Permission";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { WorkflowRunAs } from "../../../../../Types/Workflow/WorkflowRunAs";
import TelemetryUtil from "../../../../../Server/Utils/Telemetry/Telemetry";
import {
  AuditRecordNameReaders,
  AuditResourceType,
  AuditScanRecord,
  MassDeleteRow,
  buildAuditRecordEvent,
  buildMassDeleteEvent,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";
import {
  AuditChangeSaying,
  getAuditChangeSayings,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE REPAIR OF STORED AUDIT LOG EVENTS AGAINST A REAL CLICKHOUSE (#10663).
 *
 * The claim the repair makes: once it has run, an event the audit log's
 * scan stored before #10663 - naming its record - reads exactly as the scan
 * writes the same record's event now: its message, its target, its
 * attributes and their keys. Every way the scan says a change, by every
 * kind of actor, about records named every awkward way, is stored as it was
 * written then, repaired, and compared with what the scan writes now; and
 * every row the repair must not touch is stored beside them and checked
 * unchanged.
 *
 * The table carries the model's real severity projection, so the suite also
 * shows ClickHouse keeps its projection while the rows are rewritten.
 *
 * Opt in against a local development ClickHouse server. The suite creates and
 * removes only its own uniquely named database, never application tables.
 * Load local credentials with DOTENV_CONFIG_PATH=../../config.env node -r dotenv/config.
 * Set AUDIT_NAMES_TEST_CLICKHOUSE_URL=http://localhost:8189 to enable the suite.
 */
const endpoint: string | undefined =
  process.env["AUDIT_NAMES_TEST_CLICKHOUSE_URL"];
jest.setTimeout(180000);

const integration: typeof describe.skip = endpoint ? describe : describe.skip;
const database: string = `audit_names_repair_${process.pid}_${Date.now()}`;
const model: SecurityEvent = new SecurityEvent();
const table: string = `${database}.${model.tableName}Local`;
let client: ClickHouseClient;

const NAMED_AS_BEFORE: AuditRecordNameReaders = {
  eventReaders: [Permission.ProjectOwner],
  getRecordReaders: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
};

const ACTORS: Record<string, Partial<AuditScanRecord>> = {
  person: { userEmail: "alice@example.com", userName: "Alice" },
  "API key": {
    userEmail: "",
    userType: "API",
    apiKeyId: "0192f1a0-0000-7000-8000-00000000f0aa",
    apiKeyName: "ci",
  },
  "workflow given an API key's permissions": {
    userEmail: "",
    userType: "Workflow",
    workflowId: "0192f1a0-0000-7000-8000-00000000f0bb",
    workflowName: "Access Sync",
    workflowRunAs: WorkflowRunAs.CustomRole,
    workflowRunAsCustomRoleName: "Cleanup Crew",
    workflowRunAsGiverName: "terraform",
    workflowRunAsGiverApiKeyId: "0192f1a0-0000-7000-8000-00000000f0cc",
  },
  "MCP client": { userEmail: "", mcpClientName: "Claude Desktop" },
  OneUptime: { userEmail: "", userId: "", userType: "System" },
};

const NAMES: Record<string, string> = {
  plain: "terraform-prod",
  "with quotes": 'the "prod" key',
  "with an apostrophe and a backslash": "O'Brien\\ops",
  unicode: "Équipe d'astreinte — 夜勤",
  emoji: "🔑 deploy",
  "longer than a message quotes": "k".repeat(150),
  "longer than an attribute keeps": "a".repeat(2500),
  "emoji, long": "🔑".repeat(130),
  "that says a change itself": 'x" created the API key "y',
};

interface Case {
  uid: string;
  record: AuditScanRecord;
}

function record(
  index: number,
  overrides: Partial<AuditScanRecord>,
): AuditScanRecord {
  return {
    id: `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
    createdAt: new Date("2026-11-10T10:00:00.000Z"),
    resourceType: AuditResourceType.ApiKey,
    resourceId: `0192f1a0-0000-7000-8001-${String(index).padStart(12, "0")}`,
    resourceName: "terraform-prod",
    action: AuditLogAction.Create,
    userId: "0192f1a0-0000-7000-8000-00000000f003",
    userName: "",
    userEmail: "",
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

function corpus(): Array<Case> {
  const cases: Array<Case> = [];
  let index: number = 0;

  for (const saying of getAuditChangeSayings()) {
    for (const actor of Object.values(ACTORS)) {
      for (const resourceName of Object.values(NAMES)) {
        const event: AuditScanRecord = record(++index, {
          ...actor,
          resourceType: saying.resourceType,
          action: saying.action,
          resourceName,
        });
        const built: NormalizedSecurityEvent = buildAuditRecordEvent(
          event,
          NAMED_AS_BEFORE,
        )!;

        cases.push({ uid: built.eventUid, record: event });
      }
    }
  }

  return cases;
}

// A row as the table holds it, from an event as it was written.
function rowOf(event: NormalizedSecurityEvent, time: string): JSONObject {
  return {
    projectId: "project",
    primaryEntityId: "entity",
    time,
    eventUid: event.eventUid,
    className: event.className,
    severityName: event.severityName,
    vendorName: event.vendorName,
    productName: event.productName,
    message: event.message,
    targetResource: event.targetResource,
    principalUser: event.principalUser,
    attributes: event.attributes,
    attributeKeys: TelemetryUtil.getAttributeKeys(event.attributes),
  };
}

interface StoredRow {
  eventUid: string;
  message: string;
  targetResource: string;
  attributes: JSONObject;
  attributeKeys: Array<string>;
}

async function storedRows(): Promise<Map<string, StoredRow>> {
  const result: { data: Array<StoredRow> } = (await (
    await client.query({
      query: `SELECT eventUid, message, targetResource, attributes, attributeKeys FROM ${table}`,
      format: "JSON",
    })
  ).json()) as { data: Array<StoredRow> };

  return new Map(
    result.data.map((row: StoredRow): [string, StoredRow] => {
      return [row.eventUid, row];
    }),
  );
}

integration("the repair of stored audit log events against ClickHouse", () => {
  const cases: Array<Case> = corpus();
  // Rows the repair must not touch, as stored.
  const untouched: Map<string, JSONObject> = new Map();

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
      query: `CREATE TABLE ${table} (projectId String, primaryEntityId String, time DateTime64(9), eventUid String, className LowCardinality(String), severityName LowCardinality(String), vendorName LowCardinality(String), productName LowCardinality(String), message String, targetResource String, principalUser String, attributes Map(String, String), attributeKeys Array(String)${projections}) ENGINE = MergeTree PARTITION BY toYYYYMMDD(time) ORDER BY (projectId, time, primaryEntityId)`,
    });

    const rows: Array<JSONObject> = cases.map((testCase: Case): JSONObject => {
      return rowOf(
        buildAuditRecordEvent(testCase.record, NAMED_AS_BEFORE)!,
        "2026-11-10 10:00:00",
      );
    });

    // Before the scan shipped: a partition the repair never reads.
    const early: NormalizedSecurityEvent = buildAuditRecordEvent(
      record(90001, { resourceName: "before-the-scan" }),
      NAMED_AS_BEFORE,
    )!;
    // Another source's event, with keys that look like the audit log's.
    const other: JSONObject = {
      ...rowOf(early, "2026-11-10 10:00:00"),
      eventUid: "other-source",
      vendorName: "Acme",
      productName: "Acme Gateway",
      message: 'jane created the API key "acme"',
      attributes: {
        "oneuptime.source": "logs",
        "audit.resource_type": "API Key",
        "audit.action": "Create",
        "audit.resource_name": "acme",
      },
    };
    // An audit log event already written without a name, and a mass delete.
    const now: NormalizedSecurityEvent = buildAuditRecordEvent(
      record(90002, {}),
    )!;
    const massDelete: NormalizedSecurityEvent = buildMassDeleteEvent(
      {
        userId: "0192f1a0-0000-7000-8000-00000000f004",
        userName: "Mallory",
        userEmail: "mallory@example.com",
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
        deletes: 40,
        sampleResourceTypes: ["Monitor"],
        firstAt: new Date("2026-11-10T10:00:00.000Z"),
        lastAt: new Date("2026-11-10T10:03:00.000Z"),
      } as MassDeleteRow,
      new Date("2026-11-10T10:00:00.000Z"),
    )!;

    for (const row of [
      { ...rowOf(early, "2026-10-01 10:00:00"), eventUid: "before-the-scan" },
      other,
      rowOf(now, "2026-11-10 10:00:00"),
      rowOf(massDelete, "2026-11-10 10:00:00"),
    ]) {
      untouched.set(String(row["eventUid"]), row);
      rows.push(row);
    }

    await client.insert({
      table,
      values: rows,
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0 },
    });

    await client.command({
      query: `${AuditRecordNamesRepair.repairStatement({
        storageTable: table,
        onCluster: "",
      })} SETTINGS mutations_sync = 2`,
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

  test("the corpus is every saying, by every actor, about every kind of name", () => {
    expect(cases.length).toBe(
      getAuditChangeSayings().length *
        Object.keys(ACTORS).length *
        Object.keys(NAMES).length,
    );
    expect(
      new Set(
        getAuditChangeSayings().map((saying: AuditChangeSaying): string => {
          return saying.resourceType;
        }),
      ).size,
    ).toBe(10);
  });

  test("after the repair every stored event reads as the scan writes it now", async (): Promise<void> => {
    const stored: Map<string, StoredRow> = await storedRows();
    const mismatches: Array<JSONObject> = [];

    for (const testCase of cases) {
      const now: NormalizedSecurityEvent = buildAuditRecordEvent(
        testCase.record,
      )!;
      const got: StoredRow = stored.get(testCase.uid)!;

      if (
        got.message !== now.message ||
        got.targetResource !== now.targetResource ||
        JSON.stringify(Object.entries(got.attributes).sort()) !==
          JSON.stringify(Object.entries(now.attributes).sort()) ||
        JSON.stringify([...got.attributeKeys].sort()) !==
          JSON.stringify(TelemetryUtil.getAttributeKeys(now.attributes).sort())
      ) {
        mismatches.push({
          uid: testCase.uid,
          stored: got.message,
          now: now.message,
          target: `${got.targetResource} / ${now.targetResource}`,
        });
      }
    }

    expect(mismatches).toEqual([]);
  });

  test("nothing the repair may not touch changed: older partitions, other sources, events without names, mass deletes", async (): Promise<void> => {
    const stored: Map<string, StoredRow> = await storedRows();

    for (const [uid, row] of untouched) {
      const got: StoredRow = stored.get(uid)!;

      expect([uid, got.message, got.targetResource]).toEqual([
        uid,
        row["message"],
        row["targetResource"],
      ]);
      expect(got.attributes).toEqual(row["attributes"]);
    }
  });

  test("a second run finds nothing left to do", async (): Promise<void> => {
    const result: { data: Array<{ candidates: string }> } = (await (
      await client.query({
        query: `SELECT count() AS candidates FROM ${table} WHERE ${AuditRecordNamesRepair.condition(AuditRecordNamesRepair.getWithheldResourceTypes())}`,
        format: "JSON",
      })
    ).json()) as { data: Array<{ candidates: string }> };

    expect(Number(result.data[0]!.candidates)).toBe(0);
  });

  test("the projection still answers as the rows do", async (): Promise<void> => {
    const result: { data: Array<{ rows: string }> } = (await (
      await client.query({
        query: `SELECT count() AS rows FROM ${table} WHERE projectId = 'project'`,
        format: "JSON",
      })
    ).json()) as { data: Array<{ rows: string }> };

    expect(Number(result.data[0]!.rows)).toBe(cases.length + untouched.size);
  });
});
