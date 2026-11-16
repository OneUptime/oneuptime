import Dictionary from "../../../Types/Dictionary";

/*
 * The headers OneUptime's own traces, metrics and logs are exported with:
 * OPENTELEMETRY_EXPORTER_OTLP_HEADERS, which the Helm chart sets from
 * openTelemetryExporter.headers.
 *
 * Each header is written name=value, and split at its FIRST '=' only,
 * because a value may hold '=' itself: a Basic Authorization value ends in
 * base64 padding, and many tokens end in '='. Splitting at every '=' dropped
 * such a header without a word, and with it, when it was the only one,
 * everything OneUptime exports - Telemetry.init exports a signal only with a
 * header.
 *
 * Headers are separated in one of two ways (issue #7162):
 *
 *   - OneUptime's own: ';' between headers, each value as written, so a
 *     value may hold ',' or '%' as it is.
 *   - The OpenTelemetry standard's, OTEL_EXPORTER_OTLP_HEADERS's: ',' between
 *     headers, each value percent-encoded (a space as %20, a ',' as %2C), as
 *     W3C Baggage writes them. It is what a backend's setup guide gives, so
 *     it is what an operator copies, and until it was read "x-a=1,x-b=2"
 *     was sent as one header x-a with the value "1,x-b=2" - without a word,
 *     as that is a valid header.
 *
 * A setting with a ';' is OneUptime's, as every setting was. One without a
 * ';' is the standard's when every part between its commas is a header - a
 * name a header may have, an '=' and a value - one header alone included,
 * and its values are then percent-decoded as the standard says. Anything
 * else is one header written OneUptime's way, its commas part of its value,
 * as before: "x-list=a,b" stays one header, since "b" is not one. So a
 * setting that worked keeps working, unless it was one header whose value
 * holds ",name=value" or a percent-encoding meant as written; a ';' at its
 * end keeps such a setting OneUptime's.
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

// The OpenTelemetry standard's own variable, whose form OneUptime also reads.
export const OTEL_EXPORTER_OTLP_HEADERS_SETTING: string =
  "OTEL_EXPORTER_OTLP_HEADERS";

const ONEUPTIME_HEADER_SEPARATOR: string = ";";

const STANDARD_HEADER_SEPARATOR: string = ",";

const NAME_VALUE_SEPARATOR: string = "=";

/*
 * A run of percent-encoded octets: "%20", or "%E2%9C%93" for one character.
 * A '%' that does not start two hex digits is not one, and stays as written.
 */
const PERCENT_ENCODED_OCTETS_REGEX: RegExp = /(?:%[0-9A-Fa-f]{2})+/g;

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
   * The header's place among the headers written, from 1, counted between
   * the separator the setting is read with. Empty parts (a trailing ';' or
   * ',', or ';;') are not headers and are not counted.
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

/*
 * A value as the standard writes it, decoded: each run of percent-encoded
 * octets read as UTF-8. Octets that are not UTF-8 read as U+FFFD, as W3C
 * Baggage says, which no header value may hold, so such a header is
 * reported, not sent garbled. Only the value is decoded: a name is an HTTP
 * token, which is written as it is.
 */
const percentDecode: (value: string) => string = (value: string): string => {
  return value.replace(
    PERCENT_ENCODED_OCTETS_REGEX,
    (octets: string): string => {
      return Buffer.from(octets.split("%").join(""), "hex").toString("utf8");
    },
  );
};

// A part's name and value, split at its first '=' and trimmed; null without one.
const splitNameAndValue: (
  part: string,
) => { name: string; value: string } | null = (
  part: string,
): { name: string; value: string } | null => {
  const separatorIndex: number = part.indexOf(NAME_VALUE_SEPARATOR);

  if (separatorIndex < 0) {
    return null;
  }

  return {
    name: part.substring(0, separatorIndex).trim(),
    value: part.substring(separatorIndex + NAME_VALUE_SEPARATOR.length).trim(),
  };
};

// The parts of a setting between one separator, the empty ones left out.
const partsOf: (setting: string, separator: string) => Array<string> = (
  setting: string,
  separator: string,
): Array<string> => {
  return setting.split(separator).filter((part: string): boolean => {
    return Boolean(part.trim());
  });
};

/*
 * Whether a setting is written the standard's way, ',' between headers (see
 * the top of this file): no ';', and every part between its commas a name a
 * header may have, an '=' and a value. Shape only - a header of that shape
 * that cannot be sent all the same (a value of only '=', a line break) is
 * still one, and is reported by its place among the comma-separated ones. A
 * setting of nothing but commas and spaces holds no header either way.
 */
const isWrittenTheStandardWay: (setting: string) => boolean = (
  setting: string,
): boolean => {
  if (setting.includes(ONEUPTIME_HEADER_SEPARATOR)) {
    return false;
  }

  return partsOf(setting, STANDARD_HEADER_SEPARATOR).every(
    (part: string): boolean => {
      const header: { name: string; value: string } | null =
        splitNameAndValue(part);

      return (
        header !== null &&
        HEADER_NAME_REGEX.test(header.name) &&
        header.value.length > 0
      );
    },
  );
};

const readHeader: (
  part: string,
  isPercentEncoded: boolean,
) =>
  | { name: string; value: string }
  | { reason: UnreadableOtlpHeaderReason } = (
  part: string,
  isPercentEncoded: boolean,
): { name: string; value: string } | { reason: UnreadableOtlpHeaderReason } => {
  const header: { name: string; value: string } | null =
    splitNameAndValue(part);

  if (!header) {
    return { reason: UnreadableOtlpHeaderReason.NoEqualsSign };
  }

  const name: string = header.name;

  if (!name) {
    return { reason: UnreadableOtlpHeaderReason.NoName };
  }

  if (!HEADER_NAME_REGEX.test(name)) {
    return { reason: UnreadableOtlpHeaderReason.NameNotAllowed };
  }

  if (!header.value) {
    return { reason: UnreadableOtlpHeaderReason.NoValue };
  }

  // As written: what was typed is a token without its name, encoded or not.
  if (ONLY_EQUALS_SIGNS_REGEX.test(header.value)) {
    return { reason: UnreadableOtlpHeaderReason.OnlyEqualsSigns };
  }

  // As sent: a decoded line break is a line break all the same.
  const value: string = isPercentEncoded
    ? percentDecode(header.value)
    : header.value;

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

  const isStandard: boolean = isWrittenTheStandardWay(setting);

  for (const part of partsOf(
    setting,
    isStandard ? STANDARD_HEADER_SEPARATOR : ONEUPTIME_HEADER_SEPARATOR,
  )) {
    result.written++;

    const header:
      | { name: string; value: string }
      | { reason: UnreadableOtlpHeaderReason } = readHeader(part, isStandard);

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
    `Write each header as name=value, and separate headers with ';' (or ',' as in ${OTEL_EXPORTER_OTLP_HEADERS_SETTING}).`,
  ].join(" ");
};

/*
 * THE STANDARD'S OWN VARIABLES (issue #8884)
 *
 * The OTLP exporters Telemetry.init builds read the OpenTelemetry standard's
 * header variables themselves, and send what they hold under OneUptime's
 * own headers, which win by name: OTEL_EXPORTER_OTLP_HEADERS for every
 * signal, and OTEL_EXPORTER_OTLP_TRACES_HEADERS, _METRICS_HEADERS and
 * _LOGS_HEADERS for one, which win over it (@opentelemetry/otlp-exporter-base,
 * getStaticHeadersFromEnv). So an exporter has a header to send when either
 * holds one, and Telemetry.init builds it then too, and the profiler takes
 * its token from OTEL_EXPORTER_OTLP_HEADERS when OneUptime's own setting has
 * none.
 *
 * They are read here exactly as the exporters read them, with
 * @opentelemetry/core's parseKeyPairsIntoRecord, which OtlpExporterHeaders's
 * tests hold this to: ',' between headers, each split at its first '=', its
 * name and value trimmed and URI-decoded, what follows a ';' in a header left
 * out, and a header with an empty name or value, or one that does not
 * decode, left out too.
 */

export enum OtlpSignal {
  Traces = "TRACES",
  Metrics = "METRICS",
  Logs = "LOGS",
}

export const OTLP_SIGNALS: Array<OtlpSignal> = [
  OtlpSignal.Traces,
  OtlpSignal.Metrics,
  OtlpSignal.Logs,
];

const SIGNAL_WORDS: Record<OtlpSignal, string> = {
  [OtlpSignal.Traces]: "traces",
  [OtlpSignal.Metrics]: "metrics",
  [OtlpSignal.Logs]: "logs",
};

// OTEL_EXPORTER_OTLP_TRACES_HEADERS and the rest: one signal's own headers.
export const otelSignalHeadersSetting: (signal: OtlpSignal) => string = (
  signal: OtlpSignal,
): string => {
  return `OTEL_EXPORTER_OTLP_${signal}_HEADERS`;
};

const STANDARD_METADATA_SEPARATOR: string = ";";

/*
 * Headers as the OTLP exporters read one of the standard's variables, as
 * parseKeyPairsIntoRecord does.
 */
export const readStandardOtlpHeaders: (
  setting: string | undefined,
) => Dictionary<string> = (setting: string | undefined): Dictionary<string> => {
  const headers: Dictionary<string> = {};

  if (typeof setting !== "string" || !setting) {
    return headers;
  }

  for (const entry of setting.split(STANDARD_HEADER_SEPARATOR)) {
    if (!entry) {
      continue;
    }

    const metadataIndex: number = entry.indexOf(STANDARD_METADATA_SEPARATOR);
    const pair: string =
      metadataIndex === -1 ? entry : entry.substring(0, metadataIndex);
    const separatorIndex: number = pair.indexOf(NAME_VALUE_SEPARATOR);

    if (separatorIndex <= 0) {
      continue;
    }

    const rawName: string = pair.substring(0, separatorIndex).trim();
    const rawValue: string = pair.substring(separatorIndex + 1).trim();

    if (!rawName || !rawValue) {
      continue;
    }

    let name: string;
    let value: string;

    try {
      name = decodeURIComponent(rawName);
      value = decodeURIComponent(rawValue);
    } catch {
      continue;
    }

    if (value.length > 0) {
      headers[name] = value;
    }
  }

  return headers;
};

/*
 * The headers one signal's exporter reads from the environment on its own:
 * OTEL_EXPORTER_OTLP_HEADERS, with the signal's own variable over it.
 */
export const readStandardOtlpSignalHeaders: (
  environment: NodeJS.ProcessEnv,
  signal: OtlpSignal,
) => Dictionary<string> = (
  environment: NodeJS.ProcessEnv,
  signal: OtlpSignal,
): Dictionary<string> => {
  return {
    ...readStandardOtlpHeaders(environment[OTEL_EXPORTER_OTLP_HEADERS_SETTING]),
    ...readStandardOtlpHeaders(environment[otelSignalHeadersSetting(signal)]),
  };
};

/*
 * Whether one signal's exporter has a header to send: one of OneUptime's own
 * (`ownHeaders`, read from OPENTELEMETRY_EXPORTER_OTLP_HEADERS), or one the
 * exporter reads from the standard's variables itself.
 */
export const hasOtlpHeadersFor: (data: {
  ownHeaders: Dictionary<string>;
  environment: NodeJS.ProcessEnv;
  signal: OtlpSignal;
}) => boolean = (data: {
  ownHeaders: Dictionary<string>;
  environment: NodeJS.ProcessEnv;
  signal: OtlpSignal;
}): boolean => {
  return (
    Object.keys(data.ownHeaders).length > 0 ||
    Object.keys(readStandardOtlpSignalHeaders(data.environment, data.signal))
      .length > 0
  );
};

const listWords: (words: Array<string>, last: string) => string = (
  words: Array<string>,
  last: string,
): string => {
  if (words.length <= 1) {
    return words.join("");
  }

  return `${words.slice(0, -1).join(", ")} ${last} ${words[words.length - 1]}`;
};

/*
 * The line for an exporter endpoint that is set while no header can be sent:
 * OneUptime then exports nothing at all (see Telemetry.init).
 */
export const NOTHING_EXPORTED_WITHOUT_A_HEADER: string = [
  "OneUptime sends none of its own traces, metrics or logs:",
  "OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but neither",
  `${OTLP_EXPORTER_HEADERS_SETTING} (${OTLP_EXPORTER_HEADERS_HELM_VALUE} in the Helm chart)`,
  `nor ${OTEL_EXPORTER_OTLP_HEADERS_SETTING} holds a header it can send, and it exports only with one.`,
  "Set at least one header, written as name=value, such as the x-oneuptime-token header with a Server ingestion key.",
].join(" ");

/*
 * The line for an endpoint whose headers are set for some signals only, in
 * their own variables (OTEL_EXPORTER_OTLP_TRACES_HEADERS and the rest):
 * OneUptime then exports those, and none of the others. `unexported` lists
 * the others, and NOTHING_EXPORTED_WITHOUT_A_HEADER is the line when it lists
 * every signal. It names variables only, never what they hold.
 */
export const describeSignalsExportedWithoutAHeader: (
  unexported: Array<OtlpSignal>,
) => string | null = (unexported: Array<OtlpSignal>): string | null => {
  const missing: Array<OtlpSignal> = OTLP_SIGNALS.filter(
    (signal: OtlpSignal): boolean => {
      return unexported.includes(signal);
    },
  );

  if (missing.length === 0) {
    return null;
  }

  if (missing.length === OTLP_SIGNALS.length) {
    return NOTHING_EXPORTED_WITHOUT_A_HEADER;
  }

  const exported: Array<OtlpSignal> = OTLP_SIGNALS.filter(
    (signal: OtlpSignal): boolean => {
      return !missing.includes(signal);
    },
  );

  const words: (signals: Array<OtlpSignal>, last: string) => string = (
    signals: Array<OtlpSignal>,
    last: string,
  ): string => {
    return listWords(
      signals.map((signal: OtlpSignal): string => {
        return SIGNAL_WORDS[signal];
      }),
      last,
    );
  };

  const settings: (signals: Array<OtlpSignal>, last: string) => string = (
    signals: Array<OtlpSignal>,
    last: string,
  ): string => {
    return listWords(signals.map(otelSignalHeadersSetting), last);
  };

  return [
    `OneUptime sends none of its own ${words(missing, "or")}:`,
    `OPENTELEMETRY_EXPORTER_OTLP_ENDPOINT is set, but its only headers are in ${settings(exported, "and")},`,
    `for ${words(exported, "and")} alone, and it exports a signal only with a header.`,
    `Set one for every signal in ${OTLP_EXPORTER_HEADERS_SETTING} (${OTLP_EXPORTER_HEADERS_HELM_VALUE} in the Helm chart)`,
    `or ${OTEL_EXPORTER_OTLP_HEADERS_SETTING}, or set ${settings(missing, "and")}.`,
  ].join(" ");
};
