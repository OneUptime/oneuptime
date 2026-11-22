import logger from "../../Logger";
import AuditRecordNameReaders from "./AuditRecordNameReaders";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import { SecurityTelemetrySourceKind } from "../../../../Types/SecurityEvent/SecurityTelemetrySource";
import { getSecurityCaseEventEvidenceName } from "../../../../Types/SecurityCase/SecurityCaseEventEvidence";
import {
  AuditRecordNameFields,
  withholdAuditRecordNameInEvent,
  withholdAuditRecordNameInSentence,
  withholdAuditRecordNamesInEachLine,
  withholdAuditRecordNamesInSampleLines,
} from "../../../../Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld";

/*
 * WHAT WAS MADE OF THE AUDIT LOG'S SECURITY EVENTS BEFORE #10663, SAID
 * WITHOUT THE NAMES ITS READERS MAY NOT READ.
 *
 * An event about a change in OneUptime named its record ("alice created
 * the API key "terraform""), and what was made of it kept the name after
 * the event itself is gone (security events are kept 15 days unless a
 * project says longer): a detection's sample and the events it kept, the
 * case it opened, the alert or incident it raised - whose readers are every
 * member of the project - their "Created" feed items, and a case's evidence.
 * Each is reworded here as a new one would be written
 * (Utils/SecurityEvent/TelemetryScan/AuditRecordNamesWithheld), once, by a
 * data migration (WithholdAuditRecordNamesInSecurityEvents).
 *
 * Only projects that have had the audit log as a security source are read,
 * and in each only the rows that can quote an event (TABLES' `candidates`).
 * A row is written back with SQL of its own, not through its service: a
 * service's write would record the change in the audit log, with the text
 * it replaced - the name - as its value before.
 *
 * What was sent is not reached: an email, a chat post, a webhook, an event
 * forwarded to a SIEM, a notification's log. Nor is what OneUptime AI wrote
 * in its own words, nor the audit log's own record of these rows, which is
 * immutable and held to each reader by #10642.
 */

// Runs SQL on Postgres: a TypeORM EntityManager's query.
export interface AuditRecordNameCopiesManager {
  query: (query: string, parameters?: Array<unknown>) => Promise<unknown>;
}

// One row of a table, as it is read: its id and the columns that can quote an event.
export type AuditRecordNameCopyRow = Record<string, unknown> & { _id: string };

export type IsNameWithheld = (resourceType: string) => boolean;

// How one column of a table is said without a record's name: its new value, or null when it is as it was.
type Reword = (data: {
  value: unknown;
  row: AuditRecordNameCopyRow;
  isNameWithheld: IsNameWithheld;
}) => unknown | null;

export interface AuditRecordNameCopyTable {
  table: string;
  // What narrows a project's rows to those that can quote an event.
  candidates: string;
  columns: Array<{ column: string; isJson: boolean; reword: Reword }>;
}

// The rows of a table read at a time.
export const AUDIT_RECORD_NAME_COPIES_PAGE_SIZE: number = 500;

function changedText(before: unknown, after: string): string | null {
  return typeof before === "string" && after !== before ? after : null;
}

// Text quoting events on lines of their own.
const sampleLines: Reword = (data: {
  value: unknown;
  isNameWithheld: IsNameWithheld;
}): string | null => {
  return typeof data.value === "string"
    ? changedText(
        data.value,
        withholdAuditRecordNamesInSampleLines(data.value, data.isNameWithheld),
      )
    : null;
};

// One quoted event, as the whole of the text.
const sentence: Reword = (data: {
  value: unknown;
  isNameWithheld: IsNameWithheld;
}): string | null => {
  return typeof data.value === "string"
    ? changedText(
        data.value,
        withholdAuditRecordNameInSentence(data.value, data.isNameWithheld),
      )
    : null;
};

// A quoted event a line.
const eachLine: Reword = (data: {
  value: unknown;
  isNameWithheld: IsNameWithheld;
}): string | null => {
  return typeof data.value === "string"
    ? changedText(
        data.value,
        withholdAuditRecordNamesInEachLine(data.value, data.isNameWithheld),
      )
    : null;
};

function readObject(value: unknown): JSONObject | null {
  if (typeof value === "string") {
    try {
      return readObject(JSON.parse(value));
    } catch {
      return null;
    }
  }

  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : null;
}

// A copy of an event (a snapshot): its name taken out where it is the audit log's.
function withheldSnapshot(
  snapshot: JSONObject,
  isNameWithheld: IsNameWithheld,
): JSONObject | null {
  const attributes: JSONObject | null = readObject(snapshot["attributes"]);

  if (!attributes) {
    return null;
  }

  const withheld: AuditRecordNameFields | null = withholdAuditRecordNameInEvent(
    {
      event: {
        message:
          typeof snapshot["message"] === "string" ? snapshot["message"] : "",
        attributes,
        vendorName:
          typeof snapshot["vendorName"] === "string"
            ? snapshot["vendorName"]
            : undefined,
        productName:
          typeof snapshot["productName"] === "string"
            ? snapshot["productName"]
            : undefined,
      },
      isNameWithheld,
    },
  );

  return withheld
    ? {
        ...snapshot,
        message: withheld.message,
        attributes: withheld.attributes,
      }
    : null;
}

// The events a detection kept (SecurityDetectionMatchedEvents): each said without its name.
const matchedEvents: Reword = (data: {
  value: unknown;
  isNameWithheld: IsNameWithheld;
}): JSONObject | null => {
  const kept: JSONObject | null = readObject(data.value);
  const events: unknown = kept?.["events"];

  if (!kept || !Array.isArray(events)) {
    return null;
  }

  let changed: boolean = false;
  const reworded: JSONArray = events.map((event: unknown): JSONObject => {
    const snapshot: JSONObject | null = readObject(event);
    const withheld: JSONObject | null = snapshot
      ? withheldSnapshot(snapshot, data.isNameWithheld)
      : null;

    if (withheld) {
      changed = true;
      return withheld;
    }

    return event as JSONObject;
  });

  return changed ? { ...kept, events: reworded } : null;
};

// A case's evidence of an event: the copy it kept.
const eventSnapshot: Reword = (data: {
  value: unknown;
  isNameWithheld: IsNameWithheld;
}): JSONObject | null => {
  const snapshot: JSONObject | null = readObject(data.value);

  return snapshot ? withheldSnapshot(snapshot, data.isNameWithheld) : null;
};

// The evidence's name is its event's message: said again from the copy it kept.
const evidenceName: Reword = (data: {
  value: unknown;
  row: AuditRecordNameCopyRow;
  isNameWithheld: IsNameWithheld;
}): string | null => {
  const snapshot: JSONObject | null = readObject(data.row["eventSnapshot"]);
  const withheld: JSONObject | null = snapshot
    ? withheldSnapshot(snapshot, data.isNameWithheld)
    : null;

  if (!withheld || typeof data.value !== "string") {
    return null;
  }

  return changedText(
    data.value,
    getSecurityCaseEventEvidenceName({
      message: String(withheld["message"] || ""),
      className: String(withheld["className"] || ""),
      activityName: String(withheld["activityName"] || ""),
    }),
  );
};

const SAMPLE: string = "'%Sample event: %'";

/*
 * Every table that keeps a copy of an event's text, and how each column of
 * it is reworded. The detection's events and the evidence's copy are read
 * as events, by their attributes; text quoting an event is reworded by the
 * words it was said with.
 */
export const AUDIT_RECORD_NAME_COPY_TABLES: ReadonlyArray<AuditRecordNameCopyTable> =
  [
    {
      table: "SecurityDetection",
      candidates: `("sampleMessage" LIKE '%"' OR "description" LIKE ${SAMPLE} OR "matchedEvents"::text LIKE '%audit.resource\\_name%')`,
      columns: [
        { column: "sampleMessage", isJson: false, reword: sentence },
        { column: "description", isJson: false, reword: sampleLines },
        { column: "matchedEvents", isJson: true, reword: matchedEvents },
      ],
    },
    {
      table: "SecurityCase",
      candidates: `("description" LIKE ${SAMPLE} OR "description" LIKE '%**Message:** %')`,
      columns: [{ column: "description", isJson: false, reword: sampleLines }],
    },
    {
      table: "Alert",
      candidates: `"description" LIKE ${SAMPLE}`,
      columns: [{ column: "description", isJson: false, reword: sampleLines }],
    },
    {
      table: "AlertFeed",
      candidates: `"alertFeedEventType" = 'AlertCreated' AND "feedInfoInMarkdown" LIKE ${SAMPLE}`,
      columns: [
        { column: "feedInfoInMarkdown", isJson: false, reword: sampleLines },
      ],
    },
    {
      table: "Incident",
      candidates: `"description" LIKE ${SAMPLE}`,
      columns: [{ column: "description", isJson: false, reword: sampleLines }],
    },
    {
      table: "IncidentFeed",
      candidates: `"incidentFeedEventType" = 'IncidentCreated' AND "feedInfoInMarkdown" LIKE ${SAMPLE}`,
      columns: [
        { column: "feedInfoInMarkdown", isJson: false, reword: sampleLines },
      ],
    },
    {
      table: "SecurityCaseEvidence",
      candidates: `"eventSnapshot"::text LIKE '%audit.resource\\_name%'`,
      columns: [
        // The name first: it is said again from the copy as it was read.
        { column: "name", isJson: false, reword: evidenceName },
        { column: "eventSnapshot", isJson: true, reword: eventSnapshot },
      ],
    },
    {
      table: "SecurityCaseFeed",
      candidates: `"securityCaseFeedEventType" = 'Evidence' AND "moreInformationInMarkdown" LIKE '%"%'`,
      columns: [
        {
          column: "moreInformationInMarkdown",
          isJson: false,
          reword: eachLine,
        },
      ],
    },
  ];

// What a row of a table becomes: its changed columns, or null when nothing changes.
export function rewordAuditRecordNameCopy(data: {
  table: AuditRecordNameCopyTable;
  row: AuditRecordNameCopyRow;
  isNameWithheld: IsNameWithheld;
}): Record<string, unknown> | null {
  const changes: Record<string, unknown> = {};

  for (const { column, reword } of data.table.columns) {
    const value: unknown | null = reword({
      value: data.row[column],
      row: data.row,
      isNameWithheld: data.isNameWithheld,
    });

    if (value !== null && value !== undefined) {
      changes[column] = value;
    }
  }

  return Object.keys(changes).length > 0 ? changes : null;
}

export default class AuditRecordNameCopies {
  // Whether events of a type no longer name their records.
  public static isNameWithheld(resourceType: string): boolean {
    return !AuditRecordNameReaders.isNameWritten(resourceType);
  }

  // The projects that have had the audit log as a security source.
  public static readonly READ_PROJECTS: string = `SELECT DISTINCT "projectId" FROM "SecurityTelemetrySource" WHERE "kind" = $1 AND "projectId" IS NOT NULL`;

  public static readStatement(table: AuditRecordNameCopyTable): string {
    const columns: string = [
      "_id",
      ...table.columns.map((copy: { column: string }): string => {
        return copy.column;
      }),
    ]
      .map((column: string): string => {
        return `"${column}"`;
      })
      .join(", ");

    return `SELECT ${columns} FROM "${table.table}" WHERE "projectId" = $1 AND "_id" > $2 AND ${table.candidates} ORDER BY "_id" ASC LIMIT ${AUDIT_RECORD_NAME_COPIES_PAGE_SIZE}`;
  }

  public static updateStatement(data: {
    table: AuditRecordNameCopyTable;
    columns: Array<string>;
  }): string {
    const sets: Array<string> = data.columns.map(
      (column: string, index: number): string => {
        const isJson: boolean = Boolean(
          data.table.columns.find(
            (copy: { column: string; isJson: boolean }): boolean => {
              return copy.column === column;
            },
          )?.isJson,
        );

        return `"${column}" = $${index + 2}${isJson ? "::jsonb" : ""}`;
      },
    );

    return `UPDATE "${data.table.table}" SET ${sets.join(", ")} WHERE "_id" = $1`;
  }

  // Rewords one project's copies in one table. Returns how many rows changed.
  public static async rewordTable(data: {
    manager: AuditRecordNameCopiesManager;
    projectId: string;
    table: AuditRecordNameCopyTable;
    isNameWithheld?: IsNameWithheld | undefined;
  }): Promise<number> {
    const isNameWithheld: IsNameWithheld =
      data.isNameWithheld || AuditRecordNameCopies.isNameWithheld;
    let after: string = "00000000-0000-0000-0000-000000000000";
    let changed: number = 0;

    for (;;) {
      const rows: Array<AuditRecordNameCopyRow> = (await data.manager.query(
        AuditRecordNameCopies.readStatement(data.table),
        [data.projectId, after],
      )) as Array<AuditRecordNameCopyRow>;

      for (const row of rows) {
        const changes: Record<string, unknown> | null =
          rewordAuditRecordNameCopy({ table: data.table, row, isNameWithheld });

        if (!changes) {
          continue;
        }

        const columns: Array<string> = Object.keys(changes);

        await data.manager.query(
          AuditRecordNameCopies.updateStatement({
            table: data.table,
            columns,
          }),
          [
            row._id,
            ...columns.map((column: string): unknown => {
              const value: unknown = changes[column];

              return typeof value === "string" ? value : JSON.stringify(value);
            }),
          ],
        );

        changed++;
      }

      if (rows.length < AUDIT_RECORD_NAME_COPIES_PAGE_SIZE) {
        return changed;
      }

      after = String(rows[rows.length - 1]!._id);
    }
  }

  /*
   * Rewords every copy in every project that has had the audit log as a
   * security source. A table that fails is logged and costs the others
   * nothing; what was reworded stays so, and a run again finds nothing more
   * to do there.
   */
  public static async rewordEveryProject(data: {
    manager: AuditRecordNameCopiesManager;
    isNameWithheld?: IsNameWithheld | undefined;
  }): Promise<number> {
    const projects: Array<{ projectId: unknown }> = (await data.manager.query(
      AuditRecordNameCopies.READ_PROJECTS,
      [SecurityTelemetrySourceKind.AuditLog],
    )) as Array<{ projectId: unknown }>;
    let changed: number = 0;

    for (const project of projects) {
      const projectId: string = String(project.projectId || "");

      if (!projectId) {
        continue;
      }

      for (const table of AUDIT_RECORD_NAME_COPY_TABLES) {
        try {
          changed += await AuditRecordNameCopies.rewordTable({
            manager: data.manager,
            projectId,
            table,
            isNameWithheld: data.isNameWithheld,
          });
        } catch (err) {
          logger.error(
            `AuditRecordNameCopies: could not reword ${table.table} of project ${projectId}: ${(err as Error)?.message || String(err)}`,
          );
        }
      }
    }

    return changed;
  }
}
