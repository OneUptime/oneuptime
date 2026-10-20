import Dictionary from "../../../../../Types/Dictionary";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../../Types/LlmObservability/LlmConnectionTest";
import AwsSecurityHubClient, {
  AwsSigV4SignResult,
} from "../../../SecurityEvent/Connectors/AwsSecurityHub/AwsSecurityHubClient";
import { LlmConnectorTransport } from "../../LlmConnectorTypes";
import LlmProviderError from "../../LlmProviderError";
import LlmProviderHttp, {
  readArray,
  readObject,
  readText,
} from "../../LlmProviderHttp";

/*
 * Amazon CloudWatch, the two calls the Amazon Bedrock connection makes,
 * over CloudWatch's AWS JSON 1.0 protocol (botocore's cloudwatch model lists
 * "json" among its protocols, target prefix GraniteServiceVersion20100801):
 *
 *   POST https://monitoring.{region}.amazonaws.com/
 *   Content-Type: application/x-amz-json-1.0
 *   X-Amz-Target: GraniteServiceVersion20100801.ListMetrics | .GetMetricData
 *
 * signed with AWS Signature Version 4 for the service "monitoring" - the
 * signer the AWS Security Hub connector already checks against AWS's
 * published test vectors (AwsSecurityHubClient.signRequest).
 *
 *   ListMetrics      { Namespace, MetricName, Dimensions: [{ Name }],
 *                      NextToken } -> { Metrics: [{ Dimensions }], NextToken }
 *   GetMetricData    { MetricDataQueries: [{ Id, MetricStat: { Metric,
 *                      Period, Stat }, ReturnData }], StartTime, EndTime
 *                      (epoch seconds), ScanBy, NextToken } ->
 *                      { MetricDataResults: [{ Id, Timestamps, Values }],
 *                      NextToken }; at most 500 queries per call.
 *
 * An error answer is { "__type": "...#Code", "message": "..." }.
 */

export const CLOUDWATCH_SERVICE: string = "monitoring";
const TARGET_PREFIX: string = "GraniteServiceVersion20100801";
const MAX_QUERIES_PER_CALL: number = 500;
const MAX_PAGES: number = 20;

// The codes that mean the key, the secret or the signature was refused.
const AUTHENTICATION_CODES: Array<string> = [
  "UnrecognizedClientException",
  "InvalidClientTokenId",
  "InvalidSignatureException",
  "SignatureDoesNotMatch",
  "IncompleteSignature",
  "IncompleteSignatureException",
  "ExpiredToken",
  "ExpiredTokenException",
  "MissingAuthenticationToken",
  "MissingAuthenticationTokenException",
  "RequestExpired",
];

const PROVIDER_TITLE: string = "Amazon CloudWatch";

export interface CloudWatchMetricQuery {
  id: string;
  metricName: string;
  dimensions: Array<{ name: string; value: string }>;
}

export interface CloudWatchMetricResult {
  id: string;
  timestamps: Array<number>;
  values: Array<number>;
}

export interface CloudWatchClientOptions {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  transport: LlmConnectorTransport;
  requestTimeoutInMs?: number | undefined;
  now?: (() => Date) | undefined;
}

export default class CloudWatchClient {
  private options: CloudWatchClientOptions;
  private requestCount: number = 0;

  public constructor(options: CloudWatchClientOptions) {
    AwsSecurityHubClient.validateRegion(options.region);
    AwsSecurityHubClient.validateAccessKeyId(options.accessKeyId);

    if (!options.secretAccessKey) {
      throw new BadDataException("Secret access key is required.");
    }

    this.options = options;
  }

  public getRequestCount(): number {
    return this.requestCount;
  }

  // monitoring.{region}.amazonaws.com (amazonaws.com.cn in China).
  public getHost(): string {
    const region: string = this.options.region.trim();

    return `${CLOUDWATCH_SERVICE}.${region}.${
      region.startsWith("cn-") ? "amazonaws.com.cn" : "amazonaws.com"
    }`;
  }

  /*
   * The error code of a CloudWatch JSON answer: the part of "__type" after
   * '#' ("com.amazonaws...#AccessDeniedException"), or "" when there is none.
   */
  public static errorCodeOf(body: string): string {
    let parsed: unknown = undefined;

    try {
      parsed = JSON.parse(body);
    } catch {
      return "";
    }

    const type: string = readText(readObject(parsed)["__type"]);
    const hashIndex: number = type.lastIndexOf("#");

    return hashIndex >= 0 ? type.substring(hashIndex + 1) : type;
  }

  private async call(action: string, payload: JSONObject): Promise<JSONObject> {
    const body: string = JSON.stringify(payload);
    const date: Date = this.options.now ? this.options.now() : new Date();
    const headers: Dictionary<string> = {
      "Content-Type": "application/x-amz-json-1.0",
      "X-Amz-Target": `${TARGET_PREFIX}.${action}`,
      Accept: "application/json",
    };

    const signed: AwsSigV4SignResult = AwsSecurityHubClient.signRequest({
      method: "POST",
      host: this.getHost(),
      path: "/",
      headers: headers,
      body: body,
      accessKeyId: this.options.accessKeyId.trim(),
      secretAccessKey: this.options.secretAccessKey,
      region: this.options.region.trim(),
      service: CLOUDWATCH_SERVICE,
      date: date,
    });

    this.requestCount++;

    try {
      return await LlmProviderHttp.requestJson({
        transport: this.options.transport,
        method: "POST",
        url: `https://${this.getHost()}/`,
        headers: signed.headers,
        body: body,
        timeoutInMs: this.options.requestTimeoutInMs,
        step: `${action} request`,
        providerTitle: PROVIDER_TITLE,
        secretValues: [this.options.secretAccessKey],
      });
    } catch (error) {
      throw CloudWatchClient.classify(error, this.options.secretAccessKey);
    }
  }

  /*
   * CloudWatch answers a refused key or signature with a 400 that names the
   * code; without reading the code it would read as a setting to fix.
   */
  public static classify(
    error: unknown,
    secretAccessKey: string,
  ): LlmProviderError {
    const failure: LlmProviderError =
      error instanceof LlmProviderError
        ? error
        : LlmProviderError.from({
            error,
            step: "request",
            providerTitle: PROVIDER_TITLE,
            secretValues: [secretAccessKey],
          });

    const code: string = CloudWatchClient.errorCodeOf(
      failure.responseBody || "",
    );

    if (AUTHENTICATION_CODES.includes(code)) {
      return new LlmProviderError({
        message: failure.message,
        kind: LlmConnectionFailureKind.Authentication,
        statusCode: failure.statusCode,
      });
    }

    if (code === "AccessDeniedException" || code === "AccessDenied") {
      return new LlmProviderError({
        message: failure.message,
        kind: LlmConnectionFailureKind.Permission,
        statusCode: failure.statusCode,
      });
    }

    if (code === "Throttling" || code === "ThrottlingException") {
      return new LlmProviderError({
        message: failure.message,
        kind: LlmConnectionFailureKind.RateLimited,
        statusCode: failure.statusCode,
      });
    }

    return failure;
  }

  // Every metric of a name in a namespace that carries exactly these dimensions.
  public async listMetricDimensionValues(data: {
    namespace: string;
    metricName: string;
    dimensionName: string;
  }): Promise<Array<string>> {
    const values: Set<string> = new Set<string>();
    let nextToken: string = "";

    for (let index: number = 0; index < MAX_PAGES; index++) {
      const payload: JSONObject = {
        Namespace: data.namespace,
        MetricName: data.metricName,
        Dimensions: [{ Name: data.dimensionName }],
      };

      if (nextToken) {
        payload["NextToken"] = nextToken;
      }

      const response: JSONObject = await this.call("ListMetrics", payload);

      for (const raw of readArray(response["Metrics"])) {
        const dimensions: Array<unknown> = readArray(
          readObject(raw)["Dimensions"],
        );

        // ModelId alone: the ModelId + ContextWindow series is a subset of it.
        if (dimensions.length !== 1) {
          continue;
        }

        const dimension: JSONObject = readObject(dimensions[0]);

        if (readText(dimension["Name"]) === data.dimensionName) {
          const value: string = readText(dimension["Value"]);

          if (value) {
            values.add(value);
          }
        }
      }

      const next: string = readText(response["NextToken"]);

      if (!next || next === nextToken) {
        break;
      }

      nextToken = next;
    }

    return Array.from(values).sort();
  }

  // Daily sums of the queries over [startTime, endTime).
  public async getDailySums(data: {
    namespace: string;
    queries: Array<CloudWatchMetricQuery>;
    startTime: Date;
    endTime: Date;
  }): Promise<Array<CloudWatchMetricResult>> {
    const results: Map<string, CloudWatchMetricResult> = new Map();

    for (
      let offset: number = 0;
      offset < data.queries.length;
      offset += MAX_QUERIES_PER_CALL
    ) {
      const batch: Array<CloudWatchMetricQuery> = data.queries.slice(
        offset,
        offset + MAX_QUERIES_PER_CALL,
      );
      let nextToken: string = "";

      for (let index: number = 0; index < MAX_PAGES; index++) {
        const payload: JSONObject = {
          MetricDataQueries: batch.map((query: CloudWatchMetricQuery) => {
            return {
              Id: query.id,
              MetricStat: {
                Metric: {
                  Namespace: data.namespace,
                  MetricName: query.metricName,
                  Dimensions: query.dimensions.map(
                    (dimension: { name: string; value: string }) => {
                      return { Name: dimension.name, Value: dimension.value };
                    },
                  ),
                },
                Period: 86400,
                Stat: "Sum",
              },
              ReturnData: true,
            };
          }),
          StartTime: Math.floor(data.startTime.getTime() / 1000),
          EndTime: Math.floor(data.endTime.getTime() / 1000),
          ScanBy: "TimestampAscending",
        };

        if (nextToken) {
          payload["NextToken"] = nextToken;
        }

        const response: JSONObject = await this.call("GetMetricData", payload);

        for (const raw of readArray(response["MetricDataResults"])) {
          const result: JSONObject = readObject(raw);
          const id: string = readText(result["Id"]);

          if (!id) {
            continue;
          }

          const entry: CloudWatchMetricResult = results.get(id) || {
            id,
            timestamps: [],
            values: [],
          };
          const timestamps: Array<unknown> = readArray(result["Timestamps"]);
          const values: Array<unknown> = readArray(result["Values"]);

          timestamps.forEach((timestamp: unknown, position: number) => {
            entry.timestamps.push(CloudWatchClient.readTimestamp(timestamp));
            entry.values.push(Number(values[position]));
          });

          results.set(id, entry);
        }

        const next: string = readText(response["NextToken"]);

        if (!next || next === nextToken) {
          break;
        }

        nextToken = next;
      }
    }

    return Array.from(results.values());
  }

  // Epoch seconds (the JSON protocol) or an ISO string; milliseconds out.
  public static readTimestamp(value: unknown): number {
    if (typeof value === "number") {
      return value * 1000;
    }

    const parsed: number = Date.parse(String(value));
    return Number.isFinite(parsed) ? parsed : NaN;
  }
}
