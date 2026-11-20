import EnableAuditLogOn from "Common/Types/BaseDatabase/EnableAuditLogOn";
import ObjectID from "Common/Types/ObjectID";
import { getApiSingularName, ModelNames } from "Common/Utils/ModelApiName";
import PageMap from "../../Utils/PageMap";
import { RESOURCE_META } from "./AuditLogsTableUtils";

/*
 * WHICH PAGE HOLDS A RECORD'S HISTORY (#10290).
 *
 * A record's line ends with "History" where the audit log records its kind:
 *
 *   - the Audit Logs page of its own view, where its kind has one - a
 *     monitor's at MONITOR_VIEW_AUDIT_LOGS, beside MONITOR_VIEW - worked out
 *     from what the audit log already knows of each kind (RESOURCE_META: the
 *     page an entry about it opens), by the name the log stores it under, so
 *     a kind that gets an Audit Logs page gets the link with nothing else to
 *     change;
 *   - else the project's audit log, showing that record alone
 *     (`?recordId=<id>`): a rule, an LLM provider, an API key - records with
 *     a page of their own and no Audit Logs page beside it;
 *   - and none for a kind the audit log does not record (a log of messages,
 *     a record of runs: AuditLogCoverage).
 *
 * Pure (no RouteMap, no window), like AuditLogsTableUtils, so plain-node
 * tests read it; RecordHistoryRoute turns the page into a link.
 */

// The query parameter Settings > Audit Logs reads the one record it shows from.
export const RECORD_HISTORY_QUERY_PARAM: string = "recordId";

export interface RecordHistoryPage {
  page: PageMap;
  // The record's own Audit Logs page, or the project's log showing it alone.
  isOwnPage: boolean;
}

export interface RecordHistoryModel extends ModelNames {
  enableAuditLogOn?: EnableAuditLogOn | undefined;
}

// The record's own Audit Logs page, when its kind has one.
export const getOwnRecordHistoryPage: (model: ModelNames) => PageMap | null = (
  model: ModelNames,
): PageMap | null => {
  const resourceType: string = getApiSingularName(model);

  if (
    !resourceType ||
    !Object.prototype.hasOwnProperty.call(RESOURCE_META, resourceType)
  ) {
    return null;
  }

  const viewRoute: PageMap | undefined = RESOURCE_META[resourceType]?.viewRoute;

  if (!viewRoute) {
    return null;
  }

  const historyPage: string = `${viewRoute}_AUDIT_LOGS`;

  return (Object.values(PageMap) as Array<string>).includes(historyPage)
    ? (historyPage as PageMap)
    : null;
};

// Where a record's history is, or null for a kind the audit log does not record.
export const getRecordHistoryPage: (
  model: RecordHistoryModel,
) => RecordHistoryPage | null = (
  model: RecordHistoryModel,
): RecordHistoryPage | null => {
  const auditLogOn: EnableAuditLogOn | undefined = model.enableAuditLogOn;

  if (!auditLogOn || (!auditLogOn.create && !auditLogOn.update)) {
    return null;
  }

  const ownPage: PageMap | null = getOwnRecordHistoryPage(model);

  if (ownPage) {
    return { page: ownPage, isOwnPage: true };
  }

  return { page: PageMap.SETTINGS_AUDIT_LOGS, isOwnPage: false };
};

/*
 * The record Settings > Audit Logs shows alone, read off its `recordId`:
 * null for none, or for anything that is not a record's id - the page then
 * shows every change, as it always did.
 */
export const getRecordIdOfAuditLogsPage: (
  value: string | null | undefined,
) => ObjectID | null = (value: string | null | undefined): ObjectID | null => {
  const text: string = (value || "").trim();

  if (!text || !ObjectID.isValidUUID(text)) {
    return null;
  }

  return new ObjectID(text);
};
