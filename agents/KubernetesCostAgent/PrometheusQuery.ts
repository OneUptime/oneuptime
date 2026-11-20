import { URL } from "url";
import { httpGetJson, HttpResult } from "./HttpClient";
import { PrometheusInstantQueryResponse } from "./Types";

/*
 * One instant query against a Prometheus's HTTP API, as an instant vector:
 * each sample's labels and its value as a number. Throws with the reason on
 * anything else - an HTTP error, an answer that is not JSON, and Prometheus'
 * own status "error", which it answers with HTTP 200 for a rejected query.
 * Samples whose value is not a finite number are dropped.
 */

export interface PrometheusVectorSample {
  metric: Record<string, string>;
  value: number;
}

export type PrometheusQuery = (
  baseUrl: string,
  promql: string,
  options?: { time?: Date | undefined; timeoutMs?: number | undefined },
) => Promise<Array<PrometheusVectorSample>>;

// A check is a small query: an address that takes longer is not one to use.
export const CHECK_TIMEOUT_MS: number = 20000;

export const queryPrometheus: PrometheusQuery = async (
  baseUrl: string,
  promql: string,
  options?: { time?: Date | undefined; timeoutMs?: number | undefined },
): Promise<Array<PrometheusVectorSample>> => {
  const url: URL = new URL(`${baseUrl.replace(/\/+$/, "")}/api/v1/query`);
  url.searchParams.set("query", promql);

  if (options?.time) {
    url.searchParams.set(
      "time",
      String(Math.floor(options.time.getTime() / 1000)),
    );
  }

  const result: HttpResult = await httpGetJson(
    url,
    {},
    options?.timeoutMs ?? CHECK_TIMEOUT_MS,
  );

  if (result.statusCode < 200 || result.statusCode >= 300) {
    throw new Error(
      `answered HTTP ${result.statusCode}: ${result.body.slice(0, 200)}`,
    );
  }

  let parsed: PrometheusInstantQueryResponse;

  try {
    parsed = JSON.parse(result.body) as PrometheusInstantQueryResponse;
  } catch {
    throw new Error("answered with something that is not Prometheus' JSON");
  }

  if (parsed?.status !== "success" || !Array.isArray(parsed.data?.result)) {
    throw new Error(
      `answered the query with status ${String(parsed?.status)}${
        parsed?.error ? `: ${parsed.error}` : ""
      }`,
    );
  }

  const samples: Array<PrometheusVectorSample> = [];

  for (const sample of parsed.data!.result!) {
    const raw: string | undefined = sample?.value?.[1];
    const value: number = raw === undefined ? NaN : Number(raw);

    if (!Number.isFinite(value)) {
      continue;
    }

    const metric: Record<string, string> = {};

    for (const [key, labelValue] of Object.entries(sample.metric || {})) {
      if (typeof labelValue === "string") {
        metric[key] = labelValue;
      }
    }

    samples.push({ metric, value });
  }

  return samples;
};
