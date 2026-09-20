import {
  JSONish,
  createItem,
  getItem,
  listItems,
  requestJson,
  toId,
} from "../../Tests/Dashboard/Helpers/MonitorAlerting";
import { Page } from "@playwright/test";

/*
 * Driving the audit-log recorder end to end on a real stack: turn recording on
 * for a project, perform a genuinely audited write, and read the entry back
 * out of ClickHouse through the core API.
 *
 * What only a booted stack proves: ee/Tests/Server/AuditLog/* already pins the
 * recorder's eligibility rules and its redaction, with the store mocked. What
 * no jest suite can show is that the recorder inside the PUBLISHED enterprise
 * image, running against the real ClickHouse that docker-compose.yml starts,
 * actually lands a row that the core read API then returns - the recorder is
 * enterprise code, the AuditLogV2 table and the read API are core, and they
 * only meet in a booted stack.
 *
 * Three things must all hold for an entry to be written on a self-hosted
 * stack: the enterprise module is loaded, the licence covers audit-logs, and
 * the project's enableAuditLogs is true. The last one defaults to FALSE
 * (Common/Models/DatabaseModels/Project.ts), so a spec has to turn it on
 * first; updating the project invalidates the recorder's 60s settings cache
 * immediately (Common/Server/Services/ProjectService.ts), so no wait is needed
 * between enabling it and the audited write.
 *
 * Everything here talks to the same REST API the dashboard uses, through
 * page.request, so the calls carry the session cookies the sign-up flow set
 * and the writes are attributed to a real project owner.
 */

// Common/Models/AnalyticsModels/AuditLog.ts: crudApiPath.
export const AUDIT_LOG_API_PATH: string = "/api/audit-log";

/*
 * The audited write this suite uses. A Label is the cheapest model that
 * carries @EnableAuditLog: name, projectId and colour, no fixtures, no
 * side effects on anything else in the project.
 */
export const LABEL_API_PATH: string = "/api/label";

/*
 * What the recorder writes into resourceType: the model's singularName
 * (ee/Server/AuditLog/AuditLogRecorder.ts), which is "Label" here.
 */
export const LABEL_RESOURCE_TYPE: string = "Label";

// Common/Types/AuditLog/AuditLogAction.ts.
export const AUDIT_LOG_ACTION_CREATE: string = "Create";

/*
 * The whole budget an audited write is given to show up in the trail: the
 * recorder's own work, the ClickHouse insert and the read behind it.
 *
 * Exported because the Lapsed suite's assertion is the NEGATIVE of the
 * Licensed suite's - that a write performed while the licence is dead records
 * nothing - and an absence is only meaningful against a deadline. Waiting THIS
 * long before concluding that nothing was recorded means the negative outlasts
 * the entire budget the positive was allowed on the same stack, so the two can
 * never drift apart: raising this makes the licensed wait more patient and the
 * lapsed absence more certain at the same time.
 */
export const AUDIT_LOG_ENTRY_TIMEOUT_MS: number = 90000;

// How often the polls below re-read the trail.
export const AUDIT_LOG_POLL_INTERVAL_MS: number = 3000;

export interface AuditLogEntry {
  resourceType: string;
  resourceName: string;
  resourceId: string;
  action: string;
  userEmail: string;
  userName: string;
  // The row as the API returned it, for assertions this interface does not name.
  raw: JSONish;
}

export interface ProjectAuditLogSettings {
  enableAuditLogs: boolean;
  auditLogsRetentionInDays: number | null;
  storeSystemEventsInAuditLogs: boolean;
}

type SetProjectAuditLogsFunction = (data: {
  page: Page;
  projectId: string;
  enabled: boolean;
}) => Promise<void>;

/*
 * Turns the project's audit-log switch on or off through the API, as a project
 * owner - the same PUT the Dashboard's Settings > Audit Logs screen sends.
 */
export const setProjectAuditLogs: SetProjectAuditLogsFunction = async (data: {
  page: Page;
  projectId: string;
  enabled: boolean;
}): Promise<void> => {
  await requestJson({
    page: data.page,
    projectId: data.projectId,
    path: `/api/project/${data.projectId}`,
    method: "put",
    body: { data: { enableAuditLogs: data.enabled } },
  });
};

type ReadProjectAuditLogSettingsFunction = (data: {
  page: Page;
  projectId: string;
}) => Promise<ProjectAuditLogSettings>;

export const readProjectAuditLogSettings: ReadProjectAuditLogSettingsFunction =
  async (data: {
    page: Page;
    projectId: string;
  }): Promise<ProjectAuditLogSettings> => {
    const project: JSONish = await getItem({
      page: data.page,
      projectId: data.projectId,
      path: "/api/project",
      id: data.projectId,
      select: {
        enableAuditLogs: true,
        auditLogsRetentionInDays: true,
        storeSystemEventsInAuditLogs: true,
      },
    });

    const retention: unknown = project["auditLogsRetentionInDays"];

    return {
      enableAuditLogs: project["enableAuditLogs"] === true,
      auditLogsRetentionInDays:
        typeof retention === "number" ? retention : null,
      storeSystemEventsInAuditLogs:
        project["storeSystemEventsInAuditLogs"] === true,
    };
  };

type CreateAuditedLabelFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
}) => Promise<string>;

/*
 * Performs the audited write and returns the new label's id. An ordinary CRUD
 * create by a signed-in project owner: nothing here asks for an audit entry,
 * which is the point - the recorder has to notice on its own.
 */
export const createAuditedLabel: CreateAuditedLabelFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
}): Promise<string> => {
  const label: JSONish = await createItem({
    page: data.page,
    projectId: data.projectId,
    path: LABEL_API_PATH,
    item: {
      name: data.name,
      projectId: data.projectId,
      color: { _type: "Color", value: "#4b5563" },
    },
  });

  return toId(label["_id"]);
};

type ReadAuditFieldFunction = (row: JSONish, key: string) => string;

const readAuditField: ReadAuditFieldFunction = (
  row: JSONish,
  key: string,
): string => {
  const value: unknown = row[key];

  if (typeof value === "string") {
    return value;
  }

  if (value && typeof value === "object") {
    return String((value as JSONish)["value"] || "");
  }

  return "";
};

type ListAuditLogEntriesFunction = (data: {
  page: Page;
  projectId: string;
}) => Promise<Array<AuditLogEntry>>;

/*
 * Reads the project's audit trail through the CORE read API
 * (Common/Server/API/BaseAnalyticsAPI.ts), which is what a project owner or
 * admin sees in the Dashboard. Creates through this API are refused for every
 * non-root caller, so a row here can only have come from the recorder.
 *
 * Deliberately no page size: unlike the ordinary CRUD list, the analytics one
 * reads skip and limit from the QUERY STRING and takes only query/select/sort
 * from the body, so a limit passed here would be silently ignored. The server
 * default (10) is what comes back, sorted by createdAt descending - so the
 * most recent audited write is always on this page, which is all any caller
 * here needs.
 */
export const listAuditLogEntries: ListAuditLogEntriesFunction = async (data: {
  page: Page;
  projectId: string;
}): Promise<Array<AuditLogEntry>> => {
  const rows: Array<JSONish> = await listItems({
    page: data.page,
    projectId: data.projectId,
    path: AUDIT_LOG_API_PATH,
    query: { projectId: data.projectId },
    select: {
      projectId: true,
      resourceType: true,
      resourceName: true,
      resourceId: true,
      action: true,
      userEmail: true,
      userName: true,
      createdAt: true,
    },
  });

  return rows.map((row: JSONish): AuditLogEntry => {
    return {
      resourceType: readAuditField(row, "resourceType"),
      resourceName: readAuditField(row, "resourceName"),
      resourceId: readAuditField(row, "resourceId"),
      action: readAuditField(row, "action"),
      userEmail: readAuditField(row, "userEmail"),
      userName: readAuditField(row, "userName"),
      raw: row,
    };
  });
};

export interface AuditLogEntryMatch {
  resourceType: string;
  resourceName: string;
  action: string;
}

type FindAuditLogEntryFunction = (data: {
  entries: ReadonlyArray<AuditLogEntry>;
  match: AuditLogEntryMatch;
}) => AuditLogEntry | null;

/*
 * Exported on its own so the Lapsed suite can assert the NEGATIVE - that a
 * write performed while the licence is dead never shows up - without having to
 * re-derive how an entry is identified.
 */
export const findAuditLogEntry: FindAuditLogEntryFunction = (data: {
  entries: ReadonlyArray<AuditLogEntry>;
  match: AuditLogEntryMatch;
}): AuditLogEntry | null => {
  return (
    data.entries.find((entry: AuditLogEntry): boolean => {
      return (
        entry.resourceType === data.match.resourceType &&
        entry.resourceName === data.match.resourceName &&
        entry.action === data.match.action
      );
    }) || null
  );
};

type WaitForAuditLogEntryFunction = (data: {
  page: Page;
  projectId: string;
  match: AuditLogEntryMatch;
  timeoutMs?: number | undefined;
  intervalMs?: number | undefined;
}) => Promise<AuditLogEntry>;

/*
 * Polls the read API until the entry for a specific audited write appears.
 *
 * Bounded, and the timeout message carries every entry the project did have,
 * because the two ways this fails look identical from a bare "not found": the
 * recorder wrote nothing at all (no enterprise module, a dead licence, or the
 * project switch still off), or it wrote something other than what was
 * expected. Printing the trail tells those apart at a glance.
 */
export const waitForAuditLogEntry: WaitForAuditLogEntryFunction = async (data: {
  page: Page;
  projectId: string;
  match: AuditLogEntryMatch;
  timeoutMs?: number | undefined;
  intervalMs?: number | undefined;
}): Promise<AuditLogEntry> => {
  const timeoutMs: number = data.timeoutMs ?? AUDIT_LOG_ENTRY_TIMEOUT_MS;
  const intervalMs: number = data.intervalMs ?? AUDIT_LOG_POLL_INTERVAL_MS;
  const deadline: number = Date.now() + timeoutMs;

  let entries: Array<AuditLogEntry> = [];
  let lastError: string = "";

  for (;;) {
    try {
      entries = await listAuditLogEntries({
        page: data.page,
        projectId: data.projectId,
      });

      const found: AuditLogEntry | null = findAuditLogEntry({
        entries,
        match: data.match,
      });

      if (found) {
        return found;
      }
    } catch (error) {
      lastError = (error as Error).message;
    }

    if (Date.now() >= deadline) {
      break;
    }

    await data.page.waitForTimeout(intervalMs);
  }

  const trail: string =
    entries.length === 0
      ? "the project's audit trail is empty"
      : `the project's audit trail holds ${entries.length} entr${
          entries.length === 1 ? "y" : "ies"
        }: ${entries
          .map((entry: AuditLogEntry): string => {
            return `${entry.action} ${entry.resourceType} "${entry.resourceName}"`;
          })
          .join(", ")}`;

  throw new Error(
    `Timed out after ${timeoutMs}ms waiting for the audit log entry ` +
      `"${data.match.action} ${data.match.resourceType} \\"${data.match.resourceName}\\"" ` +
      `in project ${data.projectId}. Meanwhile ${trail}.` +
      (lastError ? ` Last error while reading it: ${lastError}` : ""),
  );
};
