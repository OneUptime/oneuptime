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
import { RUM_SESSION_TAGS_PREFIX } from "../../../../../Types/DataSecurity/RumSessionPlaces";
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
 * The lines a pull request adds to a service's code are read for six
 * kinds of call, in every language a service is written in:
 *
 *   - a log call: `logger.info`, `log.Printf`, `console.error`,
 *     `_logger.LogInformation`, `Logger.info`, `info!`;
 *   - a span's or an event's attribute, a tag on a span:
 *     `span.setAttribute`, `attribute.String`, `span.setTag`;
 *   - a metric's label: `counter.add(1, {...})`, `.labels(...)`,
 *     `WithLabelValues`;
 *   - a prompt sent to an AI provider: `chat.completions.create`,
 *     `messages.create`, `generateText`, `llm.invoke`;
 *   - an exception (#10778), which reaches the service's exceptions in
 *     telemetry as a log line does its logs: the message an error is made
 *     with - thrown, raised or returned (`throw new Error(...)`, `raise
 *     ValueError(...)`, `fmt.Errorf`, `errors.New`, `bail!`, Ruby's and
 *     Elixir's `raise "..."`) - and what an error tracker is handed with
 *     one (`Sentry.captureException(error, { extra })`, `Sentry.setUser`,
 *     `scope.setTag`, Bugsnag's, Rollbar's, Honeybadger's, New Relic's
 *     `noticeError`), or a span's recorded exception (`recordException`).
 *     A message that only names a field ("email is required") holds no
 *     value, so it is no point;
 *   - a recorded session's identity (#11395), which a web or mobile
 *     app's front end gives its session recorder or product analytics
 *     SDK, each called as its documentation calls it: who the user is and
 *     the user's traits - OneUptime's `OneUptimeReplay.identify(ref,
 *     traits)` and its queue's `["identify", ref, traits]`,
 *     `LogRocket.identify`, FullStory's `FS.identify` and
 *     `FS('setIdentity', ...)`, `posthog.identify`, `datadogRum.setUser`,
 *     OpenReplay's `tracker.setUserID`, Hotjar's, Smartlook's,
 *     Mixpanel's, Amplitude's and Heap's. A session identified by an
 *     opaque id (`identify(user.id)`, a hash) is no point. And the tags
 *     OneUptime's recorder is handed (#11458): `setTags({...})`,
 *     `addTag(key, value)` and the queue's `["setTags", ...]` and
 *     `["addTag", ...]`, which every reader of the session list reads.
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

/*
 * A span's, an event's or a trace's setters, lower case. An error
 * tracker's own setters - its user, extras and context - are an
 * exception's (ERROR_TRACKER_METHODS): `this.setUser` or a state setter
 * named so writes to no telemetry at all.
 */
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
  "startspan",
  "startactivespan",
  "start_span",
  "start_as_current_span",
  "withattributes",
]);

// A tracer's user, on the trace's root span: Datadog's `tracer.setUser`.
const SPAN_USER_METHODS: ReadonlySet<string> = new Set<string>([
  "setuser",
  "set_user",
]);

/*
 * An error tracker, by a part of the receiver it is called on, lower case:
 * `Sentry.captureException`, `sentry_sdk.set_user`, `Bugsnag.notify`,
 * `Sentry.Context.set_user_context`.
 */
const ERROR_TRACKER_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "sentry",
  "sentry_sdk",
  "sentrysdk",
  "raven",
  "bugsnag",
  "rollbar",
  "honeybadger",
  "airbrake",
  "newrelic",
  "raygun",
  "appsignal",
  "crashlytics",
  "trackjs",
  "errortracker",
  "errorreporter",
  "errorreporting",
]);

/*
 * Sentry's scope and hub, which are only named so: read for the scope's
 * own setters and captures, never for any other method of a `scope`.
 */
const ERROR_SCOPE_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "scope",
  "hub",
  "sentryscope",
  "sentryhub",
]);

// An error tracker's setters, which every report after them carries.
const ERROR_SCOPE_METHODS: ReadonlySet<string> = new Set<string>([
  "setuser",
  "set_user",
  "settag",
  "settags",
  "set_tag",
  "set_tags",
  "setextra",
  "setextras",
  "set_extra",
  "set_extras",
  "setcontext",
  "set_context",
  "addbreadcrumb",
  "add_breadcrumb",
  "user_context",
  "set_user_context",
  "extra_context",
  "set_extra_context",
  "tags_context",
  "set_tags_context",
  "addmetadata",
  "add_metadata",
]);

// What an error tracker reports with, lower case: read on a tracker only.
const ERROR_TRACKER_METHODS: ReadonlySet<string> = new Set<string>([
  ...ERROR_SCOPE_METHODS,
  "captureexception",
  "capture_exception",
  "capturemessage",
  "capture_message",
  "captureevent",
  "capture_event",
  "notify",
  "noticeerror",
  "notice_error",
  "report",
  "error",
  "critical",
  "warning",
  "warn",
  "info",
  "debug",
  "log",
]);

/*
 * The calls that report an exception, whatever they are called on - or on
 * nothing, imported on their own: `captureException(error)`, a span's
 * `recordException`, Application Insights' `trackException`, New Relic's
 * `noticeError`, Bugsnag's `addMetadata` on its event.
 */
const ERROR_REPORT_METHODS: ReadonlySet<string> = new Set<string>([
  "captureexception",
  "capture_exception",
  "capturemessage",
  "capture_message",
  "captureevent",
  "capture_event",
  "recordexception",
  "record_exception",
  "trackexception",
  "track_exception",
  "noticeerror",
  "notice_error",
  "addexception",
  "addmetadata",
  "add_metadata",
  "addbreadcrumb",
  "add_breadcrumb",
]);

/*
 * Sentry's setters as Python imports them on their own (`from sentry_sdk
 * import set_user`): snake case only, since a camel-case `setUser(...)`
 * with nothing before it is as often a component's state.
 */
const BARE_ERROR_SCOPE_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "set_user",
  "set_tag",
  "set_tags",
  "set_extra",
  "set_extras",
  "set_context",
]);

/*
 * Functions that stop the program with a message, called on nothing:
 * Go's `panic`, Swift's `fatalError`, Flask's `abort` - their message is
 * an exception's.
 */
const BARE_EXCEPTION_FUNCTIONS: ReadonlySet<string> = new Set<string>([
  "panic",
  "fatalerror",
  "abort",
]);

/*
 * Go's and its packages' ways to make an error with a message, by the
 * method: `fmt.Errorf`, `status.Errorf`, `errors.Newf` on any receiver...
 */
const ERROR_FORMAT_METHODS: ReadonlySet<string> = new Set<string>([
  "errorf",
  "newf",
]);

// ...and these on an errors package: `errors.New`, `pkgerrors.Wrapf`.
const ERRORS_PACKAGE_METHODS: ReadonlySet<string> = new Set<string>([
  "new",
  "wrap",
  "wrapf",
  "withmessage",
  "withmessagef",
]);

// Go's errors packages, as code imports them.
const ERRORS_PACKAGES: ReadonlySet<string> = new Set<string>([
  "errors",
  "xerrors",
  "pkgerrors",
  "goerrors",
]);

// Rust's macros that make or raise an error with a message.
const EXCEPTION_MACROS: ReadonlySet<string> = new Set<string>([
  "panic",
  "bail",
  "anyhow",
  "ensure",
  "eyre",
  "format_err",
  "unreachable",
  "unimplemented",
  "todo",
]);

/*
 * The words that raise what follows them, on its line, with no
 * parentheses: Ruby's and Elixir's `raise "..."`, Ruby's `fail "..."`.
 */
const PARENLESS_RAISE_WORDS: ReadonlySet<string> = new Set<string>([
  "raise",
  "fail",
]);

// The words that throw or raise the call after them: `throw createError(...)`.
const THROW_WORDS: ReadonlySet<string> = new Set<string>(["throw", "raise"]);

// The word that makes the call after it a constructor: `new Error(...)`.
const NEW_WORDS: ReadonlySet<string> = new Set<string>(["new"]);

/*
 * The words that end a call written with no parentheses, outside any
 * bracket: Ruby's and Elixir's statement modifiers. `raise "..." unless
 * customer` raises the message; `customer` is only asked about.
 */
const PARENLESS_CALL_ENDS: ReadonlySet<string> = new Set<string>([
  "if",
  "unless",
  "while",
  "until",
  "rescue",
  "and",
  "or",
  "do",
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

/*
 * What makes a metric's instrument, by the call's last part, lower case:
 * OpenTelemetry's meters in each language, Prometheus's clients. A name
 * the file assigns one of these to is a metric's receiver, whatever it is
 * called: `const ordersPlaced = meter.createCounter(...)`.
 */
const METRIC_INSTRUMENT_MAKERS: ReadonlySet<string> = new Set<string>([
  "createcounter",
  "createupdowncounter",
  "createhistogram",
  "creategauge",
  "createobservablecounter",
  "createobservableupdowncounter",
  "createobservablegauge",
  "create_counter",
  "create_up_down_counter",
  "create_histogram",
  "create_gauge",
  "create_observable_counter",
  "create_observable_up_down_counter",
  "create_observable_gauge",
  "int64counter",
  "int64updowncounter",
  "int64histogram",
  "int64gauge",
  "float64counter",
  "float64updowncounter",
  "float64histogram",
  "float64gauge",
  "counterbuilder",
  "updowncounterbuilder",
  "histogrambuilder",
  "gaugebuilder",
  "newcounter",
  "newcountervec",
  "newgauge",
  "newgaugevec",
  "newhistogram",
  "newhistogramvec",
  "newsummary",
  "newsummaryvec",
  // Prometheus's classes: Counter("orders_total", ...), new client.Counter({...}).
  "counter",
  "gauge",
  "histogram",
  "summary",
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
 * A session recorder or a product analytics SDK, by the last part of the
 * receiver it is called on, lower case (#11395) - each as its own
 * documentation calls it: OneUptime's RUM SDK (`OneUptimeReplay`, and a
 * session recorder as code names one: the hook's `replay`, a module's
 * `recorder`), LogRocket, FullStory (`FS`), PostHog, Datadog RUM
 * (`datadogRum`, the CDN's `DD_RUM`), OpenReplay (`tracker`), Hotjar,
 * Smartlook, Mixpanel, Amplitude and Heap. Microsoft Clarity hashes the
 * id it is handed in the browser, and Segment and RudderStack carry a
 * user's traits on to other tools by design: none of them is one.
 */
const SESSION_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "oneuptimereplay",
  "recorder",
  "sessionrecorder",
  "session_recorder",
  "replayrecorder",
  "replay",
  "sessionreplay",
  "session_replay",
  "logrocket",
  "fs",
  "fullstory",
  "posthog",
  "datadogrum",
  "dd_rum",
  "tracker",
  "openreplay",
  "hotjar",
  "smartlook",
  "mixpanel",
  "amplitude",
  "heap",
]);

/*
 * OneUptime's own session recorder among them, the one SDK whose sessions
 * keep tags (#11458): `OneUptimeReplay`, the hook's `replay`, a module's
 * `recorder`.
 */
const ONEUPTIME_SESSION_RECEIVERS: ReadonlySet<string> = new Set<string>([
  "oneuptimereplay",
  "recorder",
  "sessionrecorder",
  "session_recorder",
  "replayrecorder",
  "replay",
  "sessionreplay",
  "session_replay",
]);

/*
 * What gives a recorded session its tags (#11458), lower case: OneUptime's
 * `setTags({ key: value })` and `addTag(key, value)`. The tags are stored as
 * sent in every masking mode, and everyone who can list sessions reads them.
 */
const SESSION_TAG_METHODS: ReadonlySet<string> = new Set<string>([
  "settags",
  "addtag",
]);

/*
 * What tells a session's SDK who its user is, lower case: the first thing
 * it is handed - `identify(userRef, traits)`, `setUserID(id)` - or the
 * object of the user it is handed (`datadogRum.setUser({ id, email })`).
 * A bare `identify(...)` or `setUserId(...)`, called on nothing, is as
 * often the app's own function or a component's state: never read.
 */
const SESSION_IDENTITY_METHODS: ReadonlySet<string> = new Set<string>([
  "identify",
  "setuser",
  "setuserid",
  "setidentity",
  "alias",
]);

// What adds to a session's user, under a key: its traits, properties and metadata.
const SESSION_PROPERTY_METHODS: ReadonlySet<string> = new Set<string>([
  "setuservars",
  "setuserproperty",
  "setuserproperties",
  "setpersonproperties",
  "adduserproperties",
  "setmetadata",
]);

// A user's profile, on an SDK's `people`: Mixpanel's `mixpanel.people.set({...})`.
const SESSION_PEOPLE_METHODS: ReadonlySet<string> = new Set<string>([
  "set",
  "set_once",
  "setonce",
]);

/*
 * What a session SDK's call tells a recorded session: who its user is, a
 * detail of that user under a key, or - OneUptime's - a tag of the session
 * under its key (#11458).
 */
export enum SessionCallKind {
  Identity = "Identity",
  UserDetail = "UserDetail",
  Tags = "Tags",
}

/*
 * A session SDK called as a function with its command first, by the
 * call's last part, lower case, and the commands of it that say who the
 * session's user is: FullStory's `FS('setIdentity', { uid, properties })`
 * and `FS('setProperties', { type: 'user', properties })` (its npm
 * package's `Fullstory(...)` too), Hotjar's `hj('identify', userId,
 * attributes)` and Smartlook's `smartlook('identify', userId, properties)`.
 */
const SESSION_COMMAND_FUNCTIONS: ReadonlyMap<
  string,
  ReadonlyMap<string, SessionCallKind>
> = new Map<string, ReadonlyMap<string, SessionCallKind>>([
  [
    "fs",
    new Map<string, SessionCallKind>([
      ["setidentity", SessionCallKind.Identity],
      ["setproperties", SessionCallKind.UserDetail],
    ]),
  ],
  [
    "fullstory",
    new Map<string, SessionCallKind>([
      ["setidentity", SessionCallKind.Identity],
      ["setproperties", SessionCallKind.UserDetail],
    ]),
  ],
  [
    "hj",
    new Map<string, SessionCallKind>([["identify", SessionCallKind.Identity]]),
  ],
  [
    "smartlook",
    new Map<string, SessionCallKind>([["identify", SessionCallKind.Identity]]),
  ],
]);

/*
 * OneUptime's command queue, by the last part of what `push` is called on,
 * lower case: `OneUptimeReplayQueue.push(["identify", ref, traits])`, read
 * before the recorder has loaded as well as after.
 */
const SESSION_QUEUES: ReadonlySet<string> = new Set<string>([
  "oneuptimereplayqueue",
]);

/*
 * The queue's commands that tell a recorded session something: who its
 * user is (`["identify", ref, traits]`), and its tags (#11458):
 * `["setTags", { key: value }]` and `["addTag", key, value]`.
 */
const SESSION_QUEUE_COMMANDS: ReadonlyMap<string, SessionCallKind> = new Map<
  string,
  SessionCallKind
>([
  ["identify", SessionCallKind.Identity],
  ["settags", SessionCallKind.Tags],
  ["addtag", SessionCallKind.Tags],
]);

// The keys a session's user object holds its identity under: the rest are its traits.
const SESSION_IDENTITY_KEYS: ReadonlySet<string> = new Set<string>([
  "id",
  "uid",
  "userid",
  "user_id",
  "userref",
  "user_ref",
  "distinctid",
  "distinct_id",
  "identity",
]);

// Where a RUM application's sessions keep what a session is told of its user (#11395).
export const SESSION_LABEL_LOCATION: string = "sessions.identifiedUserLabel";
export const SESSION_TRAITS_LOCATION_PREFIX: string =
  "sessions.identifiedUserTraits.";

/*
 * And its tags (#11458), each under its key: `sessions.tags.<key>`. A tag
 * whose key the code does not spell out is the session's tags as a whole.
 */
export const SESSION_TAGS_LOCATION_PREFIX: string = RUM_SESSION_TAGS_PREFIX;
export const SESSION_TAGS_LOCATION: string = RUM_SESSION_TAGS_PREFIX.slice(
  0,
  -1,
);

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
  /*
   * An exception's: what an error tracker or a span is handed to report
   * one (`Sentry.captureException`, `scope.setTag`, `recordException`),
   * rather than the message an error is made with.
   */
  isErrorReport?: boolean | undefined;
  /*
   * A recorded session's (#11395): the call says who the session's user
   * is (`identify(ref, traits)`), so the first thing it is handed is that
   * user - never a key - rather than one of the user's details under a key
   * (`setUserProperty("plan", plan)`).
   */
  isIdentity?: boolean | undefined;
  /*
   * A recorded session's tags (#11458): `setTags({ key: value })`,
   * `addTag(key, value)`. Each value is under its key, and none is who the
   * session's user is, whatever its key says.
   */
  isTags?: boolean | undefined;
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

// A name as an instrument's is looked up: its last part, lower case, `_` and `this.` left off.
function instrumentKeyOf(name: string): string {
  return withoutLeadingUnderscores(toLower(lastPartOf(name)));
}

/*
 * A metric's receiver: one named as one (`requestCounter`), or a name the
 * file makes an instrument of (findMetricInstruments).
 */
function isMetricReceiver(
  receiver: string,
  instruments?: ReadonlySet<string> | undefined,
): boolean {
  const last: string = toLower(lastPartOf(receiver));

  if (instruments && instruments.has(instrumentKeyOf(receiver))) {
    return true;
  }

  return METRIC_RECEIVER_ENDINGS.some((ending: string): boolean => {
    return last.endsWith(ending);
  });
}

// Whether a call's name makes a metric's instrument: Prometheus's classes by their capital.
function isInstrumentMaker(name: string): boolean {
  const last: string = lastPartOf(name);
  const lower: string = toLower(last);

  if (!METRIC_INSTRUMENT_MAKERS.has(lower)) {
    return false;
  }

  if (["counter", "gauge", "histogram", "summary"].includes(lower)) {
    const first: number = last.charCodeAt(0);

    return first >= 0x41 && first <= 0x5a;
  }

  return true;
}

/*
 * The names a file assigns a metric's instrument to, as instrumentKeyOf
 * reads them: `const ordersPlaced = meter.createCounter("orders.placed")`,
 * `self.orders_placed = meter.create_counter(...)`, `placed :=
 * meter.Int64Counter(...)`, `_placed = meter.CreateCounter<long>(...)`,
 * `ORDERS = Counter("orders_total", ...)`. Read from every line the
 * change shows, so an instrument made above the hunk's added lines - shown
 * as context - still names what writes to it.
 */
export function findMetricInstruments(
  lines: ReadonlyArray<string>,
  language: CodeLanguage,
): Set<string> {
  const instruments: Set<string> = new Set<string>();
  const lastLine: number = Math.min(lines.length, MAX_LINES_READ);

  // Line by line: an assignment is on one, and each read stays that line's length.
  for (let line: number = 0; line < lastLine; line++) {
    if (!(lines[line] || "").includes("=")) {
      continue;
    }

    const tokens: Array<CodeToken> = tokenize({
      lines,
      language,
      line,
      column: 0,
      lastLine: line,
    }).tokens;

    for (let index: number = 1; index < tokens.length; index++) {
      if (!isPunct(tokens[index], "=")) {
        continue;
      }

      // Go's ":=" is ":" then "=".
      let targetAt: number = isPunct(tokens[index - 1], ":")
        ? index - 2
        : index - 1;

      // Go's `placed, err := meter.Int64Counter(...)`: the instrument is the first.
      while (
        targetAt >= 2 &&
        isPunct(tokens[targetAt - 1], ",") &&
        tokens[targetAt - 2]?.kind === CodeTokenKind.Name
      ) {
        targetAt -= 2;
      }

      const target: CodeToken | undefined = tokens[targetAt];

      if (!target || target.kind !== CodeTokenKind.Name) {
        continue;
      }

      const at: number = isWord(tokens[index + 1], NEW_WORDS)
        ? index + 2
        : index + 1;
      const maker: CodeToken | undefined = tokens[at];
      const after: CodeToken | undefined = tokens[at + 1];

      if (
        maker &&
        maker.kind === CodeTokenKind.Name &&
        (isPunct(after, "(") || isPunct(after, "<")) &&
        isInstrumentMaker(maker.text)
      ) {
        instruments.add(instrumentKeyOf(target.text));
      }
    }
  }

  return instruments;
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

// A receiver's parts as a tracker is looked for in them: `Sentry.Context` is sentry, context.
function receiverParts(receiver: string): Array<string> {
  return receiver
    .split(".")
    .map((part: string): string => {
      return withoutLeadingUnderscores(toLower(part));
    })
    .filter((part: string): boolean => {
      return part.length > 0;
    });
}

function isErrorTrackerReceiver(receiver: string): boolean {
  return receiverParts(receiver).some((part: string): boolean => {
    return ERROR_TRACKER_RECEIVERS.has(part);
  });
}

function isErrorScopeReceiver(receiver: string): boolean {
  const parts: Array<string> = receiverParts(receiver);
  const last: string | undefined = parts[parts.length - 1];

  return last !== undefined && ERROR_SCOPE_RECEIVERS.has(last);
}

// A tracer or a span, which a user is set on for the trace: `tracer.setUser`.
function isTraceReceiver(receiver: string): boolean {
  const last: string = withoutLeadingUnderscores(toLower(lastPartOf(receiver)));

  return last.endsWith("tracer") || last.endsWith("span");
}

/*
 * A class of error, by its name: `Error`, `TypeError`, `ValueError`,
 * `IllegalArgumentException`, `HTTPException` - a capital first, and
 * Error or Exception last. Read only where the code makes one (`new`,
 * `throw`, `raise`): a method named so, such as C#'s `AddModelError`,
 * reports nothing.
 */
export function isExceptionClassName(name: string): boolean {
  const last: string = lastPartOf(name);
  const first: number = last.charCodeAt(0);

  return (
    first >= 0x41 &&
    first <= 0x5a &&
    (last.endsWith("Error") || last.endsWith("Exception"))
  );
}

// A sink a call writes to, and whether it reports an exception rather than making one.
export interface ReadSink {
  sink: SensitiveDataSink;
  isErrorReport: boolean;
  // A recorded session's: the call says who its user is (SinkCall.isIdentity).
  isIdentity?: boolean | undefined;
  // A recorded session's tags (SinkCall.isTags, #11458).
  isTags?: boolean | undefined;
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
  // Thrown or raised where it is made: `throw createError(...)`, `raise ValueError(...)`.
  isThrown?: boolean | undefined;
  // The names the file makes a metric's instrument of (findMetricInstruments).
  instruments?: ReadonlySet<string> | undefined;
}): SensitiveDataSink | null {
  return readSink(data)?.sink || null;
}

/*
 * An exception a call makes or reports (#10778), by its name and what it
 * is called on - or null for one that is no exception's.
 */
function readExceptionSink(data: {
  method: string;
  receiver: string;
  isConstructor: boolean;
  isThrown: boolean;
  name: string;
}): ReadSink | null {
  const thrown: ReadSink = {
    sink: SensitiveDataSink.Exception,
    isErrorReport: false,
  };
  const reported: ReadSink = {
    sink: SensitiveDataSink.Exception,
    isErrorReport: true,
  };

  // Made, thrown or raised: `new Error(...)`, `throw createError(...)`.
  if (
    data.isThrown ||
    (data.isConstructor && isExceptionClassName(data.name))
  ) {
    return thrown;
  }

  if (data.isConstructor) {
    return null;
  }

  if (data.receiver) {
    if (
      isErrorTrackerReceiver(data.receiver) &&
      ERROR_TRACKER_METHODS.has(data.method)
    ) {
      return reported;
    }

    if (
      isErrorScopeReceiver(data.receiver) &&
      (ERROR_SCOPE_METHODS.has(data.method) ||
        ERROR_REPORT_METHODS.has(data.method))
    ) {
      return reported;
    }

    // Go: fmt.Errorf, status.Errorf, errors.New, pkgerrors.Wrapf.
    if (ERROR_FORMAT_METHODS.has(data.method)) {
      return thrown;
    }

    if (
      ERRORS_PACKAGE_METHODS.has(data.method) &&
      ERRORS_PACKAGES.has(toLower(data.receiver))
    ) {
      return thrown;
    }
  } else {
    if (
      BARE_ERROR_SCOPE_FUNCTIONS.has(data.method) ||
      ERROR_REPORT_METHODS.has(data.method)
    ) {
      return reported;
    }

    if (BARE_EXCEPTION_FUNCTIONS.has(data.method)) {
      return thrown;
    }
  }

  return ERROR_REPORT_METHODS.has(data.method) ? reported : null;
}

/*
 * What a session call tells a recorded session, as a sink: who its user
 * is, a detail of the user, or its tags (#11458).
 */
function sessionSinkOf(kind: SessionCallKind): ReadSink {
  return {
    sink: SensitiveDataSink.Session,
    isErrorReport: false,
    isIdentity: kind === SessionCallKind.Identity,
    ...(kind === SessionCallKind.Tags ? { isTags: true } : {}),
  };
}

/*
 * A recorded session's identity a call gives (#11395), by its method and
 * what it is called on - a session SDK, or its `people` - or the tags
 * OneUptime's recorder is given (#11458), or null for a call that is no
 * session's.
 */
function readSessionSink(data: {
  method: string;
  receiver: string;
}): ReadSink | null {
  const parts: Array<string> = data.receiver
    ? receiverParts(data.receiver)
    : [];
  const last: string | undefined = parts[parts.length - 1];
  const session: (isIdentity: boolean) => ReadSink = (
    isIdentity: boolean,
  ): ReadSink => {
    return sessionSinkOf(
      isIdentity ? SessionCallKind.Identity : SessionCallKind.UserDetail,
    );
  };

  if (last === undefined) {
    return null;
  }

  // OneUptime's recorder's tags, which only its sessions keep (#11458).
  if (
    ONEUPTIME_SESSION_RECEIVERS.has(last) &&
    SESSION_TAG_METHODS.has(data.method)
  ) {
    return sessionSinkOf(SessionCallKind.Tags);
  }

  if (SESSION_RECEIVERS.has(last)) {
    if (SESSION_IDENTITY_METHODS.has(data.method)) {
      return session(true);
    }

    return SESSION_PROPERTY_METHODS.has(data.method) ? session(false) : null;
  }

  const before: string | undefined = parts[parts.length - 2];

  return last === "people" &&
    before !== undefined &&
    SESSION_RECEIVERS.has(before) &&
    SESSION_PEOPLE_METHODS.has(data.method)
    ? session(false)
    : null;
}

// What a call writes to, and how: getSink's answer, with whether it reports an exception.
export function readSink(data: {
  name: string;
  receiver?: string | undefined;
  isMacro: boolean;
  isConstructor: boolean;
  isThrown?: boolean | undefined;
  instruments?: ReadonlySet<string> | undefined;
}): ReadSink | null {
  const method: string = toLower(lastPartOf(data.name));
  const receiver: string =
    data.receiver !== undefined ? data.receiver : receiverOf(data.name);
  const plain: (sink: SensitiveDataSink) => ReadSink = (
    sink: SensitiveDataSink,
  ): ReadSink => {
    return { sink, isErrorReport: false };
  };

  if (data.isMacro) {
    if (LOG_MACROS.has(method)) {
      return plain(SensitiveDataSink.Log);
    }

    return EXCEPTION_MACROS.has(method)
      ? plain(SensitiveDataSink.Exception)
      : null;
  }

  if (data.isConstructor && AI_FUNCTIONS.has(method)) {
    return plain(SensitiveDataSink.AiPrompt);
  }

  if (
    !data.isConstructor &&
    !data.isThrown &&
    LOG_METHODS.has(method) &&
    receiver &&
    isLogReceiver(receiver)
  ) {
    return plain(SensitiveDataSink.Log);
  }

  const exception: ReadSink | null = readExceptionSink({
    method,
    receiver,
    isConstructor: data.isConstructor,
    isThrown: data.isThrown === true,
    name: data.name,
  });

  if (exception || data.isConstructor) {
    return exception;
  }

  // A session's user (#11395): a tracer's `setUser` stays a span's, below.
  const session: ReadSink | null = readSessionSink({ method, receiver });

  if (session) {
    return session;
  }

  if (SPAN_METHODS.has(method)) {
    return plain(SensitiveDataSink.Span);
  }

  if (SPAN_USER_METHODS.has(method) && receiver && isTraceReceiver(receiver)) {
    return plain(SensitiveDataSink.Span);
  }

  if (receiver && ATTRIBUTE_RECEIVERS.has(toLower(lastPartOf(receiver)))) {
    return plain(SensitiveDataSink.Span);
  }

  if (METRIC_LABEL_METHODS.has(method)) {
    return plain(SensitiveDataSink.Metric);
  }

  if (
    METRIC_METHODS.has(method) &&
    receiver &&
    isMetricReceiver(receiver, data.instruments)
  ) {
    return plain(SensitiveDataSink.Metric);
  }

  if (AI_FUNCTIONS.has(method)) {
    return plain(SensitiveDataSink.AiPrompt);
  }

  if (
    method === "create" &&
    receiver &&
    AI_CREATE_RECEIVERS.has(toLower(lastPartOf(receiver)))
  ) {
    return plain(SensitiveDataSink.AiPrompt);
  }

  if (
    AI_INVOKE_METHODS.has(method) &&
    receiver &&
    AI_INVOKE_RECEIVERS.has(
      withoutLeadingUnderscores(toLower(lastPartOf(receiver))),
    )
  ) {
    return plain(SensitiveDataSink.AiPrompt);
  }

  return null;
}

function isPunct(token: CodeToken | undefined, text: string): boolean {
  return Boolean(
    token && token.kind === CodeTokenKind.Punct && token.text === text,
  );
}

function isWord(
  token: CodeToken | undefined,
  words: ReadonlySet<string>,
): boolean {
  return Boolean(
    token && token.kind === CodeTokenKind.Name && words.has(token.text),
  );
}

/*
 * What stands before a call's name: `new` (a constructor), and `throw` or
 * `raise` before that (an exception thrown where it is made) - read past
 * PHP's root namespace (`throw new \RuntimeException(`).
 */
function readWordsBefore(
  tokens: ReadonlyArray<CodeToken>,
  index: number,
): { isConstructor: boolean; isThrown: boolean } {
  let at: number = index - 1;

  if (isPunct(tokens[at], "\\")) {
    at--;
  }

  const isConstructor: boolean = isWord(tokens[at], NEW_WORDS);

  if (isConstructor) {
    at--;
  }

  return { isConstructor, isThrown: isWord(tokens[at], THROW_WORDS) };
}

/*
 * A session SDK's call with its command first (#11395), read from just
 * past its "(": FullStory's `FS('setIdentity', {...})`, Hotjar's
 * `hj('identify', ...)` - or OneUptime's queue, whose entries are arrays
 * with the command first, `["identify", ref, traits]` and the tags'
 * `["setTags", {...}]` and `["addTag", key, value]` (#11458), as its docs
 * write them over several lines. Each call, read from just past its
 * command - so an identity's first value is the user, never a key - and
 * every entry of one push (`push(["identify", ...], ["setTags", ...])`);
 * none for a call that is no session command.
 */
function findSessionCommand(data: {
  // The call's name as written, and what it is called on: a queue's `push` names its queue.
  name: string;
  receiver: string;
  lines: ReadonlyArray<string>;
  language: CodeLanguage;
  line: number;
  column: number;
}): Array<SinkCall> {
  const method: string = toLower(lastPartOf(data.name));
  const receiverLast: string = withoutLeadingUnderscores(
    toLower(lastPartOf(data.receiver)),
  );
  const isQueue: boolean =
    method === "push" && SESSION_QUEUES.has(receiverLast);
  const commands: ReadonlyMap<string, SessionCallKind> | undefined = isQueue
    ? SESSION_QUEUE_COMMANDS
    : SESSION_COMMAND_FUNCTIONS.get(method);
  const calls: Array<SinkCall> = [];

  if (!commands) {
    return calls;
  }

  const tokens: Array<CodeToken> = tokenize({
    lines: data.lines,
    language: data.language,
    line: data.line,
    column: data.column,
    lastLine: Math.min(data.line + MAX_CALL_LINES, data.lines.length - 1),
    untilClosed: true,
  }).tokens;
  let depth: number = 0;

  for (let index: number = 0; index < tokens.length; index++) {
    const token: CodeToken = tokens[index]!;

    // A command function's command is its first argument; a queue's, each entry's first.
    const isAtCommand: boolean = isQueue
      ? depth === 1 && isPunct(tokens[index - 1], "[")
      : index === 0;
    const kind: SessionCallKind | undefined = isAtCommand
      ? commands.get(toLower(token.text))
      : undefined;

    if (
      isAtCommand &&
      token.kind === CodeTokenKind.String &&
      token.parts.length === 0 &&
      kind !== undefined &&
      isPunct(tokens[index + 1], ",")
    ) {
      const comma: CodeToken = tokens[index + 1]!;

      calls.push({
        sink: SensitiveDataSink.Session,
        name: (isQueue
          ? `${data.receiver}.push(["${token.text}"])`
          : `${data.name}("${token.text}")`
        ).slice(0, SENSITIVE_DATA_LIMITS.maxSubjectLength),
        line: comma.line,
        column: comma.column + 1,
        isParenless: false,
        isIdentity: kind === SessionCallKind.Identity,
        ...(kind === SessionCallKind.Tags ? { isTags: true } : {}),
      });
    }

    // A command function has one command, its first argument.
    if (!isQueue) {
      return calls;
    }

    if (token.kind === CodeTokenKind.Punct) {
      if (token.text === "(" || token.text === "[" || token.text === "{") {
        depth++;
      } else if (
        token.text === ")" ||
        token.text === "]" ||
        token.text === "}"
      ) {
        depth = Math.max(0, depth - 1);
      }
    }
  }

  return calls;
}

/*
 * The calls to a sink on one line, read from its tokens: a name followed
 * by "(" (or Rust's "!(", or `new Name(`), a chained call's method after
 * the call before it (`metrics.counter("x").add(`), and - in Ruby - a log
 * call with no parentheses (`logger.info "..."`), and in Ruby and Elixir an
 * exception raised with none (`raise ArgumentError, "..."`).
 */
export function findSinkCalls(data: {
  lines: ReadonlyArray<string>;
  line: number;
  language: CodeLanguage;
  isRuby: boolean;
  // Elixir raises with no parentheses as Ruby does.
  isElixir?: boolean | undefined;
  // The names the file makes a metric's instrument of (findMetricInstruments).
  instruments?: ReadonlySet<string> | undefined;
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
  /*
   * A "(" that is no call's - a group - and the first name in it: what a
   * queue's `push` is called on in `(window.OneUptimeReplayQueue =
   * window.OneUptimeReplayQueue || []).push(...)` (#11395).
   */
  const openGroups: Array<string> = [];
  let lastClosedGroup: string = "";

  for (let index: number = 0; index < tokens.length; index++) {
    const token: CodeToken = tokens[index]!;

    if (token.kind === CodeTokenKind.Punct) {
      if (token.text === "(") {
        const before: CodeToken | undefined = tokens[index - 1];
        openCalls.push(
          before && before.kind === CodeTokenKind.Name ? before.text : "",
        );
        openGroups.push("");
      } else if (token.text === ")") {
        lastClosedCall = openCalls.pop() || "";
        lastClosedGroup = openGroups.pop() || "";
      }

      continue;
    }

    if (token.kind !== CodeTokenKind.Name) {
      continue;
    }

    if (
      openCalls.length > 0 &&
      openCalls[openCalls.length - 1] === "" &&
      openGroups[openGroups.length - 1] === ""
    ) {
      openGroups[openGroups.length - 1] = token.text;
    }

    const next: CodeToken | undefined = tokens[index + 1];
    const afterNext: CodeToken | undefined = tokens[index + 2];
    const before: CodeToken | undefined = tokens[index - 1];
    const isChained: boolean =
      isPunct(before, ".") && isPunct(tokens[index - 2], ")");
    const wordsBefore: { isConstructor: boolean; isThrown: boolean } =
      readWordsBefore(tokens, index);

    let open: CodeToken | undefined = undefined;
    let isMacro: boolean = false;

    if (isPunct(next, "(")) {
      open = next;
    } else if (isPunct(next, "!") && isPunct(afterNext, "(")) {
      open = afterNext;
      isMacro = true;
    }

    if (open) {
      const read: ReadSink | null = readSink({
        name: token.text,
        receiver: isChained ? lastClosedCall : undefined,
        isMacro,
        isConstructor: wordsBefore.isConstructor,
        isThrown: wordsBefore.isThrown,
        instruments: data.instruments,
      });

      if (read) {
        calls.push({
          sink: read.sink,
          name: isChained ? `${lastClosedCall}.${token.text}` : token.text,
          line: data.line,
          column: open.column + 1,
          isParenless: false,
          ...(read.isErrorReport ? { isErrorReport: true } : {}),
          ...(read.isIdentity !== undefined
            ? { isIdentity: read.isIdentity }
            : {}),
          ...(read.isTags ? { isTags: true } : {}),
        });

        continue;
      }

      // A session SDK's command, or OneUptime's queue's each (#11395, #11458).
      const commands: Array<SinkCall> =
        isMacro || wordsBefore.isConstructor
          ? []
          : findSessionCommand({
              name: token.text,
              receiver: isChained
                ? lastClosedCall || lastClosedGroup
                : receiverOf(token.text),
              lines: data.lines,
              language: data.language,
              line: data.line,
              column: open.column + 1,
            });

      calls.push(...commands);

      continue;
    }

    const isOnItsLine: boolean = Boolean(
      next &&
        next.line === token.line &&
        (next.kind === CodeTokenKind.String ||
          next.kind === CodeTokenKind.Name),
    );

    // Ruby's and Elixir's `raise ArgumentError, "bad #{email}"`, with no parentheses.
    if (
      (data.isRuby || data.isElixir) &&
      isOnItsLine &&
      PARENLESS_RAISE_WORDS.has(token.text) &&
      (data.isRuby || token.text === "raise") &&
      !isPunct(before, ".")
    ) {
      // Named as it is written: `raise ArgumentError`, or `raise` alone before a message.
      calls.push({
        sink: SensitiveDataSink.Exception,
        name:
          next!.kind === CodeTokenKind.Name
            ? `${token.text} ${next!.text}`
            : token.text,
        line: data.line,
        column: next!.column,
        isParenless: true,
      });

      continue;
    }

    // Ruby's `logger.info "signup #{email}"`, with no parentheses.
    if (data.isRuby && isOnItsLine) {
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
          column: next!.column,
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
  [SensitiveDataSink.Exception]: "Writes {{what}} to an exception",
  [SensitiveDataSink.Session]: "Identifies a recorded session by {{what}}",
};

/*
 * A value a session's call is handed is who its user is - handed on its
 * own, or under the key an identity is (`uid`, `id`) - or one of the
 * user's traits, under its key (#11395). A tag is never who the user is,
 * whatever its key (#11458).
 */
function isSessionLabel(
  call: Pick<SinkCall, "isTags">,
  value: Pick<WrittenValue, "key">,
): boolean {
  if (call.isTags) {
    return false;
  }

  return (
    !value.key || SESSION_IDENTITY_KEYS.has(toLower(lastPartOf(value.key)))
  );
}

// Why a session's tag is a point of its own (#11458): who reads it.
export const SESSION_TAGS_WHY: string =
  "A session's tags are stored as sent, and everyone who can list sessions reads them.";

/*
 * How a point's sentence says where its value goes: an exception's
 * message when the value is in it, or handed to the error on its own; an
 * error report when a tracker or a span is handed it; who a recorded
 * session is, or one of its user's traits.
 */
function sinkWordsOf(
  call: SinkCall,
  value: Pick<WrittenValue, "key" | "isInString">,
): string {
  if (call.sink === SensitiveDataSink.Session) {
    if (call.isTags) {
      return "Writes {{what}} to a recorded session's tags";
    }

    return isSessionLabel(call, value)
      ? SINK_WORDS[SensitiveDataSink.Session]
      : "Writes {{what}} to a recorded session's user";
  }

  if (call.sink !== SensitiveDataSink.Exception) {
    return SINK_WORDS[call.sink];
  }

  if (call.isErrorReport) {
    return "Writes {{what}} to an error report";
  }

  return value.isInString || !value.key
    ? "Writes {{what}} to an exception's message"
    : SINK_WORDS[SensitiveDataSink.Exception];
}

/*
 * Where production would keep what a call writes, as a telemetry finding
 * names it: an attribute under its key, a log's body - and an exception's
 * message, or the attribute an error report is handed it under; a
 * session's user label, or the trait it is handed under (#11395); a
 * session's tag, under its key (#11458).
 */
function locationOf(call: SinkCall, value: Pick<WrittenValue, "key">): string {
  if (call.sink === SensitiveDataSink.Session) {
    // A tag under its key; one whose key is not spelled out, the tags whole (#11458).
    if (call.isTags) {
      return value.key
        ? `${SESSION_TAGS_LOCATION_PREFIX}${value.key}`
        : SESSION_TAGS_LOCATION;
    }

    return isSessionLabel(call, value)
      ? SESSION_LABEL_LOCATION
      : `${SESSION_TRAITS_LOCATION_PREFIX}${value.key}`;
  }

  if (call.sink === SensitiveDataSink.Exception) {
    return call.isErrorReport && value.key
      ? `attributes.${value.key}`
      : "message";
  }

  return value.key ? `attributes.${value.key}` : "body";
}

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
  words: string;
  what: string;
  subject: string;
  where: string;
}): string {
  return `${data.words.replace("{{what}}", data.what)}: \`${data.subject}\`, in \`${data.where}\`.`;
}

// A point's sentence, with who reads a session's tags after it when it is about one (#11458).
function withSessionTagsWhy(call: SinkCall, text: string): string {
  return call.sink === SensitiveDataSink.Session && call.isTags
    ? `${text} ${SESSION_TAGS_WHY}`
    : text;
}

/*
 * The change that fixes a candidate, in English: leave it out, or hash it -
 * or, when the change already passes values through a function that
 * redacts or masks them, use that. An exception's message names the field
 * it is about, never what the field held; a recorded session is
 * identified by an opaque id, never by what the person is (#11395).
 */
function fixOf(data: {
  sink: SensitiveDataSink;
  subject: string;
  isSecret: boolean;
  whole: WholeObjectKind | null;
  helper: string | null;
  isErrorReport?: boolean | undefined;
  // A session's: who its user is, rather than one of the user's traits.
  isSessionLabel?: boolean | undefined;
  // A session's tag (#11458).
  isSessionTag?: boolean | undefined;
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

  // Masked, every user would be one: an id tells them apart.
  if (data.sink === SensitiveDataSink.Session && data.isSessionLabel) {
    return `Identify the session by an opaque id, such as the user's id, never by \`${data.subject}\`.`;
  }

  if (data.helper) {
    return `Pass \`${data.subject}\` through \`${data.helper}\` first, as this change does elsewhere, or leave it out.`;
  }

  if (data.sink === SensitiveDataSink.Exception) {
    return data.isErrorReport
      ? `Leave \`${data.subject}\` out of the error report, or send a hash of it when you need to tell values apart.`
      : `Leave \`${data.subject}\` out of the exception: name the field it is about, never what it holds.`;
  }

  if (data.sink === SensitiveDataSink.Session && data.isSessionTag) {
    return `Leave \`${data.subject}\` out of the session's tags, or tag the session with an opaque value instead, such as an id.`;
  }

  if (data.sink === SensitiveDataSink.Session) {
    return `Leave \`${data.subject}\` out of the session's user details, or send a hash of it when you need to tell users apart.`;
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
 * A call written with no parentheses, as far as it goes: to its line's
 * end, or to a statement modifier outside any bracket (`raise "..." unless
 * customer`, `logger.info "..." if debug`), which only asks about what
 * follows it.
 */
export function untilStatementModifier(
  tokens: Array<CodeToken>,
): Array<CodeToken> {
  let depth: number = 0;

  for (let index: number = 0; index < tokens.length; index++) {
    const token: CodeToken = tokens[index]!;

    if (token.kind === CodeTokenKind.Punct) {
      if (token.text === "(" || token.text === "[" || token.text === "{") {
        depth++;
      } else if (
        token.text === ")" ||
        token.text === "]" ||
        token.text === "}"
      ) {
        depth = Math.max(0, depth - 1);
      }

      continue;
    }

    if (
      depth === 0 &&
      token.kind === CodeTokenKind.Name &&
      PARENLESS_CALL_ENDS.has(token.text)
    ) {
      return tokens.slice(0, index);
    }
  }

  return tokens;
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
  const instruments: Set<string> = findMetricInstruments(texts, language);

  for (let index: number = 0; index < newLines.length; index++) {
    // A call that starts on a line a hunk shows, added or not.
    const calls: Array<SinkCall> = findSinkCalls({
      lines: texts,
      line: index,
      language,
      isRuby: extension === "rb",
      isElixir: extension === "ex" || extension === "exs",
      instruments,
    });

    for (const call of calls) {
      const maxLines: number =
        call.sink === SensitiveDataSink.AiPrompt
          ? MAX_PROMPT_CALL_LINES
          : MAX_CALL_LINES;
      const read: Array<CodeToken> = tokenize({
        lines: texts,
        language,
        line: call.line,
        column: call.column,
        lastLine: call.isParenless ? call.line : call.line + maxLines,
        untilClosed: !call.isParenless,
      }).tokens;
      const tokens: Array<CodeToken> = call.isParenless
        ? untilStatementModifier(read)
        : read;

      for (const value of readWrittenValues({
        tokens,
        sinkName: call.name,
        extension,
        /*
         * A log's first string is its message, and so is an exception's: a
         * tracker's is its key (`scope.setTag("ssn", ssn)`). A session's
         * identity is its user (`identify("u-1", traits)`); a user's
         * detail its key (`setUserProperty("plan", plan)`).
         */
        isFirstStringMessage:
          call.sink === SensitiveDataSink.Log ||
          (call.sink === SensitiveDataSink.Exception && !call.isErrorReport) ||
          (call.sink === SensitiveDataSink.Session && call.isIdentity === true),
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
      text: withSessionTagsWhy(
        data.call,
        `${sentenceOf({
          words: sinkWordsOf(data.call, value),
          what: WHOLE_WORDS[value.whole],
          subject,
          where,
        })} ${WHOLE_WHY[value.whole]}`,
      ),
      fix: fixOf({
        sink: data.call.sink,
        subject,
        isSecret,
        whole: value.whole,
        helper: data.helper,
        isErrorReport: data.call.isErrorReport,
        isSessionLabel: isSessionLabel(data.call, value),
        isSessionTag: data.call.isTags === true,
      }),
      location: locationOf(data.call, value),
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
    text: withSessionTagsWhy(
      data.call,
      sentenceOf({
        words: sinkWordsOf(data.call, value),
        what: describeDataType(types[0]!),
        subject,
        where,
      }),
    ),
    fix: fixOf({
      sink: data.call.sink,
      subject,
      isSecret,
      whole: null,
      helper: data.helper,
      isErrorReport: data.call.isErrorReport,
      isSessionLabel: isSessionLabel(data.call, value),
      isSessionTag: data.call.isTags === true,
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
    /*
     * Under its key, an attribute; in the message itself, the log's body -
     * or the exception's message.
     */
    location: locationOf(data.call, value),
  };
}
