import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  FakeRoute,
  bodyOf,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * AWS in a test: CloudWatch (per Region), STS and the Resource Groups
 * Tagging API, answering the way they do - CloudWatch and Tagging in their
 * JSON protocols (the action in X-Amz-Target), STS in XML - and every
 * error the way the production transport throws it. Each Region's
 * CloudWatch holds metrics (what ListMetrics lists) and values (what
 * GetMetricData returns for a metric and its dimensions).
 */

export const FAKE_ACCOUNT_ID: string = "123456789012";

export interface FakeMetric {
  namespace: string;
  metricName: string;
  dimensions: Array<[string, string]>;
  // [epoch seconds, value]
  values?: Array<[number, number]> | undefined;
}

export interface FakeRegion {
  metrics: Array<FakeMetric>;
  // Answer every call with this error instead.
  error?: FakeResponse | undefined;
  // Answer GetMetricData with these in turn first (throttling, failure).
  getMetricDataAnswers?: Array<FakeResponse> | undefined;
  // ARN (any case) -> Name tag.
  names?: Record<string, string> | undefined;
  tagsError?: FakeResponse | undefined;
}

export interface FakeAwsOptions {
  regions: Record<string, FakeRegion>;
  // Regions not listed answer as a Region the account has not opted in to.
  account?: string | undefined;
  callerIdentityError?: FakeResponse | undefined;
  assumeRoleError?: FakeResponse | undefined;
}

export interface FakeAws extends FakeProviderApi {
  // CloudWatch calls by action and Region, in order.
  cloudWatchCalls: Array<{ action: string; region: string; body: JSONObject }>;
  stsCalls: Array<{
    action: string;
    body: URLSearchParams;
    request: DataSourceHttpRequest;
  }>;
  taggingCalls: Array<{ region: string; body: JSONObject }>;
}

export function awsError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: JSON.stringify({ __type: `com.amazonaws.coral#${code}`, message }),
  };
}

export function stsError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>1</RequestId></ErrorResponse>`,
  };
}

function headerOf(request: DataSourceHttpRequest, name: string): string {
  const headers: Record<string, string> = (request.headers || {}) as Record<
    string,
    string
  >;

  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return headers[key] || "";
    }
  }

  return "";
}

// The Region a host names: monitoring.us-east-1.amazonaws.com -> us-east-1.
function regionOf(host: string): string {
  return host.split(".")[1] || "";
}

function dimensionsMatch(
  metric: FakeMetric,
  dimensions: Array<JSONObject>,
): boolean {
  if (metric.dimensions.length !== dimensions.length) {
    return false;
  }

  return metric.dimensions.every(([name, value]: [string, string]) => {
    return dimensions.some((dimension: JSONObject): boolean => {
      return dimension["Name"] === name && dimension["Value"] === value;
    });
  });
}

export function createFakeAws(options: FakeAwsOptions): FakeAws {
  const cloudWatchCalls: FakeAws["cloudWatchCalls"] = [];
  const stsCalls: FakeAws["stsCalls"] = [];
  const taggingCalls: FakeAws["taggingCalls"] = [];
  const getMetricDataTurns: Map<string, number> = new Map();
  const account: string = options.account || FAKE_ACCOUNT_ID;

  const route: FakeRoute = {
    path: "/",
    method: "POST",
    respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
      const host: string = url.host;
      const service: string = host.split(".")[0] || "";
      const region: string = regionOf(host);

      if (service === "sts") {
        const form: URLSearchParams = new URLSearchParams(
          String(request.body || ""),
        );
        const action: string = form.get("Action") || "";
        stsCalls.push({ action, body: form, request });

        if (action === "GetCallerIdentity") {
          if (options.callerIdentityError) {
            return options.callerIdentityError;
          }

          return {
            status: 200,
            body: `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><GetCallerIdentityResult><Arn>arn:aws:iam::${account}:user/reader</Arn><UserId>AIDAEXAMPLE</UserId><Account>${account}</Account></GetCallerIdentityResult><ResponseMetadata><RequestId>1</RequestId></ResponseMetadata></GetCallerIdentityResponse>`,
          };
        }

        if (action === "AssumeRole") {
          if (options.assumeRoleError) {
            return options.assumeRoleError;
          }

          return {
            status: 200,
            body: `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><AssumedRoleUser><Arn>arn:aws:sts::${account}:assumed-role/OneUptimeReadOnly/x</Arn><AssumedRoleId>AROA:x</AssumedRoleId></AssumedRoleUser><Credentials><AccessKeyId>ASIAASSUMEDROLE00001</AccessKeyId><SecretAccessKey>assumed/secret&amp;key</SecretAccessKey><SessionToken>session-token-abc</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
          };
        }

        return stsError(400, "InvalidAction");
      }

      const fakeRegion: FakeRegion | undefined = options.regions[region];

      if (!fakeRegion) {
        // An opt-in Region the account has not enabled.
        return awsError(
          403,
          "UnrecognizedClientException",
          "The security token included in the request is invalid.",
        );
      }

      if (fakeRegion.error) {
        return fakeRegion.error;
      }

      const target: string = headerOf(request, "X-Amz-Target");
      const body: JSONObject = bodyOf(request);

      if (service === "tagging") {
        taggingCalls.push({ region, body });

        if (fakeRegion.tagsError) {
          return fakeRegion.tagsError;
        }

        return json({
          ResourceTagMappingList: Object.entries(fakeRegion.names || {}).map(
            ([arn, name]: [string, string]) => {
              return { ResourceARN: arn, Tags: [{ Key: "Name", Value: name }] };
            },
          ),
          PaginationToken: "",
        });
      }

      const action: string = target.split(".")[1] || "";
      cloudWatchCalls.push({ action, region, body });

      if (action === "ListMetrics") {
        const matched: Array<FakeMetric> = fakeRegion.metrics.filter(
          (metric: FakeMetric): boolean => {
            return (
              metric.namespace === body["Namespace"] &&
              (!body["MetricName"] || metric.metricName === body["MetricName"])
            );
          },
        );

        return json({
          Metrics: matched.map((metric: FakeMetric) => {
            return {
              Namespace: metric.namespace,
              MetricName: metric.metricName,
              Dimensions: metric.dimensions.map(
                ([Name, Value]: [string, string]) => {
                  return { Name, Value };
                },
              ),
            };
          }),
        });
      }

      if (action === "GetMetricData") {
        const turn: number = getMetricDataTurns.get(region) || 0;
        getMetricDataTurns.set(region, turn + 1);
        const scripted: FakeResponse | undefined =
          fakeRegion.getMetricDataAnswers?.[turn];

        if (scripted) {
          return scripted;
        }

        const queries: Array<JSONObject> = (body["MetricDataQueries"] ||
          []) as Array<JSONObject>;

        return json({
          MetricDataResults: queries.map((query: JSONObject) => {
            const stat: JSONObject = query["MetricStat"] as JSONObject;
            const metric: JSONObject = stat["Metric"] as JSONObject;
            const found: FakeMetric | undefined = fakeRegion.metrics.find(
              (candidate: FakeMetric): boolean => {
                return (
                  candidate.namespace === metric["Namespace"] &&
                  candidate.metricName === metric["MetricName"] &&
                  dimensionsMatch(
                    candidate,
                    (metric["Dimensions"] || []) as Array<JSONObject>,
                  )
                );
              },
            );
            const values: Array<[number, number]> = (
              found?.values || []
            ).filter(([time]: [number, number]): boolean => {
              return (
                time >= Number(body["StartTime"]) &&
                time < Number(body["EndTime"])
              );
            });

            return {
              Id: query["Id"],
              Timestamps: values.map(([time]: [number, number]) => {
                return time;
              }),
              Values: values.map(([, value]: [number, number]) => {
                return value;
              }),
              StatusCode: "Complete",
            };
          }),
        });
      }

      return awsError(400, "InvalidAction");
    },
  };

  const api: FakeProviderApi = createFakeProviderApi([route]);

  return { ...api, cloudWatchCalls, stsCalls, taggingCalls };
}
