import { JSONObject } from "../JSON";
import HuntressSeverity, { parseHuntressSeverity } from "./HuntressSeverity";

/*
 * What Huntress sends to a webhook endpoint, read into the shape OneUptime
 * works with.
 *
 * Huntress delivers webhooks through Svix: an HTTPS POST of a JSON event,
 * signed with the endpoint's signing secret (Server/Utils/Webhook/
 * StandardWebhookSignature verifies it). The payloads are documented at
 * https://api.huntress.io/v1/webhooks_doc.json. Every incident report event
 * (created, closed, comment_added) carries the whole report:
 *
 *   {
 *     "event_type": "incident_report.created",
 *     "id": 1234,
 *     "account": { "id": 5, "name": "Example MSP" },
 *     "organization": { "id": 4, "name": "Acme Corp" },
 *     "agent_id": 12,
 *     "severity": "critical",
 *     "status": "sent",
 *     "subject": "CRITICAL - Incident on DESKTOP-01 (Acme Corp)",
 *     "summary": "Huntress detected ...",
 *     "body": "...",
 *     "platform": "windows",
 *     "indicator_counts": { "footholds": 1, "process_detections": 2 },
 *     "created_at": "...", "sent_at": "...", "closed_at": null,
 *     "status_updated_at": "...", "updated_at": "...",
 *     "api_url": "https://api.huntress.io/v1/incident_reports/1234"
 *   }
 *
 * plus "comment" on incident_report.comment_added. Escalations, platform
 * actions and account notices are other event types: they are not incident
 * reports, and OneUptime acknowledges them without acting on them.
 *
 * Pure: no database, no network, no React.
 */

// Where the webhook is received, under the API (`/api/huntress/webhook/<connection id>`).
export const HUNTRESS_WEBHOOK_ROUTE: string = "/huntress/webhook";

export enum HuntressWebhookEventType {
  IncidentReportCreated = "incident_report.created",
  IncidentReportClosed = "incident_report.closed",
  IncidentReportCommentAdded = "incident_report.comment_added",
}

export const AllHuntressIncidentReportEventTypes: Array<HuntressWebhookEventType> =
  [
    HuntressWebhookEventType.IncidentReportCreated,
    HuntressWebhookEventType.IncidentReportClosed,
    HuntressWebhookEventType.IncidentReportCommentAdded,
  ];

export function isHuntressIncidentReportEventType(
  value: unknown,
): value is HuntressWebhookEventType {
  return (
    typeof value === "string" &&
    (AllHuntressIncidentReportEventTypes as Array<string>).includes(value)
  );
}

/*
 * The statuses of an incident report (Huntress API: sent, closed,
 * dismissed, auto_remediating, deleting, partner_dismissed, and draft for a
 * report the SOC is still working on).
 */
export enum HuntressIncidentReportStatus {
  Sent = "sent",
  Closed = "closed",
  Dismissed = "dismissed",
  PartnerDismissed = "partner_dismissed",
  AutoRemediating = "auto_remediating",
  Deleting = "deleting",
  Draft = "draft",
}

/*
 * The statuses after which a report needs nobody any more: closed by the
 * partner or Huntress, dismissed by either, or being deleted. A report in
 * one of them is over, whichever event carried it.
 */
export const HUNTRESS_FINISHED_REPORT_STATUSES: Array<string> = [
  HuntressIncidentReportStatus.Closed,
  HuntressIncidentReportStatus.Dismissed,
  HuntressIncidentReportStatus.PartnerDismissed,
  HuntressIncidentReportStatus.Deleting,
];

export function isHuntressReportStatusFinished(
  status: string | null | undefined,
): boolean {
  if (!status) {
    return false;
  }

  return HUNTRESS_FINISHED_REPORT_STATUSES.includes(
    status.trim().toLowerCase(),
  );
}

/*
 * How much of each text field is kept. A report's subject is one line and a
 * summary a few paragraphs; anything longer than this is not something a
 * responder reads in a page or an email, and the full report is one click
 * away in Huntress.
 */
export const HUNTRESS_MAX_SUBJECT_LENGTH: number = 300;
export const HUNTRESS_MAX_SUMMARY_LENGTH: number = 20000;
export const HUNTRESS_MAX_COMMENT_LENGTH: number = 20000;
export const HUNTRESS_MAX_NAME_LENGTH: number = 200;
export const HUNTRESS_MAX_INDICATOR_TYPES: number = 20;

// The longest id a payload may name: Huntress ids are 64-bit integers.
const MAX_ID_DIGITS: number = 19;

export interface HuntressNamedRef {
  // A positive integer, as text; null when the payload names none.
  id: string | null;
  name: string | null;
}

export interface HuntressIndicatorCount {
  type: string;
  count: number;
}

export interface HuntressIncidentReportEvent {
  eventType: HuntressWebhookEventType;
  // The incident report's id, a positive integer as text.
  reportId: string;
  account: HuntressNamedRef;
  organization: HuntressNamedRef;
  agentId: string | null;
  // null when the payload names no severity Huntress documents.
  severity: HuntressSeverity | null;
  // The status as Huntress wrote it, lower-cased.
  status: string | null;
  subject: string | null;
  summary: string | null;
  platform: string | null;
  indicatorCounts: Array<HuntressIndicatorCount>;
  createdAt: Date | null;
  closedAt: Date | null;
  // The comment of an incident_report.comment_added event.
  comment: string | null;
}

export type ParsedHuntressWebhook =
  | { kind: "incident-report"; event: HuntressIncidentReportEvent }
  // A well-formed event that is not about an incident report.
  | { kind: "not-an-incident-report"; eventType: string }
  | { kind: "invalid"; reason: string };

const ID_PATTERN: RegExp = /^[0-9]{1,19}$/;
const INDICATOR_TYPE_PATTERN: RegExp = /^[a-z0-9_]{1,64}$/;

function isJsonObject(value: unknown): value is JSONObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/*
 * A Huntress id: a positive integer, sent as a JSON number or as text.
 * Anything else (a negative, a fraction, a word) is not an id - it is never
 * placed in a link to the Huntress portal or used as a dedupe key.
 */
export function readHuntressId(value: unknown): string | null {
  if (typeof value === "number") {
    if (Number.isSafeInteger(value) && value > 0) {
      return String(value);
    }

    return null;
  }

  if (typeof value === "string") {
    const trimmed: string = value.trim();

    if (trimmed.length > MAX_ID_DIGITS || !ID_PATTERN.test(trimmed)) {
      return null;
    }

    // "0" and "007" are not ids Huntress hands out.
    if (trimmed.startsWith("0")) {
      return null;
    }

    return trimmed;
  }

  return null;
}

/*
 * Text a payload carries, trimmed and cut to at most `maxLength` characters
 * (ending in an ellipsis when cut), or null when it is not text or is empty.
 * Cut by slicing, never with a pattern: a field can be as long as a sender
 * likes.
 */
export function readHuntressText(
  value: unknown,
  maxLength: number,
): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed: string = value.trim();

  if (!trimmed) {
    return null;
  }

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, Math.max(maxLength - 1, 0)).trimEnd()}…`;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date: Date = new Date(value);

  return isNaN(date.getTime()) ? null : date;
}

function readNamedRef(
  value: unknown,
  deprecatedId: unknown,
): HuntressNamedRef {
  const object: JSONObject = isJsonObject(value) ? value : {};

  return {
    id: readHuntressId(object["id"]) || readHuntressId(deprecatedId),
    name: readHuntressText(object["name"], HUNTRESS_MAX_NAME_LENGTH),
  };
}

function readIndicatorCounts(value: unknown): Array<HuntressIndicatorCount> {
  if (!isJsonObject(value)) {
    return [];
  }

  const counts: Array<HuntressIndicatorCount> = [];

  for (const key of Object.keys(value)) {
    if (counts.length >= HUNTRESS_MAX_INDICATOR_TYPES) {
      break;
    }

    const count: unknown = value[key];

    if (
      key.length > 64 ||
      !INDICATOR_TYPE_PATTERN.test(key) ||
      typeof count !== "number" ||
      !Number.isSafeInteger(count) ||
      count <= 0
    ) {
      continue;
    }

    counts.push({ type: key, count });
  }

  return counts;
}

/*
 * Read a webhook body (already parsed from JSON) into an incident report
 * event, or say why it is not one. Never throws.
 */
export function parseHuntressWebhook(body: unknown): ParsedHuntressWebhook {
  if (!isJsonObject(body)) {
    return {
      kind: "invalid",
      reason: "The request body is not a JSON object.",
    };
  }

  const eventType: unknown = body["event_type"];

  if (typeof eventType !== "string" || !eventType.trim()) {
    return {
      kind: "invalid",
      reason: "The request body has no event_type.",
    };
  }

  if (!isHuntressIncidentReportEventType(eventType)) {
    return {
      kind: "not-an-incident-report",
      eventType: eventType.trim().slice(0, 100),
    };
  }

  const reportId: string | null = readHuntressId(body["id"]);

  if (!reportId) {
    return {
      kind: "invalid",
      reason: `The ${eventType} event has no incident report id.`,
    };
  }

  const status: string | null = readHuntressText(body["status"], 64);

  return {
    kind: "incident-report",
    event: {
      eventType,
      reportId,
      account: readNamedRef(body["account"], body["account_id"]),
      organization: readNamedRef(
        body["organization"],
        body["organization_id"],
      ),
      agentId: readHuntressId(body["agent_id"]),
      severity: parseHuntressSeverity(body["severity"]),
      status: status ? status.toLowerCase() : null,
      subject: readHuntressText(body["subject"], HUNTRESS_MAX_SUBJECT_LENGTH),
      summary: readHuntressText(body["summary"], HUNTRESS_MAX_SUMMARY_LENGTH),
      platform: readHuntressText(body["platform"], 64),
      indicatorCounts: readIndicatorCounts(body["indicator_counts"]),
      createdAt: readDate(body["created_at"]),
      closedAt: readDate(body["closed_at"]),
      comment: readHuntressText(body["comment"], HUNTRESS_MAX_COMMENT_LENGTH),
    },
  };
}

/*
 * Whether this event says the report is over: an incident_report.closed
 * event, or any event whose status is a finished one (a comment added to a
 * report that was dismissed meanwhile, say).
 */
export function isHuntressReportFinished(
  event: HuntressIncidentReportEvent,
): boolean {
  return (
    event.eventType === HuntressWebhookEventType.IncidentReportClosed ||
    isHuntressReportStatusFinished(event.status)
  );
}
