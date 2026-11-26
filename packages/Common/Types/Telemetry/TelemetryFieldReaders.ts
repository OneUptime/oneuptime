/*
 * WHAT READS A LOG'S OR A SPAN'S FIELDS, AS AN ANSWER NAMES IT (#10433).
 *
 * A scrub rule changes what is stored of a log or a span before anything
 * reads it: a value it hides is gone from every record it reaches. What the
 * project saved that reads those values then reads what the rule left: a
 * monitor filtering on user.email never matches again and stays green, one
 * grouped by client.address resolves every group's alert and opens one
 * "[REDACTED]" group, a recording rule grouped by it writes one series.
 * So before a rule is made or turned on, OneUptime says which records read
 * what it would hide, the way Drop This Metric says what reads a metric
 * (Types/Metrics/MetricOutputReaders, Server/Utils/Telemetry/MetricReaders).
 *
 * The lookup (Server/Utils/Telemetry/TelemetryFieldReaders) reads the
 * project's monitors, dashboards, saved views, recording rules and SLOs,
 * and asks of each the question its caller asks - a scrub rule's today, a
 * drop or sample filter's next (#10436) - and Security Events' scans, which
 * read the logs and spans themselves (SecurityEventsFieldReads). This file
 * is the answer's shape, read by the server and the Dashboard alike.
 */

// The kinds of saved record that read a log's or a span's fields.
export enum TelemetryFieldReaderKind {
  Monitor = "Monitor",
  Dashboard = "Dashboard",
  SavedView = "SavedView",
  RecordingRule = "RecordingRule",
  ServiceLevelObjective = "ServiceLevelObjective",
}

export const TELEMETRY_FIELD_READER_KINDS: ReadonlyArray<TelemetryFieldReaderKind> =
  [
    TelemetryFieldReaderKind.Monitor,
    TelemetryFieldReaderKind.Dashboard,
    TelemetryFieldReaderKind.SavedView,
    TelemetryFieldReaderKind.RecordingRule,
    TelemetryFieldReaderKind.ServiceLevelObjective,
  ];

// The records a field is read from: a log's, or a span's (an exception's is its span's).
export type TelemetryFieldSignal = "log" | "trace";

// The part of a record a query reads.
export enum TelemetryFieldPart {
  // A log's message.
  Body = "body",
  // A log's or a span's attributes.
  Attributes = "attributes",
  // A span's name.
  SpanName = "spanName",
  // A span's status message.
  StatusMessage = "statusMessage",
  // A span's events: an exception's message, type and attributes are copies of one.
  Events = "events",
}

// How a query reads it.
export enum TelemetryFieldUse {
  // Keeps the records whose field is, or is not, a value.
  Filter = "filter",
  // Keeps the records whose text contains a value.
  Search = "search",
  // Splits the records by the field's values.
  GroupBy = "groupBy",
  // Adds up, averages or ranks the field's numbers.
  Value = "value",
}

// One way a record reads a field: what an answer says of a reader.
export interface TelemetryFieldRead {
  part: TelemetryFieldPart;
  // An attribute's key, as the record names it.
  key?: string | undefined;
  use: TelemetryFieldUse;
}

// A dashboard's widget that reads the field, as its dashboard names it.
export interface TelemetryFieldReaderWidget {
  // The id the board draws it under: a link opens the dashboard at it.
  id: string;
  // Its title, or "" when it has none.
  title: string;
  // Its componentType ("LogChart"), which names it when it has no title.
  type: string;
}

// Which list a saved view or a recording rule is in.
export enum TelemetryFieldReaderList {
  Logs = "logs",
  Traces = "traces",
  Exceptions = "exceptions",
}

// A record that reads a field the change takes away.
export interface TelemetryFieldReader {
  id: string;
  // As its person named it; "" when it has none.
  name: string;
  // A saved view's explorer, or a recording rule's list.
  list?: TelemetryFieldReaderList | undefined;
  // A dashboard's: the widgets on it that read the field, in their order on it.
  widgets?: Array<TelemetryFieldReaderWidget> | undefined;
  // What of the field it reads: the first few, each once.
  reads: Array<TelemetryFieldRead>;
}

export interface TelemetryFieldReadersOfKind {
  // Those the person asking may read, by name.
  readers: Array<TelemetryFieldReader>;
  // How many more read it that they may not read: counted, never named.
  hiddenCount: number;
  // False when the records could not be read just now: nothing is known of them.
  isChecked: boolean;
}

export type TelemetryFieldReadersByKind = Record<
  TelemetryFieldReaderKind,
  TelemetryFieldReadersOfKind
>;

/*
 * SECURITY EVENTS, WHICH READS THE LOGS AND SPANS THEMSELVES.
 *
 * Not a saved query but two scans: "Your logs" reads every line of the
 * project's logs for sign-ins, web attacks and firewall records; the
 * Traces source reads every request's span for attacks in its URL, and
 * "Your logs" follows a line into its request's span for the client's
 * address (Server/Utils/SecurityEvent/SecurityEventsReadTelemetry). What a
 * change can take from them is what they name an attack by.
 */
export enum SecurityEventsTelemetrySource {
  // "Your logs": SecurityLogSource.
  Logs = "logs",
  // "Your OneUptime data" of kind Traces: SecurityTelemetrySource.
  Traces = "traces",
}

export enum SecurityEventsFieldNeed {
  /*
   * The address a request or a sign-in came from: the event's principalIp,
   * the address its Response Plan blocks, what threat intel, entity risk
   * and campaigns are read by.
   */
  ClientAddresses = "clientAddresses",
  // Who signed in or acted: brute force and the other per-user rules count by it.
  UserNames = "userNames",
}

export interface SecurityEventsFieldReads {
  // False when the sources could not be read just now: nothing is known.
  isChecked: boolean;
  // The scans that read the signal: none when Security Events reads none of it.
  sources: Array<SecurityEventsTelemetrySource>;
  // What the change takes from them: none when it takes nothing they read.
  loses: Array<SecurityEventsFieldNeed>;
}

// Everything that reads what a change takes away, kind by kind.
export interface TelemetryFieldReaders {
  kinds: TelemetryFieldReadersByKind;
  securityEvents: SecurityEventsFieldReads;
}

/*
 * A scrub rule being written or turned on, as the rule form asks what it
 * would take away (ScrubRuleReadersAPI): the rule's own fields, as the form
 * holds them.
 */
export const SCRUB_RULE_READERS_API_PATH: string =
  "/telemetry/scrub-rule-readers";

export interface ScrubRuleReadersRequest {
  signal: TelemetryFieldSignal;
  patternType: string;
  customRegex?: string | undefined;
  scrubAction?: string | undefined;
  fieldsToScrub?: string | undefined;
  // The service it is for; none for every service.
  serviceId?: string | null | undefined;
  // The attributes it names (#10366): a Named Attributes rule's, or a pattern's only ones.
  attributeKeys?: Array<string> | undefined;
}

export function getEmptyTelemetryFieldReadersByKind(
  isChecked: boolean,
): TelemetryFieldReadersByKind {
  return {
    [TelemetryFieldReaderKind.Monitor]: {
      readers: [],
      hiddenCount: 0,
      isChecked,
    },
    [TelemetryFieldReaderKind.Dashboard]: {
      readers: [],
      hiddenCount: 0,
      isChecked,
    },
    [TelemetryFieldReaderKind.SavedView]: {
      readers: [],
      hiddenCount: 0,
      isChecked,
    },
    [TelemetryFieldReaderKind.RecordingRule]: {
      readers: [],
      hiddenCount: 0,
      isChecked,
    },
    [TelemetryFieldReaderKind.ServiceLevelObjective]: {
      readers: [],
      hiddenCount: 0,
      isChecked,
    },
  };
}

/*
 * An answer as it arrived, read defensively for a page: a reader without an
 * id or a name is no reader, a widget without an id no widget, a reading of
 * a part or a use no answer names is dropped, and a count that is no count
 * is none. A kind or Security Events the answer does not say was checked
 * is said to be unchecked, never empty.
 */
const UUID_PATTERN: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asArray(value: unknown): Array<unknown> {
  return Array.isArray(value) ? value : [];
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function isOneOf<T extends string>(
  values: ReadonlyArray<T>,
  value: unknown,
): value is T {
  return (
    typeof value === "string" &&
    (values as ReadonlyArray<string>).includes(value)
  );
}

function readReader(value: unknown): TelemetryFieldReader | null {
  const entry: Record<string, unknown> = asObject(value);
  const id: string = textOf(entry["id"]);

  if (!UUID_PATTERN.test(id) || typeof entry["name"] !== "string") {
    return null;
  }

  const reader: TelemetryFieldReader = {
    id,
    name: entry["name"],
    reads: asArray(entry["reads"])
      .map(asObject)
      .filter((read: Record<string, unknown>): boolean => {
        return (
          isOneOf(Object.values(TelemetryFieldPart), read["part"]) &&
          isOneOf(Object.values(TelemetryFieldUse), read["use"])
        );
      })
      .map((read: Record<string, unknown>): TelemetryFieldRead => {
        const field: TelemetryFieldRead = {
          part: read["part"] as TelemetryFieldPart,
          use: read["use"] as TelemetryFieldUse,
        };

        if (typeof read["key"] === "string" && read["key"]) {
          field.key = read["key"];
        }

        return field;
      }),
  };

  if (isOneOf(Object.values(TelemetryFieldReaderList), entry["list"])) {
    reader.list = entry["list"];
  }

  if (Array.isArray(entry["widgets"])) {
    reader.widgets = entry["widgets"]
      .map(asObject)
      .filter((widget: Record<string, unknown>): boolean => {
        return Boolean(textOf(widget["id"]));
      })
      .map((widget: Record<string, unknown>): TelemetryFieldReaderWidget => {
        return {
          id: textOf(widget["id"]),
          title: textOf(widget["title"]),
          type: textOf(widget["type"]),
        };
      });
  }

  return reader;
}

export function readTelemetryFieldReaders(
  value: unknown,
): TelemetryFieldReaders {
  const answer: Record<string, unknown> = asObject(value);
  const kinds: Record<string, unknown> = asObject(answer["kinds"]);
  const read: TelemetryFieldReadersByKind =
    getEmptyTelemetryFieldReadersByKind(false);

  for (const kind of TELEMETRY_FIELD_READER_KINDS) {
    const ofKind: Record<string, unknown> = asObject(kinds[kind]);
    const hidden: unknown = ofKind["hiddenCount"];

    read[kind] = {
      readers: asArray(ofKind["readers"])
        .map(readReader)
        .filter((reader: TelemetryFieldReader | null): boolean => {
          return reader !== null;
        }) as Array<TelemetryFieldReader>,
      hiddenCount:
        typeof hidden === "number" && Number.isInteger(hidden) && hidden > 0
          ? hidden
          : 0,
      isChecked: ofKind["isChecked"] === true,
    };
  }

  const securityEvents: Record<string, unknown> = asObject(
    answer["securityEvents"],
  );

  return {
    kinds: read,
    securityEvents: {
      isChecked: securityEvents["isChecked"] === true,
      sources: asArray(securityEvents["sources"]).filter(
        (source: unknown): source is SecurityEventsTelemetrySource => {
          return isOneOf(Object.values(SecurityEventsTelemetrySource), source);
        },
      ),
      loses: asArray(securityEvents["loses"]).filter(
        (need: unknown): need is SecurityEventsFieldNeed => {
          return isOneOf(Object.values(SecurityEventsFieldNeed), need);
        },
      ),
    },
  };
}

// Whether anything reads what the change takes away: a reader named or counted, or Security Events.
export function isAnyTelemetryFieldRead(
  readers: TelemetryFieldReaders,
): boolean {
  return (
    TELEMETRY_FIELD_READER_KINDS.some((kind: TelemetryFieldReaderKind) => {
      const ofKind: TelemetryFieldReadersOfKind = readers.kinds[kind];

      return ofKind.readers.length > 0 || ofKind.hiddenCount > 0;
    }) || readers.securityEvents.loses.length > 0
  );
}

// Whether every kind could be read: only then is "nothing reads it" true.
export function isEveryTelemetryFieldReaderChecked(
  readers: TelemetryFieldReaders,
): boolean {
  return (
    TELEMETRY_FIELD_READER_KINDS.every((kind: TelemetryFieldReaderKind) => {
      return readers.kinds[kind].isChecked;
    }) && readers.securityEvents.isChecked
  );
}
