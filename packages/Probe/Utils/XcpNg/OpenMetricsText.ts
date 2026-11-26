/*
 * Reads the OpenMetrics text Xen Orchestra's OpenMetrics plugin serves
 * (xo-server-openmetrics 1.9.4, `application/openmetrics-text;
 * version=1.0.0`), the way the XCP-ng Agent's prometheus receiver reads it
 * for the series that plugin writes:
 *
 *   # HELP <name> <text>
 *   # TYPE <name> gauge|counter|...
 *   <name>{<label>="<value>",...} <value> [<timestamp in seconds>]
 *   # EOF
 *
 * Label values carry the three escapes OpenMetrics defines (\\, \" and \n),
 * a HELP text the same; a timestamp is in SECONDS, as OpenMetrics has it
 * (and as the receiver reads it for that content type). A sample names its
 * family as its TYPE line does - Xen Orchestra types
 * `xcp_host_network_receive_bytes_total` itself a counter, so the family
 * and the series share the name, as the receiver reads it too.
 *
 * Pure, and bounded by what it is handed: the caller has already limited
 * the answer's size.
 */

export type OpenMetricsType =
  | "gauge"
  | "counter"
  | "histogram"
  | "summary"
  | "stateset"
  | "info"
  | "gaugehistogram"
  | "unknown";

export interface OpenMetricsSample {
  // The series' name as written.
  name: string;
  // Its family, as a TYPE line names it (the name itself when none does).
  family: string;
  type: OpenMetricsType;
  // The family's HELP text, unescaped; empty when it has none.
  help: string;
  // In the order they were written.
  labels: Array<[string, string]>;
  value: number;
  // Seconds since the epoch; null when the sample carries none.
  timestampSeconds: number | null;
}

export interface OpenMetricsParseResult {
  samples: Array<OpenMetricsSample>;
  // Whether the text ended with "# EOF", as every OpenMetrics answer does.
  hasEof: boolean;
  // Lines that were not a comment, a sample or blank.
  invalidLineCount: number;
  // The first of them, cut short, for the message a person reads.
  firstInvalidLine: string | null;
}

const KNOWN_TYPES: ReadonlySet<string> = new Set<string>([
  "gauge",
  "counter",
  "histogram",
  "summary",
  "stateset",
  "info",
  "gaugehistogram",
  "unknown",
]);

const NAME_PATTERN: RegExp = /^[a-zA-Z_:][a-zA-Z0-9_:]*/;
const LABEL_NAME_PATTERN: RegExp = /^[a-zA-Z_][a-zA-Z0-9_]*/;

// The OpenMetrics escapes: \\, \" and \n.
export function unescapeOpenMetrics(value: string): string {
  let result: string = "";

  for (let index: number = 0; index < value.length; index++) {
    const char: string = value[index]!;

    if (char !== "\\" || index === value.length - 1) {
      result += char;
      continue;
    }

    const next: string = value[index + 1]!;

    if (next === "n") {
      result += "\n";
    } else if (next === "\\" || next === '"') {
      result += next;
    } else {
      // Not an escape OpenMetrics defines: kept as written.
      result += char + next;
    }

    index++;
  }

  return result;
}

/*
 * A sample's value or timestamp: a decimal float, or NaN, +Inf and -Inf as
 * OpenMetrics spells them. Null for anything else.
 */
export function parseOpenMetricsNumber(text: string): number | null {
  const trimmed: string = text.trim();

  if (!trimmed) {
    return null;
  }

  switch (trimmed) {
    case "NaN":
      return Number.NaN;
    case "+Inf":
    case "Inf":
      return Number.POSITIVE_INFINITY;
    case "-Inf":
      return Number.NEGATIVE_INFINITY;
    default:
      break;
  }

  if (!/^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(trimmed)) {
    return null;
  }

  const value: number = Number(trimmed);

  return Number.isNaN(value) ? null : value;
}

interface ParsedSampleLine {
  name: string;
  labels: Array<[string, string]>;
  value: number;
  timestampSeconds: number | null;
}

// One sample line, or null when it is not one.
export function parseOpenMetricsSampleLine(
  line: string,
): ParsedSampleLine | null {
  const nameMatch: RegExpMatchArray | null = line.match(NAME_PATTERN);

  if (!nameMatch) {
    return null;
  }

  const name: string = nameMatch[0];
  let position: number = name.length;
  const labels: Array<[string, string]> = [];

  if (line[position] === "{") {
    position++;

    while (position < line.length && line[position] !== "}") {
      const rest: string = line.substring(position);
      const labelMatch: RegExpMatchArray | null =
        rest.match(LABEL_NAME_PATTERN);

      if (!labelMatch) {
        return null;
      }

      const labelName: string = labelMatch[0];
      position += labelName.length;

      if (line[position] !== "=" || line[position + 1] !== '"') {
        return null;
      }

      position += 2;
      let raw: string = "";
      let isClosed: boolean = false;

      while (position < line.length) {
        const char: string = line[position]!;

        if (char === "\\" && position + 1 < line.length) {
          raw += char + line[position + 1];
          position += 2;
          continue;
        }

        if (char === '"') {
          isClosed = true;
          position++;
          break;
        }

        raw += char;
        position++;
      }

      if (!isClosed) {
        return null;
      }

      labels.push([labelName, unescapeOpenMetrics(raw)]);

      if (line[position] === ",") {
        position++;
      }
    }

    if (line[position] !== "}") {
      return null;
    }

    position++;
  }

  if (line[position] !== " ") {
    return null;
  }

  // An exemplar (" # {...}") belongs to no series; nothing past it is read.
  const exemplarAt: number = line.indexOf(" # ", position);
  const valuePart: string = (
    exemplarAt >= 0 ? line.substring(position, exemplarAt) : line.substring(position)
  ).trim();

  const fields: Array<string> = valuePart.split(/\s+/).filter((field: string) => {
    return field.length > 0;
  });

  if (fields.length < 1 || fields.length > 2) {
    return null;
  }

  const value: number | null = parseOpenMetricsNumber(fields[0]!);

  if (value === null) {
    return null;
  }

  let timestampSeconds: number | null = null;

  if (fields.length === 2) {
    timestampSeconds = parseOpenMetricsNumber(fields[1]!);

    if (timestampSeconds === null || !Number.isFinite(timestampSeconds)) {
      return null;
    }
  }

  return {
    name: name,
    labels: labels,
    value: value,
    timestampSeconds: timestampSeconds,
  };
}

/*
 * The family a sample belongs to: the TYPE'd name itself, or - for the
 * suffixes OpenMetrics gives a counter, a histogram or a summary's samples -
 * the TYPE'd name they extend.
 */
function findFamily(
  name: string,
  types: Map<string, OpenMetricsType>,
): string {
  if (types.has(name)) {
    return name;
  }

  for (const suffix of [
    "_total",
    "_created",
    "_count",
    "_sum",
    "_bucket",
    "_gcount",
    "_gsum",
    "_info",
  ]) {
    if (name.endsWith(suffix)) {
      const family: string = name.substring(0, name.length - suffix.length);

      if (types.has(family)) {
        return family;
      }
    }
  }

  return name;
}

export function parseOpenMetricsText(text: string): OpenMetricsParseResult {
  const result: OpenMetricsParseResult = {
    samples: [],
    hasEof: false,
    invalidLineCount: 0,
    firstInvalidLine: null,
  };

  const types: Map<string, OpenMetricsType> = new Map();
  const helps: Map<string, string> = new Map();

  const noteInvalid: (line: string) => void = (line: string): void => {
    result.invalidLineCount++;

    if (result.firstInvalidLine === null) {
      result.firstInvalidLine =
        line.length > 120 ? `${line.substring(0, 119)}…` : line;
    }
  };

  for (const rawLine of text.split("\n")) {
    const line: string = rawLine.endsWith("\r")
      ? rawLine.substring(0, rawLine.length - 1)
      : rawLine;

    if (result.hasEof) {
      // Nothing after # EOF is part of the exposition.
      if (line.trim()) {
        noteInvalid(line);
      }
      continue;
    }

    if (!line.trim()) {
      continue;
    }

    if (line.startsWith("#")) {
      if (line.trim() === "# EOF") {
        result.hasEof = true;
        continue;
      }

      const comment: RegExpMatchArray | null = line.match(
        /^#\s+(HELP|TYPE|UNIT)\s+([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\s(.*))?$/,
      );

      if (!comment) {
        // Any other comment, as Xen Orchestra's "# No connected hosts".
        continue;
      }

      const keyword: string = comment[1]!;
      const family: string = comment[2]!;
      const rest: string = comment[3] || "";

      if (keyword === "TYPE") {
        const type: string = rest.trim().toLowerCase();
        types.set(
          family,
          (KNOWN_TYPES.has(type) ? type : "unknown") as OpenMetricsType,
        );
      } else if (keyword === "HELP") {
        helps.set(family, unescapeOpenMetrics(rest));
      }

      continue;
    }

    const sample: ParsedSampleLine | null = parseOpenMetricsSampleLine(line);

    if (!sample) {
      noteInvalid(line);
      continue;
    }

    const family: string = findFamily(sample.name, types);

    result.samples.push({
      name: sample.name,
      family: family,
      type: types.get(family) || "unknown",
      help: helps.get(family) || "",
      labels: sample.labels,
      value: sample.value,
      timestampSeconds: sample.timestampSeconds,
    });
  }

  return result;
}
