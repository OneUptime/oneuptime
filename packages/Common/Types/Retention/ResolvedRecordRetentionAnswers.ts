import { JSONObject } from "../JSON";
import {
  ResolvedRecordKind,
  readResolvedRecordRetentionInDays,
  readResolvedRecordRetentionMaximumInDays,
} from "./ResolvedRecordRetention";

/*
 * WHAT THE SERVER ANSWERS ABOUT DATA RETENTION, as the routes send it and
 * the Dashboard and the Admin Dashboard read it - one shape, read in one
 * place, so a route and its page cannot drift apart.
 *
 *   - GET /project/:id/resolved-record-retention (ProjectAPI): the server's
 *     maximum for incidents and alerts (issue #6941), for the Data
 *     Retention cards to lock what a project cannot keep longer. Any member
 *     who can read the project's retention reads it.
 *   - POST /project/:id/resolved-record-retention/count (ProjectAPI): how
 *     many incidents (alerts) a setting deletes now (issue #6943), for the
 *     question asked before it is saved. Project Owners and Admins, as the
 *     setting.
 *   - GET /global-config/resolved-record-retention/projects-reached
 *     (GlobalConfigAPI): how many projects a new server maximum holds to a
 *     shorter length (issue #6941). Master admins.
 */

export const RESOLVED_RECORD_RETENTION_ROUTE: string =
  "resolved-record-retention";

export const RESOLVED_RECORD_RETENTION_COUNT_ROUTE: string = `${RESOLVED_RECORD_RETENTION_ROUTE}/count`;

export const RESOLVED_RECORD_RETENTION_PROJECTS_REACHED_ROUTE: string = `${RESOLVED_RECORD_RETENTION_ROUTE}/projects-reached`;

// The server's maximum for each kind, or undefined for none.
export interface ResolvedRecordRetentionLimitsAnswer {
  incidentMaximumInDays?: number | undefined;
  alertMaximumInDays?: number | undefined;
}

// How many records a setting deletes now; isAtLeast when the count stopped early.
export interface DueRecordsCountAnswer {
  count: number;
  isAtLeast: boolean;
}

// What a count is asked for: the setting as it would be saved.
export interface DueRecordsCountRequest {
  kind: ResolvedRecordKind;
  retentionInDays: number;
  // Incidents only.
  keepIncidentsWithCompletedPostmortem?: boolean | undefined;
  keepIncidentsInPostmortemStatusIds?: Array<string> | undefined;
}

function asObject(value: unknown): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readCount(value: unknown): number {
  const count: number = Number(value);

  return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
}

export default class ResolvedRecordRetentionAnswers {
  public static toLimitsJSON(
    answer: ResolvedRecordRetentionLimitsAnswer,
  ): JSONObject {
    return {
      incidentMaximumInDays: answer.incidentMaximumInDays ?? null,
      alertMaximumInDays: answer.alertMaximumInDays ?? null,
    };
  }

  /*
   * The limits as a page reads them: a maximum that is not one of the
   * choices is none - it never locks a choice the server would not hold.
   */
  public static readLimits(
    value: unknown,
  ): ResolvedRecordRetentionLimitsAnswer {
    const json: JSONObject = asObject(value);

    return {
      incidentMaximumInDays: readResolvedRecordRetentionMaximumInDays(
        json["incidentMaximumInDays"],
      ),
      alertMaximumInDays: readResolvedRecordRetentionMaximumInDays(
        json["alertMaximumInDays"],
      ),
    };
  }

  // The maximum of a kind, from the answer.
  public static getMaximumInDays(
    answer: ResolvedRecordRetentionLimitsAnswer,
    kind: ResolvedRecordKind,
  ): number | undefined {
    return kind === ResolvedRecordKind.Incident
      ? answer.incidentMaximumInDays
      : answer.alertMaximumInDays;
  }

  public static toCountJSON(answer: DueRecordsCountAnswer): JSONObject {
    return {
      count: readCount(answer.count),
      isAtLeast: answer.isAtLeast === true,
    };
  }

  // A count as a page reads it, or null when the answer is not one.
  public static readCount(value: unknown): DueRecordsCountAnswer | null {
    const json: JSONObject = asObject(value);
    const count: number = Number(json["count"]);

    if (!Number.isFinite(count) || count < 0) {
      return null;
    }

    return {
      count: Math.floor(count),
      isAtLeast: json["isAtLeast"] === true,
    };
  }

  public static toCountRequestJSON(
    request: DueRecordsCountRequest,
  ): JSONObject {
    const json: JSONObject = {
      kind: request.kind,
      retentionInDays: request.retentionInDays,
    };

    if (request.kind === ResolvedRecordKind.Incident) {
      if (request.keepIncidentsWithCompletedPostmortem !== undefined) {
        json["keepIncidentsWithCompletedPostmortem"] =
          request.keepIncidentsWithCompletedPostmortem !== false;
      }

      if (request.keepIncidentsInPostmortemStatusIds) {
        json["keepIncidentsInPostmortemStatusIds"] =
          request.keepIncidentsInPostmortemStatusIds;
      }
    }

    return json;
  }

  /*
   * A count request as the route reads it, or null when it is not one: a
   * kind, and one of the retention choices or Never. What it leaves out -
   * the postmortem switch, the statuses - is the project's as saved (the
   * route reads it). The switch reads as on unless it is a clear false: a
   * request that cannot be read must never count more than the purge
   * deletes.
   */
  public static readCountRequest(
    value: unknown,
  ): DueRecordsCountRequest | null {
    const json: JSONObject = asObject(value);
    const kind: unknown = json["kind"];

    if (
      kind !== ResolvedRecordKind.Incident &&
      kind !== ResolvedRecordKind.Alert
    ) {
      return null;
    }

    const retentionInDays: number | undefined =
      readResolvedRecordRetentionInDays(json["retentionInDays"]);

    if (retentionInDays === undefined) {
      return null;
    }

    if (kind === ResolvedRecordKind.Alert) {
      return { kind, retentionInDays };
    }

    const keep: unknown = json["keepIncidentsWithCompletedPostmortem"];
    const statusIds: unknown = json["keepIncidentsInPostmortemStatusIds"];

    return {
      kind,
      retentionInDays,
      keepIncidentsWithCompletedPostmortem:
        keep === undefined || keep === null ? undefined : keep !== false,
      keepIncidentsInPostmortemStatusIds: Array.isArray(statusIds)
        ? statusIds.filter((id: unknown): id is string => {
            return typeof id === "string";
          })
        : undefined,
    };
  }
}
