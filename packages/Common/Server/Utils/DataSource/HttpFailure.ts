import Dictionary from "../../../Types/Dictionary";
import {
  ProbeFailureCause,
  writeProbeFailureCause,
} from "../../../Utils/Monitor/ProbeFailureCauses";

/*
 * WHAT A DATA SOURCE'S FAILED ANSWER SAYS, IN ONE SENTENCE A PERSON CAN ACT ON.
 *
 * Every Data Observability collector that talks HTTP (Dataverse, Snowflake,
 * Databricks, BigQuery, Athena and Glue, ClickHouse) says a failure the same
 * way, first written for Dataverse (#9506):
 *
 *   Snowflake answered 503 (390600) while listing the tables (SHOW TABLES):
 *   Service unavailable. Tried 3 times. Query ID: 01b2c3d4-0000-0001-....
 *
 *  - what was being read, in OneUptime's words;
 *  - the provider's status, its own error code and the first line of its own
 *    message, cut short enough that the whole sentence fits the store's
 *    message;
 *  - how many times it was asked, when more than once, in the words the
 *    table of why a check failed gives it (withAttempts);
 *  - the ID the provider's support finds the request by, when it gave one.
 *
 * A refusal (401, 403) says who was refused instead, and what to do where
 * the collector knows. An empty body says so, and a gateway's HTML page is
 * said by its title. A bearer token, a JSON web token or a secret of the
 * connection an answer repeats is taken out before anything is said.
 */

const SENTENCE_END: RegExp = /[.!?]$/;
// A body that is an HTML page, as a gateway or a proxy answers: never the provider's own error.
const HTML_PAGE: RegExp = /^<(?:!doctype|html|head|body|\?xml)/i;
const HTML_TITLE: RegExp = /<title[^>]*>([\s\S]*?)<\/title>/i;
const HTML_HIDDEN: RegExp = /<(script|style)[^>]*>[\s\S]*?<\/\1>/gi;
const HTML_TAG: RegExp = /<[^>]*>/g;
// Credentials an answer could repeat: a bearer token, or a JSON web token on its own.
const BEARER_TOKEN: RegExp = /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi;
/*
 * A JSON web token, looked for once per run of the characters it is made of:
 * from the first "eyJ" in the run, with the run's text before it put back
 * ($1). A later "eyJ" in the same run has a shorter first segment and ends
 * no better, so this masks the tokens a search from every "eyJ" did, in
 * time in line with the answer's length rather than its square.
 */
const JSON_WEB_TOKEN: RegExp =
  /(?<![A-Za-z0-9_-])(?=([A-Za-z0-9_-]*?)eyJ)\1eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}/g;
// An ID a provider gives for a request or a query: letters, digits and a few separators.
const REQUEST_ID: RegExp = /^[A-Za-z0-9][A-Za-z0-9._:-]{3,99}$/;
// A provider's own error code: 0x80040216, ThrottlingException, TEMPORARILY_UNAVAILABLE, 390144.
const ERROR_CODE: RegExp = /^[A-Za-z0-9_.-]{1,60}$/;

// What stands in for a credential taken out of an answer.
export const REDACTED_IN_ANSWER: string = "****";

// The most of the provider's own message an error keeps, so the whole sentence around it fits.
export const MAX_PROVIDER_MESSAGE_LENGTH: number = 130;

// A message ending in a full stop, so a sentence can follow it.
export function asSentence(text: string): string {
  const trimmed: string = text.trim();

  return !trimmed || SENTENCE_END.test(trimmed) ? trimmed : `${trimmed}.`;
}

/*
 * A failure and how many times it was asked, once it was asked more than
 * once: "... Tried 3 times.", written from the table of why a check failed
 * (ProbeFailureCauses, TriedTimes), which words it in every language the
 * Dashboard reads, as a probe's check writes it.
 */
export function withAttempts(sentence: string, attempts: number): string {
  if (attempts <= 1) {
    return sentence;
  }

  return writeProbeFailureCause(ProbeFailureCause.TriedTimes, {
    cause: sentence,
    count: attempts,
  });
}

// The first line of a text, trimmed.
export function firstLineOf(text: string): string {
  return (text || "").trim().split(/\r?\n/)[0]!.trim();
}

/*
 * The words of a body that is no JSON: an HTML page's title (a gateway's
 * 502), else its first line.
 */
export function readBodyText(text: string): string {
  const trimmed: string = (text || "").trim();

  if (!HTML_PAGE.test(trimmed)) {
    return firstLineOf(trimmed);
  }

  const title: string | undefined = HTML_TITLE.exec(trimmed)?.[1];

  return (
    title !== undefined
      ? title
      : trimmed.replace(HTML_HIDDEN, " ").replace(HTML_TAG, " ")
  )
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

/*
 * Text from an answer with any bearer token, JSON web token or secret of
 * the connection in it taken out. A secret shorter than three characters is
 * no secret worth looking for: it would take out every match of it.
 */
export function redactAnswer(text: string, secrets: Array<string>): string {
  let redacted: string = (text || "")
    .replace(BEARER_TOKEN, `Bearer ${REDACTED_IN_ANSWER}`)
    .replace(JSON_WEB_TOKEN, `$1${REDACTED_IN_ANSWER}`);

  for (const secret of secrets) {
    if (typeof secret === "string" && secret.length >= 3) {
      redacted = redacted.split(secret).join(REDACTED_IN_ANSWER);
    }
  }

  return redacted;
}

// A provider's own error code, when it is one; null otherwise.
export function readErrorCode(value: unknown): string | null {
  const code: string =
    typeof value === "string"
      ? value.trim()
      : typeof value === "number" && Number.isFinite(value)
        ? String(value)
        : "";

  return code && ERROR_CODE.test(code) ? code : null;
}

/*
 * The first of the headers named that holds an ID a provider's support can
 * find the request by; null when none does. Headers are read in the lower
 * case DataSourceHttpFetch gives them.
 */
export function readRequestIdHeader(
  headers: Dictionary<string> | undefined,
  names: Array<string>,
  pattern: RegExp = REQUEST_ID,
): string | null {
  for (const name of names) {
    const value: string = String(headers?.[name] || "").trim();
    const match: RegExpExecArray | null = pattern.exec(value);

    if (match) {
      return match[0];
    }
  }

  return null;
}

// Whether a request ID a provider wrote in its body is one to repeat.
export function isRequestId(value: unknown): value is string {
  return typeof value === "string" && REQUEST_ID.test(value.trim());
}

/*
 * An answer of a data source that is no success: its status, the
 * provider's own error code, the ID its support finds it by and how many
 * times it was asked. The message says what was being read and what the
 * provider answered; reason says only the answer, for a warning that names
 * what it was about itself. Neither ever holds a credential.
 */
export class DataSourceRequestError extends Error {
  public readonly statusCode: number;
  public readonly errorCode: string | null;
  public readonly requestId: string | null;
  public readonly attempts: number;
  public readonly reason: string;

  public constructor(data: {
    message: string;
    reason: string;
    statusCode: number;
    errorCode: string | null;
    requestId: string | null;
    attempts: number;
  }) {
    super(data.message);
    this.reason = data.reason;
    this.statusCode = data.statusCode;
    this.errorCode = data.errorCode;
    this.requestId = data.requestId;
    this.attempts = data.attempts;
  }
}

export interface FailedAnswer {
  // Who answered: "Snowflake", "AWS Glue", "Dataverse".
  provider: string;
  statusCode: number;
  // The provider's own code for the error; null when it gave none.
  errorCode: string | null;
  // What was being read, as a sentence goes on after "while": "listing the tables (SHOW TABLES)".
  operation: string;
  // The provider's own message, its first line; "" when it said nothing.
  message: string;
  attempts: number;
  requestId: string | null;
  // What the ID is called where the provider's support asks for it: "Request ID" unless said.
  requestIdLabel?: string | undefined;
  // Who a 401 or a 403 refused ("the app", "the user"), and what to do about it, when known.
  refused?: { who: string; advice?: string | undefined } | undefined;
  // The connection's secrets, taken out of the provider's message.
  secrets?: Array<string> | undefined;
}

/*
 * What a failed answer says, as a sentence (message) and as the answer
 * alone (reason). A refusal leaves out how many times it was asked and the
 * request ID: asking again changes nothing, and what to do is the person's.
 */
export function describeFailedAnswer(answer: FailedAnswer): {
  message: string;
  reason: string;
} {
  const said: string = asSentence(
    redactAnswer(answer.message || "", answer.secrets || [])
      .slice(0, MAX_PROVIDER_MESSAGE_LENGTH)
      .trim(),
  );
  const isRefusal: boolean =
    answer.statusCode === 401 || answer.statusCode === 403;
  const code: string | null = answer.errorCode;
  const head: string =
    isRefusal && answer.refused
      ? `${answer.provider} refused ${answer.refused.who} (${answer.statusCode}${code ? `, ${code}` : ""})`
      : `${answer.provider} answered ${answer.statusCode}${code ? ` (${code})` : ""}`;
  const tail: string = said
    ? `: ${said}`
    : isRefusal && answer.refused
      ? "."
      : ", with no error message.";
  const read: string = `${head} while ${answer.operation}${tail}`;
  const parts: Array<string> = [];

  if (isRefusal && answer.refused) {
    parts.push(read);

    if (answer.refused.advice) {
      parts.push(answer.refused.advice);
    }
  } else {
    parts.push(withAttempts(read, answer.attempts));

    if (answer.requestId) {
      parts.push(
        `${answer.requestIdLabel || "Request ID"}: ${answer.requestId}.`,
      );
    }
  }

  return { message: parts.join(" "), reason: `${head}${tail}` };
}

/*
 * A request that got no answer at all: the transport threw (a network that
 * failed, a timeout, an address the egress guard refused). Its message is
 * the transport's own, so a caller that reads the message reads it as
 * before; a collector tells it apart from a failure of its own making (a
 * sign-in refused while the request was built) and says what was being
 * read (unreachedError).
 */
export class DataSourceUnreachedError extends Error {
  // What the transport threw.
  public readonly transportError: unknown;

  public constructor(transportError: unknown) {
    super(
      transportError instanceof Error
        ? transportError.message
        : String(transportError ?? ""),
    );
    this.transportError = transportError;
  }
}

// The error a failed answer is, said as describeFailedAnswer says it.
export function failedAnswerError(
  answer: FailedAnswer,
): DataSourceRequestError {
  const described: { message: string; reason: string } =
    describeFailedAnswer(answer);

  return new DataSourceRequestError({
    message: described.message,
    reason: described.reason,
    statusCode: answer.statusCode,
    errorCode: answer.errorCode,
    requestId: answer.requestId,
    attempts: answer.attempts,
  });
}

// The most of a transport's own words an error keeps.
const MAX_TRANSPORT_MESSAGE_LENGTH: number = 200;

// The words of an error a transport threw, without the transport's own prefix.
export function describeTransportError(error: unknown): string {
  const message: string =
    error instanceof Error ? error.message : String(error ?? "");

  return (
    firstLineOf(message.replace(/^Could not reach data source:\s*/i, "")) ||
    "the connection failed"
  );
}

/*
 * A request that got no answer at all - a network that failed, a timeout,
 * an address refused - as an error that says what was being read.
 */
export function unreachedError(data: {
  provider: string;
  operation: string;
  error: unknown;
  secrets?: Array<string> | undefined;
}): Error {
  return new Error(
    `${data.provider} could not be reached while ${data.operation}: ${asSentence(
      redactAnswer(describeTransportError(data.error), data.secrets || [])
        .slice(0, MAX_TRANSPORT_MESSAGE_LENGTH)
        .trim(),
    )}`,
  );
}
