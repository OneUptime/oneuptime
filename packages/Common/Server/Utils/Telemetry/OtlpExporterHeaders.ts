import Dictionary from "../../../Types/Dictionary";

/*
 * The headers OneUptime's own traces, metrics and logs are exported with:
 * OPENTELEMETRY_EXPORTER_OTLP_HEADERS, which the Helm chart sets from
 * openTelemetryExporter.headers.
 *
 * Headers are separated by ';', and each is written name=value. A header is
 * split at its FIRST '=' only, because a value may hold '=' itself: a Basic
 * Authorization value ends in base64 padding, and many tokens end in '='.
 * Splitting at every '=' dropped such a header without a word, and with it,
 * when it was the only one, everything OneUptime exports - Telemetry.init
 * exports a signal only with a header.
 *
 * A part that cannot be sent as a header is left out and reported by its place
 * and its reason only. These headers hold credentials, so a report never
 * holds a name or a value: a name OneUptime cannot read may well be a token
 * written without its name.
 */

export const OTLP_EXPORTER_HEADERS_SETTING: string =
  "OPENTELEMETRY_EXPORTER_OTLP_HEADERS";

export const OTLP_EXPORTER_HEADERS_HELM_VALUE: string =
  "openTelemetryExporter.headers";

const HEADER_SEPARATOR: string = ";";

const NAME_VALUE_SEPARATOR: string = "=";

/*
 * A header name is an HTTP token (RFC 9110, section 5.6.2), the same rule
 * Node's http module applies before it sends a request. A name outside it
 * makes every export request throw before it leaves, which the exporters
 * report to nobody.
 */
const HEADER_NAME_REGEX: RegExp = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;

/*
 * A value of nothing but '=' is base64 padding: a token written without its
 * name, read as a name (the token) and a value (its padding). Sending it would
 * put the token where a header's name goes.
 */
const ONLY_EQUALS_SIGNS_REGEX: RegExp = /^=+$/;

export enum UnreadableOtlpHeaderReason {
  NoEqualsSign = "no-equals-sign",
  NoName = "no-name",
  NameNotAllowed = "name-not-allowed",
  NoValue = "no-value",
  OnlyEqualsSigns = "only-equals-signs",
  ValueNotAllowed = "value-not-allowed",
}

export interface UnreadableOtlpHeader {
  /*
   * The header's place among the headers written, from 1. Empty parts (a
   * trailing ';', or ';;') are not headers and are not counted.
   */
  position: number;
  reason: UnreadableOtlpHeaderReason;
}

export interface OtlpExporterHeaders {
  // The headers OneUptime sends, by name.
  headers: Dictionary<string>;
  // How many headers the setting holds: its parts that are not empty.
  written: number;
  // The headers it holds that cannot be sent, in the order they are written.
  unreadable: Array<UnreadableOtlpHeader>;
}

/*
 * What Node's http module accepts in a header value: a tab, visible ASCII and
 * a space, and Latin-1 (its checkInvalidHeaderChar). A line break or another
 * control character, or a character past Latin-1, makes the request throw.
 */
const isAllowedHeaderValue: (value: string) => boolean = (
  value: string,
): boolean => {
  for (let index: number = 0; index < value.length; index++) {
    const code: number = value.charCodeAt(index);

    const allowed: boolean =
      code === 0x09 ||
      (code >= 0x20 && code <= 0x7e) ||
      (code >= 0x80 && code <= 0xff);

    if (!allowed) {
      return false;
    }
  }

  return true;
};

const readHeader: (
  part: string,
) =>
  | { name: string; value: string }
  | { reason: UnreadableOtlpHeaderReason } = (
  part: string,
): { name: string; value: string } | { reason: UnreadableOtlpHeaderReason } => {
  const separatorIndex: number = part.indexOf(NAME_VALUE_SEPARATOR);

  if (separatorIndex < 0) {
    return { reason: UnreadableOtlpHeaderReason.NoEqualsSign };
  }

  const name: string = part.substring(0, separatorIndex).trim();
  const value: string = part
    .substring(separatorIndex + NAME_VALUE_SEPARATOR.length)
    .trim();

  if (!name) {
    return { reason: UnreadableOtlpHeaderReason.NoName };
  }

  if (!HEADER_NAME_REGEX.test(name)) {
    return { reason: UnreadableOtlpHeaderReason.NameNotAllowed };
  }

  if (!value) {
    return { reason: UnreadableOtlpHeaderReason.NoValue };
  }

  if (ONLY_EQUALS_SIGNS_REGEX.test(value)) {
    return { reason: UnreadableOtlpHeaderReason.OnlyEqualsSigns };
  }

  if (!isAllowedHeaderValue(value)) {
    return { reason: UnreadableOtlpHeaderReason.ValueNotAllowed };
  }

  return { name, value };
};

export const readOtlpExporterHeaders: (
  setting: string | undefined,
) => OtlpExporterHeaders = (
  setting: string | undefined,
): OtlpExporterHeaders => {
  const result: OtlpExporterHeaders = {
    headers: {},
    written: 0,
    unreadable: [],
  };

  if (!setting) {
    return result;
  }

  for (const part of setting.split(HEADER_SEPARATOR)) {
    if (!part.trim()) {
      continue;
    }

    result.written++;

    const header:
      | { name: string; value: string }
      | { reason: UnreadableOtlpHeaderReason } = readHeader(part);

    if ("reason" in header) {
      result.unreadable.push({
        position: result.written,
        reason: header.reason,
      });
      continue;
    }

    // A name written twice keeps its last value, as it always has.
    result.headers[header.name] = header.value;
  }

  return result;
};

const REASON_WORDS: Record<UnreadableOtlpHeaderReason, string> = {
  [UnreadableOtlpHeaderReason.NoEqualsSign]:
    "has no '=' between a name and a value",
  [UnreadableOtlpHeaderReason.NoName]: "has nothing before its first '='",
  [UnreadableOtlpHeaderReason.NameNotAllowed]:
    "has a name, before its first '=', with a character no header name may hold, such as a space or ':'",
  [UnreadableOtlpHeaderReason.NoValue]: "has nothing after its first '='",
  [UnreadableOtlpHeaderReason.OnlyEqualsSigns]:
    "has only '=' after its first '=', as a value ending in '=' does when it is written without a name",
  [UnreadableOtlpHeaderReason.ValueNotAllowed]:
    "has a value with a character no header value may hold, such as a line break",
};

const listPositions: (positions: Array<number>) => string = (
  positions: Array<number>,
): string => {
  if (positions.length <= 1) {
    return positions.join("");
  }

  return `${positions.slice(0, -1).join(", ")} and ${positions[positions.length - 1]}`;
};

/*
 * One line for the operator, naming each header OneUptime leaves out by its
 * place and saying why, or null when every header can be sent. It never
 * holds anything the setting holds.
 */
export const describeUnreadableOtlpHeaders: (
  read: OtlpExporterHeaders,
) => string | null = (read: OtlpExporterHeaders): string | null => {
  if (read.unreadable.length === 0) {
    return null;
  }

  const one: boolean = read.unreadable.length === 1;

  const positions: string = listPositions(
    read.unreadable.map((header: UnreadableOtlpHeader): number => {
      return header.position;
    }),
  );

  const reasons: string = read.unreadable
    .map((header: UnreadableOtlpHeader): string => {
      return `Header ${header.position} ${REASON_WORDS[header.reason]}.`;
    })
    .join(" ");

  return [
    `${OTLP_EXPORTER_HEADERS_SETTING} (${OTLP_EXPORTER_HEADERS_HELM_VALUE} in the Helm chart):`,
    `OneUptime cannot read ${one ? "header" : "headers"} ${positions} of ${read.written}, so it does not send ${one ? "it" : "them"}.`,
    reasons,
    "Write each header as name=value, and separate headers with ';'.",
  ].join(" ");
};

/*
 * The line for an exporter endpoint that is set while no header can be sent:
 * OneUptime then exports nothing at all (see Telemetry.init).
 */
export const NOTHING_EXPORTED_WITHOUT_A_HEADER: string = [
  "OneUptime sends none of its own traces, metrics or logs:",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but",
  `${OTLP_EXPORTER_HEADERS_SETTING} (${OTLP_EXPORTER_HEADERS_HELM_VALUE} in the Helm chart)`,
  "holds no header it can send, and it exports only with one.",
  "Set at least one header, written as name=value, such as the x-oneuptime-token header with a Server ingestion key.",
].join(" ");
