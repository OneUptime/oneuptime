import {
  PromQLExpression,
  PromQLNodeKind,
  PromQLVectorSelector,
} from "../../../Utils/PromQL/PromQLAst";
import { parsePromQLDuration } from "../../../Utils/PromQL/PromQLDuration";
import PromQLEngine from "../../../Utils/PromQL/PromQLEngine";
import {
  PromQLMatrixResultSeries,
  PromQLQueryResult,
  PromQLResultPoint,
  PromQLResultType,
  PromQLSeries,
  PromQLSeriesSource,
  PromQLVectorResultSample,
} from "../../../Utils/PromQL/PromQLEngineTypes";
import PromQLError, {
  PromQLErrorType,
} from "../../../Utils/PromQL/PromQLError";
import {
  PromQLLabels,
  formatPromQLValue,
  promQLLabelsKey,
} from "../../../Utils/PromQL/PromQLLabels";
import { parsePromQL } from "../../../Utils/PromQL/PromQLParser";
import { JSONObject } from "../../../Types/JSON";

/*
 * The Prometheus HTTP API's reading and writing (issue #6796), apart from
 * Express so it can be tested on its own: how a time, a duration and
 * `match[]` are read, how a result is written, and how an error is told.
 *
 * Written to the Prometheus API's own shapes
 * (https://prometheus.io/docs/prometheus/latest/querying/api/), so Grafana,
 * the Prometheus data source of any tool, and scripts written against
 * Prometheus read OneUptime's answers unchanged.
 */

// How far back /series, /labels and /label/<name>/values look by default.
export const PROMETHEUS_DEFAULT_METADATA_WINDOW_MS: number = 60 * 60 * 1000;

// The most series, label names or values a metadata answer lists.
export const PROMETHEUS_METADATA_LIMIT: number = 10000;

const UNIX_SECONDS_REGEX: RegExp = /^[-+]?\d+(\.\d+)?$/;

/*
 * A time parameter: Unix seconds (`1700000000.5`) or RFC 3339
 * (`2023-11-14T22:13:20.5Z`). Undefined uses `defaultMs`.
 */
export const parsePrometheusTime: (
  value: unknown,
  name: string,
  defaultMs: number,
) => number = (value: unknown, name: string, defaultMs: number): number => {
  if (value === undefined || value === null || value === "") {
    return defaultMs;
  }

  const text: string = String(value).trim();

  if (UNIX_SECONDS_REGEX.test(text)) {
    return Math.round(Number(text) * 1000);
  }

  const parsed: number = Date.parse(text);

  if (Number.isNaN(parsed)) {
    throw new PromQLError(
      `The ${name} parameter "${text}" is not a time. Send Unix seconds, such as 1700000000, or RFC 3339, such as 2023-11-14T22:13:20Z.`,
    );
  }

  return parsed;
};

// A duration parameter: seconds (`15`, `0.5`) or a duration (`15s`, `1m`).
export const parsePrometheusDuration: (
  value: unknown,
  name: string,
) => number = (value: unknown, name: string): number => {
  const text: string = String(value ?? "").trim();

  if (UNIX_SECONDS_REGEX.test(text)) {
    return Math.round(Number(text) * 1000);
  }

  const milliseconds: number | undefined = parsePromQLDuration(text);

  if (milliseconds === undefined) {
    throw new PromQLError(
      `The ${name} parameter "${text}" is not a duration. Send seconds, such as 15, or a duration, such as 15s or 1m.`,
    );
  }

  return milliseconds;
};

// A required string parameter.
export const readRequiredString: (value: unknown, name: string) => string = (
  value: unknown,
  name: string,
): string => {
  const text: string = typeof value === "string" ? value : "";

  if (text.trim().length === 0) {
    throw new PromQLError(`The ${name} parameter is required.`);
  }

  return text;
};

/*
 * The selectors of `match[]`, which a client may send once or many times,
 * spelled `match[]` or (as a form body parsed into an array) `match`.
 */
export const readMatchSelectors: (
  params: Record<string, unknown>,
) => Array<PromQLVectorSelector> = (
  params: Record<string, unknown>,
): Array<PromQLVectorSelector> => {
  const raw: unknown = params["match[]"] ?? params["match"];
  const texts: Array<string> = (Array.isArray(raw) ? raw : raw ? [raw] : [])
    .map((item: unknown): string => {
      return String(item);
    })
    .filter((item: string): boolean => {
      return item.trim().length > 0;
    });

  return texts.map((text: string): PromQLVectorSelector => {
    const expression: PromQLExpression = parsePromQL(text);

    if (expression.kind !== PromQLNodeKind.VectorSelector) {
      throw new PromQLError(
        `match[] takes series selectors, such as up{job="api"}, and "${text}" is not one.`,
      );
    }

    return expression;
  });
};

const toSeconds: (timestampMs: number) => number = (
  timestampMs: number,
): number => {
  return timestampMs / 1000;
};

// A sample as the API writes it: Unix seconds, and the value as a string.
export type PrometheusSamplePair = [number, string];

export interface PrometheusVectorEntry {
  metric: PromQLLabels;
  value: PrometheusSamplePair;
}

export interface PrometheusMatrixEntry {
  metric: PromQLLabels;
  values: Array<PrometheusSamplePair>;
}

export type PrometheusQueryData =
  | { resultType: "scalar"; result: PrometheusSamplePair }
  | { resultType: "string"; result: [number, string] }
  | { resultType: "vector"; result: Array<PrometheusVectorEntry> }
  | { resultType: "matrix"; result: Array<PrometheusMatrixEntry> };

// A query's result in the API's `data` shape.
export const formatPrometheusQueryResult: (
  result: PromQLQueryResult,
) => PrometheusQueryData = (result: PromQLQueryResult): PrometheusQueryData => {
  switch (result.resultType) {
    case PromQLResultType.Scalar:
      return {
        resultType: "scalar",
        result: [
          toSeconds(result.timestampMs),
          formatPromQLValue(result.value),
        ],
      };
    case PromQLResultType.String:
      return {
        resultType: "string",
        result: [toSeconds(result.timestampMs), result.value],
      };
    case PromQLResultType.Vector:
      return {
        resultType: "vector",
        result: result.samples.map(
          (sample: PromQLVectorResultSample): PrometheusVectorEntry => {
            return {
              metric: { ...sample.labels },
              value: [
                toSeconds(sample.timestampMs),
                formatPromQLValue(sample.value),
              ],
            };
          },
        ),
      };
    case PromQLResultType.Matrix:
      return {
        resultType: "matrix",
        result: result.series.map(
          (series: PromQLMatrixResultSeries): PrometheusMatrixEntry => {
            return {
              metric: { ...series.labels },
              values: series.points.map(
                (point: PromQLResultPoint): PrometheusSamplePair => {
                  return [
                    toSeconds(point.timestampMs),
                    formatPromQLValue(point.value),
                  ];
                },
              ),
            };
          },
        ),
      };
  }
};

export interface PrometheusErrorAnswer {
  statusCode: number;
  body: JSONObject;
}

const STATUS_CODES: Record<PromQLErrorType, number> = {
  [PromQLErrorType.BadData]: 400,
  [PromQLErrorType.Execution]: 422,
  [PromQLErrorType.Timeout]: 503,
};

/*
 * A PromQL error as the API tells it: Prometheus' status code and
 * errorType, with the message. Undefined for any other error, which the
 * server's own error handling answers.
 */
export const toPrometheusErrorAnswer: (
  error: unknown,
) => PrometheusErrorAnswer | undefined = (
  error: unknown,
): PrometheusErrorAnswer | undefined => {
  if (!(error instanceof PromQLError)) {
    return undefined;
  }

  return {
    statusCode: STATUS_CODES[error.errorType],
    body: {
      status: "error",
      errorType: error.errorType,
      error: error.message,
    },
  };
};

/*
 * A successful answer. Its data holds shapes OneUptime's JSON types do not
 * describe (a [time, "value"] pair), so it is typed at this one edge.
 */
export const prometheusSuccess: (data: unknown) => JSONObject = (
  data: unknown,
): JSONObject => {
  return { status: "success", data } as unknown as JSONObject;
};

// The label sets of every series the selectors match in the window.
export const listPrometheusSeries: (data: {
  source: PromQLSeriesSource;
  selectors: Array<PromQLVectorSelector>;
  startTimeMs: number;
  endTimeMs: number;
  limit: number;
}) => Promise<Array<PromQLLabels>> = async (data: {
  source: PromQLSeriesSource;
  selectors: Array<PromQLVectorSelector>;
  startTimeMs: number;
  endTimeMs: number;
  limit: number;
}): Promise<Array<PromQLLabels>> => {
  const seen: Map<string, PromQLLabels> = new Map();

  for (const selector of data.selectors) {
    const series: Array<PromQLSeries> = await data.source.select({
      metricName: selector.name,
      matchers: selector.matchers,
      startTimeMs: data.startTimeMs,
      endTimeMs: data.endTimeMs,
    });

    for (const item of series) {
      seen.set(promQLLabelsKey(item.labels), item.labels);

      if (seen.size >= data.limit) {
        break;
      }
    }

    if (seen.size >= data.limit) {
      break;
    }
  }

  return Array.from(seen.values()).sort(
    (a: PromQLLabels, b: PromQLLabels): number => {
      const keyA: string = promQLLabelsKey(a);
      const keyB: string = promQLLabelsKey(b);
      return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
    },
  );
};

// The label names of the series, sorted, `__name__` first.
export const labelNamesOf: (series: Array<PromQLLabels>) => Array<string> = (
  series: Array<PromQLLabels>,
): Array<string> => {
  const names: Set<string> = new Set<string>();

  for (const labels of series) {
    for (const name of Object.keys(labels)) {
      names.add(name);
    }
  }

  return Array.from(names).sort();
};

// One label's values across the series, sorted.
export const labelValuesOf: (
  series: Array<PromQLLabels>,
  label: string,
) => Array<string> = (
  series: Array<PromQLLabels>,
  label: string,
): Array<string> => {
  const values: Set<string> = new Set<string>();

  for (const labels of series) {
    const value: string | undefined = labels[label];

    if (value) {
      values.add(value);
    }
  }

  return Array.from(values).sort();
};

// Runs an instant query and answers in the API's shape.
export const runPrometheusInstantQuery: (data: {
  engine: PromQLEngine;
  params: Record<string, unknown>;
  nowMs: number;
}) => Promise<JSONObject> = async (data: {
  engine: PromQLEngine;
  params: Record<string, unknown>;
  nowMs: number;
}): Promise<JSONObject> => {
  const query: string = readRequiredString(data.params["query"], "query");
  const timeMs: number = parsePrometheusTime(
    data.params["time"],
    "time",
    data.nowMs,
  );
  const result: PromQLQueryResult = await data.engine.instantQuery(
    query,
    timeMs,
  );

  return prometheusSuccess(formatPrometheusQueryResult(result));
};

// Runs a range query and answers in the API's shape.
export const runPrometheusRangeQuery: (data: {
  engine: PromQLEngine;
  params: Record<string, unknown>;
}) => Promise<JSONObject> = async (data: {
  engine: PromQLEngine;
  params: Record<string, unknown>;
}): Promise<JSONObject> => {
  const query: string = readRequiredString(data.params["query"], "query");

  if (data.params["start"] === undefined || data.params["start"] === "") {
    throw new PromQLError("The start parameter is required.");
  }

  if (data.params["end"] === undefined || data.params["end"] === "") {
    throw new PromQLError("The end parameter is required.");
  }

  if (data.params["step"] === undefined || data.params["step"] === "") {
    throw new PromQLError("The step parameter is required, such as 15s.");
  }

  const startMs: number = parsePrometheusTime(data.params["start"], "start", 0);
  const endMs: number = parsePrometheusTime(data.params["end"], "end", 0);
  const stepMs: number = parsePrometheusDuration(data.params["step"], "step");

  const result: PromQLQueryResult = await data.engine.rangeQuery(
    query,
    startMs,
    endMs,
    stepMs,
  );

  return prometheusSuccess(formatPrometheusQueryResult(result));
};

// The window a metadata request names, by default the last hour.
export const readMetadataWindow: (
  params: Record<string, unknown>,
  nowMs: number,
) => { startTimeMs: number; endTimeMs: number } = (
  params: Record<string, unknown>,
  nowMs: number,
): { startTimeMs: number; endTimeMs: number } => {
  const endTimeMs: number = parsePrometheusTime(params["end"], "end", nowMs);
  const startTimeMs: number = parsePrometheusTime(
    params["start"],
    "start",
    endTimeMs - PROMETHEUS_DEFAULT_METADATA_WINDOW_MS,
  );

  if (startTimeMs > endTimeMs) {
    throw new PromQLError("The start parameter is after the end parameter.");
  }

  return { startTimeMs, endTimeMs };
};

// A metadata request's `limit`, at most PROMETHEUS_METADATA_LIMIT.
export const readMetadataLimit: (params: Record<string, unknown>) => number = (
  params: Record<string, unknown>,
): number => {
  const raw: unknown = params["limit"];

  if (raw === undefined || raw === "" || raw === null) {
    return PROMETHEUS_METADATA_LIMIT;
  }

  const limit: number = Math.floor(Number(raw));

  if (!Number.isFinite(limit) || limit < 0) {
    throw new PromQLError("The limit parameter must be a whole number.");
  }

  // 0 means no limit in Prometheus; OneUptime still answers at most this.
  return limit === 0
    ? PROMETHEUS_METADATA_LIMIT
    : Math.min(limit, PROMETHEUS_METADATA_LIMIT);
};
