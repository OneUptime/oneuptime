import HuntressSeverity, {
  AllHuntressSeverities,
  getHuntressSeverityTitle,
} from "../../Types/Huntress/HuntressSeverity";
import {
  HuntressIncidentReportEvent,
  HuntressIndicatorCount,
} from "../../Types/Huntress/HuntressWebhook";
import FeedMarkdown, { MarkdownText, mdText } from "../Markdown/FeedMarkdown";

/*
 * The text of the incident a Huntress incident report opens: its title,
 * its description, and the notes added when Huntress comments on or closes
 * the report.
 *
 * Everything in a report was written outside OneUptime - by Huntress's SOC
 * analysts, or by whoever named the host or the organization - and it is
 * read by responders in the dashboard, in emails, and in Slack and
 * Microsoft Teams. So names and ids are placed as text with `mdText`, and
 * the analyst's summary and comments as outside Markdown
 * (FeedMarkdown.writtenOutside): they keep their formatting, but nothing in
 * them fetches an image, mentions a channel or draws a diagram.
 *
 * Fields are cut to their limits when the payload is read
 * (Types/Huntress/HuntressWebhook), and nothing here runs a pattern over
 * them: a subject is searched with indexOf.
 *
 * Pure: no database, no network, no React.
 */

/*
 * Where an incident report opens in the Huntress portal. The portal sends a
 * signed-out reader to sign in first and then on to the report.
 */
export const HUNTRESS_PORTAL_ORIGIN: string = "https://huntress.io";

const SUBJECT_HOST_MARKER: string = "incident on ";
const MAX_AFFECTED_NAME_LENGTH: number = 200;

// The platforms Huntress names, as it shows them.
const PLATFORM_TITLES: Record<string, string> = {
  windows: "Windows",
  darwin: "macOS",
  linux: "Linux",
  microsoft_365: "Microsoft 365",
  google: "Google Workspace",
  email_security: "Email security",
  other: "Other",
};

// Platforms whose reports are about an identity rather than a host (ITDR).
const IDENTITY_PLATFORMS: Array<string> = ["microsoft_365", "google"];

// Platforms whose reports are about a host (EDR).
const HOST_PLATFORMS: Array<string> = ["windows", "darwin", "linux"];

// The indicator types Huntress documents, as it shows them.
const INDICATOR_TITLES: Record<string, string> = {
  footholds: "Footholds",
  monitored_files: "Monitored files",
  ransomware_canaries: "Ransomware canaries",
  antivirus_detections: "Antivirus detections",
  process_detections: "Process detections",
  managed_identity: "Managed identity",
  mde_detections: "Microsoft Defender detections",
  siem_detections: "SIEM detections",
  favicon_detections: "Favicon detections",
  behavioral_detections: "Behavioral detections",
  email_security_detections: "Email security detections",
  app_control: "App control",
  ai_misuse: "AI misuse",
};

export function getHuntressPlatformTitle(
  platform: string | null,
): string | null {
  if (!platform) {
    return null;
  }

  return PLATFORM_TITLES[platform.toLowerCase()] || platform;
}

// An indicator type as a reader sees it: "process_detections" -> "Process detections".
export function getHuntressIndicatorTitle(type: string): string {
  const known: string | undefined = INDICATOR_TITLES[type];

  if (known) {
    return known;
  }

  const words: string = type.split("_").join(" ").trim();

  return words ? words.charAt(0).toUpperCase() + words.slice(1) : type;
}

/*
 * The report as it opens in the Huntress portal, or null when the payload
 * names no organization id (the portal addresses reports by organization).
 * Both ids are positive integers by the time they get here.
 */
export function getHuntressReportPortalUrl(
  event: Pick<HuntressIncidentReportEvent, "reportId" | "organization">,
): string | null {
  if (!event.organization.id) {
    return null;
  }

  return `${HUNTRESS_PORTAL_ORIGIN}/org/${event.organization.id}/incident_reports/${event.reportId}`;
}

/*
 * The host or identity a report is about. Huntress writes it into the
 * report's subject, "CRITICAL - Incident on DESKTOP-01 (Acme Corp)", and
 * the webhook carries no hostname of its own (only the agent's id). The
 * organization's name in brackets is taken off by name, so an organization
 * called "Acme (UK)" is not cut in half; without a name, at the first " (".
 */
export function getHuntressAffectedName(
  event: Pick<HuntressIncidentReportEvent, "subject" | "organization">,
): string | null {
  const subject: string | null = event.subject;

  if (!subject) {
    return null;
  }

  const markerAt: number = subject.toLowerCase().indexOf(SUBJECT_HOST_MARKER);

  if (markerAt < 0) {
    return null;
  }

  let rest: string = subject
    .slice(markerAt + SUBJECT_HOST_MARKER.length)
    .trim();

  const organizationName: string | null = event.organization.name;
  const organizationSuffix: string | null = organizationName
    ? ` (${organizationName.toLowerCase()})`
    : null;

  if (organizationSuffix && rest.toLowerCase().endsWith(organizationSuffix)) {
    rest = rest.slice(0, rest.length - organizationSuffix.length).trim();
  } else {
    const bracketAt: number = rest.indexOf(" (");

    if (bracketAt > 0) {
      rest = rest.slice(0, bracketAt).trim();
    }
  }

  // Nothing before the organization's brackets: the subject names no host.
  if (!rest || rest.startsWith("(")) {
    return null;
  }

  return rest.slice(0, MAX_AFFECTED_NAME_LENGTH);
}

/*
 * What to call the affected thing in a sentence: a host for an endpoint
 * report, an identity for a Microsoft 365 or Google one.
 */
export function getHuntressAffectedLabel(platform: string | null): string {
  const normalized: string = (platform || "").toLowerCase();

  if (IDENTITY_PLATFORMS.includes(normalized)) {
    return "Identity";
  }

  if (HOST_PLATFORMS.includes(normalized)) {
    return "Host";
  }

  return "Affected";
}

/*
 * A report's subject without the severity Huntress writes in front of it
 * ("CRITICAL - Incident on ..." reads "Incident on ..."): the severity is
 * shown on its own wherever the subject is. Empty for no subject.
 */
export function getHuntressSubjectWithoutSeverity(
  subject: string | null | undefined,
): string {
  let text: string = (subject || "").trim();
  const lowerText: string = text.toLowerCase();

  for (const severity of AllHuntressSeverities) {
    // "CRITICAL - ...", or just "CRITICAL -" once the payload was trimmed.
    const prefix: string = `${severity} -`;

    if (lowerText.startsWith(`${prefix} `) || lowerText === prefix) {
      text = text.slice(prefix.length).trim();
      break;
    }
  }

  return text;
}

/*
 * The incident's title: the report's subject, which MSPs already know from
 * Huntress's emails and PSA tickets, after "Huntress:" so a page or a call
 * says where it came from. The severity Huntress puts in front of the
 * subject ("CRITICAL - ") is left off: the incident shows its severity on
 * its own.
 */
export function getHuntressIncidentTitle(
  event: Pick<
    HuntressIncidentReportEvent,
    "subject" | "reportId" | "organization"
  >,
): string {
  const subject: string = getHuntressSubjectWithoutSeverity(event.subject);

  if (subject) {
    return `Huntress: ${subject}`;
  }

  if (event.organization.name) {
    return `Huntress incident report ${event.reportId} (${event.organization.name})`;
  }

  return `Huntress incident report ${event.reportId}`;
}

function getIndicatorsText(
  indicatorCounts: Array<HuntressIndicatorCount>,
): string | null {
  if (indicatorCounts.length === 0) {
    return null;
  }

  return indicatorCounts
    .map((indicator: HuntressIndicatorCount): string => {
      return `${getHuntressIndicatorTitle(indicator.type)} (${indicator.count})`;
    })
    .join(", ");
}

/*
 * The incident's description: the analyst's summary first - it says what
 * happened and what to do - then the facts a responder looks for, and the
 * way back to the full report in Huntress.
 */
export function getHuntressIncidentDescription(data: {
  event: HuntressIncidentReportEvent;
  // The severity the report was handled at (unknown ones read as High).
  severity: HuntressSeverity;
}): string {
  const event: HuntressIncidentReportEvent = data.event;
  const facts: Array<MarkdownText> = [];

  facts.push(
    mdText`**Severity in Huntress:** ${getHuntressSeverityTitle(data.severity)}`,
  );

  if (event.organization.name) {
    facts.push(mdText`**Organization:** ${event.organization.name}`);
  }

  const affectedName: string | null = getHuntressAffectedName(event);
  const platformTitle: string | null = getHuntressPlatformTitle(event.platform);
  const affectedLabel: string = getHuntressAffectedLabel(event.platform);

  if (affectedName && platformTitle) {
    facts.push(
      mdText`**${affectedLabel}:** ${affectedName} (${platformTitle})`,
    );
  } else if (affectedName) {
    facts.push(mdText`**${affectedLabel}:** ${affectedName}`);
  } else if (platformTitle) {
    facts.push(mdText`**Platform:** ${platformTitle}`);
  }

  const indicators: string | null = getIndicatorsText(event.indicatorCounts);

  if (indicators) {
    facts.push(mdText`**Indicators:** ${indicators}`);
  }

  const portalUrl: string | null = getHuntressReportPortalUrl(event);

  if (portalUrl) {
    facts.push(
      mdText`**Huntress report:** ${FeedMarkdown.link(event.reportId, portalUrl)}`,
    );
  } else {
    facts.push(mdText`**Huntress report:** ${event.reportId}`);
  }

  const parts: Array<MarkdownText> = [];

  if (event.summary) {
    parts.push(FeedMarkdown.writtenOutside(event.summary));
  }

  parts.push(FeedMarkdown.bulletList(facts));

  return FeedMarkdown.join(parts, "\n\n").toString();
}

// A comment someone added to the report in Huntress, as an incident note.
export function getHuntressCommentNote(comment: string): string {
  return FeedMarkdown.join(
    [
      mdText`**Comment added in Huntress**`,
      FeedMarkdown.writtenOutside(comment),
    ],
    "\n\n",
  ).toString();
}

/*
 * The note added when Huntress closes a report whose incident the
 * connection does not resolve on its own.
 */
export function getHuntressClosedNote(
  event: Pick<HuntressIncidentReportEvent, "reportId" | "status">,
): string {
  if (event.status) {
    return mdText`Huntress closed incident report ${event.reportId} (status: ${event.status}).`.toString();
  }

  return mdText`Huntress closed incident report ${event.reportId}.`.toString();
}

// Why the incident was resolved, on its state timeline.
export function getHuntressResolvedReason(
  event: Pick<HuntressIncidentReportEvent, "reportId" | "status">,
): string {
  if (event.status) {
    return mdText`Resolved because Huntress closed incident report ${event.reportId} (status: ${event.status}).`.toString();
  }

  return mdText`Resolved because Huntress closed incident report ${event.reportId}.`.toString();
}
