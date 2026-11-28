import { readAddressText } from "../ClientAddressTrust";
import { readScrubbedAddress } from "../ScrubbedAddress";

/*
 * READING AN ACCESS LOG BY THE PROJECT'S OWN FORMAT (#11048).
 *
 * A line never says what its fields are, so since #10548 the X-Forwarded-For
 * a combined line ends with is read only when it can be nothing else: the
 * combined format with one quoted field after the user agent, and nothing
 * after it. That left out the formats people run behind a load balancer -
 * one that ends with $request_time, one that puts the header anywhere else.
 *
 * Now a project can give its nginx log_format (Project
 * .securityAccessLogFormat, on Access Logs), and each line is read by it,
 * field by field, so $http_x_forwarded_for is read wherever the format puts
 * it, and nothing else is ever taken for it. A line that does not fit the
 * format is read as it always was.
 *
 * How a line is read, so that nothing a client writes can move a field:
 *
 *   - nginx writes every value with its quotes escaped (escape=default:
 *     `"` is \x22; escape=json: \"). So every quote in a line that no
 *     backslash escapes is one of the format's own. A line with any other
 *     number of them is not in the format - a server that writes values as
 *     sent (escape=none, Express's morgan) lets a request add a quote, and
 *     its line then fits no more. Split at those quotes, each run of the
 *     line is read by the run of the format between the same two quotes.
 *   - Within a run, each field is read from the left while it is followed
 *     by text its value never holds (an address is followed by " - ", which
 *     holds a space no address does), and from the right while it is
 *     preceded by such text; one field left between the two is what is left
 *     between them. A field that can be read neither way - two fields of
 *     free text side by side, a header unquoted beside another - is not
 *     read at all, and a format whose X-Forwarded-For or connection address
 *     is such a field is refused when it is given, with why.
 *   - Each value read is held to what its variable holds: an address is an
 *     address, a status digits, a time a time. A line whose value is not is
 *     not in the format.
 *
 * Read with indexOf and lastIndexOf over bounded text, never a regular
 * expression with a repeat: these are lines anybody can write into a log.
 */

// The longest format read: nginx's main format is about 170 characters.
export const MAX_ACCESS_LOG_FORMAT_LENGTH: number = 4096;

// The variables a line is read for, by their nginx names.
export const ACCESS_LOG_VARIABLES: {
  connection: string;
  realConnection: string;
  forwardedFor: string;
  request: string;
  method: string;
  target: string;
  status: string;
  bodySize: string;
  userAgent: string;
  contentType: string;
} = {
  // The address that connected - or, with nginx's realip module, the one it worked out.
  connection: "remote_addr",
  // With the realip module, the address that really connected.
  realConnection: "realip_remote_addr",
  forwardedFor: "http_x_forwarded_for",
  request: "request",
  method: "request_method",
  target: "request_uri",
  status: "status",
  bodySize: "body_bytes_sent",
  userAgent: "http_user_agent",
  contentType: "sent_http_content_type",
};

// How nginx escapes the values it writes (log_format's escape= parameter).
export enum AccessLogEscape {
  Default = "default",
  Json = "json",
  None = "none",
}

// What a variable's value may hold, as nginx writes it.
enum ValueClass {
  // An address, "-", or what a scrub rule left of one: no space, no quote.
  Address = "address",
  // A count: digits, or "-".
  Digits = "digits",
  // A duration or a time in seconds: digits and a point, or "-".
  Number = "number",
  // $time_local: "10/Oct/2026:13:55:36 +0000".
  TimeLocal = "time-local",
  // One word: no space, no quote.
  Word = "word",
  // Anything but a quote: what a client wrote, or nobody knows.
  Text = "text",
}

const VARIABLE_CLASSES: Readonly<Record<string, ValueClass>> = {
  remote_addr: ValueClass.Address,
  realip_remote_addr: ValueClass.Address,
  server_addr: ValueClass.Address,
  proxy_protocol_addr: ValueClass.Address,
  proxy_protocol_server_addr: ValueClass.Address,
  status: ValueClass.Digits,
  body_bytes_sent: ValueClass.Digits,
  bytes_sent: ValueClass.Digits,
  request_length: ValueClass.Digits,
  connection: ValueClass.Digits,
  connection_requests: ValueClass.Digits,
  pid: ValueClass.Digits,
  remote_port: ValueClass.Digits,
  server_port: ValueClass.Digits,
  realip_remote_port: ValueClass.Digits,
  proxy_protocol_port: ValueClass.Digits,
  request_time: ValueClass.Number,
  msec: ValueClass.Number,
  gzip_ratio: ValueClass.Number,
  time_local: ValueClass.TimeLocal,
  time_iso8601: ValueClass.Word,
  request_method: ValueClass.Word,
  server_protocol: ValueClass.Word,
  scheme: ValueClass.Word,
  request_id: ValueClass.Word,
  pipe: ValueClass.Word,
  https: ValueClass.Word,
};

function classOf(name: string): ValueClass {
  return Object.prototype.hasOwnProperty.call(VARIABLE_CLASSES, name)
    ? VARIABLE_CLASSES[name]!
    : ValueClass.Text;
}

function isDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function isLetter(character: string): boolean {
  return (
    (character >= "a" && character <= "z") ||
    (character >= "A" && character <= "Z")
  );
}

// Whether a value of `valueClass` may hold `character` - what decides where a field ends.
function mayHold(valueClass: ValueClass, character: string): boolean {
  if (character === '"') {
    return false;
  }

  switch (valueClass) {
    case ValueClass.Address:
      return (
        isDigit(character) ||
        isLetter(character) ||
        ".:-%_[]*".includes(character)
      );
    case ValueClass.Digits:
      return isDigit(character) || character === "-";
    case ValueClass.Number:
      return isDigit(character) || character === "." || character === "-";
    case ValueClass.TimeLocal:
      return (
        isDigit(character) || isLetter(character) || "/:+- ".includes(character)
      );
    case ValueClass.Word:
      return character !== " " && character !== "\t";
    case ValueClass.Text:
      return true;
  }
}

function holdsOnly(
  value: string,
  test: (character: string) => boolean,
): boolean {
  for (const character of value) {
    if (!test(character)) {
      return false;
    }
  }

  return true;
}

// "10/Oct/2026:13:55:36 +0000", and nothing else.
function isTimeLocal(value: string): boolean {
  if (value.length !== 26) {
    return false;
  }

  const shape: string = "00/Aaa/0000:00:00:00 +0000";

  for (let index: number = 0; index < shape.length; index++) {
    const expected: string = shape[index]!;
    const character: string = value[index]!;

    if (expected === "0" && !isDigit(character)) {
      return false;
    }

    if (expected === "A" || expected === "a") {
      if (!isLetter(character)) {
        return false;
      }
    } else if (expected === "+") {
      if (character !== "+" && character !== "-") {
        return false;
      }
    } else if (expected !== "0" && character !== expected) {
      return false;
    }
  }

  return true;
}

// Whether a value read for a variable is one it holds: else the line is not in the format.
function isValueOf(valueClass: ValueClass, value: string): boolean {
  if (value === "-") {
    return true;
  }

  switch (valueClass) {
    case ValueClass.Address:
      return (
        Boolean(readAddressText(value)) ||
        value === "unix:" ||
        Boolean(readScrubbedAddress(value))
      );
    case ValueClass.Digits:
      return value.length > 0 && holdsOnly(value, isDigit);
    case ValueClass.Number: {
      if (!value || value.startsWith(".") || value.endsWith(".")) {
        return false;
      }

      return (
        holdsOnly(value, (character: string): boolean => {
          return isDigit(character) || character === ".";
        }) && value.indexOf(".") === value.lastIndexOf(".")
      );
    }
    case ValueClass.TimeLocal:
      return isTimeLocal(value);
    case ValueClass.Word:
      return (
        value.length > 0 &&
        holdsOnly(value, (character: string): boolean => {
          return mayHold(ValueClass.Word, character);
        })
      );
    case ValueClass.Text:
      return true;
  }
}

interface FormatVariable {
  name: string;
  valueClass: ValueClass;
}

/*
 * One run of the format between two of its quotes: its literals around its
 * variables, literals[i] before variables[i] - one more literal than
 * variables, each '' where two parts meet.
 */
interface FormatRun {
  literals: Array<string>;
  variables: Array<FormatVariable>;
}

export interface AccessLogFormat {
  // The format's string, as nginx joins the parts of its log_format.
  pattern: string;
  escape: AccessLogEscape;
  runs: Array<FormatRun>;
  // Where a line's connection address is read: $realip_remote_addr when the format logs it.
  connectionVariable: string;
  // Whether the format logs X-Forwarded-For.
  readsForwardedFor: boolean;
}

export enum AccessLogFormatProblemKind {
  // Longer than MAX_ACCESS_LOG_FORMAT_LENGTH.
  TooLong = "too-long",
  // A quote of the log_format that never closes.
  NotClosed = "not-closed",
  // No variable at all: no log format.
  NoField = "no-field",
  // Neither $remote_addr nor $realip_remote_addr: nothing says whether a proxy connected.
  NoConnectionAddress = "no-connection-address",
  // A field whose end can never be told: the connection's address, or X-Forwarded-For.
  UnclearField = "unclear-field",
}

export type AccessLogFormatProblem =
  | { kind: AccessLogFormatProblemKind.TooLong; max: number }
  | { kind: AccessLogFormatProblemKind.NotClosed }
  | { kind: AccessLogFormatProblemKind.NoField }
  | { kind: AccessLogFormatProblemKind.NoConnectionAddress }
  | { kind: AccessLogFormatProblemKind.UnclearField; variable: string };

export interface AccessLogFormatReading {
  format: AccessLogFormat | null;
  problem: AccessLogFormatProblem | null;
}

/*
 * ---------------------------------------------------------------------------
 * Reading what a person gave
 * ---------------------------------------------------------------------------
 */

interface DirectiveWord {
  value: string;
  isQuoted: boolean;
}

function isSpace(character: string): boolean {
  return (
    character === " " ||
    character === "\t" ||
    character === "\n" ||
    character === "\r"
  );
}

/*
 * The words of an nginx directive, as nginx reads them: a quoted string -
 * '...' or "..." - is one word, its backslash escapes read (\" \' \\ \n \t
 * \r); anything else runs to a space, a ";" or a quote. A "#" starts a
 * comment to the end of its line. Null when a quote never closes.
 */
function readDirectiveWords(text: string): Array<DirectiveWord> | null {
  const words: Array<DirectiveWord> = [];
  let index: number = 0;

  while (index < text.length) {
    const character: string = text[index]!;

    if (isSpace(character)) {
      index++;
      continue;
    }

    if (character === "#") {
      const end: number = text.indexOf("\n", index);
      index = end === -1 ? text.length : end + 1;
      continue;
    }

    if (character === ";") {
      words.push({ value: ";", isQuoted: false });
      index++;
      continue;
    }

    if (character === "'" || character === '"') {
      let value: string = "";
      let closed: boolean = false;

      for (index = index + 1; index < text.length; index++) {
        const inner: string = text[index]!;

        if (inner === "\\" && index + 1 < text.length) {
          const next: string = text[index + 1]!;
          const escaped: Record<string, string> = {
            '"': '"',
            "'": "'",
            "\\": "\\",
            n: "\n",
            t: "\t",
            r: "\r",
          };

          value += Object.prototype.hasOwnProperty.call(escaped, next)
            ? escaped[next]
            : `\\${next}`;
          index++;
          continue;
        }

        if (inner === character) {
          closed = true;
          index++;
          break;
        }

        value += inner;
      }

      if (!closed) {
        return null;
      }

      words.push({ value, isQuoted: true });
      continue;
    }

    let value: string = "";

    while (
      index < text.length &&
      !isSpace(text[index]!) &&
      text[index] !== ";" &&
      text[index] !== "'" &&
      text[index] !== '"'
    ) {
      value += text[index];
      index++;
    }

    words.push({ value, isQuoted: false });
  }

  return words;
}

function readEscape(word: string): AccessLogEscape | null {
  if (!word.startsWith("escape=")) {
    return null;
  }

  switch (word.slice("escape=".length)) {
    case "json":
      return AccessLogEscape.Json;
    case "none":
      return AccessLogEscape.None;
    default:
      return AccessLogEscape.Default;
  }
}

/*
 * The format's string and how its values are escaped, from what a person
 * gave: a log_format directive, as nginx.conf writes it; ingress-nginx's
 * log-format-upstream, as its ConfigMap writes it; the directive's quoted
 * strings alone; or the format as a line of text. Null when a quote of a
 * directive never closes.
 */
function readPattern(
  text: string,
): { pattern: string; escape: AccessLogEscape } | null {
  // A comment line pasted with the directive is no part of it.
  let source: string = text
    .split("\n")
    .filter((line: string): boolean => {
      return !line.trim().startsWith("#");
    })
    .join("\n")
    .trim();
  let escape: AccessLogEscape = AccessLogEscape.Default;

  // ingress-nginx's ConfigMap key, before its value.
  const configMapKey: string = "log-format-upstream:";

  if (source.startsWith(configMapKey)) {
    source = source.slice(configMapKey.length).trim();
  }

  const isDirective: boolean =
    source.startsWith("log_format") &&
    (source.length === "log_format".length ||
      isSpace(source["log_format".length]!));

  if (isDirective || source.startsWith("'") || source.startsWith('"')) {
    const words: Array<DirectiveWord> | null = readDirectiveWords(source);

    if (!words) {
      return null;
    }

    // `log_format <name> [escape=...] <string>...;`
    let rest: Array<DirectiveWord> = isDirective ? words.slice(2) : words;
    const end: number = rest.findIndex((word: DirectiveWord): boolean => {
      return !word.isQuoted && word.value === ";";
    });

    if (end !== -1) {
      rest = rest.slice(0, end);
    }

    const parts: Array<string> = [];

    for (const word of rest) {
      const wordEscape: AccessLogEscape | null = word.isQuoted
        ? null
        : readEscape(word.value);

      if (wordEscape) {
        escape = wordEscape;
      } else {
        parts.push(word.value);
      }
    }

    /*
     * Quoted strings alone are the directive's parts. Text that starts
     * with a quote and goes on unquoted is a format of its own, as typed.
     */
    if (
      isDirective ||
      rest.every((word: DirectiveWord): boolean => {
        return word.isQuoted || readEscape(word.value) !== null;
      })
    ) {
      return { pattern: parts.join(""), escape };
    }
  }

  // A format typed on several lines is one line of a log.
  return {
    pattern: source.split("\r").join("").split("\n").join(" ").trim(),
    escape,
  };
}

function isNameCharacter(character: string | undefined): boolean {
  return (
    character !== undefined &&
    (isLetter(character) || isDigit(character) || character === "_")
  );
}

// The format's string as runs of literals and variables, split at its quotes.
function readRuns(pattern: string): Array<FormatRun> {
  const runs: Array<FormatRun> = [{ literals: [""], variables: [] }];
  const run: () => FormatRun = (): FormatRun => {
    return runs[runs.length - 1]!;
  };
  const addLiteral: (character: string) => void = (character: string): void => {
    const current: FormatRun = run();

    if (character === '"') {
      runs.push({ literals: [""], variables: [] });
      return;
    }

    current.literals[current.literals.length - 1] += character;
  };

  let index: number = 0;

  while (index < pattern.length) {
    const character: string = pattern[index]!;

    if (character === "$") {
      let name: string = "";
      let after: number = index + 1;

      if (pattern[after] === "{") {
        const close: number = pattern.indexOf("}", after + 1);
        const braced: string =
          close === -1 ? "" : pattern.slice(after + 1, close);

        if (braced && holdsOnly(braced, isNameCharacter)) {
          name = braced;
          after = close + 1;
        }
      } else {
        while (isNameCharacter(pattern[after])) {
          name += pattern[after];
          after++;
        }
      }

      if (name) {
        const current: FormatRun = run();
        const lower: string = name.toLowerCase();

        current.variables.push({ name: lower, valueClass: classOf(lower) });
        current.literals.push("");
        index = after;
        continue;
      }
    }

    addLiteral(character);
    index++;
  }

  // A line's text is read trimmed, so the format is too.
  const first: FormatRun = runs[0]!;
  const last: FormatRun = runs[runs.length - 1]!;

  first.literals[0] = first.literals[0]!.trimStart();
  last.literals[last.literals.length - 1] =
    last.literals[last.literals.length - 1]!.trimEnd();

  return runs;
}

/*
 * Which variables of a run every line resolves, and how: from the left while
 * a field is followed by text whose first character its value never holds,
 * from the right while it is preceded by text whose last character its value
 * never holds, and one field left between the two. The same for every line,
 * so a format is judged once, when it is given.
 */
function resolvableVariables(run: FormatRun): Set<number> {
  const resolved: Set<number> = new Set<number>();
  const count: number = run.variables.length;
  let left: number = 0;

  while (left < count - 1) {
    const separator: string = run.literals[left + 1]!;

    if (!separator || mayHold(run.variables[left]!.valueClass, separator[0]!)) {
      break;
    }

    resolved.add(left);
    left++;
  }

  let right: number = count - 1;

  while (right > left) {
    const separator: string = run.literals[right]!;

    if (
      !separator ||
      mayHold(
        run.variables[right]!.valueClass,
        separator[separator.length - 1]!,
      )
    ) {
      break;
    }

    resolved.add(right);
    right--;
  }

  if (right === left && count > 0) {
    resolved.add(left);
  }

  return resolved;
}

function isResolvable(runs: Array<FormatRun>, name: string): boolean {
  return runs.some((run: FormatRun): boolean => {
    const resolved: Set<number> = resolvableVariables(run);

    return run.variables.some(
      (variable: FormatVariable, index: number): boolean => {
        return variable.name === name && resolved.has(index);
      },
    );
  });
}

function logs(runs: Array<FormatRun>, name: string): boolean {
  return runs.some((run: FormatRun): boolean => {
    return run.variables.some((variable: FormatVariable): boolean => {
      return variable.name === name;
    });
  });
}

/*
 * What a person gave, read as an access log format, or the problem that
 * keeps it from being one: nothing given is no format, and no problem.
 */
export function readAccessLogFormat(
  text: string | undefined | null,
): AccessLogFormatReading {
  const given: string = (text || "").trim();

  if (!given) {
    return { format: null, problem: null };
  }

  if (given.length > MAX_ACCESS_LOG_FORMAT_LENGTH) {
    return {
      format: null,
      problem: {
        kind: AccessLogFormatProblemKind.TooLong,
        max: MAX_ACCESS_LOG_FORMAT_LENGTH,
      },
    };
  }

  const read: { pattern: string; escape: AccessLogEscape } | null =
    readPattern(given);

  if (!read) {
    return {
      format: null,
      problem: { kind: AccessLogFormatProblemKind.NotClosed },
    };
  }

  const runs: Array<FormatRun> = readRuns(read.pattern);

  if (
    !runs.some((run: FormatRun): boolean => {
      return run.variables.length > 0;
    })
  ) {
    return {
      format: null,
      problem: { kind: AccessLogFormatProblemKind.NoField },
    };
  }

  const connectionVariable: string | null = logs(
    runs,
    ACCESS_LOG_VARIABLES.realConnection,
  )
    ? ACCESS_LOG_VARIABLES.realConnection
    : logs(runs, ACCESS_LOG_VARIABLES.connection)
      ? ACCESS_LOG_VARIABLES.connection
      : null;

  if (!connectionVariable) {
    return {
      format: null,
      problem: { kind: AccessLogFormatProblemKind.NoConnectionAddress },
    };
  }

  const readsForwardedFor: boolean = logs(
    runs,
    ACCESS_LOG_VARIABLES.forwardedFor,
  );

  for (const name of [
    connectionVariable,
    ...(readsForwardedFor ? [ACCESS_LOG_VARIABLES.forwardedFor] : []),
  ]) {
    if (!isResolvable(runs, name)) {
      return {
        format: null,
        problem: {
          kind: AccessLogFormatProblemKind.UnclearField,
          variable: name,
        },
      };
    }
  }

  return {
    format: {
      pattern: read.pattern,
      escape: read.escape,
      runs,
      connectionVariable,
      readsForwardedFor,
    },
    problem: null,
  };
}

// Why a format cannot be kept, in English, for the server's refusal; null when it can.
export function getAccessLogFormatError(
  text: string | undefined | null,
): string | null {
  const problem: AccessLogFormatProblem | null =
    readAccessLogFormat(text).problem;

  if (!problem) {
    return null;
  }

  switch (problem.kind) {
    case AccessLogFormatProblemKind.TooLong:
      return `Your log format is too long. OneUptime reads one of up to ${problem.max} characters.`;
    case AccessLogFormatProblemKind.NotClosed:
      return "A quote in your log format never closes. Paste it as your nginx.conf writes it.";
    case AccessLogFormatProblemKind.NoField:
      return "This is no nginx log format: it names no field, such as $remote_addr.";
    case AccessLogFormatProblemKind.NoConnectionAddress:
      return "Your log format must log the address that connected, $remote_addr, so OneUptime can tell whether it was a proxy you trust.";
    case AccessLogFormatProblemKind.UnclearField:
      return `OneUptime can't tell where $${problem.variable} ends in your log format. Put it in quotes, as "$${problem.variable}".`;
  }
}

/*
 * ---------------------------------------------------------------------------
 * Reading a line
 * ---------------------------------------------------------------------------
 */

/*
 * The line with every quote and backslash a backslash escapes - JSON's \"
 * and \\ - put out of reach, the same length, so a field's ends are found
 * where the format's own quotes are.
 */
function maskJsonEscapes(line: string): string {
  let masked: string = "";

  for (let index: number = 0; index < line.length; index++) {
    if (line[index] === "\\" && index + 1 < line.length) {
      masked += "\u0001\u0001";
      index++;
      continue;
    }

    masked += line[index];
  }

  return masked;
}

/*
 * One run of the line, between [start, end) of `masked`, read by one run
 * of the format: each variable's value, by its index, as `line` holds it;
 * null when the run does not fit.
 */
function readRun(data: {
  line: string;
  masked: string;
  start: number;
  end: number;
  run: FormatRun;
}): Map<number, string> | null {
  const { masked, run } = data;
  const literals: Array<string> = run.literals;
  const count: number = run.variables.length;
  const leading: string = literals[0]!;
  const trailing: string = literals[count]!;
  const text: string = masked.slice(data.start, data.end);

  if (!text.startsWith(leading) || !text.endsWith(trailing)) {
    return null;
  }

  if (count === 0) {
    return text === leading ? new Map<number, string>() : null;
  }

  const first: number = leading.length;
  const last: number = text.length - trailing.length;

  if (first > last) {
    return null;
  }

  const spans: Map<number, [number, number]> = new Map<
    number,
    [number, number]
  >();
  let position: number = first;
  let left: number = 0;

  while (left < count - 1) {
    const separator: string = literals[left + 1]!;

    if (!separator || mayHold(run.variables[left]!.valueClass, separator[0]!)) {
      break;
    }

    const at: number = text.indexOf(separator, position);

    if (at === -1 || at > last) {
      return null;
    }

    spans.set(left, [position, at]);
    position = at + separator.length;
    left++;
  }

  let end: number = last;
  let right: number = count - 1;

  while (right > left) {
    const separator: string = literals[right]!;

    if (
      !separator ||
      mayHold(
        run.variables[right]!.valueClass,
        separator[separator.length - 1]!,
      )
    ) {
      break;
    }

    const at: number = text.lastIndexOf(separator, end - separator.length);

    if (at === -1 || at < position) {
      return null;
    }

    spans.set(right, [at + separator.length, end]);
    end = at;
    right--;
  }

  if (right === left) {
    if (position > end) {
      return null;
    }

    spans.set(left, [position, end]);
  }

  const values: Map<number, string> = new Map<number, string>();

  for (const [index, [from, to]] of spans) {
    const value: string = data.line.slice(data.start + from, data.start + to);

    if (!isValueOf(run.variables[index]!.valueClass, value)) {
      return null;
    }

    values.set(index, value);
  }

  return values;
}

/*
 * A line's fields, by variable, as the format writes them; null for a line
 * that is not in the format. A field that can never be told apart from the
 * fields beside it is left out, never guessed at.
 */
export function readAccessLogFields(
  line: string,
  format: AccessLogFormat,
): Map<string, string> | null {
  const text: string = line.trim();
  const masked: string =
    format.escape === AccessLogEscape.Json ? maskJsonEscapes(text) : text;
  const quotes: Array<number> = [];

  for (
    let at: number = masked.indexOf('"');
    at !== -1;
    at = masked.indexOf('"', at + 1)
  ) {
    quotes.push(at);

    if (quotes.length >= format.runs.length) {
      return null;
    }
  }

  if (quotes.length !== format.runs.length - 1) {
    return null;
  }

  const fields: Map<string, string> = new Map<string, string>();
  let start: number = 0;

  for (let index: number = 0; index < format.runs.length; index++) {
    const end: number = index < quotes.length ? quotes[index]! : text.length;
    const run: FormatRun = format.runs[index]!;
    const values: Map<number, string> | null = readRun({
      line: text,
      masked,
      start,
      end,
      run,
    });

    if (!values) {
      return null;
    }

    for (const [variable, value] of values) {
      const name: string = run.variables[variable]!.name;
      const before: string | undefined = fields.get(name);

      // A variable logged twice holds one value: two are no line of the format.
      if (before !== undefined && before !== value) {
        return null;
      }

      fields.set(name, value);
    }

    start = end + 1;
  }

  return fields;
}

/*
 * ---------------------------------------------------------------------------
 * Formats people run
 * ---------------------------------------------------------------------------
 */

export interface KnownAccessLogFormat {
  key: string;
  // As the software that writes it names it.
  name: string;
  // The log_format, as its configuration writes it.
  text: string;
}

export const KNOWN_ACCESS_LOG_FORMATS: ReadonlyArray<KnownAccessLogFormat> = [
  {
    key: "nginx-main",
    name: "nginx main",
    // nginx's own nginx.conf, as nginx.org's packages and its Docker image ship it.
    text: [
      "log_format main '$remote_addr - $remote_user [$time_local] \"$request\" '",
      "                '$status $body_bytes_sent \"$http_referer\" '",
      '                \'"$http_user_agent" "$http_x_forwarded_for"\';',
    ].join("\n"),
  },
  {
    key: "ingress-nginx-upstreaminfo",
    name: "ingress-nginx upstreaminfo",
    // ingress-nginx's default log-format-upstream, which logs no X-Forwarded-For.
    text: [
      "log_format upstreaminfo '$remote_addr - $remote_user [$time_local] \"$request\" '",
      '    \'$status $body_bytes_sent "$http_referer" "$http_user_agent" \'',
      "    '$request_length $request_time [$proxy_upstream_name] [$proxy_alternative_upstream_name] $upstream_addr '",
      "    '$upstream_response_length $upstream_response_time $upstream_status $req_id';",
    ].join("\n"),
  },
];
