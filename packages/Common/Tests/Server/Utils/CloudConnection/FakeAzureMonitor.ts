import AzureArm from "../../../../Server/Utils/CloudConnection/Azure/AzureArm";
import { CloudReadBudget } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * AZURE MONITOR'S METRICS, AS A TEST ANSWERS THEM (#10291): a call per
 * resource on Resource Manager, and metrics:getBatch on a Region's data
 * plane, each answered with every metric's points - or its own error, as
 * Azure answers one inside an answer that reads the others, from what the
 * call asked (`metricError`) - or the call refused or throttled whole
 * (`callAnswer`). Every call is recorded with what it asked, and how many
 * were in flight at once per subscription and Region (`hold` keeps each
 * open until it is let go).
 *
 * Its words for a failure are Azure Monitor's own, from the answers the
 * issue quotes: ServerBusy's "Too many queries are in flight", a sampling
 * type a metric is not served with, "Bad request".
 */

export const FAKE_TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
export const FAKE_SUBSCRIPTION: string = "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
export const OTHER_SUBSCRIPTION: string =
  "7c4a1f2e-9d3b-4e5f-8a6b-1c2d3e4f5a6b";
// 12:07: the window Azure Monitor has: up to 12:03.
export const FAKE_WINDOW: { start: Date; end: Date } = {
  start: new Date("2026-10-21T11:58:00Z"),
  end: new Date("2026-10-21T12:03:00Z"),
};

// A metric's own error inside an answer, as Azure Monitor writes it.
export interface FakeMetricError {
  errorCode: string;
  errorMessage: string;
}

/*
 * ServerBusy, as Azure Monitor answers a query it throttles: a metric's own
 * error inside an answer, or a whole call's 529.
 */
export const SERVER_BUSY: FakeMetricError = {
  errorCode: "Throttled",
  errorMessage:
    "Query was throttled with reason: ServerBusy. Microsoft.Online.Metrics.MetricsMP.Utilities.QueryThrottledException: Too many queries are in flight., TraceId: {6f0d2a3c-1b4e-4c55-9e1f-0a7d3b2c1e00}",
};
export const SERVER_BUSY_CALL: FakeResponse = {
  status: 529,
  body: JSON.stringify({
    code: "Throttled",
    message: SERVER_BUSY.errorMessage,
  }),
};

// Front Door's ByteHitRatio asked in a call that also names a Total.
export function samplingTypeNotFound(
  metric: string,
  requested: string,
): FakeMetricError {
  return {
    errorCode: "BadRequest",
    errorMessage: `Sampling type is not found. Metric: AzureFrontdoorShoebox/${metric}. Sampling type requested: ${requested}.`,
  };
}

// Cosmos DB's ThrottledRequestPercentage asked with an aggregation it is not served with.
export const BAD_REQUEST: FakeMetricError = {
  errorCode: "BadRequest",
  errorMessage: "Bad request",
};

export interface FakeMonitorCall {
  isBatch: boolean;
  host: string;
  subscriptionId: string;
  resourceIds: Array<string>;
  metrics: Array<string>;
  aggregations: Array<string>;
  interval: string;
  namespace: string;
  splitBy: string;
}

export interface FakeAzureMonitorOptions {
  /*
   * A metric's own error for a call, or null to answer its points: from
   * the aggregations the call names and how many times the resource's
   * metric was asked before.
   */
  metricError?:
    | ((data: {
        resourceId: string;
        metric: string;
        aggregations: Array<string>;
        attempt: number;
      }) => FakeMetricError | null)
    | undefined;
  // A whole call's answer in place of its metrics' (a refusal, a throttle).
  callAnswer?:
    | ((data: { call: FakeMonitorCall; index: number }) => FakeResponse | null)
    | undefined;
  // What a batch leaves out of its answer, by resource id.
  leftOut?: Array<string> | undefined;
  // The sign-in's answer for Azure Monitor's data plane, in place of a token.
  dataPlaneTokenError?: FakeResponse | undefined;
  // Each call waits for this before it is answered.
  hold?: ((call: FakeMonitorCall) => Promise<void>) | undefined;
  // A resource's metric definitions, as Resource Manager lists them.
  definitions?: ((resourceId: string) => Array<JSONObject>) | undefined;
}

/*
 * A metric's definition as Azure Monitor lists it: its primary
 * aggregation, the ones it is served with ("None" is Azure's own entry,
 * never asked for), and the grains it is kept at.
 */
export function fakeDefinition(data: {
  name: string;
  primary: string;
  served: Array<string>;
  grains?: Array<string> | undefined;
  unit?: string | undefined;
}): JSONObject {
  return {
    name: { value: data.name, localizedValue: data.name },
    unit: data.unit || "Percent",
    primaryAggregationType: data.primary,
    supportedAggregationTypes: ["None", ...data.served],
    metricAvailabilities: (data.grains || ["PT1M", "PT5M", "PT1H"]).map(
      (timeGrain: string): JSONObject => {
        return { timeGrain, retention: "P93D" };
      },
    ),
  };
}

export interface FakeAzureMonitor extends FakeProviderApi {
  calls: Array<FakeMonitorCall>;
  // The scopes tokens were asked for.
  scopes: Array<string>;
  // The most calls in flight at once, per "subscription|host".
  mostAtOnce: Map<string, number>;
}

const METRICS_PATH: RegExp = /\/providers\/Microsoft\.Insights\/metrics$/;
const BATCH_PATH: RegExp = /^\/subscriptions\/([^/]+)\/metrics:getBatch$/;
const SPLIT_FILTER: RegExp = /^([A-Za-z0-9]+) eq '\*'$/;

function listOf(value: string | null): Array<string> {
  return (value || "").split(",").filter((item: string): boolean => {
    return Boolean(item);
  });
}

export function createFakeAzureMonitor(
  options: FakeAzureMonitorOptions = {},
): FakeAzureMonitor {
  const calls: Array<FakeMonitorCall> = [];
  const scopes: Array<string> = [];
  const attempts: Map<string, number> = new Map();
  const inFlight: Map<string, number> = new Map();
  const mostAtOnce: Map<string, number> = new Map();

  // One resource's metrics as Azure Monitor answers them.
  const valuesOf: (data: {
    resourceId: string;
    call: FakeMonitorCall;
    start: number;
  }) => JSONArray = (data: {
    resourceId: string;
    call: FakeMonitorCall;
    start: number;
  }): JSONArray => {
    return data.call.metrics.map((metric: string, index: number) => {
      const key: string = `${data.resourceId.toLowerCase()}|${metric.toLowerCase()}`;
      const attempt: number = attempts.get(key) || 0;
      const failure: FakeMetricError | null =
        options.metricError?.({
          resourceId: data.resourceId,
          metric,
          aggregations: data.call.aggregations,
          attempt,
        }) || null;

      attempts.set(key, attempt + 1);

      if (failure) {
        return {
          name: { value: metric, localizedValue: metric },
          unit: "Unspecified",
          timeseries: [],
          errorCode: failure.errorCode,
          errorMessage: failure.errorMessage,
        };
      }

      return {
        name: { value: metric, localizedValue: metric },
        unit: "Percent",
        timeseries: [
          {
            metadatavalues: [],
            data: [
              {
                timeStamp: new Date(data.start).toISOString(),
                average: 10 + index,
                total: 100 + index,
                maximum: 50 + index,
                minimum: 1 + index,
                count: 5 + index,
              },
            ],
          },
        ],
        errorCode: "Success",
      };
    });
  };

  const track: (call: FakeMonitorCall) => Promise<() => void> = async (
    call: FakeMonitorCall,
  ): Promise<() => void> => {
    const key: string = `${call.subscriptionId}|${call.host}`;
    const now: number = (inFlight.get(key) || 0) + 1;

    inFlight.set(key, now);
    mostAtOnce.set(key, Math.max(mostAtOnce.get(key) || 0, now));

    if (options.hold) {
      await options.hold(call);
    }

    return (): void => {
      inFlight.set(key, (inFlight.get(key) || 1) - 1);
    };
  };

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${FAKE_TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const scope: string = String(
          (request.body as JSONObject | undefined)?.["scope"] || "",
        );

        scopes.push(scope);

        if (
          options.dataPlaneTokenError &&
          scope.startsWith("https://metrics.monitor.azure.com")
        ) {
          return options.dataPlaneTokenError;
        }

        return json({ access_token: `token-for-${scope}`, expires_in: 3599 });
      },
    },
    {
      host: "management.azure.com",
      path: /\/providers\/Microsoft\.Insights\/metricDefinitions$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        return json({
          value:
            options.definitions?.(
              url.pathname.replace(
                "/providers/Microsoft.Insights/metricDefinitions",
                "",
              ),
            ) || [],
        });
      },
    },
    {
      host: "management.azure.com",
      path: METRICS_PATH,
      respond: async (
        _request: DataSourceHttpRequest,
        url: URL,
      ): Promise<FakeResponse> => {
        const resourceId: string = url.pathname.replace(
          "/providers/Microsoft.Insights/metrics",
          "",
        );
        const call: FakeMonitorCall = {
          isBatch: false,
          host: url.host,
          subscriptionId: resourceId.split("/")[2] || "",
          resourceIds: [resourceId],
          metrics: listOf(url.searchParams.get("metricnames")),
          aggregations: listOf(url.searchParams.get("aggregation")),
          interval: url.searchParams.get("interval") || "",
          namespace: "",
          splitBy:
            SPLIT_FILTER.exec(url.searchParams.get("$filter") || "")?.[1] || "",
        };

        calls.push(call);

        const done: () => void = await track(call);

        try {
          const answer: FakeResponse | null =
            options.callAnswer?.({ call, index: calls.length - 1 }) || null;

          if (answer) {
            return answer;
          }

          return json({
            value: valuesOf({
              resourceId,
              call,
              start: Date.parse(
                (url.searchParams.get("timespan") || "").split("/")[0]!,
              ),
            }),
          });
        } finally {
          done();
        }
      },
    },
    {
      path: BATCH_PATH,
      method: "POST",
      respond: async (
        request: DataSourceHttpRequest,
        url: URL,
      ): Promise<FakeResponse> => {
        const body: JSONObject = (
          typeof request.body === "string"
            ? JSON.parse(request.body)
            : request.body || {}
        ) as JSONObject;
        const call: FakeMonitorCall = {
          isBatch: true,
          host: url.host,
          subscriptionId: BATCH_PATH.exec(url.pathname)?.[1] || "",
          resourceIds: ((body["resourceids"] as Array<string>) || []).map(
            (resourceId: string): string => {
              return String(resourceId);
            },
          ),
          metrics: listOf(url.searchParams.get("metricnames")),
          aggregations: listOf(url.searchParams.get("aggregation")),
          interval: url.searchParams.get("interval") || "",
          namespace: url.searchParams.get("metricnamespace") || "",
          splitBy: "",
        };

        calls.push(call);

        const done: () => void = await track(call);

        try {
          const answer: FakeResponse | null =
            options.callAnswer?.({ call, index: calls.length - 1 }) || null;

          if (answer) {
            return answer;
          }

          return json({
            values: call.resourceIds
              .filter((resourceId: string): boolean => {
                return !(options.leftOut || []).includes(resourceId);
              })
              .map((resourceId: string): JSONObject => {
                return {
                  starttime: url.searchParams.get("starttime") || "",
                  endtime: url.searchParams.get("endtime") || "",
                  interval: call.interval,
                  namespace: call.namespace.toLowerCase(),
                  resourceregion: url.host.split(".")[0]!,
                  // As Azure answers it: its own casing.
                  resourceid: resourceId.toLowerCase(),
                  value: valuesOf({
                    resourceId,
                    call,
                    start: Date.parse(url.searchParams.get("starttime") || ""),
                  }),
                };
              }),
          });
        } finally {
          done();
        }
      },
    },
  ]);

  return { ...api, calls, scopes, mostAtOnce };
}

// An app with the Monitoring Reader role, signed in through the fake.
export function createFakeArm(data: {
  fake: FakeAzureMonitor;
  budget: CloudReadBudget;
  cloud?: "public" | "usgov" | undefined;
}): AzureArm {
  return new AzureArm({
    tenantId: FAKE_TENANT,
    clientId: "00001111-aaaa-2222-bbbb-3333cccc4444",
    clientSecret: "client-secret~value",
    cloud: data.cloud || "public",
    transport: data.fake.transport,
    budget: data.budget,
  });
}

// A resource's ARM id, of the subscription, type and name.
export function armIdOf(data: {
  subscriptionId?: string | undefined;
  type: string;
  name: string;
}): string {
  return `/subscriptions/${data.subscriptionId || FAKE_SUBSCRIPTION}/resourceGroups/rg-prod/providers/${data.type}/${data.name}`;
}
