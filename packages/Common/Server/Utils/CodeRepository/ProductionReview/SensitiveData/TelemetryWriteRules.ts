import {
  PRODUCTION_REVIEW_LEAK_CHECK_IDS,
  SECRETS_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID,
  SENSITIVE_DATA_LIMITS,
  SENSITIVE_DATA_TO_AI_CHECK_ID,
  SensitiveDataLeakKind,
  SensitiveDataSink,
} from "../../../../../Types/CodeRepository/ProductionReviewSensitiveData";
import DataSensitivity from "../../../../../Types/DataSecurity/DataSensitivity";
import { getBuiltInDataType } from "../../../../../Types/DataSecurity/DataTypeCatalog";
import {
  CodeLanguage,
  CodeToken,
  CodeTokenKind,
  getCodeLanguage,
  lastPartOf,
  receiverOf,
  tokenize,
} from "./SensitiveDataCode";
import { SensitiveDataCandidate } from "./SensitiveDataCandidate";
import {
  highestSensitivity,
  isAnySecret,
  NamedDataType,
  SensitiveNameMatcher,
} from "./SensitiveDataNames";
import {
  extensionOf,
  isMarkedNotSensitive,
  PatchLine,
  PatchLineKind,
  readNewLines,
} from "./SensitiveDataPatch";
import { describeDataType } from "./SensitiveDataWords";

/*
 * CODE THAT WRITES SENSITIVE DATA TO TELEMETRY (#10376).
 *
 * The lines a pull request adds to a service's code are read for four
 * kinds of call, in every language a service is written in:
 *
 *   - a log call: `logger.info`, `log.Printf`, `console.error`,
 *     `_logger.LogInformation`, `Logger.info`, `info!`;
 *   - a span's or an event's attribute, a tag, the user on a trace:
 *     `span.setAttribute`, `attribute.String`, `Sentry.setUser`;
 *   - a metric's label: `counter.add(1, {...})`, `.labels(...)`,
 *     `WithLabelValues`;
 *   - a prompt sent to an AI provider: `chat.completions.create`,
 *     `messages.create`, `generateText`, `llm.invoke`.
 *
 * What each is handed is read (SensitiveDataCode): the names it is
 * handed, the keys they go in under, and what its strings interpolate. A
 * name or a key that a data type's hints point at (SensitiveNameMatcher)
 * is a candidate, and so is a whole request body, its headers or cookies,
 * or a whole user record. What is no leak is left out here already:
 *
 *   - a value passed through a function that hashes, masks or redacts it
 *     (`hash(email)`, `redact(token)`) - what is written is no longer it;
 *   - a key whose value is a literal, or plainly another thing (`{ email:
 *     user.id }`, `{ email: "redacted" }`): a key that only names a field;
 *   - a value only asked about (`!!email`, `email === undefined`);
 *   - a line marked `oneuptime:not-sensitive`.
 *
 * A candidate holds where production would keep what the line writes
 * (`location`), so what production's telemetry already holds there can be
 * named beside it.
 */

// The lines of one call's arguments read, and of a prompt's.
const MAX_CALL_LINES: number = 20;
const MAX_PROMPT_CALL_LINES: number = 40;

// The lines of one file read for calls.
const MAX_LINES_READ: number = 4000;

// The methods a log call is made with, lower case.
const LOG_METHODS: ReadonlySet<string> = new Set<string>([
  "info",
  "debug",
  "warn",
  "warning",
  "error",
  "fatal",
  "trace",
  "log",
  "critical",
  "crit",
  "exception",
  "notice",
  "verbose",
  "silly",
  "emerg",
  "alert",
  "infof",
  "debugf",
  "warnf",
  "warningf",
  "errorf",
  "fatalf",
  "tracef",
  "printf",
  "println",
  "print",
  "infow",
  "debugw",
  "warnw",
  "errorw",
  "fatalw",
  "loginformation",
  "logdebug",
  "logwarning",
  "logerror",
  "logcritical",
  "logtrace",
  "information",
]);

// What a log call's receiver is called, lower case.
const LOG_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "log",
  "logger",
  "logging",
  "console",
  "slog",
  "zap",
  "zlog",
  "zerolog",
  "logrus",
  "winston",
  "pino",
  "bunyan",
  "structlog",
  "loguru",
  "logr",
  "klog",
  "glog",
  "seelog",
  "log4j",
  "log4js",
  "timber",
  "napier",
  "spdlog",
]);

// The macros of Rust's log and tracing crates, and Elixir's Logger's functions.
const LOG_MACROS: ReadonlySet<string> = new Set<string>([
  "info",
  "debug",
  "warn",
  "error",
  "trace",
  "event",
]);

// A span's, an event's or a trace's setters, lower case.
const SPAN_METHODS: ReadonlySet<string> = new Set<string>([
  "setattribute",
  "setattributes",
  "set_attribute",
  "set_attributes",
  "addevent",
  "add_event",
  "settag",
  "settags",
  "set_tag",
  "set_tags",
  "setuser",
  "set_user",
  "setcontext",
  "set_context",
  "setextra",
  "setextras",
  "set_extra",
  "startspan",
  "startactivespan",
  "start_span",
  "start_as_current_span",
  "withattributes",
]);

// OpenTelemetry Go's attribute constructors: attribute.String("key", value).
const ATTRIBUTE_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "attribute",
  "semconv",
  "tag",
]);

// A metric's recorders, lower case: read only on a receiver named as a metric.
const METRIC_METHODS: ReadonlySet<string> = new Set<string>([
  "add",
  "record",
  "inc",
  "increment",
  "dec",
  "decrement",
  "observe",
  "set",
  "with",
  "histogram",
  "gauge",
  "distribution",
  "timing",
  "count",
  "mark",
]);

// A metric's labels, whatever the receiver is called: Prometheus's.
const METRIC_LABEL_METHODS: ReadonlySet<string> = new Set<string>([
  "labels",
  "withlabelvalues",
]);

// What a metric's receiver ends with, lower case.
const METRIC_RECEIVER_ENDINGS: ReadonlyArray<string> = [
  "counter",
  "histogram",
  "gauge",
  "meter",
  "metric",
  "metrics",
  "statsd",
  "summary",
  "timer",
  "recorder",
  "instrument",
];

// The calls that send a prompt to an AI provider, by their last part, lower case.
const AI_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "generatetext",
  "streamtext",
  "generateobject",
  "streamobject",
  "generate_content",
  "generatecontent",
  "generate_content_async",
  "invoke_model",
  "invokemodel",
  "invokemodelcommand",
  "conversecommand",
  "converse",
  "createchatcompletion",
  "createcompletion",
]);

// The receivers of `create` that send a prompt: OpenAI's and Anthropic's clients.
const AI_CREATE_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "completions",
  "messages",
  "responses",
  "chatcompletion",
  "completion",
]);

// A chain's or a model's methods that send it a prompt, on a receiver named as one.
const AI_INVOKE_METHODS: ReadonlySet<string> = new Set<string>([
  "invoke",
  "ainvoke",
  "stream",
  "astream",
  "predict",
  "apredict",
  "chat",
  "complete",
  "generate",
]);

const AI_INVOKE_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "llm",
  "model",
  "chain",
  "chat",
  "agent",
  "chatmodel",
  "chat_model",
  "llmchain",
  "llm_chain",
  "openai",
  "anthropic",
  "ollama",
  "gemini",
  "mistral",
  "cohere",
  "claude",
  "gpt",
]);

/*
 * The words of a function's name that say it changes a value into one
 * that is no longer it: a hash, a mask, a redaction.
 */
const TRANSFORM_WORDS: ReadonlySet<string> = new Set<string>([
  "hash",
  "hashed",
  "sha",
  "sha1",
  "sha256",
  "sha512",
  "md5",
  "hmac",
  "digest",
  "redact",
  "redacted",
  "mask",
  "masked",
  "scrub",
  "scrubbed",
  "sanitize",
  "sanitise",
  "sanitized",
  "anonymize",
  "anonymise",
  "anonymized",
  "pseudonymize",
  "pseudonymise",
  "obfuscate",
  "obfuscated",
  "encrypt",
  "encrypted",
  "tokenize",
  "tokenise",
  "truncate",
  "len",
  "length",
  "count",
  "size",
  "bool",
  "boolean",
  "isset",
  "empty",
  "exists",
  "typeof",
]);

/*
 * The words of a function's name that write a whole object out: what it
 * is handed is written whole, every field of it.
 */
const SERIALIZER_CALLS: ReadonlySet<string> = new Set<string>([
  "json.stringify",
  "json.dumps",
  "util.inspect",
  "inspect",
  "vars",
  "asdict",
  "dataclasses.asdict",
  "dict",
  "jsonify",
  "json.marshal",
  "serialize",
]);

// Methods that write their receiver out whole: user.toJSON().
const SERIALIZER_METHODS: ReadonlySet<string> = new Set<string>([
  "tojson",
  "to_json",
  "to_dict",
  "todict",
  "model_dump",
  "dict",
  "serialize",
  "as_json",
  "attributes",
  "inspect",
]);

// The keys a log call wraps its fields in, which are no part of where they land.
const WRAPPER_KEYS: ReadonlySet<string> = new Set<string>([
  "extra",
  "fields",
  "attributes",
  "attrs",
  "labels",
  "tags",
  "meta",
  "metadata",
  "context",
  "data",
  "properties",
  "props",
]);

/*
 * A value's last word that says it is plainly another thing than the data
 * its key names: `{ email: user.id }` writes an id.
 */
const OTHER_THING_VALUE_WORDS: ReadonlySet<string> = new Set<string>([
  "id",
  "ids",
  "uuid",
  "guid",
  "count",
  "length",
  "len",
  "size",
  "status",
  "state",
  "type",
  "kind",
  "enabled",
  "exists",
  "present",
  "verified",
  "valid",
  "domain",
  "provider",
  "source",
  "format",
  "hash",
  "digest",
  "masked",
  "redacted",
  "total",
  "at",
]);

// A whole request body, as a framework names it, lower case.
const REQUEST_BODIES: ReadonlySet<string> = new Set<string>([
  "req.body",
  "request.body",
  "ctx.request.body",
  "ctx.req.body",
  "context.request.body",
  "event.body",
  "request.json",
  "request.get_json",
  "request.data",
  "request.post",
  "request.form",
  "request.values",
  "request.all",
  "request.input",
  "request.raw_post_data",
  "request.params",
  "req.rawbody",
  "request.rawbody",
]);

// A request's headers, whose authorization header and cookies are secrets.
const REQUEST_HEADERS: ReadonlySet<string> = new Set<string>([
  "req.headers",
  "request.headers",
  "ctx.headers",
  "ctx.request.headers",
  "ctx.req.headers",
  "context.request.headers",
  "event.headers",
  "request.meta",
  "request.header",
  "req.header",
]);

const REQUEST_COOKIES: ReadonlySet<string> = new Set<string>([
  "req.cookies",
  "request.cookies",
  "ctx.cookies",
  "ctx.request.cookies",
  "event.cookies",
]);

/*
 * A record of a person, by its name, written whole. A bare `user` is one
 * only where it is written out whole on purpose (serialized, spread): it
 * is as often a user's name or id.
 */
const PERSON_RECORDS: ReadonlySet<string> = new Set<string>([
  "currentuser",
  "current_user",
  "req.user",
  "request.user",
  "ctx.state.user",
  "ctx.user",
  "customer",
  "patient",
  "cardholder",
  "employee",
  "applicant",
]);

const PERSON_RECORDS_WHEN_WRITTEN_WHOLE: ReadonlySet<string> = new Set<string>([
  "user",
  "account",
  "profile",
  "person",
  "member",
  "contact",
  "subscriber",
]);

export enum WholeObjectKind {
  Body = "Body",
  Headers = "Headers",
  Cookies = "Cookies",
  Record = "Record",
}

// One thing a call is handed, as the rules read it.
export interface WrittenValue {
  // The key it is written under, as written ("user.email"), its path included.
  key: string | null;
  // The name chain of the value ("user.email"), when it is one.
  chain: string | null;
  // Which line of the read lines it is on.
  line: number;
  // Interpolated into a string: the log's message, the prompt's text.
  isInString: boolean;
  whole: WholeObjectKind | null;
}

// A call to a sink, found on a line.
export interface SinkCall {
  sink: SensitiveDataSink;
  // Its name as written, its parts joined by ".": "logger.info".
  name: string;
  line: number;
  // Just after its "(", where its arguments start; -1 for Ruby's call with none.
  column: number;
  isParenless: boolean;
}

function toLower(text: string): string {
  return text.toLowerCase();
}

// The words of a name, as a person reads it: "redactPii" is redact, pii.
function wordsOfName(name: string): Array<string> {
  return SensitiveNameMatcher.wordsOf(lastPartOf(name));
}

export function isTransformCall(name: string): boolean {
  return wordsOfName(name).some((word: string): boolean => {
    return TRANSFORM_WORDS.has(word);
  });
}

function isSerializerCall(name: string): boolean {
  const lower: string = toLower(name);

  return (
    SERIALIZER_CALLS.has(lower) ||
    SERIALIZER_CALLS.has(lastPartOf(lower)) ||
    lower.endsWith(".stringify")
  );
}

function isMetricReceiver(receiver: string): boolean {
  const last: string = toLower(lastPartOf(receiver));

  return METRIC_RECEIVER_ENDINGS.some((ending: string): boolean => {
    return last.endsWith(ending);
  });
}

// A name without the underscores it starts with: _logger is logger.
function withoutLeadingUnderscores(name: string): string {
  let start: number = 0;

  while (start < name.length && name.charAt(start) === "_") {
    start++;
  }

  return name.slice(start);
}

function isLogReceiver(receiver: string): boolean {
  const last: string = withoutLeadingUnderscores(toLower(lastPartOf(receiver)));

  return LOG_RECEIVERS.has(last) || last.endsWith("logger");
}

/*
 * What a call writes to, by its name and what it is called on: null for a
 * call that writes to no telemetry.
 */
export function getSink(data: {
  name: string;
  // The call's receiver, when the name holds none (`).add(`): the call before.
  receiver?: string | undefined;
  isMacro: boolean;
  isConstructor: boolean;
}): SensitiveDataSink | null {
  const method: string = toLower(lastPartOf(data.name));
  const receiver: string =
    data.receiver !== undefined ? data.receiver : receiverOf(data.name);

  if (data.isMacro) {
    return LOG_MACROS.has(method) ? SensitiveDataSink.Log : null;
  }

  if (data.isConstructor) {
    return AI_FUNCTIONS.has(method) ? SensitiveDataSink.AiPrompt : null;
  }

  if (LOG_METHODS.has(method) && receiver && isLogReceiver(receiver)) {
    return SensitiveDataSink.Log;
  }

  if (SPAN_METHODS.has(method)) {
    return SensitiveDataSink.Span;
  }

  if (receiver && ATTRIBUTE_RECEIVERS.has(toLower(lastPartOf(receiver)))) {
    return SensitiveDataSink.Span;
  }

  if (METRIC_LABEL_METHODS.has(method)) {
    return SensitiveDataSink.Metric;
  }

  if (METRIC_METHODS.has(method) && receiver && isMetricReceiver(receiver)) {
    return SensitiveDataSink.Metric;
  }

  if (AI_FUNCTIONS.has(method)) {
    return SensitiveDataSink.AiPrompt;
  }

  if (
    method === "create" &&
    receiver &&
    AI_CREATE_RECEIVERS.has(toLower(lastPartOf(receiver)))
  ) {
    return SensitiveDataSink.AiPrompt;
  }

  if (
    AI_INVOKE_METHODS.has(method) &&
    receiver &&
    AI_INVOKE_RECEIVERS.has(
      withoutLeadingUnderscores(toLower(lastPartOf(receiver))),
    )
  ) {
    return SensitiveDataSink.AiPrompt;
  }

  return null;
}

function isPunct(token: CodeToken | undefined, text: string): boolean {
  return Boolean(
    token && token.kind === CodeTokenKind.Punct && token.text === text,
  );
}

/*
 * The calls to a sink on one line, read from its tokens: a name followed
 * by "(" (or Rust's "!(", or `new Name(`), a chained call's method after
 * the call before it (`metrics.counter("x").add(`), and - in Ruby - a log
 * call with no parentheses (`logger.info "..."`).
 */
export function findSinkCalls(data: {
  lines: ReadonlyArray<string>;
  line: number;
  language: CodeLanguage;
  isRuby: boolean;
}): Array<SinkCall> {
  const calls: Array<SinkCall> = [];
  const tokens: Array<CodeToken> = tokenize({
    lines: data.lines,
    language: data.language,
    line: data.line,
    column: 0,
    lastLine: data.line,
  }).tokens;

  // The name of the call each open "(" is, to name a chained call's receiver.
  const openCalls: Array<string> = [];
  let lastClosedCall: string = "";

  for (let index: number = 0; index < tokens.length; index++) {
    const token: CodeToken = tokens[index]!;

    if (token.kind === CodeTokenKind.Punct) {
      if (token.text === "(") {
        const before: CodeToken | undefined = tokens[index - 1];
        openCalls.push(
          before && before.kind === CodeTokenKind.Name ? before.text : "",
        );
      } else if (token.text === ")") {
        lastClosedCall = openCalls.pop() || "";
      }

      continue;
    }

    if (token.kind !== CodeTokenKind.Name) {
      continue;
    }

    const next: CodeToken | undefined = tokens[index + 1];
    const afterNext: CodeToken | undefined = tokens[index + 2];
    const before: CodeToken | undefined = tokens[index - 1];
    const isChained: boolean =
      isPunct(before, ".") && isPunct(tokens[index - 2], ")");
    const isConstructor: boolean = Boolean(
      before && before.kind === CodeTokenKind.Name && before.text === "new",
    );

    let open: CodeToken | undefined = undefined;
    let isMacro: boolean = false;

    if (isPunct(next, "(")) {
      open = next;
    } else if (isPunct(next, "!") && isPunct(afterNext, "(")) {
      open = afterNext;
      isMacro = true;
    }

    if (open) {
      const sink: SensitiveDataSink | null = getSink({
        name: token.text,
        receiver: isChained ? lastClosedCall : undefined,
        isMacro,
        isConstructor,
      });

      if (sink) {
        calls.push({
          sink,
          name: isChained ? `${lastClosedCall}.${token.text}` : token.text,
          line: data.line,
          column: open.column + 1,
          isParenless: false,
        });
      }

      continue;
    }

    // Ruby's `logger.info "signup #{email}"`, with no parentheses.
    if (
      data.isRuby &&
      next &&
      next.line === token.line &&
      (next.kind === CodeTokenKind.String || next.kind === CodeTokenKind.Name)
    ) {
      const sink: SensitiveDataSink | null = getSink({
        name: token.text,
        isMacro: false,
        isConstructor: false,
      });

      if (sink === SensitiveDataSink.Log) {
        calls.push({
          sink,
          name: token.text,
          line: data.line,
          column: next.column,
          isParenless: true,
        });
      }
    }
  }

  return calls;
}

interface Frame {
  bracket: string;
  // The call this bracket's arguments are of, when it is one.
  callName: string;
  // What is in it is changed before it is written (hash(...)).
  isTransformed: boolean;
  // What is in it is written whole (JSON.stringify(...)).
  isSerialized: boolean;
  // The key what comes next is written under, until a ",".
  pendingKey: string | null;
  // The key this bracket itself is written under: its entries' path.
  path: string | null;
}

function joinKey(path: string | null, key: string): string {
  if (!path || WRAPPER_KEYS.has(toLower(path))) {
    return key;
  }

  return `${path}.${key}`;
}

// A key as a person writes one: no spaces, not too long, made of name characters.
function isKeyLike(text: string): boolean {
  if (text.length === 0 || text.length > 100) {
    return false;
  }

  for (let index: number = 0; index < text.length; index++) {
    const code: number = text.charCodeAt(index);
    const isNameCharacter: boolean =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a) ||
      code === 0x5f ||
      code === 0x2e ||
      code === 0x2d ||
      code === 0x3a;

    if (!isNameCharacter) {
      return false;
    }
  }

  return true;
}

// Names that are literals, in the languages services are written in.
const LITERAL_NAMES: ReadonlySet<string> = new Set<string>([
  "null",
  "undefined",
  "none",
  "nil",
  "true",
  "false",
  "nan",
  "this",
  "self",
]);

// The tokens that, after a value, say it is only asked about.
const QUESTION_AFTER: ReadonlySet<string> = new Set<string>([
  "?",
  "==",
  "!=",
  "===",
  "!==",
  "<",
  ">",
  "<=",
  ">=",
]);

// A getter's name, as the value it gets: getEmail is email.
function asGetterValue(name: string): string | null {
  const last: string = lastPartOf(name);

  if (
    (last.startsWith("get") || last.startsWith("Get")) &&
    last.length > 3 &&
    last.charCodeAt(3) >= 0x41 &&
    last.charCodeAt(3) <= 0x5a
  ) {
    const receiver: string = receiverOf(name);
    const value: string = last.charAt(3).toLowerCase() + last.slice(4);

    return receiver ? `${receiver}.${value}` : value;
  }

  return null;
}

/*
 * What one call is handed, read from its argument tokens: each value with
 * the key it goes in under, what its strings interpolate, and what is
 * written whole.
 */
export function readWrittenValues(data: {
  tokens: Array<CodeToken>;
  sinkName: string;
  extension: string;
  /*
   * A log call's first argument, when it is a string, is its message -
   * never a key: logger.info("signup", email) logs `email` in its body.
   */
  isFirstStringMessage?: boolean | undefined;
}): Array<WrittenValue> {
  const values: Array<WrittenValue> = [];
  const isRuby: boolean = data.extension === "rb";
  const firstToken: CodeToken | undefined = data.tokens[0];

  const walk: (
    tokens: Array<CodeToken>,
    root: Frame,
    isInString: boolean,
  ) => void = (
    tokens: Array<CodeToken>,
    root: Frame,
    isInString: boolean,
  ): void => {
    const frames: Array<Frame> = [root];

    for (let index: number = 0; index < tokens.length; index++) {
      const token: CodeToken = tokens[index]!;
      const frame: Frame = frames[frames.length - 1]!;
      const next: CodeToken | undefined = tokens[index + 1];
      const before: CodeToken | undefined = tokens[index - 1];

      if (token.kind === CodeTokenKind.Punct) {
        if (token.text === "(" || token.text === "[" || token.text === "{") {
          const callName: string =
            token.text === "(" && before && before.kind === CodeTokenKind.Name
              ? before.text
              : "";

          frames.push({
            bracket: token.text,
            callName,
            isTransformed:
              frame.isTransformed ||
              (callName !== "" && isTransformCall(callName)),
            isSerialized: callName !== "" && isSerializerCall(callName),
            pendingKey: null,
            path:
              token.text === "{" || token.text === "["
                ? frame.pendingKey
                  ? joinKey(frame.path, frame.pendingKey)
                  : frame.path
                : frame.path,
          });
        } else if (
          (token.text === ")" || token.text === "]" || token.text === "}") &&
          frames.length > 1
        ) {
          frames.pop();
        } else if (token.text === ",") {
          frame.pendingKey = null;
        }

        continue;
      }

      if (token.kind === CodeTokenKind.String) {
        // A key: "email": value, 'email' => $email, "email" = value.
        if (
          isPunct(next, ":") ||
          isPunct(next, "=>") ||
          (isPunct(next, "=") && frame.bracket !== "(")
        ) {
          frame.pendingKey = token.text;
          index++;
          continue;
        }

        // A key and its value as a call's two arguments: setAttribute("user.email", email).
        const isMessage: boolean = Boolean(
          data.isFirstStringMessage &&
            frames.length === 1 &&
            !isInString &&
            token === firstToken,
        );

        if (
          isPunct(next, ",") &&
          frame.bracket === "(" &&
          !isMessage &&
          isKeyLike(token.text)
        ) {
          frame.pendingKey = token.text;
          index++;
          continue;
        }

        if (!frame.isTransformed) {
          for (const part of token.parts) {
            walk(
              part,
              {
                bracket: "(",
                callName: "",
                isTransformed: false,
                isSerialized: false,
                pendingKey: frame.pendingKey,
                path: frame.path,
              },
              true,
            );
          }
        }

        continue;
      }

      if (token.kind !== CodeTokenKind.Name) {
        continue;
      }

      // A key: email: value, email=value (Python, Rust's tracing), :email => value.
      if (
        (isPunct(next, ":") && frame.bracket === "{") ||
        (isPunct(next, ":") && isRuby) ||
        isPunct(next, "=>") ||
        (isPunct(next, "=") && frame.bracket === "(")
      ) {
        frame.pendingKey = token.text;
        index++;
        continue;
      }

      // A literal is no value of the data: { email: null } names a field.
      if (frame.isTransformed || LITERAL_NAMES.has(toLower(token.text))) {
        continue;
      }

      // A call: its arguments are read as the walk goes on; a getter is its value.
      let chain: string = token.text;

      if (isPunct(next, "(")) {
        const getter: string | null = asGetterValue(token.text);
        const isEmptyCall: boolean = isPunct(tokens[index + 2], ")");
        const method: string = toLower(lastPartOf(token.text));

        if (isEmptyCall && SERIALIZER_METHODS.has(method)) {
          // user.toJSON(): the receiver, written whole - when it is a person's record.
          const receiver: string = receiverOf(token.text);
          const whole: WholeObjectKind | null = receiver
            ? wholeKindOf(receiver, true, isRuby)
            : null;

          if (whole) {
            values.push({
              key: frame.pendingKey
                ? joinKey(frame.path, frame.pendingKey)
                : null,
              chain: receiver,
              line: token.line,
              isInString,
              whole,
            });
          }

          index += 2;
          continue;
        }

        if (!(isEmptyCall && getter)) {
          continue;
        }

        chain = getter;
        index += 2;
      }

      // Only asked about: !!email, email === undefined, email ? a : b.
      const after: CodeToken | undefined = tokens[index + 1];

      if (
        isPunct(before, "!") ||
        (after &&
          after.kind === CodeTokenKind.Punct &&
          QUESTION_AFTER.has(after.text)) ||
        (before &&
          before.kind === CodeTokenKind.Name &&
          (before.text === "typeof" || before.text === "not"))
      ) {
        continue;
      }

      const isSpread: boolean = isPunct(before, "...") || isPunct(before, "**");

      // A shorthand property: { email } is { email: email }.
      const isShorthand: boolean =
        frame.bracket === "{" &&
        frame.pendingKey === null &&
        (isPunct(before, "{") || isPunct(before, ",")) &&
        (isPunct(after, ",") || isPunct(after, "}"));

      const key: string | null = isShorthand
        ? joinKey(frame.path, token.text)
        : frame.pendingKey
          ? joinKey(frame.path, frame.pendingKey)
          : null;

      values.push({
        key,
        chain,
        line: token.line,
        isInString,
        whole: wholeKindOf(chain, isSpread || frame.isSerialized, isRuby),
      });
    }
  };

  walk(
    data.tokens,
    {
      bracket: "(",
      callName: data.sinkName,
      isTransformed: false,
      isSerialized: false,
      pendingKey: null,
      path: null,
    },
    false,
  );

  return values;
}

/*
 * What a value is when it is written whole: a request's body, headers or
 * cookies, or a record of a person - or null.
 */
export function wholeKindOf(
  chain: string,
  isWrittenWhole: boolean,
  isRuby: boolean,
): WholeObjectKind | null {
  const lower: string = toLower(chain);

  if (REQUEST_HEADERS.has(lower)) {
    return WholeObjectKind.Headers;
  }

  if (REQUEST_COOKIES.has(lower)) {
    return WholeObjectKind.Cookies;
  }

  if (REQUEST_BODIES.has(lower) || (isRuby && lower === "params")) {
    return WholeObjectKind.Body;
  }

  if (PERSON_RECORDS.has(lower)) {
    return WholeObjectKind.Record;
  }

  if (isWrittenWhole && PERSON_RECORDS_WHEN_WRITTEN_WHOLE.has(lower)) {
    return WholeObjectKind.Record;
  }

  return null;
}

// The kinds of data a whole object is known to carry.
function typesOfWhole(kind: WholeObjectKind): Array<NamedDataType> {
  const id: string | null =
    kind === WholeObjectKind.Headers
      ? "authorization-header"
      : kind === WholeObjectKind.Cookies
        ? "generic-secret"
        : null;

  if (!id) {
    return [];
  }

  const info: ReturnType<typeof getBuiltInDataType> = getBuiltInDataType(id);

  return info
    ? [
        {
          id: info.id,
          name: info.name,
          sensitivity: info.sensitivity,
          category: info.category,
        },
      ]
    : [];
}

function wholeSensitivity(kind: WholeObjectKind): DataSensitivity {
  return kind === WholeObjectKind.Headers || kind === WholeObjectKind.Cookies
    ? DataSensitivity.Restricted
    : DataSensitivity.Confidential;
}

function checkIdOf(
  sink: SensitiveDataSink,
  types: ReadonlyArray<NamedDataType>,
): string {
  if (sink === SensitiveDataSink.AiPrompt) {
    return SENSITIVE_DATA_TO_AI_CHECK_ID;
  }

  return isAnySecret(types)
    ? SECRETS_IN_TELEMETRY_CHECK_ID
    : SENSITIVE_DATA_IN_TELEMETRY_CHECK_ID;
}

const SINK_WORDS: Readonly<Record<SensitiveDataSink, string>> = {
  [SensitiveDataSink.Log]: "Writes {{what}} to a log",
  [SensitiveDataSink.Span]: "Writes {{what}} to a span",
  [SensitiveDataSink.Metric]: "Puts {{what}} in a metric label",
  [SensitiveDataSink.AiPrompt]: "Sends {{what}} to an AI provider",
};

const WHOLE_WORDS: Readonly<Record<WholeObjectKind, string>> = {
  [WholeObjectKind.Body]: "a whole request body",
  [WholeObjectKind.Headers]: "a request's headers",
  [WholeObjectKind.Cookies]: "a request's cookies",
  [WholeObjectKind.Record]: "a whole record of a person",
};

const WHOLE_WHY: Readonly<Record<WholeObjectKind, string>> = {
  [WholeObjectKind.Body]:
    "A body can carry passwords, tokens and personal data.",
  [WholeObjectKind.Headers]: "They carry its authorization header and cookies.",
  [WholeObjectKind.Cookies]: "They carry its session.",
  [WholeObjectKind.Record]: "Every field of it is written, personal data too.",
};

function sentenceOf(data: {
  sink: SensitiveDataSink;
  what: string;
  subject: string;
  where: string;
}): string {
  return `${SINK_WORDS[data.sink].replace("{{what}}", data.what)}: \`${data.subject}\`, in \`${data.where}\`.`;
}

/*
 * The change that fixes a candidate, in English: leave it out, or hash it -
 * or, when the change already passes values through a function that
 * redacts or masks them, use that.
 */
function fixOf(data: {
  sink: SensitiveDataSink;
  subject: string;
  isSecret: boolean;
  whole: WholeObjectKind | null;
  helper: string | null;
}): string {
  if (data.whole) {
    return data.whole === WholeObjectKind.Record
      ? "Write only the fields you need, by name, and none that holds personal data."
      : "Write only the fields you need, by name, and none of its secrets.";
  }

  if (data.sink === SensitiveDataSink.AiPrompt) {
    return `Leave \`${data.subject}\` out of the prompt, or put a placeholder in its place that the answer does not need.`;
  }

  if (data.isSecret) {
    return `Leave \`${data.subject}\` out: everyone who reads the telemetry could read the secret.`;
  }

  if (data.helper) {
    return `Pass \`${data.subject}\` through \`${data.helper}\` first, as this change does elsewhere, or leave it out.`;
  }

  return `Leave \`${data.subject}\` out, or write a hash of it when you need to tell values apart.`;
}

/*
 * The first function the file's changed code calls that redacts or masks
 * a value: "use the repository's redaction helper" when it has one.
 */
export function findRedactionHelper(
  lines: ReadonlyArray<string>,
  language: CodeLanguage,
): string | null {
  const tokens: Array<CodeToken> = tokenize({
    lines,
    language,
    line: 0,
    column: 0,
    lastLine: Math.min(lines.length - 1, MAX_LINES_READ),
  }).tokens;

  for (let index: number = 0; index < tokens.length; index++) {
    const token: CodeToken = tokens[index]!;

    if (
      token.kind === CodeTokenKind.Name &&
      isPunct(tokens[index + 1], "(") &&
      wordsOfName(token.text).some((word: string): boolean => {
        return (
          word === "redact" ||
          word === "mask" ||
          word === "scrub" ||
          word === "anonymize" ||
          word === "anonymise" ||
          word === "pseudonymize" ||
          word === "pseudonymise" ||
          word === "obfuscate"
        );
      }) &&
      token.text.length <= SENSITIVE_DATA_LIMITS.maxSubjectLength
    ) {
      return token.text;
    }
  }

  return null;
}

/*
 * A line without one entry of the object literal it holds, as the line
 * would read with that value left out - or null when the entry is not one
 * this can take out safely: the literal must open and close on the line,
 * and the entry be the key alone (`{ email }`) or the key and a plain
 * value (`email: user.email`).
 */
export function withoutEntry(lineText: string, key: string): string | null {
  const open: number = lineText.indexOf("{");
  const close: number = lineText.lastIndexOf("}");

  if (open < 0 || close <= open) {
    return null;
  }

  const inside: string = lineText.slice(open + 1, close);

  // No nested brackets or strings with commas: the entries split cleanly.
  for (const character of ["{", "}", "(", ")", "[", "]", "`"]) {
    if (inside.includes(character)) {
      return null;
    }
  }

  const entries: Array<string> = inside.split(",");
  const kept: Array<string> = entries.filter((entry: string): boolean => {
    const trimmed: string = entry.trim();
    const colon: number = trimmed.indexOf(":");
    const entryKey: string = (colon >= 0 ? trimmed.slice(0, colon) : trimmed)
      .trim()
      .split('"')
      .join("")
      .split("'")
      .join("");

    return entryKey !== key;
  });

  if (kept.length === entries.length || kept.length === 0) {
    // Not there, or the object would be empty: a person decides what stays.
    return kept.length === 0 ? withoutEmptyObject(lineText, open, close) : null;
  }

  const rebuilt: string = kept
    .map((entry: string): string => {
      return entry.trim();
    })
    .filter((entry: string): boolean => {
      return entry.length > 0;
    })
    .join(", ");

  return `${lineText.slice(0, open)}{ ${rebuilt} }${lineText.slice(close + 1)}`;
}

/*
 * The line with an object literal that held only the value taken out, as
 * a call's last argument: `logger.info("signup", { email });` is
 * `logger.info("signup");`.
 */
function withoutEmptyObject(
  lineText: string,
  open: number,
  close: number,
): string | null {
  const before: string = lineText.slice(0, open);
  const comma: number = before.lastIndexOf(",");

  if (comma < 0 || before.slice(comma + 1).trim() !== "") {
    return null;
  }

  const after: string = lineText.slice(close + 1);

  if (!after.trimStart().startsWith(")")) {
    return null;
  }

  return `${before.slice(0, comma)}${after}`;
}

/*
 * The candidates of one file of code: what its added lines write to
 * telemetry that a data type's hints point at.
 */
export function findTelemetryWrites(data: {
  path: string;
  lines: Array<PatchLine>;
  matcher: SensitiveNameMatcher;
}): Array<SensitiveDataCandidate> {
  const extension: string = extensionOf(data.path);
  const language: CodeLanguage = getCodeLanguage(extension);
  const newLines: Array<PatchLine> = readNewLines(data.lines).slice(
    0,
    MAX_LINES_READ,
  );
  const texts: Array<string> = newLines.map((line: PatchLine): string => {
    return line.text;
  });
  const candidates: Array<SensitiveDataCandidate> = [];
  const seen: Set<string> = new Set<string>();

  if (
    !newLines.some((line: PatchLine): boolean => {
      return line.kind === PatchLineKind.Added;
    })
  ) {
    return candidates;
  }

  const helper: string | null = findRedactionHelper(texts, language);

  for (let index: number = 0; index < newLines.length; index++) {
    // A call that starts on a line a hunk shows, added or not.
    const calls: Array<SinkCall> = findSinkCalls({
      lines: texts,
      line: index,
      language,
      isRuby: extension === "rb",
    });

    for (const call of calls) {
      const maxLines: number =
        call.sink === SensitiveDataSink.AiPrompt
          ? MAX_PROMPT_CALL_LINES
          : MAX_CALL_LINES;
      const tokens: Array<CodeToken> = tokenize({
        lines: texts,
        language,
        line: call.line,
        column: call.column,
        lastLine: call.isParenless ? call.line : call.line + maxLines,
        untilClosed: !call.isParenless,
      }).tokens;

      for (const value of readWrittenValues({
        tokens,
        sinkName: call.name,
        extension,
        isFirstStringMessage: call.sink === SensitiveDataSink.Log,
      })) {
        const lineOfValue: PatchLine | undefined = newLines[value.line];

        if (
          !lineOfValue ||
          lineOfValue.kind !== PatchLineKind.Added ||
          isMarkedNotSensitive(newLines, value.line)
        ) {
          continue;
        }

        const candidate: SensitiveDataCandidate | null = toCandidate({
          path: data.path,
          call,
          value,
          line: lineOfValue,
          matcher: data.matcher,
          helper,
        });

        if (!candidate) {
          continue;
        }

        const id: string = `${candidate.line}\u0000${candidate.subject.toLowerCase()}`;

        if (seen.has(id)) {
          continue;
        }

        seen.add(id);
        candidates.push(candidate);
      }
    }
  }

  return candidates;
}

function toCandidate(data: {
  path: string;
  call: SinkCall;
  value: WrittenValue;
  line: PatchLine;
  matcher: SensitiveNameMatcher;
  helper: string | null;
}): SensitiveDataCandidate | null {
  const value: WrittenValue = data.value;
  const where: string = data.call.name.slice(
    0,
    SENSITIVE_DATA_LIMITS.maxSubjectLength,
  );

  if (value.whole && value.chain) {
    const types: Array<NamedDataType> = typesOfWhole(value.whole);
    const sensitivity: DataSensitivity = wholeSensitivity(value.whole);
    const isSecret: boolean = isAnySecret(types);
    const subject: string = value.chain.slice(
      0,
      SENSITIVE_DATA_LIMITS.maxSubjectLength,
    );

    return {
      kind: SensitiveDataLeakKind.Telemetry,
      checkId: checkIdOf(data.call.sink, types),
      sink: data.call.sink,
      path: data.path,
      line: data.line.newLine,
      lineText: data.line.text,
      subject,
      where,
      isWholeObject: true,
      dataTypes: types,
      sensitivity,
      isBlocking: isSecret || sensitivity === DataSensitivity.Restricted,
      text: `${sentenceOf({
        sink: data.call.sink,
        what: WHOLE_WORDS[value.whole],
        subject,
        where,
      })} ${WHOLE_WHY[value.whole]}`,
      fix: fixOf({
        sink: data.call.sink,
        subject,
        isSecret,
        whole: value.whole,
        helper: data.helper,
      }),
      location: value.key ? `attributes.${value.key}` : "body",
    };
  }

  const keyTypes: Array<NamedDataType> = value.key
    ? data.matcher.match(value.key)
    : [];
  const valueName: string | null = value.chain ? lastPartOf(value.chain) : null;
  const valueTypes: Array<NamedDataType> = valueName
    ? data.matcher.match(valueName)
    : [];

  if (keyTypes.length === 0 && valueTypes.length === 0) {
    return null;
  }

  // A key that only names a field: its value is plainly another thing.
  if (valueTypes.length === 0 && valueName) {
    const valueWords: Array<string> = SensitiveNameMatcher.wordsOf(valueName);
    const head: string | undefined = valueWords[valueWords.length - 1];

    if (head && OTHER_THING_VALUE_WORDS.has(head)) {
      return null;
    }
  }

  const types: Array<NamedDataType> = [...valueTypes];

  for (const type of keyTypes) {
    if (
      !types.some((known: NamedDataType): boolean => {
        return known.id === type.id;
      })
    ) {
      types.push(type);
    }
  }

  const sensitivity: DataSensitivity = highestSensitivity(types);
  const isSecret: boolean = isAnySecret(types);
  const subject: string = (
    keyTypes.length > 0 && value.key
      ? value.key
      : value.chain || value.key || ""
  ).slice(0, SENSITIVE_DATA_LIMITS.maxSubjectLength);

  if (!subject) {
    return null;
  }

  const checkId: string = checkIdOf(data.call.sink, types);

  if (!PRODUCTION_REVIEW_LEAK_CHECK_IDS.includes(checkId)) {
    return null;
  }

  const shorthandKey: string | null =
    value.key && value.chain && value.key === value.chain ? value.key : null;
  const objectKey: string | null = value.key
    ? lastPartOf(value.key)
    : shorthandKey;
  const replacement: string | null =
    !value.isInString && objectKey
      ? withoutEntry(data.line.text, objectKey)
      : null;

  return {
    kind: SensitiveDataLeakKind.Telemetry,
    checkId,
    sink: data.call.sink,
    path: data.path,
    line: data.line.newLine,
    lineText: data.line.text,
    subject,
    where,
    dataTypes: types,
    sensitivity,
    isBlocking: isSecret || sensitivity === DataSensitivity.Restricted,
    text: sentenceOf({
      sink: data.call.sink,
      what: describeDataType(types[0]!),
      subject,
      where,
    }),
    fix: fixOf({
      sink: data.call.sink,
      subject,
      isSecret,
      whole: null,
      helper: data.helper,
    }),
    ...(replacement !== null
      ? {
          suggestion: {
            startLine: data.line.newLine,
            endLine: data.line.newLine,
            original: [data.line.text],
            replacement: [replacement],
            isByAi: false,
          },
        }
      : {}),
    // Under its key, an attribute; in the message itself, the log's body.
    location: value.key ? `attributes.${value.key}` : "body",
  };
}
