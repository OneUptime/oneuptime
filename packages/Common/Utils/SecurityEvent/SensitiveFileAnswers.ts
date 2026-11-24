import NormalizedSecurityEvent from "../../Types/SecurityEvent/NormalizedSecurityEvent";
import OcsfSeverity, {
  OcsfSeverityId,
} from "../../Types/SecurityEvent/OcsfSeverity";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
} from "../../Types/SecurityEvent/SecurityEventRequestOutcome";
import { SECURITY_LOG_RESOURCE_ID_ATTRIBUTE } from "../../Types/SecurityCase/SecurityConnection";
import {
  SENSITIVE_FILE_SERVED_LABEL,
  WEB_ATTACK_KIND_ATTRIBUTE,
  WEB_ATTACK_LABELS,
  WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE,
  WebAttackKind,
  outcomeForSensitiveFile,
  severityForSensitiveFile,
} from "./LogParsers/WebAttackLogParser";
import { readStatusCode } from "./RequestOutcome";
import {
  SensitiveFileAnswer,
  isSensitiveFileAnswer,
  readBodySize,
  readRequestPathSegments,
} from "./SensitiveFileProbe";

/*
 * WHAT THE SAME SITE ANSWERED OTHER PATHS (#10912).
 *
 * A request for a file that holds secrets, answered with a 2xx whose type
 * nothing recorded - a common log format line records a size and no type -
 * is unconfirmed by itself (SensitiveFileProbe): the file, or the site's
 * own page for a path it does not have? What the same site answered the
 * other requests of the batch says which - a scanner asks for many paths
 * at once:
 *
 *   - a size that answered two different paths is the site's own page for
 *     paths it does not have - a single-page app answers every one of them
 *     with the same page: "/.env" and "/.git/config" both 200 and 1,789
 *     bytes are no leak;
 *   - a size no other path got, on a site that answered another of those
 *     paths "not found" (a 404 or a 410: it refuses what it does not have,
 *     so it has no page for every path), is the file itself: "/.env" 200
 *     and 412 bytes beside "/.git/config" 404 is a leak. A 403 is no such
 *     sign: a server that refuses every path that starts with a dot, in
 *     front of a single-page app, refuses them all the same;
 *   - anything else stays unconfirmed, and is no event: OneUptime says
 *     nothing it cannot tell.
 *
 * A site is the record the event was sent under - the host or service
 * whose logs or spans held it - and the host its URL names. A request is
 * its path, lowercased and decoded once, without its query.
 *
 * Every event this decides is said as what it is: the file is Critical and
 * its message says "Sensitive file served"; the site's own page is a probe
 * that found nothing, Low, and turned away - so is one the site answered
 * with nothing, however a trace it was followed into read its status.
 *
 * Pure: the log scan and the trace scan hand it each page of events before
 * they are stored, and store what it keeps.
 */

// What a site answered, and how much, for the requests of one batch.
interface SiteAnswers {
  // The sizes each of its unconfirmed or own-page answers had, by the paths that got each.
  pathsBySize: Map<number, Set<string>>;
  // Whether it answered a request for a sensitive path "not found".
  refusesUnknownPaths: boolean;
}

// The statuses that say a site has no such path: never a 403, which a deny rule writes.
const NOT_FOUND_STATUSES: ReadonlyArray<number> = [404, 410];

function attributeText(event: NormalizedSecurityEvent, key: string): string {
  const value: unknown = event.attributes[key];

  return typeof value === "string" || typeof value === "number"
    ? String(value).trim()
    : "";
}

// Whether an event is a request for a sensitive file, and what the site answered it.
function answerOf(event: NormalizedSecurityEvent): SensitiveFileAnswer | null {
  if (
    attributeText(event, WEB_ATTACK_KIND_ATTRIBUTE) !==
    WebAttackKind.SensitiveFile
  ) {
    return null;
  }

  const answer: string = attributeText(
    event,
    WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE,
  );

  return isSensitiveFileAnswer(answer) ? answer : null;
}

// The host a URL names, lowercased; '' for a path alone.
function hostOf(url: string): string {
  const scheme: number = url.indexOf("://");

  if (scheme === -1 || scheme > 10) {
    return "";
  }

  const rest: string = url.slice(scheme + 3);
  let end: number = rest.length;

  for (const stop of ["/", "?", "#"]) {
    const at: number = rest.indexOf(stop);

    if (at !== -1 && at < end) {
      end = at;
    }
  }

  return rest.slice(0, end).toLowerCase();
}

function urlOf(event: NormalizedSecurityEvent): string {
  return (
    attributeText(event, SECURITY_REQUEST_ATTRIBUTES.url) ||
    event.targetResource ||
    ""
  );
}

// The site an event's request was sent to: the record it came under, and its URL's host.
export function getSensitiveFileSiteKey(
  event: NormalizedSecurityEvent,
): string {
  return `${attributeText(event, SECURITY_LOG_RESOURCE_ID_ATTRIBUTE)}|${hostOf(
    urlOf(event),
  )}`;
}

// The path an event's request asked for, as it is compared: lowercased, decoded once, no query.
export function getSensitiveFileRequestPath(
  event: NormalizedSecurityEvent,
): string {
  return `/${readRequestPathSegments(urlOf(event)).join("/")}`;
}

function sizeOf(event: NormalizedSecurityEvent): number | null {
  const text: string = attributeText(
    event,
    SECURITY_REQUEST_ATTRIBUTES.responseBodySize,
  );

  return text ? readBodySize(text) : null;
}

function readSiteAnswers(
  events: ReadonlyArray<NormalizedSecurityEvent>,
): Map<string, SiteAnswers> {
  const sites: Map<string, SiteAnswers> = new Map();

  for (const event of events) {
    const answer: SensitiveFileAnswer | null = answerOf(event);

    if (!answer) {
      continue;
    }

    const key: string = getSensitiveFileSiteKey(event);
    let site: SiteAnswers | undefined = sites.get(key);

    if (!site) {
      site = { pathsBySize: new Map(), refusesUnknownPaths: false };
      sites.set(key, site);
    }

    if (answer === SensitiveFileAnswer.Refused) {
      if (
        NOT_FOUND_STATUSES.includes(
          readStatusCode(
            attributeText(event, SECURITY_REQUEST_ATTRIBUTES.statusCode),
          ),
        )
      ) {
        site.refusesUnknownPaths = true;
      }

      continue;
    }

    if (
      answer !== SensitiveFileAnswer.Unconfirmed &&
      answer !== SensitiveFileAnswer.OwnPage
    ) {
      continue;
    }

    const size: number | null = sizeOf(event);

    if (size === null || size <= 0) {
      continue;
    }

    const paths: Set<string> = site.pathsBySize.get(size) || new Set();
    paths.add(getSensitiveFileRequestPath(event));
    site.pathsBySize.set(size, paths);
  }

  return sites;
}

// The sizes a site answered two or more different paths with: its own page's.
function ownPageSizesOf(site: SiteAnswers): Set<number> {
  const sizes: Set<number> = new Set();

  for (const [size, paths] of site.pathsBySize) {
    if (paths.size >= 2) {
      sizes.add(size);
    }
  }

  return sizes;
}

/*
 * What an unconfirmed answer was, by what its site answered the batch's
 * other requests; Unconfirmed when they do not say.
 */
function decideUnconfirmed(
  event: NormalizedSecurityEvent,
  site: SiteAnswers | undefined,
): SensitiveFileAnswer {
  const size: number | null = sizeOf(event);

  if (!site || size === null || size <= 0) {
    return SensitiveFileAnswer.Unconfirmed;
  }

  const ownPageSizes: Set<number> = ownPageSizesOf(site);

  if (ownPageSizes.has(size)) {
    return SensitiveFileAnswer.OwnPage;
  }

  if (site.refusesUnknownPaths && ownPageSizes.size === 0) {
    return SensitiveFileAnswer.File;
  }

  return SensitiveFileAnswer.Unconfirmed;
}

// An event said as the answer it was decided to be.
function sayAnswer(
  event: NormalizedSecurityEvent,
  answer: SensitiveFileAnswer,
): void {
  event.attributes[WEB_SENSITIVE_FILE_ANSWER_ATTRIBUTE] = answer;

  const severity: OcsfSeverity = severityForSensitiveFile(answer);
  event.severityName = severity;
  event.severityId = OcsfSeverityId[severity];

  if (answer === SensitiveFileAnswer.File) {
    const probeLabel: string = WEB_ATTACK_LABELS[WebAttackKind.SensitiveFile];

    if (event.message.startsWith(probeLabel)) {
      event.message = `${SENSITIVE_FILE_SERVED_LABEL}${event.message.slice(probeLabel.length)}`;
    }
  }
}

/*
 * A turned-away outcome for an answer that found nothing (outcomeForSensitiveFile)
 * - unless the request's trace showed it broke something, which outranks it.
 */
function sayOutcome(
  event: NormalizedSecurityEvent,
  answer: SensitiveFileAnswer,
): void {
  if (
    event.requestOutcome === SecurityEventRequestOutcome.Errored ||
    event.requestOutcome === SecurityEventRequestOutcome.ReachedDatabase
  ) {
    return;
  }

  const outcome: SecurityEventRequestOutcome | undefined =
    outcomeForSensitiveFile(answer, event.requestOutcome);

  if (outcome) {
    event.requestOutcome = outcome;
  }
}

/*
 * Each request for a sensitive file that found nothing said as turned
 * away again, once its trace was followed (#10912): a follow-up reads a
 * 2xx as reaching the app, and a single-page app's page for /.env reached
 * nothing.
 */
export function keepSensitiveFileOutcomes(
  events: ReadonlyArray<NormalizedSecurityEvent>,
): void {
  for (const event of events) {
    const answer: SensitiveFileAnswer | null = answerOf(event);

    if (answer) {
      sayOutcome(event, answer);
    }
  }
}

/*
 * The events of a batch to store (#10912): every event but a request for a
 * file that holds secrets whose answer nothing decides - each unconfirmed
 * one decided by what its site answered the batch's other requests, and
 * said as what it is.
 */
export function judgeSensitiveFileAnswers(
  events: Array<NormalizedSecurityEvent>,
): Array<NormalizedSecurityEvent> {
  if (
    !events.some((event: NormalizedSecurityEvent): boolean => {
      return answerOf(event) !== null;
    })
  ) {
    return events;
  }

  const sites: Map<string, SiteAnswers> = readSiteAnswers(events);
  const kept: Array<NormalizedSecurityEvent> = [];

  for (const event of events) {
    let answer: SensitiveFileAnswer | null = answerOf(event);

    if (answer === SensitiveFileAnswer.Unconfirmed) {
      answer = decideUnconfirmed(
        event,
        sites.get(getSensitiveFileSiteKey(event)),
      );

      if (answer === SensitiveFileAnswer.Unconfirmed) {
        // Nothing says what was sent: no event.
        continue;
      }

      sayAnswer(event, answer);
    }

    if (answer) {
      sayOutcome(event, answer);
    }

    kept.push(event);
  }

  return kept;
}
