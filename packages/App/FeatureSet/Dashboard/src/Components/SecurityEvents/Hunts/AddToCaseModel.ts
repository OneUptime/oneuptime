import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "Common/Models/DatabaseModels/SecurityCase";
import SecurityCasePriority from "Common/Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "Common/Models/DatabaseModels/SecurityCaseStatus";
import Includes from "Common/Types/BaseDatabase/Includes";
import MultiSearch from "Common/Types/BaseDatabase/MultiSearch";
import Query from "Common/Types/BaseDatabase/Query";
import { Black } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import ObjectID from "Common/Types/ObjectID";
import {
  SECURITY_CASE_EVENTS_ADD_REASONS,
  SecurityCaseEventsAddResult,
} from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import {
  BULK_ITEM_CHANGED,
  BulkItemOutcome,
  bulkItemUnchanged,
} from "Common/UI/Components/BulkUpdate/BulkActionRunner";
import SecurityCasePriorities from "Common/Utils/SecurityCase/SecurityCasePriorities";
import SecurityCaseStatuses from "Common/Utils/SecurityCase/SecurityCaseStatuses";

/*
 * The small rules of Add to Case: which cases the dialog offers - the
 * project's open ones, the latest first, or those a search finds by number
 * or title - how a case reads in its list, which events a request names,
 * and what happened to each, read from the one answer the request gave.
 * React-free, so a plain test pins them.
 */

// The most open cases the dialog lists at once; a search finds the rest.
export const ADD_TO_CASE_LIST_LIMIT: number = 20;

// The key a search across a case's number and title is sent under.
const SEARCH_KEY: string = "_multiFieldSearch";

// "#142" is read as 142, as a case's number is often written.
const LEADING_HASH: RegExp = /^#/;

/*
 * A case as the dialog's list draws it (EpisodePickerList's row): its
 * number and title, its status and its priority as pills, and when it last
 * saw a detection.
 */
export interface CasePickerItem {
  id: string;
  number?: string | undefined;
  title: string;
  state?: { name: string; color: Color } | undefined;
  severity?: { name: string; color: Color } | undefined;
  date?: Date | undefined;
}

/*
 * The project's open cases (by the statuses it counts as open), or those a
 * search finds among them by number or title. "#142" and "142" find
 * CASE-142.
 */
export function getOpenCasesQuery(data: {
  projectId: ObjectID;
  statuses: ReadonlyArray<unknown>;
  searchText: string;
}): Query<SecurityCase> {
  const query: Record<string, unknown> = {
    projectId: data.projectId,
    securityCaseStatusId: new Includes(
      SecurityCaseStatuses.getOpenStatusIds(data.statuses),
    ),
  };

  const searchText: string = data.searchText
    .trim()
    .replace(LEADING_HASH, "")
    .trim();

  if (searchText) {
    query[SEARCH_KEY] = new MultiSearch({
      fields: ["title", "caseNumberWithPrefix"],
      value: searchText,
    });
  }

  return query as Query<SecurityCase>;
}

function pillOf(
  value: { name?: string | undefined; color?: Color | undefined } | null,
): { name: string; color: Color } | undefined {
  if (!value?.name) {
    return undefined;
  }

  return { name: value.name, color: value.color || Black };
}

// A case as the dialog lists it: its number and title, its status and priority, when it last saw a detection.
export function toCasePickerItem(data: {
  securityCase: SecurityCase;
  priorities: ReadonlyArray<SecurityCasePriority>;
  statuses: ReadonlyArray<SecurityCaseStatus>;
}): CasePickerItem {
  const securityCase: SecurityCase = data.securityCase;
  const priority: SecurityCasePriority | null = SecurityCasePriorities.find(
    data.priorities as Array<SecurityCasePriority>,
    securityCase.securityCasePriorityId,
  );
  const status: SecurityCaseStatus | null = SecurityCaseStatuses.find(
    data.statuses as Array<SecurityCaseStatus>,
    securityCase.securityCaseStatusId,
  );
  const date: Date | undefined =
    securityCase.lastDetectedAt || securityCase.createdAt || undefined;

  return {
    id: securityCase._id?.toString() || "",
    number: securityCase.caseNumberWithPrefix || undefined,
    title: securityCase.title || "",
    state: pillOf(status ? { name: status.name, color: status.color } : null),
    severity: pillOf(
      priority ? { name: priority.name, color: priority.color } : null,
    ),
    ...(date ? { date: new Date(date) } : {}),
  };
}

// An event a request names: its id, and when it happened.
export interface CaseEventReference {
  eventUid: string;
  time: Date;
}

// The events of a selection a request can name: each with an id and a time, each once.
export function getCaseEventReferences(
  events: ReadonlyArray<SecurityEvent>,
): Array<CaseEventReference> {
  const references: Array<CaseEventReference> = [];
  const seen: Set<string> = new Set<string>();

  for (const event of events) {
    const eventUid: string = event.eventUid?.toString() || "";
    const time: Date | null = event.time ? new Date(event.time) : null;

    if (
      !eventUid ||
      !time ||
      Number.isNaN(time.getTime()) ||
      seen.has(eventUid)
    ) {
      continue;
    }

    seen.add(eventUid);
    references.push({ eventUid, time });
  }

  return references;
}

/*
 * What happened to one selected event, read from the one answer the request
 * gave for all of them: kept, kept already (left as it was), or not found.
 */
export function getCaseEventOutcome(data: {
  eventUid: string;
  result: SecurityCaseEventsAddResult;
}): BulkItemOutcome {
  if (data.result.added.includes(data.eventUid)) {
    return BULK_ITEM_CHANGED;
  }

  if (data.result.alreadyOnCase.includes(data.eventUid)) {
    return bulkItemUnchanged(
      SECURITY_CASE_EVENTS_ADD_REASONS.alreadyOnCase.message,
    );
  }

  throw new Error(SECURITY_CASE_EVENTS_ADD_REASONS.notFound.message);
}
