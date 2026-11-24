/*
 * WHAT READS A RECORDING RULE'S OUTPUT METRIC, DOWN THE CHAIN (#10085).
 *
 * A metric recording rule computes its output metric from the metrics it
 * reads, every minute. Take one of those away - Drop This Metric, an added
 * cloud metric's Remove - and its output no longer includes it: a minute in
 * which one of its sources has no point gets no output point at all
 * (ComputeRecordingRules), so a source taken away whole stops the output
 * with it. And whatever reads that output - a monitor, a dashboard's
 * widget, a Metric SLO, another recording rule - gets less from it, or
 * nothing, one step further on.
 *
 * So the lookup of what reads a metric (Server/Utils/Telemetry/
 * MetricReaders) follows each recording rule it finds to what reads the
 * metric the rule writes, and those rules on to what reads theirs, up to
 * MAX_OUTPUT_METRIC_DEPTH output metrics down a chain. Each record is named
 * once, at the first place it is met - a dashboard once for each of its
 * widgets - so a chain that comes back on itself ends where it closes.
 * What reads an output metric past the last one followed is said to be
 * there (isPastDepth), never named.
 *
 * As everywhere the lookup answers, what the person asking may not open is
 * counted with its kind, never named (hidden). A recording rule they may
 * not open is still followed: what reads the output metrics of those is
 * listed apart, under the count (hiddenOutputReaders), so a monitor they
 * can see is named though the rule between it and the metric is not.
 *
 * This is the answer's shape, the same in Drop This Metric's answer and in
 * More Metrics' Remove, read here defensively for the page.
 */

// How many output metrics down a chain of recording rules their readers are named.
export const MAX_OUTPUT_METRIC_DEPTH: number = 3;

// The deepest an answer is read: past the depth followed, with room for a newer server's.
const MAX_READ_DEPTH: number = MAX_OUTPUT_METRIC_DEPTH + 4;

// A dashboard's widget that reads the output metric.
export interface MetricOutputReaderWidget {
  // The id the board draws it under, which a link opens it at (#10084).
  id: string;
  // Its title, or "" when it has none.
  title: string;
  // Its componentType ("Chart"), which names it when it has no title.
  type: string;
}

// A record that reads the output metric.
export interface MetricOutputReader {
  id: string;
  // As its person named it; "" when it has none.
  name: string;
  // A dashboard's: its widgets that read it, in their order on it.
  widgets?: Array<MetricOutputReaderWidget> | undefined;
  // A recording rule's: the metric it writes, which finds it in its list.
  outputMetricName?: string | undefined;
  // A recording rule's: what reads the metric it writes, one step further on.
  outputReaders?: MetricOutputReaders | undefined;
}

export interface MetricOutputReadersOfKind {
  // Those the person asking may open, by name.
  readers: Array<MetricOutputReader>;
  // How many more read it that they may not open: counted, never named.
  hidden: number;
  /*
   * Recording rules': what reads the output metrics of the ones they may
   * not open - never which rules those are.
   */
  hiddenOutputReaders?: MetricOutputReaders | undefined;
}

// What reads an output metric, kind by kind.
export interface MetricOutputReaders {
  monitors: MetricOutputReadersOfKind;
  dashboards: MetricOutputReadersOfKind;
  slos: MetricOutputReadersOfKind;
  recordingRules: MetricOutputReadersOfKind;
  /*
   * More read it than are named: records further down the chain than
   * MAX_OUTPUT_METRIC_DEPTH output metrics. Said, never named.
   */
  isPastDepth?: boolean | undefined;
}

export type MetricOutputReaderKindKey = keyof Omit<
  MetricOutputReaders,
  "isPastDepth"
>;

// The kinds, in the order they are listed.
export const METRIC_OUTPUT_READER_KIND_KEYS: ReadonlyArray<MetricOutputReaderKindKey> =
  ["monitors", "dashboards", "slos", "recordingRules"];

export function getEmptyMetricOutputReaders(): MetricOutputReaders {
  return {
    monitors: { readers: [], hidden: 0 },
    dashboards: { readers: [], hidden: 0 },
    slos: { readers: [], hidden: 0 },
    recordingRules: { readers: [], hidden: 0 },
  };
}

/*
 * Whether an answer says nothing: no reader named or counted, nothing read
 * past the depth followed.
 */
export function isMetricOutputReadersEmpty(
  readers: MetricOutputReaders | null | undefined,
): boolean {
  if (!readers) {
    return true;
  }

  if (readers.isPastDepth) {
    return false;
  }

  return METRIC_OUTPUT_READER_KIND_KEYS.every(
    (key: MetricOutputReaderKindKey): boolean => {
      const ofKind: MetricOutputReadersOfKind = readers[key];

      return (
        ofKind.readers.length === 0 &&
        ofKind.hidden === 0 &&
        isMetricOutputReadersEmpty(ofKind.hiddenOutputReaders)
      );
    },
  );
}

/*
 * How many records an answer names or counts, at every step of the chain:
 * a dashboard named again further on, for other widgets, is counted again.
 */
export function countMetricOutputReaders(
  readers: MetricOutputReaders | null | undefined,
): number {
  if (!readers) {
    return 0;
  }

  let count: number = 0;

  for (const key of METRIC_OUTPUT_READER_KIND_KEYS) {
    const ofKind: MetricOutputReadersOfKind = readers[key];

    count += ofKind.readers.length + ofKind.hidden;
    count += countMetricOutputReaders(ofKind.hiddenOutputReaders);

    for (const reader of ofKind.readers) {
      count += countMetricOutputReaders(reader.outputReaders);
    }
  }

  return count;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function readCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function readWidget(value: unknown): MetricOutputReaderWidget | null {
  const raw: Record<string, unknown> | null = asRecord(value);

  if (!raw) {
    return null;
  }

  return {
    id: readText(raw["id"]),
    title: readText(raw["title"]),
    type: readText(raw["type"]),
  };
}

function readReader(value: unknown, depth: number): MetricOutputReader | null {
  const raw: Record<string, unknown> | null = asRecord(value);
  const id: string = readText(raw?.["id"]);

  if (!raw || !id) {
    return null;
  }

  const reader: MetricOutputReader = { id, name: readText(raw["name"]) };

  if (Array.isArray(raw["widgets"])) {
    reader.widgets = (raw["widgets"] as Array<unknown>)
      .map(readWidget)
      .filter(
        (
          widget: MetricOutputReaderWidget | null,
        ): widget is MetricOutputReaderWidget => {
          return widget !== null;
        },
      );
  }

  const outputMetricName: string = readText(raw["outputMetricName"]);

  if (outputMetricName) {
    reader.outputMetricName = outputMetricName;
  }

  const outputReaders: MetricOutputReaders | undefined = readAtDepth(
    raw["outputReaders"],
    depth + 1,
  );

  if (outputReaders) {
    reader.outputReaders = outputReaders;
  }

  return reader;
}

function readOfKind(value: unknown, depth: number): MetricOutputReadersOfKind {
  const raw: Record<string, unknown> | null = asRecord(value);
  const ofKind: MetricOutputReadersOfKind = {
    readers: (Array.isArray(raw?.["readers"])
      ? (raw!["readers"] as Array<unknown>)
      : []
    )
      .map((reader: unknown): MetricOutputReader | null => {
        return readReader(reader, depth);
      })
      .filter(
        (reader: MetricOutputReader | null): reader is MetricOutputReader => {
          return reader !== null;
        },
      ),
    hidden: readCount(raw?.["hidden"]),
  };
  const hiddenOutputReaders: MetricOutputReaders | undefined = readAtDepth(
    raw?.["hiddenOutputReaders"],
    depth + 1,
  );

  if (hiddenOutputReaders) {
    ofKind.hiddenOutputReaders = hiddenOutputReaders;
  }

  return ofKind;
}

function readAtDepth(
  value: unknown,
  depth: number,
): MetricOutputReaders | undefined {
  const raw: Record<string, unknown> | null = asRecord(value);

  if (!raw || depth > MAX_READ_DEPTH) {
    return undefined;
  }

  const readers: MetricOutputReaders = {
    monitors: readOfKind(raw["monitors"], depth),
    dashboards: readOfKind(raw["dashboards"], depth),
    slos: readOfKind(raw["slos"], depth),
    recordingRules: readOfKind(raw["recordingRules"], depth),
  };

  if (raw["isPastDepth"] === true) {
    readers.isPastDepth = true;
  }

  return isMetricOutputReadersEmpty(readers) ? undefined : readers;
}

/*
 * What reads an output metric, as an answer says it, read defensively: none
 * when it is not one, or says nothing.
 */
export function readMetricOutputReaders(
  value: unknown,
): MetricOutputReaders | undefined {
  return readAtDepth(value, 0);
}
