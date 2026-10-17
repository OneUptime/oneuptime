import HuntressSeverity, {
  HUNTRESS_SEVERITY_WHEN_UNKNOWN,
  parseHuntressSeverity,
} from "../Huntress/HuntressSeverity";
import {
  HUNTRESS_MAX_COMMENT_LENGTH,
  HUNTRESS_MAX_NAME_LENGTH,
  HUNTRESS_MAX_SUBJECT_LENGTH,
  HUNTRESS_MAX_SUMMARY_LENGTH,
  HuntressIncidentReportEvent,
  HuntressIndicatorCount,
  HuntressWebhookEventType,
  isHuntressReportStatusFinished,
  readHuntressId,
  readHuntressText,
} from "../Huntress/HuntressWebhook";
import { JSONObject } from "../JSON";
import {
  getHuntressAffectedName,
  getHuntressClosedNote,
  getHuntressCommentNote,
  getHuntressIncidentDescription,
  getHuntressIncidentTitle,
  getHuntressIndicatorTitle,
  getHuntressPlatformTitle,
  getHuntressReportPortalUrl,
} from "../../Utils/Huntress/HuntressIncidentReportText";
import { WEBHOOK_TRIGGER_SECRET_MASK } from "./WebhookTrigger";

/*
 * THE HUNTRESS INCIDENT REPORT TRIGGER: a workflow that starts for each
 * event Huntress sends about an incident report - when its SOC sends one,
 * when someone comments on it, and when it is closed.
 *
 * Huntress delivers its webhooks through Svix, signed with the endpoint's
 * signing secret, to the workflow's own URL:
 *
 *   <workflow service>/huntress/<the workflow's webhook secret key>
 *
 * The signing secret is the workflow's (Workflow.webhookSigningSecret). A
 * request that is not signed with it starts nothing
 * (Server/Utils/Huntress/HuntressWebhookHandler checks it, then starts the
 * run). The run starts with what the request said, read here into the
 * trigger's values - the report's fields as Huntress wrote them, and
 * ready-made text for an incident and its notes - so every step after it
 * reads plain values rather than Huntress's JSON.
 *
 * Huntress connections made before Huntress became a workflow trigger
 * became workflows of their own, keeping their address under the API
 * (/api/huntress/webhook/<key>): both addresses start the same workflow.
 *
 * Pure: no database, no network, no React. The two values that need the
 * project's records - the incident severity and the organization's label -
 * are worked out by the trigger on the server
 * (Server/Types/Workflow/Components/Huntress.ts).
 */

// Relative to the workflow service, which the dashboard knows as WORKFLOW_URL.
export const HUNTRESS_TRIGGER_PATH: string = "/huntress";

// The secret key, masked until the reader asks to see it: as the Webhook's.
export const HUNTRESS_TRIGGER_SECRET_MASK: string = WEBHOOK_TRIGGER_SECRET_MASK;

/*
 * What happened to the report, as the trigger's Event value says it. Plain
 * words a Switch / Case can compare with, one for each incident report
 * event Huntress sends.
 */
export enum HuntressTriggerEvent {
  // Huntress's SOC sent a new incident report.
  Created = "created",
  // Someone added a comment to the report in Huntress.
  CommentAdded = "comment-added",
  // The report was closed or dismissed in Huntress.
  Closed = "closed",
}

export const AllHuntressTriggerEvents: Array<HuntressTriggerEvent> = [
  HuntressTriggerEvent.Created,
  HuntressTriggerEvent.CommentAdded,
  HuntressTriggerEvent.Closed,
];

/*
 * The values the trigger hands the rest of the workflow. Kept in one place:
 * the component's metadata, the webhook, the run, the help and the docs all
 * read these ids.
 */
export enum HuntressTriggerValue {
  Event = "event",
  ReportId = "report-id",
  Severity = "severity",
  Status = "status",
  Subject = "subject",
  Summary = "summary",
  Organization = "organization",
  OrganizationId = "organization-id",
  Affected = "affected",
  Platform = "platform",
  Indicators = "indicators",
  Comment = "comment",
  ReportUrl = "report-url",
  IncidentTitle = "incident-title",
  IncidentDescription = "incident-description",
  Note = "note",
  IncidentSeverityId = "incident-severity-id",
  OrganizationLabelId = "organization-label-id",
  ReceivedAt = "received-at",
}

/*
 * What the webhook hands the run besides the values above: the report's
 * indicator counts, as Huntress sent them, from which the run writes
 * Indicators and the incident's description. Read by the run only.
 */
export const HUNTRESS_DELIVERY_INDICATOR_COUNTS: string = "indicator-counts";

/*
 * The trigger's settings. All four are optional and folded away: a
 * workflow that leaves them empty starts for every organization's reports,
 * and opens incidents at the project's own severities, in rank order.
 */
export enum HuntressTriggerSetting {
  Organizations = "organizations",
  CriticalIncidentSeverity = "critical-incident-severity",
  HighIncidentSeverity = "high-incident-severity",
  LowIncidentSeverity = "low-incident-severity",
}

// The setting that picks the incident severity for each Huntress severity.
export const HUNTRESS_INCIDENT_SEVERITY_SETTINGS: Record<
  HuntressSeverity,
  HuntressTriggerSetting
> = {
  [HuntressSeverity.Critical]: HuntressTriggerSetting.CriticalIncidentSeverity,
  [HuntressSeverity.High]: HuntressTriggerSetting.HighIncidentSeverity,
  [HuntressSeverity.Low]: HuntressTriggerSetting.LowIncidentSeverity,
};

/*
 * Which of the project's incident severities, in their order (the most
 * severe first), a Huntress severity opens at when its setting is empty:
 * the most severe for critical, the next for high, the one after for low -
 * or the least severe there is, in a project with fewer.
 */
export const HUNTRESS_INCIDENT_SEVERITY_RANK: Record<HuntressSeverity, number> =
  {
    [HuntressSeverity.Critical]: 0,
    [HuntressSeverity.High]: 1,
    [HuntressSeverity.Low]: 2,
  };

/*
 * The label an incident gets when the report names no organization. Every
 * Huntress incident report belongs to one, so this is for a report that
 * arrived without it - and for Run Workflow, when none is typed.
 */
export const HUNTRESS_LABEL_WHEN_NO_ORGANIZATION: string = "Huntress";

// The longest a label's name is made: a label's name is short text.
export const HUNTRESS_MAX_LABEL_NAME_LENGTH: number = 100;

export type GetHuntressTriggerUrlPrefixFunction = (data: {
  workflowServiceUrl: string;
}) => string;

// Everything before the secret key, ending in a slash.
export const getHuntressTriggerUrlPrefix: GetHuntressTriggerUrlPrefixFunction =
  (data: { workflowServiceUrl: string }): string => {
    // With or without a trailing slash, the base gives the same URL.
    const base: string = data.workflowServiceUrl.replace(/\/+$/, "");

    return `${base}${HUNTRESS_TRIGGER_PATH}/`;
  };

export type GetHuntressTriggerUrlFunction = (data: {
  workflowServiceUrl: string;
  secretKey: string;
}) => string;

// Where Huntress sends its events: the address to paste into Huntress.
export const getHuntressTriggerUrl: GetHuntressTriggerUrlFunction = (data: {
  workflowServiceUrl: string;
  secretKey: string;
}): string => {
  return `${getHuntressTriggerUrlPrefix(data)}${encodeURIComponent(data.secretKey)}`;
};

/*
 * The trigger's Event for an incident report event. A report that is over -
 * closed or dismissed, whichever event carried it - is Closed, so a report
 * that was already closed when its first event arrived opens nothing. A
 * comment is a comment whatever the report's status: what it says belongs
 * on the incident either way.
 */
export function getHuntressTriggerEvent(
  event: Pick<HuntressIncidentReportEvent, "eventType" | "status">,
): HuntressTriggerEvent {
  if (event.eventType === HuntressWebhookEventType.IncidentReportCommentAdded) {
    return HuntressTriggerEvent.CommentAdded;
  }

  if (
    event.eventType === HuntressWebhookEventType.IncidentReportClosed ||
    isHuntressReportStatusFinished(event.status)
  ) {
    return HuntressTriggerEvent.Closed;
  }

  return HuntressTriggerEvent.Created;
}

/*
 * The trigger Event a value names - as the webhook wrote it, or as typed
 * into Run Workflow - or null for one it does not name. Case and the space
 * around it aside; an empty one is Created, the event most tests are for.
 */
export function readHuntressTriggerEvent(
  value: unknown,
): HuntressTriggerEvent | null {
  if (value === undefined || value === null) {
    return HuntressTriggerEvent.Created;
  }

  if (typeof value !== "string") {
    return null;
  }

  const normalized: string = value.trim().toLowerCase();

  if (!normalized) {
    return HuntressTriggerEvent.Created;
  }

  return (
    AllHuntressTriggerEvents.find((event: HuntressTriggerEvent): boolean => {
      return event === normalized;
    }) || null
  );
}

/*
 * What the webhook hands the run for one incident report event: the
 * report's fields under the trigger's value ids, and its indicator counts.
 * The run reads them back with readHuntressRunEvent.
 */
export function getHuntressDeliveryValues(data: {
  event: HuntressIncidentReportEvent;
  receivedAt: Date;
}): JSONObject {
  const event: HuntressIncidentReportEvent = data.event;
  const indicatorCounts: JSONObject = {};

  for (const indicator of event.indicatorCounts) {
    indicatorCounts[indicator.type] = indicator.count;
  }

  return {
    [HuntressTriggerValue.Event]: getHuntressTriggerEvent(event),
    [HuntressTriggerValue.ReportId]: event.reportId,
    [HuntressTriggerValue.Severity]: event.severity || "",
    [HuntressTriggerValue.Status]: event.status || "",
    [HuntressTriggerValue.Subject]: event.subject || "",
    [HuntressTriggerValue.Summary]: event.summary || "",
    [HuntressTriggerValue.Organization]: event.organization.name || "",
    [HuntressTriggerValue.OrganizationId]: event.organization.id || "",
    [HuntressTriggerValue.Platform]: event.platform || "",
    [HuntressTriggerValue.Comment]: event.comment || "",
    [HUNTRESS_DELIVERY_INDICATOR_COUNTS]: indicatorCounts,
    [HuntressTriggerValue.ReceivedAt]: data.receivedAt.toISOString(),
  };
}

export type HuntressRunEvent =
  | {
      isValid: true;
      event: HuntressIncidentReportEvent;
      triggerEvent: HuntressTriggerEvent;
      // The severity the report is handled at: a missing one reads as high.
      severity: HuntressSeverity;
      receivedAt: Date;
    }
  | { isValid: false; problem: string };

// The problems readHuntressRunEvent names, for Run Workflow's typing.
export const HUNTRESS_RUN_EVENT_PROBLEM: string =
  "Event must be created, comment-added or closed.";

export const HUNTRESS_RUN_REPORT_ID_PROBLEM: string =
  "Report ID must be the number of a Huntress incident report, such as 1234.";

function readIndicatorCounts(value: unknown): Array<HuntressIndicatorCount> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return [];
  }

  const counts: Array<HuntressIndicatorCount> = [];

  for (const [type, count] of Object.entries(value as JSONObject)) {
    if (
      typeof count === "number" &&
      Number.isSafeInteger(count) &&
      count > 0 &&
      type.length <= 64
    ) {
      counts.push({ type, count });
    }
  }

  return counts;
}

function readDate(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) {
    return null;
  }

  const date: Date = new Date(value);

  return isNaN(date.getTime()) ? null : date;
}

/*
 * A run's start, read back into an incident report event: the values the
 * webhook handed it, or what was typed into Run Workflow to try the
 * workflow out (an Event, a Report ID, a Severity, an Organization, a
 * Subject and a Comment - the rest arrive empty). Everything is read again
 * the way the webhook reads a payload, cut to the same lengths, so a typed
 * test behaves like a delivery.
 */
export function readHuntressRunEvent(
  args: JSONObject,
  now: Date,
): HuntressRunEvent {
  const triggerEvent: HuntressTriggerEvent | null = readHuntressTriggerEvent(
    args[HuntressTriggerValue.Event],
  );

  if (!triggerEvent) {
    return { isValid: false, problem: HUNTRESS_RUN_EVENT_PROBLEM };
  }

  const reportId: string | null = readHuntressId(
    args[HuntressTriggerValue.ReportId],
  );

  if (!reportId) {
    return { isValid: false, problem: HUNTRESS_RUN_REPORT_ID_PROBLEM };
  }

  const status: string | null = readHuntressText(
    args[HuntressTriggerValue.Status],
    64,
  );

  const parsedSeverity: HuntressSeverity | null = parseHuntressSeverity(
    args[HuntressTriggerValue.Severity],
  );

  const eventType: HuntressWebhookEventType =
    triggerEvent === HuntressTriggerEvent.CommentAdded
      ? HuntressWebhookEventType.IncidentReportCommentAdded
      : triggerEvent === HuntressTriggerEvent.Closed
        ? HuntressWebhookEventType.IncidentReportClosed
        : HuntressWebhookEventType.IncidentReportCreated;

  const event: HuntressIncidentReportEvent = {
    eventType,
    reportId,
    account: { id: null, name: null },
    organization: {
      id: readHuntressId(args[HuntressTriggerValue.OrganizationId]),
      name: readHuntressText(
        args[HuntressTriggerValue.Organization],
        HUNTRESS_MAX_NAME_LENGTH,
      ),
    },
    agentId: null,
    severity: parsedSeverity,
    status: status ? status.toLowerCase() : null,
    subject: readHuntressText(
      args[HuntressTriggerValue.Subject],
      HUNTRESS_MAX_SUBJECT_LENGTH,
    ),
    summary: readHuntressText(
      args[HuntressTriggerValue.Summary],
      HUNTRESS_MAX_SUMMARY_LENGTH,
    ),
    platform: readHuntressText(args[HuntressTriggerValue.Platform], 64),
    indicatorCounts: readIndicatorCounts(
      args[HUNTRESS_DELIVERY_INDICATOR_COUNTS],
    ),
    createdAt: null,
    closedAt: null,
    comment: readHuntressText(
      args[HuntressTriggerValue.Comment],
      HUNTRESS_MAX_COMMENT_LENGTH,
    ),
  };

  return {
    isValid: true,
    event,
    triggerEvent,
    severity: parsedSeverity || HUNTRESS_SEVERITY_WHEN_UNKNOWN,
    receivedAt: readDate(args[HuntressTriggerValue.ReceivedAt]) || now,
  };
}

/*
 * The note an event leaves on the report's incident: the comment, as
 * Huntress's analyst wrote it, or that Huntress closed the report. Empty
 * for a new report, which has its incident's description instead.
 */
export function getHuntressEventNote(data: {
  event: HuntressIncidentReportEvent;
  triggerEvent: HuntressTriggerEvent;
}): string {
  if (
    data.triggerEvent === HuntressTriggerEvent.CommentAdded &&
    data.event.comment
  ) {
    return getHuntressCommentNote(data.event.comment);
  }

  if (data.triggerEvent === HuntressTriggerEvent.Closed) {
    return getHuntressClosedNote(data.event);
  }

  return "";
}

// "Footholds (1), Process detections (2)", or empty.
export function getHuntressIndicatorsText(
  indicatorCounts: Array<HuntressIndicatorCount>,
): string {
  return indicatorCounts
    .map((indicator: HuntressIndicatorCount): string => {
      return `${getHuntressIndicatorTitle(indicator.type)} (${indicator.count})`;
    })
    .join(", ");
}

/*
 * The values a run hands on, but for the two the server works out from the
 * project's records (Incident Severity ID and Organization Label ID), which
 * it adds.
 */
export function getHuntressTriggerValues(data: {
  event: HuntressIncidentReportEvent;
  triggerEvent: HuntressTriggerEvent;
  severity: HuntressSeverity;
  receivedAt: Date;
}): JSONObject {
  const event: HuntressIncidentReportEvent = data.event;

  return {
    [HuntressTriggerValue.Event]: data.triggerEvent,
    [HuntressTriggerValue.ReportId]: event.reportId,
    [HuntressTriggerValue.Severity]: data.severity,
    [HuntressTriggerValue.Status]: event.status || "",
    [HuntressTriggerValue.Subject]: event.subject || "",
    [HuntressTriggerValue.Summary]: event.summary || "",
    [HuntressTriggerValue.Organization]: event.organization.name || "",
    [HuntressTriggerValue.OrganizationId]: event.organization.id || "",
    [HuntressTriggerValue.Affected]: getHuntressAffectedName(event) || "",
    [HuntressTriggerValue.Platform]:
      getHuntressPlatformTitle(event.platform) || "",
    [HuntressTriggerValue.Indicators]: getHuntressIndicatorsText(
      event.indicatorCounts,
    ),
    [HuntressTriggerValue.Comment]: event.comment || "",
    [HuntressTriggerValue.ReportUrl]: getHuntressReportPortalUrl(event) || "",
    [HuntressTriggerValue.IncidentTitle]: getHuntressIncidentTitle(event),
    [HuntressTriggerValue.IncidentDescription]: getHuntressIncidentDescription({
      event,
      severity: data.severity,
    }),
    [HuntressTriggerValue.Note]: getHuntressEventNote({
      event,
      triggerEvent: data.triggerEvent,
    }),
    [HuntressTriggerValue.IncidentSeverityId]: "",
    [HuntressTriggerValue.OrganizationLabelId]: "",
    [HuntressTriggerValue.ReceivedAt]: data.receivedAt.toISOString(),
  };
}

// The organization label's name: the report's organization, or Huntress.
export function getHuntressOrganizationLabelName(
  event: Pick<HuntressIncidentReportEvent, "organization">,
): string {
  return (event.organization.name || HUNTRESS_LABEL_WHEN_NO_ORGANIZATION).slice(
    0,
    HUNTRESS_MAX_LABEL_NAME_LENGTH,
  );
}
