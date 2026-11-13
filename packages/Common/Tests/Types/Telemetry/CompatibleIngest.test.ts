import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";
import {
  DATADOG_BASE_PATH,
  DATADOG_LOGS_PATH,
  DATADOG_PATHS,
  DATADOG_ROOT_PATHS,
  DATADOG_SERIES_V1_PATH,
  DATADOG_SERIES_V2_PATH,
  DATADOG_VALIDATE_PATH,
  LOKI_PUSH_PATH,
  PROMETHEUS_REMOTE_WRITE_PATH,
  SPLUNK_HEC_EVENT_PATHS,
  SPLUNK_HEC_HEALTH_PATHS,
  SPLUNK_HEC_RAW_PATHS,
  isCompatibleIngestPath,
} from "../../../Types/Telemetry/CompatibleIngest";

/*
 * The compatible endpoints read their own bodies - snappy protobuf,
 * concatenated JSON objects, newline-delimited envelopes - so StartServer's
 * body parsers leave exactly their paths alone: each with and without
 * /telemetry, in any case and with a trailing slash (as the router matches
 * them), and nothing else.
 */

describe("isCompatibleIngestPath", () => {
  const ownPaths: Array<string> = [
    PROMETHEUS_REMOTE_WRITE_PATH,
    LOKI_PUSH_PATH,
    ...SPLUNK_HEC_EVENT_PATHS,
    ...SPLUNK_HEC_RAW_PATHS,
    ...SPLUNK_HEC_HEALTH_PATHS,
    ...DATADOG_PATHS.map((datadogPath: string): string => {
      return `${DATADOG_BASE_PATH}${datadogPath}`;
    }),
    ...DATADOG_ROOT_PATHS,
    "/sentry/api/1/envelope",
    "/sentry/api/42/store",
  ];

  test.each(
    ownPaths.map((own: string): [string] => {
      return [own];
    }),
  )("%s is read raw, with and without /telemetry", (own: string) => {
    expect(isCompatibleIngestPath(own)).toBe(true);
    expect(isCompatibleIngestPath(`/telemetry${own}`)).toBe(true);
  });

  test.each([
    ["/Prometheus/API/v1/Write/"],
    ["/telemetry/loki/api/v1/push//"],
    ["/SERVICES/COLLECTOR/EVENT"],
    ["/telemetry/datadog/api/v2/series/"],
    ["/telemetry/sentry/api/1/envelope/"],
    ["/sentry/api/1/store/"],
  ])("%s, as the router matches it, is read raw too", (own: string) => {
    expect(isCompatibleIngestPath(own)).toBe(true);
  });

  test.each([
    ["/prometheus/api/v1/query"],
    ["/prometheus/api/v1/write/extra"],
    ["/loki/api/v1/query_range"],
    ["/otlp/v1/logs"],
    ["/fluentd/v1/logs"],
    ["/api/monitor"],
    ["/api/v1/other"],
    ["/datadog/api/v1/other"],
    ["/sentry/api/1/minidump"],
    ["/sentry/api/1/envelope/extra"],
    ["/api/telemetry/prometheus/api/v1/write"],
    ["/"],
    [""],
  ])("%s is not", (other: string) => {
    expect(isCompatibleIngestPath(other)).toBe(false);
  });

  test("under /datadog every intake path is served; at the root only logs, which logs_dd_url cannot put under a path", () => {
    expect(DATADOG_PATHS).toEqual(
      expect.arrayContaining([
        DATADOG_LOGS_PATH,
        DATADOG_SERIES_V1_PATH,
        DATADOG_SERIES_V2_PATH,
        DATADOG_VALIDATE_PATH,
      ]),
    );
    expect(DATADOG_ROOT_PATHS).toEqual([DATADOG_LOGS_PATH]);

    // dd_url takes a path, so the rest stay OneUptime's own API's.
    expect(isCompatibleIngestPath(DATADOG_SERIES_V2_PATH)).toBe(false);
    expect(isCompatibleIngestPath("/intake")).toBe(false);
    expect(isCompatibleIngestPath(`/datadog${DATADOG_SERIES_V2_PATH}`)).toBe(
      true,
    );
  });

  test("StartServer's body parsers and urlencoded parser both leave these paths alone", () => {
    const startServer: string = fs.readFileSync(
      path.resolve(__dirname, "../../../Server/Utils/StartServer.ts"),
      "utf8",
    );

    expect(
      startServer.match(/isCompatibleIngestPath\(req\.path\)/g) || [],
    ).toHaveLength(2);
  });
});
