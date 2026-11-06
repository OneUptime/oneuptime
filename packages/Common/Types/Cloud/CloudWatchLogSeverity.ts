/*
 * THE SEVERITY A CLOUDWATCH LOGS LINE SAYS.
 *
 * A log a CloudWatch Logs subscription streams (CloudStream) is a message
 * and a time, and no severity: the stream's ingest reads the one the line
 * itself says, the way the services that write the line say it - or none.
 * Only the start of a line is read, in one pass and without a regular
 * expression: a line comes from outside and may be long.
 *
 *   - a JSON message's "level" (Lambda's JSON log format, most loggers);
 *   - Node.js on Lambda: "<time>\t<request id>\tERROR\t<message>";
 *   - Python on Lambda: "[ERROR]\t<time>\t<request id>\t<message>";
 *   - RDS for PostgreSQL and Aurora PostgreSQL, whose log_line_prefix RDS
 *     fixes ("%t:%r:%u@%d:[%p]:"): "<time> UTC:<client>:<user>@<database>:
 *     [<process>]:ERROR:  <message>". DETAIL, HINT, STATEMENT, CONTEXT and
 *     QUERY lines go with the line before them and say none of their own;
 *   - MySQL and MariaDB on RDS: "<time> <thread> [Warning] [MY-010055]
 *     <message>";
 *   - else a first word that is a level: "ERROR ...", "WARN: ...".
 *
 * Pure: the ingest (CloudWatchLogs) and the offline browser fixtures that
 * show what it stores read the same rule.
 */

export interface CloudWatchLogSeverity {
  // The OTLP severity number: 1-4 trace, 5-8 debug, 9-12 info, 13-16 warn, 17-20 error, 21-24 fatal.
  number: number;
  text: string;
}

const TRACE: CloudWatchLogSeverity = { number: 1, text: "TRACE" };
const DEBUG: CloudWatchLogSeverity = { number: 5, text: "DEBUG" };
const INFO: CloudWatchLogSeverity = { number: 9, text: "INFO" };
const NOTICE: CloudWatchLogSeverity = { number: 10, text: "INFO" };
const WARN: CloudWatchLogSeverity = { number: 13, text: "WARN" };
const ERROR: CloudWatchLogSeverity = { number: 17, text: "ERROR" };
const FATAL: CloudWatchLogSeverity = { number: 21, text: "FATAL" };

const SEVERITIES: ReadonlyMap<string, CloudWatchLogSeverity> = new Map<
  string,
  CloudWatchLogSeverity
>([
  ["trace", TRACE],
  ["debug", DEBUG],
  ["info", INFO],
  ["notice", NOTICE],
  ["warn", WARN],
  ["warning", WARN],
  ["error", ERROR],
  ["err", ERROR],
  ["fatal", FATAL],
  ["critical", FATAL],
]);

// PostgreSQL's message levels (the server's log_min_messages names).
const POSTGRES_LEVELS: ReadonlyMap<string, CloudWatchLogSeverity> = new Map<
  string,
  CloudWatchLogSeverity
>([
  ["debug5", DEBUG],
  ["debug4", DEBUG],
  ["debug3", DEBUG],
  ["debug2", DEBUG],
  ["debug1", DEBUG],
  ["log", INFO],
  ["info", INFO],
  ["notice", NOTICE],
  ["warning", WARN],
  ["error", ERROR],
  ["fatal", FATAL],
  ["panic", FATAL],
]);

// MySQL's and MariaDB's error log levels.
const MYSQL_LEVELS: ReadonlyMap<string, CloudWatchLogSeverity> = new Map<
  string,
  CloudWatchLogSeverity
>([
  ["note", INFO],
  ["system", INFO],
  ["warning", WARN],
  ["error", ERROR],
]);

// The longest JSON message whose level is read: a longer one is not parsed.
export const MAX_JSON_MESSAGE_FOR_LEVEL: number = 64 * 1024;
// How much of a line's start is read for its level.
export const SEVERITY_HEAD_LENGTH: number = 200;
// The longest level word a database's line holds ("WARNING", "DEBUG5").
const MAX_LEVEL_WORD_LENGTH: number = 10;

function severityOfWord(word: string): CloudWatchLogSeverity | null {
  let text: string = word.trim();

  if (text.startsWith("[") && text.endsWith("]")) {
    text = text.slice(1, -1);
  }

  if (text.endsWith(":")) {
    text = text.slice(0, -1);
  }

  return SEVERITIES.get(text.toLowerCase()) || null;
}

// A database's lines start with the time: "2026-11-04 09:59:01 UTC:...".
function startsWithDigit(text: string): boolean {
  const first: string = text.charAt(0);
  return first >= "0" && first <= "9";
}

/*
 * The level after RDS for PostgreSQL's prefix: the word between a "]:"
 * and the ":" after it. The prefix's user@database can itself hold one
 * ("[unknown]@[unknown]:" before the user is known), so each "]:" of the
 * line's start is tried, left to right, each read once.
 */
function readPostgresLevel(head: string): CloudWatchLogSeverity | null {
  if (!startsWithDigit(head)) {
    return null;
  }

  let at: number = head.indexOf("]:");

  while (at !== -1) {
    const start: number = at + 2;
    const end: number = head.indexOf(":", start);

    if (end === -1) {
      return null;
    }

    if (end - start <= MAX_LEVEL_WORD_LENGTH) {
      const level: CloudWatchLogSeverity | undefined = POSTGRES_LEVELS.get(
        head.slice(start, end).toLowerCase(),
      );

      if (level) {
        return level;
      }
    }

    at = head.indexOf("]:", start);
  }

  return null;
}

// The level in brackets after MySQL's and MariaDB's time and thread.
function readMySqlLevel(head: string): CloudWatchLogSeverity | null {
  if (!startsWithDigit(head)) {
    return null;
  }

  const open: number = head.indexOf(" [");

  if (open === -1) {
    return null;
  }

  const close: number = head.indexOf("]", open + 2);

  if (close === -1 || close - open - 2 > MAX_LEVEL_WORD_LENGTH) {
    return null;
  }

  return MYSQL_LEVELS.get(head.slice(open + 2, close).toLowerCase()) || null;
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function inferCloudWatchLogSeverity(
  message: string,
): CloudWatchLogSeverity | null {
  const trimmed: string = message.trimStart();

  if (trimmed.startsWith("{") && trimmed.length <= MAX_JSON_MESSAGE_FOR_LEVEL) {
    try {
      const document: Record<string, unknown> = readObject(JSON.parse(trimmed));

      for (const key of ["level", "severity", "levelname", "log.level"]) {
        const value: unknown = document[key];

        if (typeof value === "string") {
          const severity: CloudWatchLogSeverity | null = severityOfWord(value);

          if (severity) {
            return severity;
          }
        }
      }
    } catch {
      // Not JSON after all: read as text below.
    }
  }

  const head: string = trimmed.slice(0, SEVERITY_HEAD_LENGTH);
  const fields: Array<string> = head.split("\t");

  // Python: "[LEVEL]\t...".
  if (fields.length > 1) {
    const first: CloudWatchLogSeverity | null = severityOfWord(fields[0]!);

    if (first && fields[0]!.trim().startsWith("[")) {
      return first;
    }

    // Node.js: "<time>\t<request id>\t<LEVEL>\t...".
    if (fields.length > 3) {
      const third: CloudWatchLogSeverity | null = severityOfWord(fields[2]!);

      if (third) {
        return third;
      }
    }
  }

  const database: CloudWatchLogSeverity | null =
    readPostgresLevel(head) || readMySqlLevel(head);

  if (database) {
    return database;
  }

  const space: number = head.indexOf(" ");
  const firstWord: string = space > 0 ? head.slice(0, space) : head;

  if (firstWord.length <= MAX_LEVEL_WORD_LENGTH) {
    return severityOfWord(firstWord);
  }

  return null;
}
