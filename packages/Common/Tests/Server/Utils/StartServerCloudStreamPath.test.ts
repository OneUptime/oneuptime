import { isCloudStreamPath } from "../../../Server/Utils/StartServer";
import {
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_METRICS_PATH,
} from "../../../Types/CloudConnection/CloudStream";
import { describe, expect, test } from "@jest/globals";

/*
 * The Amazon Data Firehose endpoint reads its body raw - its own byte
 * limit is the one that holds, and it answers a body too large in
 * Firehose's own contract - so StartServer's body parsers leave its four
 * paths alone, and only those.
 */
describe("isCloudStreamPath", () => {
  test.each([
    [CLOUD_STREAM_METRICS_PATH],
    [CLOUD_STREAM_LOGS_PATH],
    [`/telemetry${CLOUD_STREAM_METRICS_PATH}`],
    [`/telemetry${CLOUD_STREAM_LOGS_PATH}`],
  ])("%s is the stream endpoint, read raw", (path: string) => {
    expect(isCloudStreamPath(path)).toBe(true);
  });

  /*
   * The router matches a path in any case and with a trailing slash, so
   * the paths StartServer leaves raw are matched the same way: one it
   * handed a body parser would reach the endpoint with its body gone.
   */
  test.each([
    [`${CLOUD_STREAM_METRICS_PATH}/`],
    [`/telemetry${CLOUD_STREAM_LOGS_PATH}//`],
    ["/AWS-FIREHOSE/V1/METRICS"],
    ["/Telemetry/Aws-Firehose/v1/Logs/"],
  ])(
    "%s, as the router matches it, is the stream endpoint too",
    (path: string) => {
      expect(isCloudStreamPath(path)).toBe(true);
    },
  );

  test.each([
    ["/aws-firehose/v1/metrics/extra"],
    ["/aws-firehose/v1"],
    ["/api/cloud-connection/aws-firehose/v1/metrics"],
    ["/telemetry/aws-firehose/v1/traces"],
    ["/otlp/v1/metrics"],
    ["/vercel/v1/logs"],
    ["/"],
    [""],
  ])("%s is not", (path: string) => {
    expect(isCloudStreamPath(path)).toBe(false);
  });
});
