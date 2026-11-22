import "../../../TestingUtils/Init";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import AuditRecordNameCopies, {
  AUDIT_RECORD_NAME_COPIES_PAGE_SIZE,
  AUDIT_RECORD_NAME_COPY_TABLES,
  AuditRecordNameCopiesManager,
  AuditRecordNameCopyRow,
  AuditRecordNameCopyTable,
  rewordAuditRecordNameCopy,
} from "../../../../../Server/Utils/SecurityEvent/TelemetryScan/AuditRecordNameCopies";
import logger from "../../../../../Server/Utils/Logger";
import AllDatabaseModelTypes from "../../../../../Models/DatabaseModels/Index";
import BaseModel, {
  DatabaseBaseModelType,
} from "../../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import AuditLogAction from "../../../../../Types/AuditLog/AuditLogAction";
import { JSONObject } from "../../../../../Types/JSON";
import Permission from "../../../../../Types/Permission";
import {
  SecurityCaseEventSnapshot,
  buildSecurityCaseEventSnapshot,
  getSecurityCaseEventEvidenceName,
} from "../../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SecurityDetectionMatchedEvent,
  buildSecurityDetectionMatchedEvent,
} from "../../../../../Types/SecurityCase/SecurityDetectionMatchedEvents";
import NormalizedSecurityEvent from "../../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import { SecurityTelemetrySourceKind } from "../../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { markdownCodeSpan } from "../../../../../Utils/Markdown/MarkdownEscape";
import {
  detectionRuleMatchMarkdown,
  eventEvidenceLineMarkdown,
} from "../../../../../Utils/SecurityCase/SecurityCaseMarkdown";
import FeedMarkdown from "../../../../../Utils/Markdown/FeedMarkdown";
import {
  AUDIT_ATTRIBUTES,
  AuditRecordNameReaders,
  AuditResourceType,
  AuditScanRecord,
  buildAuditRecordEvent,
} from "../../../../../Utils/SecurityEvent/TelemetryScan/AuditLogSignals";

/*
 * WHAT WAS MADE OF THE AUDIT LOG'S SECURITY EVENTS BEFORE #10663, SAID
 * WITHOUT THE NAMES (#10663).
 *
 * Each copy is built here the way OneUptime builds it - a detection's
 * sample and kept events, the case it opened, an alert's description and
 * its "Created" feed item, a case opened by hand, a case's evidence and its
 * feed - from an event stored as it used to be, and reworded. Every name
 * goes, every other line stays, and a copy of another source's event is
 * left as it was. The executor reads each project's candidates a page at a
 * time and writes each changed row back with SQL of its own.
 */

const NAMED_AS_BEFORE: AuditRecordNameReaders = {
  eventReaders: [Permission.ProjectOwner],
  getRecordReaders: (): Array<Permission> => {
    return [Permission.ProjectOwner];
  },
};

const EVERY_TYPE_WITHHELD: (resourceType: string) => boolean = (): boolean => {
  return true;
};

const NAME: string = "terraform-prod";

function record(overrides: Partial<AuditScanRecord> = {}): AuditScanRecord {
  return {
    id: "0192f1a0-0000-7000-8000-00000000e001",
    createdAt: new Date("2026-11-10T10:00:00.000Z"),
    resourceType: AuditResourceType.ApiKey,
    resourceId: "0192f1a0-0000-7000-8000-00000000e002",
    resourceName: NAME,
    action: AuditLogAction.Create,
    userId: "0192f1a0-0000-7000-8000-00000000e003",
    userName: "",
    userEmail: "",
    userType: "API",
    apiKeyId: "0192f1a0-0000-7000-8000-00000000e0aa",
    apiKeyName: "ci",
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

// The stored event as ClickHouse hands its row back.
const ROW: JSONObject = {
  eventUid: STORED.eventUid,
  time: "2026-11-10 10:00:00.000",
  primaryEntityId: "0192f1a0-0000-7000-8000-00000000e0bb",
  severityName: STORED.severityName,
  className: STORED.className,
  categoryName: STORED.categoryName,
  activityName: STORED.activityName,
  statusName: STORED.statusName,
  message: STORED.message,
  vendorName: STORED.vendorName,
  productName: STORED.productName,
  principalUser: STORED.principalUser,
  attributes: STORED.attributes,
  retentionDate: "2026-11-25",
};

const OTHER_SAMPLE: string =
  "Failed password for root from 203.0.113.9 port 22";

function tableNamed(name: string): AuditRecordNameCopyTable {
  return AUDIT_RECORD_NAME_COPY_TABLES.find(
    (table: AuditRecordNameCopyTable): boolean => {
      return table.table === name;
    },
  )!;
}

function reword(
  name: string,
  row: Record<string, unknown>,
): Record<string, unknown> | null {
  return rewordAuditRecordNameCopy({
    table: tableNamed(name),
    row: { _id: "0192f1a0-0000-7000-8000-00000000e100", ...row },
    isNameWithheld: EVERY_TYPE_WITHHELD,
  });
}

// An alert's or an incident's description, as a rule's match writes it (DetectionRuleEvaluator).
function matchDescription(sample: string): string {
  return [
    "Somebody created an API key or gave an MCP client access to the project: a new way in that does not sign in.",
    "Detection rule matched 1 security event between Nov 10, 2026 10:00 and Nov 10, 2026 10:15.",
    `Sample event: ${sample}`,
    "Observables: ci",
  ].join("\n\n");
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the copies an audit log event was quoted in", () => {
  test("the stored event names the key, and the one written now does not", () => {
    expect(STORED.message).toBe(
      `The API key "ci" created the API key "${NAME}"`,
    );
    expect(NOW.message).toBe('The API key "ci" created an API key');
  });

  test("a detection: its sample, its description and the events it kept", () => {
    const kept: SecurityDetectionMatchedEvent =
      buildSecurityDetectionMatchedEvent(ROW)!;
    const description: string = detectionRuleMatchMarkdown({
      ruleName: "New API key or MCP client in OneUptime",
      matchCount: 1,
      windowStart: "10:00",
      windowEnd: "10:15",
      sampleMessage: STORED.message,
      observables: ["ci"],
    }).toString();

    const changes: Record<string, unknown> = reword("SecurityDetection", {
      sampleMessage: STORED.message,
      description,
      matchedEvents: { events: [kept], outcomes: {} },
    })!;

    expect(changes["sampleMessage"]).toBe(NOW.message);
    expect(changes["description"]).toBe(
      description.replace(
        markdownCodeSpan(STORED.message),
        markdownCodeSpan(NOW.message),
      ),
    );

    const events: Array<JSONObject> = (changes["matchedEvents"] as JSONObject)[
      "events"
    ] as Array<JSONObject>;

    expect(events[0]!["message"]).toBe(NOW.message);
    expect(
      (events[0]!["attributes"] as JSONObject)[AUDIT_ATTRIBUTES.resourceName],
    ).toBeUndefined();
    expect(
      (events[0]!["attributes"] as JSONObject)[AUDIT_ATTRIBUTES.resourceType],
    ).toBe(AuditResourceType.ApiKey);
    expect((changes["matchedEvents"] as JSONObject)["outcomes"]).toEqual({});
    expect(JSON.stringify(changes)).not.toContain("terraform");
  });

  test("a case a rule opened, and one opened by hand from the event", () => {
    const opened: string = detectionRuleMatchMarkdown({
      ruleName: "New API key or MCP client in OneUptime",
      matchCount: 1,
      windowStart: "10:00",
      windowEnd: "10:15",
      sampleMessage: STORED.message,
      observables: [],
    }).toString();
    const byHand: string = `Opened by hand from a Account Change security event.\n\n- **Time:** 2026-11-10T10:00:00.000Z\n\n**Message:** ${markdownCodeSpan(STORED.message)}`;

    expect(reword("SecurityCase", { description: opened })).toEqual({
      description: opened.replace(
        markdownCodeSpan(STORED.message),
        markdownCodeSpan(NOW.message),
      ),
    });
    expect(reword("SecurityCase", { description: byHand })).toEqual({
      description: byHand.replace(
        markdownCodeSpan(STORED.message),
        markdownCodeSpan(NOW.message),
      ),
    });
  });

  test("an alert and an incident a rule raised, and their Created feed items, which every member reads", () => {
    const description: string = matchDescription(STORED.message);
    const feed: string = `#### 🚨 Alert #12 Created:\n           \n**New API key or MCP client in OneUptime — ci**:\n     \n${FeedMarkdown.asMarkdown(description).toString()}\n     \n`;

    for (const table of ["Alert", "Incident"]) {
      expect(reword(table, { description })).toEqual({
        description: matchDescription(NOW.message),
      });
    }

    for (const table of ["AlertFeed", "IncidentFeed"]) {
      const changes: Record<string, unknown> = reword(table, {
        feedInfoInMarkdown: feed,
      })!;

      expect(changes["feedInfoInMarkdown"]).toBe(
        feed.replace(STORED.message, NOW.message),
      );
      expect(String(changes["feedInfoInMarkdown"])).not.toContain("terraform");
    }
  });

  test("a case's evidence of the event: its copy, its name and the feed line that added it", () => {
    const snapshot: SecurityCaseEventSnapshot = buildSecurityCaseEventSnapshot({
      event: ROW,
    });
    const name: string = getSecurityCaseEventEvidenceName(snapshot);

    const changes: Record<string, unknown> = reword("SecurityCaseEvidence", {
      name,
      eventSnapshot: snapshot,
    })!;

    expect(changes["name"]).toBe(NOW.message);
    expect((changes["eventSnapshot"] as JSONObject)["message"]).toBe(
      NOW.message,
    );
    expect(JSON.stringify(changes)).not.toContain("terraform");

    const lines: string = FeedMarkdown.bulletList([
      eventEvidenceLineMarkdown({
        time: "Nov 10, 2026 10:00 UTC",
        severity: "Low",
        name,
      }),
      eventEvidenceLineMarkdown({
        time: "Nov 10, 2026 10:01 UTC",
        severity: "High",
        name: OTHER_SAMPLE,
      }),
    ]).toString();

    const feed: Record<string, unknown> = reword("SecurityCaseFeed", {
      moreInformationInMarkdown: lines,
    })!;

    expect(String(feed["moreInformationInMarkdown"])).not.toContain(
      "terraform",
    );
    expect(String(feed["moreInformationInMarkdown"])).toContain(OTHER_SAMPLE);
    expect(String(feed["moreInformationInMarkdown"])).toContain(
      "created an API key",
    );
  });

  test("a copy of another source's event, or one already reworded, is left as it is", () => {
    const description: string = matchDescription(OTHER_SAMPLE);
    const other: JSONObject = {
      ...ROW,
      vendorName: "Acme",
      productName: "Acme Gateway",
      message: OTHER_SAMPLE,
      attributes: { "oneuptime.source": "logs", "audit.resource_name": "x" },
    };

    expect(reword("Alert", { description })).toBeNull();
    expect(
      reword("SecurityCaseEvidence", {
        name: OTHER_SAMPLE,
        eventSnapshot: buildSecurityCaseEventSnapshot({ event: other }),
      }),
    ).toBeNull();
    expect(
      reword("Alert", { description: matchDescription(NOW.message) }),
    ).toBeNull();
    expect(
      reword("SecurityDetection", {
        sampleMessage: null,
        description: null,
        matchedEvents: null,
      }),
    ).toBeNull();
  });
});

describe("the tables the copies are in", () => {
  test("each is a model's table, and each column it rewords and narrows by is the model's", () => {
    for (const table of AUDIT_RECORD_NAME_COPY_TABLES) {
      const modelType: DatabaseBaseModelType | undefined = (
        AllDatabaseModelTypes as Array<DatabaseBaseModelType>
      ).find((type: DatabaseBaseModelType): boolean => {
        return new type().tableName === table.table;
      });

      expect([table.table, Boolean(modelType)]).toEqual([table.table, true]);

      const model: BaseModel = new modelType!();
      const named: Array<string> = [
        "projectId",
        ...table.columns.map((copy: { column: string }): string => {
          return copy.column;
        }),
        ...Array.from(table.candidates.matchAll(/"(\w+)"/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1]!;
          },
        ),
      ];

      for (const column of named) {
        expect([table.table, column, model.isTableColumn(column)]).toEqual([
          table.table,
          column,
          true,
        ]);
      }
    }
  });
});

describe("rewording a project's copies", () => {
  function manager(pages: Array<Array<AuditRecordNameCopyRow>>): {
    manager: AuditRecordNameCopiesManager;
    calls: Array<{ query: string; parameters: Array<unknown> }>;
  } {
    const calls: Array<{ query: string; parameters: Array<unknown> }> = [];
    let page: number = 0;

    return {
      calls,
      manager: {
        query: async (
          query: string,
          parameters: Array<unknown> = [],
        ): Promise<unknown> => {
          calls.push({ query, parameters });

          if (query.startsWith("SELECT")) {
            return pages[page++] || [];
          }

          return [];
        },
      },
    };
  }

  test("reads the candidates a page at a time, by id, and writes back only the rows that change", async () => {
    const table: AuditRecordNameCopyTable = tableNamed("SecurityDetection");
    const full: Array<AuditRecordNameCopyRow> = Array.from(
      { length: AUDIT_RECORD_NAME_COPIES_PAGE_SIZE },
      (_value: unknown, index: number): AuditRecordNameCopyRow => {
        return {
          _id: `0192f1a0-0000-7000-8000-${String(index).padStart(12, "0")}`,
          sampleMessage: index === 3 ? STORED.message : OTHER_SAMPLE,
          description: null,
          matchedEvents: null,
        };
      },
    );
    const last: Array<AuditRecordNameCopyRow> = [
      {
        _id: "0192f1a0-0000-7000-8000-ffffffffffff",
        sampleMessage: STORED.message,
        description: null,
        matchedEvents: {
          events: [buildSecurityDetectionMatchedEvent(ROW)!],
        },
      },
    ];
    const run: ReturnType<typeof manager> = manager([full, last]);

    const changed: number = await AuditRecordNameCopies.rewordTable({
      manager: run.manager,
      projectId: "0192f1a0-0000-7000-8000-00000000e0cc",
      table,
      isNameWithheld: EVERY_TYPE_WITHHELD,
    });

    expect(changed).toBe(2);

    const reads: Array<{ query: string; parameters: Array<unknown> }> =
      run.calls.filter((call: { query: string }): boolean => {
        return call.query.startsWith("SELECT");
      });
    const writes: Array<{ query: string; parameters: Array<unknown> }> =
      run.calls.filter((call: { query: string }): boolean => {
        return call.query.startsWith("UPDATE");
      });

    expect(
      reads.map((call: { parameters: Array<unknown> }) => {
        return call.parameters;
      }),
    ).toEqual([
      [
        "0192f1a0-0000-7000-8000-00000000e0cc",
        "00000000-0000-0000-0000-000000000000",
      ],
      ["0192f1a0-0000-7000-8000-00000000e0cc", full[full.length - 1]!._id],
    ]);
    expect(reads[0]!.query).toBe(
      `SELECT "_id", "sampleMessage", "description", "matchedEvents" FROM "SecurityDetection" WHERE "projectId" = $1 AND "_id" > $2 AND ${table.candidates} ORDER BY "_id" ASC LIMIT ${AUDIT_RECORD_NAME_COPIES_PAGE_SIZE}`,
    );

    expect(writes).toHaveLength(2);
    expect(writes[0]).toEqual({
      query:
        'UPDATE "SecurityDetection" SET "sampleMessage" = $2 WHERE "_id" = $1',
      parameters: [full[3]!._id, NOW.message],
    });
    expect(writes[1]!.query).toBe(
      'UPDATE "SecurityDetection" SET "sampleMessage" = $2, "matchedEvents" = $3::jsonb WHERE "_id" = $1',
    );
    expect(typeof writes[1]!.parameters[2]).toBe("string");
    expect(String(writes[1]!.parameters[2])).not.toContain("terraform");
  });

  test("every project that has had the audit log as a source, every table; a table that fails costs the others nothing", async () => {
    const calls: Array<{ query: string; parameters: Array<unknown> }> = [];
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    const changed: number = await AuditRecordNameCopies.rewordEveryProject({
      manager: {
        query: async (
          query: string,
          parameters: Array<unknown> = [],
        ): Promise<unknown> => {
          calls.push({ query, parameters });

          if (query === AuditRecordNameCopies.READ_PROJECTS) {
            return [
              { projectId: "0192f1a0-0000-7000-8000-00000000e0dd" },
              { projectId: null },
            ];
          }

          if (query.includes('FROM "Alert"')) {
            throw new Error("relation is locked");
          }

          if (query.includes('FROM "SecurityCase"')) {
            return [
              {
                _id: "0192f1a0-0000-7000-8000-00000000e0ee",
                description: `Sample event: ${markdownCodeSpan(STORED.message)}`,
              },
            ];
          }

          return [];
        },
      },
      isNameWithheld: EVERY_TYPE_WITHHELD,
    });

    expect(changed).toBe(1);
    expect(calls[0]).toEqual({
      query: AuditRecordNameCopies.READ_PROJECTS,
      parameters: [SecurityTelemetrySourceKind.AuditLog],
    });
    expect(
      calls.filter((call: { query: string }): boolean => {
        return (
          call.query.startsWith("SELECT") &&
          call.query !== AuditRecordNameCopies.READ_PROJECTS
        );
      }),
    ).toHaveLength(AUDIT_RECORD_NAME_COPY_TABLES.length);
    expect(logger.error).toHaveBeenCalledTimes(1);
  });
});
