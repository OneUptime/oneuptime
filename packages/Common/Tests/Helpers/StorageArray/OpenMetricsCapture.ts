import { JSONArray, JSONObject } from "../../../Types/JSON";

/*
 * A scrape as an array's metrics endpoint answers it, read back into what
 * the OneUptime Storage Array Agent sends: the Prometheus text exposition
 * (`name{label="value",...} value`) a storage platform serves, turned into
 * the OTLP/JSON datapoints the collector's prometheus receiver emits for it.
 *
 * The receiver keeps every label as a datapoint attribute except those
 * whose value is empty (Prometheus reads an empty label as no label), adds
 * the scrape job's static labels (the agent's `scrape_endpoint`), and sends
 * the value as asDouble with the scrape's timestamp in nanoseconds. Storage
 * platforms export gauges only, so that is the one shape this reads.
 *
 * Shared by every storage platform's recorded-capture tests: a vendor's
 * captures (what its exporter or endpoint answers, copied from its
 * documentation or a lab system) go through the same reader.
 */

export interface CapturedSeries {
  name: string;
  labels: Record<string, string>;
  value: number;
}

function readLabelValue(
  text: string,
  start: number,
): { value: string; end: number } {
  let value: string = "";
  let index: number = start;
  while (index < text.length) {
    const char: string = text.charAt(index);
    if (char === "\\") {
      const next: string = text.charAt(index + 1);
      value += next === "n" ? "\n" : next;
      index += 2;
      continue;
    }
    if (char === '"') {
      return { value, end: index + 1 };
    }
    value += char;
    index++;
  }
  throw new Error(`An unterminated label value in: ${text}`);
}

function readLabels(
  text: string,
  start: number,
): { labels: Record<string, string>; end: number } {
  const labels: Record<string, string> = {};
  let index: number = start;
  while (index < text.length) {
    while (text.charAt(index) === "," || text.charAt(index) === " ") {
      index++;
    }
    if (text.charAt(index) === "}") {
      return { labels, end: index + 1 };
    }
    const equals: number = text.indexOf("=", index);
    if (equals < 0 || text.charAt(equals + 1) !== '"') {
      throw new Error(`A label without a quoted value in: ${text}`);
    }
    const key: string = text.slice(index, equals).trim();
    const read: { value: string; end: number } = readLabelValue(
      text,
      equals + 2,
    );
    labels[key] = read.value;
    index = read.end;
  }
  throw new Error(`An unterminated label set in: ${text}`);
}

// Every series of a Prometheus text exposition, in the order it lists them.
export function parseOpenMetrics(text: string): Array<CapturedSeries> {
  const series: Array<CapturedSeries> = [];
  for (const rawLine of text.split("\n")) {
    const line: string = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }
    const brace: number = line.indexOf("{");
    const space: number = line.indexOf(" ");
    let name: string;
    let labels: Record<string, string> = {};
    let rest: string;
    if (brace >= 0 && (space < 0 || brace < space)) {
      name = line.slice(0, brace);
      const read: { labels: Record<string, string>; end: number } = readLabels(
        line,
        brace + 1,
      );
      labels = read.labels;
      rest = line.slice(read.end).trim();
    } else {
      name = line.slice(0, space);
      rest = line.slice(space + 1).trim();
    }
    // A sample may carry its own timestamp after the value; the scrape's wins.
    const valueText: string = rest.split(/\s+/)[0] || "";
    const value: number = Number(valueText);
    if (!name || valueText === "" || Number.isNaN(value)) {
      throw new Error(`Not a sample line: ${rawLine}`);
    }
    series.push({ name, labels, value });
  }
  return series;
}

/*
 * One series as the prometheus receiver hands it on: the scrape's
 * timestamp, the value as a double, every non-empty label (and the job's
 * static labels) as a string attribute.
 */
export function toOtlpDatapoint(
  series: CapturedSeries,
  data: { timeMs: number; jobLabels?: Record<string, string> | undefined },
): JSONObject {
  const labels: Record<string, string> = {
    ...series.labels,
    ...(data.jobLabels || {}),
  };
  const attributes: JSONArray = Object.entries(labels)
    .filter(([, value]: [string, string]) => {
      return value !== "";
    })
    .map(([key, value]: [string, string]): JSONObject => {
      return { key, value: { stringValue: value } };
    });
  return {
    asDouble: series.value,
    timeUnixNano: `${data.timeMs}000000`,
    attributes,
  };
}
