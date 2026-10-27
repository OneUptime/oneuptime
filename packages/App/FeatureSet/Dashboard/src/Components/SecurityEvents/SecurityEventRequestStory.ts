import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Color from "Common/Types/Color";
import { Amber500, Gray500, Green500, Orange, Red } from "Common/Types/BrandColors";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import SecurityEventRequestOutcome, {
  SECURITY_REQUEST_ATTRIBUTES,
  getRequestOutcomeRank,
  isSecurityEventRequestOutcome,
} from "Common/Types/SecurityEvent/SecurityEventRequestOutcome";
import {
  RequestTraceAssessment,
  readStatusCode,
} from "Common/Utils/SecurityEvent/RequestOutcome";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  ERRORED,
  ERRORED_WITH_EXCEPTION,
  ERRORED_WITH_STATUS,
  ERRORED_WITH_STATUS_AND_EXCEPTION,
  NOT_FOLLOWED_WITH_TRACE,
  REACHED_APP,
  REACHED_APP_IN,
  REACHED_DATABASE,
  REACHED_DATABASE_BY_DELAY,
  REACHED_DATABASE_IN_SYSTEM,
  REJECTED,
  REJECTED_IN,
} from "./SecurityEventRequestCopy";

/*
 * WHAT HAPPENED NEXT, as data: the facts a followed request left on its
 * security event (Utils/SecurityEvent/RequestFollowUp.ts writes them as
 * attributes), and the sentence the event panel says them in.
 *
 * The panel can also read the trace again when it opens (a request whose
 * spans reached OneUptime after the event was stored): mergeAssessment
 * adds what that read found to what the event already said, never making
 * the outcome less serious.
 *
 * React-free, so a plain test pins every sentence and every rule.
 */

export interface SecurityEventRequestFacts {
  outcome: SecurityEventRequestOutcome | undefined;
  statusCode: number;
  method: string;
  url: string;
  route: string;
  clientAddress: string;
  userAgent: string;
  userId: string;
  durationMs: number;
  serverSpanId: string;
  exceptionFingerprint: string;
  exceptionType: string;
  exceptionMessage: string;
  databaseSystem: string;
  databaseStatement: string;
  requestedDelaySeconds: number;
}

function readText(attributes: JSONObject, key: string): string {
  const value: JSONValue | undefined = attributes[key];

  if (value === undefined || value === null) {
    return "";
  }

  return String(value).trim();
}

function readNumber(attributes: JSONObject, key: string): number {
  const value: number = Number(readText(attributes, key));

  return Number.isFinite(value) && value > 0 ? value : 0;
}

export function readSecurityEventRequestFacts(
  event: SecurityEvent,
): SecurityEventRequestFacts {
  const attributes: JSONObject = (event.attributes || {}) as JSONObject;

  return {
    outcome: isSecurityEventRequestOutcome(event.requestOutcome)
      ? event.requestOutcome
      : undefined,
    statusCode: readStatusCode(
      readText(attributes, SECURITY_REQUEST_ATTRIBUTES.statusCode),
    ),
    method: readText(attributes, SECURITY_REQUEST_ATTRIBUTES.method),
    url: readText(attributes, SECURITY_REQUEST_ATTRIBUTES.url),
    route: readText(attributes, SECURITY_REQUEST_ATTRIBUTES.route),
    clientAddress:
      readText(attributes, SECURITY_REQUEST_ATTRIBUTES.clientAddress) ||
      (event.principalIp || "").trim(),
    userAgent: readText(attributes, SECURITY_REQUEST_ATTRIBUTES.userAgent),
    userId: readText(attributes, SECURITY_REQUEST_ATTRIBUTES.userId),
    durationMs: readNumber(attributes, SECURITY_REQUEST_ATTRIBUTES.durationMs),
    serverSpanId: readText(attributes, SECURITY_REQUEST_ATTRIBUTES.serverSpanId),
    exceptionFingerprint: readText(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.exceptionFingerprint,
    ),
    exceptionType: readText(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.exceptionType,
    ),
    exceptionMessage: readText(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.exceptionMessage,
    ),
    databaseSystem: readText(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.databaseSystem,
    ),
    databaseStatement: readText(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.databaseStatement,
    ),
    requestedDelaySeconds: readNumber(
      attributes,
      SECURITY_REQUEST_ATTRIBUTES.requestedDelaySeconds,
    ),
  };
}

function firstOf(current: string, found: string): string {
  return current || (found || "").trim();
}

/*
 * What the event said, completed by a fresh read of its trace: a fact the
 * event lacks is taken from the read, and the outcome is the more serious
 * of the two.
 */
export function mergeAssessment(
  facts: SecurityEventRequestFacts,
  assessment: RequestTraceAssessment | null,
): SecurityEventRequestFacts {
  if (!assessment) {
    return facts;
  }

  const outcome: SecurityEventRequestOutcome | undefined =
    getRequestOutcomeRank(assessment.outcome) >
    getRequestOutcomeRank(facts.outcome)
      ? assessment.outcome
      : facts.outcome;

  return {
    outcome,
    statusCode: facts.statusCode || assessment.statusCode,
    method: firstOf(facts.method, assessment.method.toUpperCase()),
    url: firstOf(facts.url, assessment.url),
    route: firstOf(facts.route, assessment.route),
    clientAddress: firstOf(facts.clientAddress, assessment.clientAddress),
    userAgent: firstOf(facts.userAgent, assessment.userAgent),
    userId: firstOf(facts.userId, assessment.userId),
    durationMs: facts.durationMs || assessment.durationMs,
    serverSpanId: firstOf(facts.serverSpanId, assessment.serverSpanId),
    exceptionFingerprint: firstOf(
      facts.exceptionFingerprint,
      assessment.exception?.fingerprint || "",
    ),
    exceptionType: firstOf(
      facts.exceptionType,
      assessment.exception?.exceptionType || "",
    ),
    exceptionMessage: firstOf(
      facts.exceptionMessage,
      assessment.exception?.message || "",
    ),
    databaseSystem: firstOf(
      facts.databaseSystem,
      assessment.database?.system || "",
    ),
    databaseStatement: firstOf(
      facts.databaseStatement,
      assessment.database?.statement || "",
    ),
    requestedDelaySeconds:
      facts.requestedDelaySeconds || assessment.requestedDelaySeconds,
  };
}

/*
 * The colour an outcome is shown in: turned away is good news, reaching the
 * app is worth a look, breaking something is bad, and reaching the
 * database is the worst there is.
 */
export function getRequestOutcomeColor(outcome: string | undefined): Color {
  switch (outcome) {
    case SecurityEventRequestOutcome.Rejected:
      return Green500;
    case SecurityEventRequestOutcome.ReachedApp:
      return Amber500;
    case SecurityEventRequestOutcome.Errored:
      return Orange;
    case SecurityEventRequestOutcome.ReachedDatabase:
      return Red;
    default:
      return Gray500;
  }
}

// The words HTTP gives the statuses an attack is answered with most.
export const HTTP_STATUS_REASONS: Readonly<Record<number, string>> = {
  200: "OK",
  201: "Created",
  202: "Accepted",
  204: "No Content",
  301: "Moved Permanently",
  302: "Found",
  303: "See Other",
  304: "Not Modified",
  307: "Temporary Redirect",
  308: "Permanent Redirect",
  400: "Bad Request",
  401: "Unauthorized",
  403: "Forbidden",
  404: "Not Found",
  405: "Method Not Allowed",
  408: "Request Timeout",
  409: "Conflict",
  413: "Content Too Large",
  414: "URI Too Long",
  415: "Unsupported Media Type",
  422: "Unprocessable Content",
  429: "Too Many Requests",
  500: "Internal Server Error",
  501: "Not Implemented",
  502: "Bad Gateway",
  503: "Service Unavailable",
  504: "Gateway Timeout",
};

// A status as HTTP writes it: "404 Not Found", or the number alone.
export function formatStatus(statusCode: number): string {
  const reason: string | undefined = HTTP_STATUS_REASONS[statusCode];

  return reason ? `${statusCode} ${reason}` : String(statusCode);
}

/*
 * How long a request took, in the units a person reads a request in:
 * "3 ms", "245 ms", "1.2 s", "16 s". The units are the SI ones every
 * language writes; the number is the reader's.
 */
export function formatRequestDuration(
  durationMs: number,
  translator: Translator,
): string {
  if (!(durationMs > 0)) {
    return "";
  }

  if (durationMs < 1000) {
    return `${translator.formatNumber(Math.max(1, Math.round(durationMs)))} ms`;
  }

  const seconds: number = durationMs / 1000;
  const rounded: number =
    seconds < 10 ? Math.round(seconds * 10) / 10 : Math.round(seconds);

  return `${translator.formatNumber(rounded)} s`;
}

/*
 * What happened next, in one sentence; '' when there is nothing to say (no
 * trace, and nothing the line itself recorded).
 */
export function describeWhatHappenedNext(data: {
  facts: SecurityEventRequestFacts;
  hasTrace: boolean;
  translator: Translator;
}): string {
  const { facts, translator } = data;
  const status: string = facts.statusCode ? formatStatus(facts.statusCode) : "";
  const duration: string = formatRequestDuration(facts.durationMs, translator);
  const exception: string = facts.exceptionType;

  switch (facts.outcome) {
    case SecurityEventRequestOutcome.ReachedDatabase:
      if (facts.databaseStatement) {
        return facts.databaseSystem
          ? translator.translateTemplate(REACHED_DATABASE_IN_SYSTEM, {
              system: facts.databaseSystem,
            })
          : translator.translateText(REACHED_DATABASE) || REACHED_DATABASE;
      }

      return translator.translateTemplate(REACHED_DATABASE_BY_DELAY, {
        duration: duration || `${facts.requestedDelaySeconds} s`,
      });
    case SecurityEventRequestOutcome.Errored:
      if (status && exception) {
        return translator.translateTemplate(ERRORED_WITH_STATUS_AND_EXCEPTION, {
          status,
          exception,
        });
      }

      if (exception) {
        return translator.translateTemplate(ERRORED_WITH_EXCEPTION, {
          exception,
        });
      }

      if (status) {
        return translator.translateTemplate(ERRORED_WITH_STATUS, { status });
      }

      return translator.translateText(ERRORED) || ERRORED;
    case SecurityEventRequestOutcome.ReachedApp:
      return translator.translateTemplate(duration ? REACHED_APP_IN : REACHED_APP, {
        status: status || "2xx",
        duration,
      });
    case SecurityEventRequestOutcome.Rejected:
      return translator.translateTemplate(duration ? REJECTED_IN : REJECTED, {
        status: status || "4xx",
        duration,
      });
    default:
      return data.hasTrace
        ? translator.translateText(NOT_FOLLOWED_WITH_TRACE) ||
            NOT_FOLLOWED_WITH_TRACE
        : "";
  }
}

// The request as one line: "GET /search" - the route when the URL is long.
export function describeRequest(facts: SecurityEventRequestFacts): string {
  const target: string =
    facts.url && facts.url.length <= 80 ? facts.url : facts.route || facts.url;

  return [facts.method, target]
    .filter((part: string): boolean => {
      return Boolean(part);
    })
    .join(" ");
}
