import URL from "Common/Types/API/URL";
import { Green500, Red500, Yellow500, Gray500 } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import HuntressIncidentReportOutcome from "Common/Types/Huntress/HuntressIncidentReportOutcome";
import HuntressSeverity from "Common/Types/Huntress/HuntressSeverity";
import { HUNTRESS_WEBHOOK_ROUTE } from "Common/Types/Huntress/HuntressWebhook";
import { getHuntressSubjectWithoutSeverity } from "Common/Utils/Huntress/HuntressIncidentReportText";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Huntress pages say about a connection and the reports it
 * received: its state, its webhook URL, and every label they show. Kept
 * React-free, so App's tests can read it without the pages.
 */

// Where Huntress posts to: the API's webhook route with the connection's id.
export function getHuntressWebhookUrl(data: {
  apiUrl: URL;
  connectionId: ObjectID | string;
}): string {
  return URL.fromString(data.apiUrl.toString())
    .addRoute(HUNTRESS_WEBHOOK_ROUTE)
    .addRoute(`/${data.connectionId.toString()}`)
    .toString();
}

export enum HuntressConnectionState {
  // Requests are refused until the endpoint's signing secret is saved.
  NeedsSigningSecret = "needs-signing-secret",
  // Set up, and nothing has arrived yet.
  Waiting = "waiting",
  // Huntress reaches it.
  Receiving = "receiving",
  // The last request was refused or could not be handled.
  Failing = "failing",
}

export interface HuntressConnectionFacts {
  isSigningSecretSet?: boolean | undefined;
  lastEventReceivedAt?: Date | string | null | undefined;
  lastError?: string | null | undefined;
  lastErrorAt?: Date | string | null | undefined;
}

function toTime(value: Date | string | null | undefined): number | null {
  if (!value) {
    return null;
  }

  const time: number = new Date(value).getTime();

  return isNaN(time) ? null : time;
}

/*
 * Where a connection stands, from what the webhook last recorded: an error
 * newer than the last event it handled means requests are being refused
 * now; an older one was put right since.
 */
export function getHuntressConnectionState(
  facts: HuntressConnectionFacts,
): HuntressConnectionState {
  if (!facts.isSigningSecretSet) {
    return HuntressConnectionState.NeedsSigningSecret;
  }

  const lastEventAt: number | null = toTime(facts.lastEventReceivedAt);
  const lastErrorAt: number | null = toTime(facts.lastErrorAt);

  if (
    facts.lastError &&
    (lastEventAt === null ||
      (lastErrorAt !== null && lastErrorAt > lastEventAt))
  ) {
    return HuntressConnectionState.Failing;
  }

  if (lastEventAt !== null) {
    return HuntressConnectionState.Receiving;
  }

  return HuntressConnectionState.Waiting;
}

export const HUNTRESS_CONNECTION_STATE_LABELS: Record<
  HuntressConnectionState,
  string
> = {
  [HuntressConnectionState.NeedsSigningSecret]: translationKey(
    "Signing secret needed",
  ),
  [HuntressConnectionState.Waiting]: translationKey("Waiting for Huntress"),
  [HuntressConnectionState.Receiving]: translationKey("Receiving reports"),
  [HuntressConnectionState.Failing]: translationKey("Refusing requests"),
};

export const HUNTRESS_CONNECTION_STATE_COLORS: Record<
  HuntressConnectionState,
  Color
> = {
  [HuntressConnectionState.NeedsSigningSecret]: Yellow500,
  [HuntressConnectionState.Waiting]: Gray500,
  [HuntressConnectionState.Receiving]: Green500,
  [HuntressConnectionState.Failing]: Red500,
};

export const HUNTRESS_SEVERITY_LABELS: Record<HuntressSeverity, string> = {
  [HuntressSeverity.Critical]: translationKey("Critical"),
  [HuntressSeverity.High]: translationKey("High"),
  [HuntressSeverity.Low]: translationKey("Low"),
};

export const HUNTRESS_SEVERITY_COLORS: Record<HuntressSeverity, Color> = {
  [HuntressSeverity.Critical]: Red500,
  [HuntressSeverity.High]: Yellow500,
  [HuntressSeverity.Low]: Gray500,
};

/*
 * What a Huntress severity opens at when the connection leaves it to rank:
 * the project's incident severities in their order, as the form's
 * placeholders and the settings card say it.
 */
export const HUNTRESS_SEVERITY_BY_RANK_LABELS: Record<
  HuntressSeverity,
  string
> = {
  [HuntressSeverity.Critical]: translationKey("Most severe (by rank)"),
  [HuntressSeverity.High]: translationKey("Second most severe (by rank)"),
  [HuntressSeverity.Low]: translationKey("Third most severe (by rank)"),
};

// "Page On-Call For", as the form's options and the settings card say it.
export const HUNTRESS_PAGE_ON_CALL_FOR_LABELS: Record<
  HuntressSeverity,
  string
> = {
  [HuntressSeverity.Critical]: translationKey("Critical reports only"),
  [HuntressSeverity.High]: translationKey("High and critical reports"),
  [HuntressSeverity.Low]: translationKey("Every report"),
};

export const HUNTRESS_PAGE_ON_CALL_FOR_DESCRIPTIONS: Record<
  HuntressSeverity,
  string
> = {
  [HuntressSeverity.Critical]: translationKey(
    "Hands-on-keyboard attackers, ransomware and active compromise: what Huntress says needs containing now.",
  ),
  [HuntressSeverity.High]: translationKey(
    "Also confirmed malware and identity compromise that need urgent remediation.",
  ),
  [HuntressSeverity.Low]: translationKey(
    "Also potentially unwanted programs and older findings.",
  ),
};

export const HUNTRESS_OUTCOME_LABELS: Record<
  HuntressIncidentReportOutcome,
  string
> = {
  [HuntressIncidentReportOutcome.Opening]: translationKey(
    "Opening the incident",
  ),
  [HuntressIncidentReportOutcome.IncidentOpened]:
    translationKey("Incident opened"),
  [HuntressIncidentReportOutcome.IncidentResolved]:
    translationKey("Incident resolved"),
  [HuntressIncidentReportOutcome.OrganizationNotWatched]: translationKey(
    "Skipped: organization not watched",
  ),
  [HuntressIncidentReportOutcome.ClosedBeforeReceived]: translationKey(
    "Skipped: already closed in Huntress",
  ),
};

export const HUNTRESS_OUTCOME_COLORS: Record<
  HuntressIncidentReportOutcome,
  Color
> = {
  [HuntressIncidentReportOutcome.Opening]: Yellow500,
  [HuntressIncidentReportOutcome.IncidentOpened]: Red500,
  [HuntressIncidentReportOutcome.IncidentResolved]: Green500,
  [HuntressIncidentReportOutcome.OrganizationNotWatched]: Gray500,
  [HuntressIncidentReportOutcome.ClosedBeforeReceived]: Gray500,
};

/*
 * A report row's first line: what it is about - the host or identity the
 * subject names - or its subject without the severity, or its number.
 */
export function getHuntressReportHeadline(report: {
  affectedName?: string | null | undefined;
  subject?: string | null | undefined;
  huntressIncidentReportId?: string | null | undefined;
}): string {
  if (report.affectedName) {
    return report.affectedName;
  }

  const subject: string = getHuntressSubjectWithoutSeverity(report.subject);

  if (subject) {
    return subject;
  }

  return `#${report.huntressIncidentReportId || ""}`;
}

// A report row's second line: its organization and its number in Huntress.
export function getHuntressReportByline(report: {
  organizationName?: string | null | undefined;
  huntressIncidentReportId?: string | null | undefined;
}): string {
  return [
    report.organizationName || "",
    report.huntressIncidentReportId
      ? `#${report.huntressIncidentReportId}`
      : "",
  ]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" · ");
}

// A report's status, in the words Huntress uses for it.
export const HUNTRESS_STATUS_LABELS: Record<string, string> = {
  sent: translationKey("Sent"),
  closed: translationKey("Closed"),
  dismissed: translationKey("Dismissed"),
  partner_dismissed: translationKey("Dismissed by your team"),
  auto_remediating: translationKey("Auto-remediating"),
  deleting: translationKey("Deleting"),
  draft: translationKey("Draft"),
};

// Where an incident report opens in the Huntress portal.
export function getHuntressReportPortalLink(data: {
  organizationId?: string | null | undefined;
  reportId?: string | null | undefined;
}): string | null {
  if (!data.organizationId || !data.reportId) {
    return null;
  }

  return `https://huntress.io/org/${encodeURIComponent(data.organizationId)}/incident_reports/${encodeURIComponent(data.reportId)}`;
}
