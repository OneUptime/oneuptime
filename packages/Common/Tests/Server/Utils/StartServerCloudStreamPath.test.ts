import { isCloudStreamPath } from "../../../Server/Utils/StartServer";
import {
  CLOUD_STREAM_LOGS_PATH,
  CLOUD_STREAM_METRICS_PATH,
  CLOUD_STREAM_PUBSUB_LOGS_PATH,
} from "../../../Types/CloudConnection/CloudStream";
import { describe, expect, test } from "@jest/globals";

/*
 * The cloud stream endpoints read their bodies raw - each one's own byte
 * limit is the one that holds, and each answers a body too large in its
 * sender's own contract - so StartServer's body parsers leave their six
 * paths alone, and only those: Amazon Data Firehose's two and Pub/Sub's
 * one, each with and without /telemetry.
 */
describe("isCloudStreamPath", () => {
  test.each([
    [CLOUD_STREAM_METRICS_PATH],
    [CLOUD_STREAM_LOGS_PATH],
    [CLOUD_STREAM_PUBSUB_LOGS_PATH],
    [`/telemetry${CLOUD_STREAM_METRICS_PATH}`],
    [`/telemetry${CLOUD_STREAM_LOGS_PATH}`],
    [`/telemetry${CLOUD_STREAM_PUBSUB_LOGS_PATH}`],
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
    ["/telemetry/gcp-pubsub/v1/logs/"],
    ["/GCP-PUBSUB/V1/LOGS"],
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
    ["/gcp-pubsub/v1/metrics"],
    ["/gcp-pubsub/v1/logs/extra"],
    ["/api/cloud-connection/gcp-pubsub/v1/logs"],
    ["/"],
    [""],
  ])("%s is not", (path: string) => {
    expect(isCloudStreamPath(path)).toBe(false);
  });
});
