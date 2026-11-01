import { CloudReadBudget } from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  CloudLiveReadContext,
  CloudLiveReadInventoryRow,
  CloudLiveReadTarget,
} from "../../../../Server/Utils/CloudConnection/LiveRead/CloudLiveReadTypes";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  CloudCatalogProvider,
  CloudCommandParse,
  parseCloudCommand,
} from "../../../../Utils/AiRemediation/Resource/CloudOperationCatalog";
import { tokenizeResourceCommand } from "../../../../Utils/AiRemediation/Resource/ResourceCommandPolicyCore";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * Fake clouds for the live reads (CloudLiveRead and its readers): every
 * request answered by a handler a test names, and recorded as the cloud
 * would read it - the host's service and Region, the action (an AWS Query
 * protocol's Action, a JSON protocol's X-Amz-Target, a Lambda REST path),
 * the form or JSON body - so a test asserts each request and the text the
 * read made of the answers. A request no handler answers is answered as an
 * error that names it, so a read that asks for something unexpected fails
 * loudly. Non-2xx answers are thrown the way the production transport
 * throws them (FakeProviderApi).
 */

export const LIVE_NOW: Date = new Date("2026-10-27T10:00:00.000Z");
export const LIVE_ACCOUNT: string = "123456789012";

// A target for a reader, read from a command exactly as CloudLiveRead reads it.
export function liveTarget(
  provider: CloudCatalogProvider,
  command: string,
  data: {
    accountId: string;
    inventory?: CloudLiveReadInventoryRow | null | undefined;
  },
): CloudLiveReadTarget {
  const argv: Array<string> | undefined = tokenizeResourceCommand(command).argv;
  const parse: CloudCommandParse = parseCloudCommand(provider, argv);

  if (!parse.ok) {
    throw new Error(`Not a cloud command: ${parse.errorMessage}`);
  }

  if (!parse.command.resource) {
    throw new Error("The command names no resource.");
  }

  return {
    command: parse.command,
    resource: parse.command.resource,
    accountId: data.accountId,
    inventory: data.inventory ?? null,
  };
}

export function liveContext(
  api: FakeProviderApi,
  data: { maxRequests?: number | undefined; now?: Date | undefined } = {},
): CloudLiveReadContext {
  return {
    transport: api.transport,
    now: (): Date => {
      return data.now || LIVE_NOW;
    },
    sleep: async (): Promise<void> => {
      return undefined;
    },
    budget: new CloudReadBudget({
      maxRequests: data.maxRequests ?? 100,
      maxDurationMs: 60000,
    }),
  };
}

export function inventoryRow(
  overrides: Partial<CloudLiveReadInventoryRow> = {},
): CloudLiveReadInventoryRow {
  return {
    name: "stored-name",
    resourceType: "",
    region: "",
    properties: {},
    tags: {},
    inventoriedAt: new Date("2026-10-27T09:51:00.000Z"),
    ...overrides,
  };
}

export function headerOf(request: DataSourceHttpRequest, name: string): string {
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

// ---- AWS ---------------------------------------------------------------------

export interface AwsLiveCall {
  // The host's first label: "ecs", "ec2", "lambda", "monitoring".
  service: string;
  region: string;
  method: string;
  path: string;
  query: URLSearchParams;
  /*
   * What was asked: the Query protocol's Action, the JSON protocol's
   * X-Amz-Target operation, or Lambda's operation read off its REST path.
   */
  action: string;
  target: string;
  form: URLSearchParams;
  json: JSONObject;
  request: DataSourceHttpRequest;
}

export type AwsLiveHandler = (call: AwsLiveCall) => FakeResponse;

export interface FakeAwsLive extends FakeProviderApi {
  calls: Array<AwsLiveCall>;
  // The calls of one "service:Action".
  callsTo: (key: string) => Array<AwsLiveCall>;
}

// Lambda's operation, from its REST path.
function lambdaAction(method: string, path: string): string {
  if (method !== "GET") {
    return `${method} ${path}`;
  }

  if (path.endsWith("/configuration")) {
    return "GetFunctionConfiguration";
  }

  if (path.endsWith("/concurrency")) {
    return "GetFunctionConcurrency";
  }

  if (path.includes("/aliases/")) {
    return "GetAlias";
  }

  return `GET ${path}`;
}

/*
 * AWS: every host, every protocol. Handlers are keyed "service:Action"
 * ("ecs:DescribeServices", "ec2:DescribeInstances",
 * "lambda:GetFunctionConfiguration", "monitoring:GetMetricData").
 */
export function createFakeAwsLive(
  handlers: Record<string, AwsLiveHandler>,
): FakeAwsLive {
  const calls: Array<AwsLiveCall> = [];

  const api: FakeProviderApi = createFakeProviderApi([
    {
      path: /^\//,
      respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const service: string = url.host.split(".")[0] || "";
        const region: string = url.host.split(".")[1] || "";
        const target: string = headerOf(request, "X-Amz-Target");
        const bodyText: string =
          typeof request.body === "string" ? request.body : "";
        const isJson: boolean = Boolean(target);
        const form: URLSearchParams = new URLSearchParams(
          !isJson && request.method === "POST" ? bodyText : "",
        );
        let parsed: JSONObject = {};

        if (isJson && bodyText) {
          parsed = JSON.parse(bodyText) as JSONObject;
        }

        const action: string =
          service === "lambda"
            ? lambdaAction(request.method, url.pathname)
            : isJson
              ? target.slice(target.lastIndexOf(".") + 1)
              : form.get("Action") || "";
        const call: AwsLiveCall = {
          service,
          region,
          method: request.method,
          path: url.pathname,
          query: url.searchParams,
          action,
          target,
          form,
          json: parsed,
          request,
        };

        calls.push(call);

        const handler: AwsLiveHandler | undefined =
          handlers[`${service}:${action}`];

        if (!handler) {
          return awsJsonError(
            400,
            "InvalidAction",
            `no fake answers ${service}:${action}`,
          );
        }

        return handler(call);
      },
    },
  ]);

  return {
    ...api,
    calls,
    callsTo: (key: string): Array<AwsLiveCall> => {
      return calls.filter((call: AwsLiveCall): boolean => {
        return `${call.service}:${call.action}` === key;
      });
    },
  };
}

// A Query protocol answer: <ActionResponse><ActionResult>inner</ActionResult></ActionResponse>.
export function awsXml(action: string, inner: string): FakeResponse {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<${action}Response xmlns="https://example.amazonaws.com/doc/"><${action}Result>${inner}</${action}Result><ResponseMetadata><RequestId>req-1</RequestId></ResponseMetadata></${action}Response>`,
  };
}

// EC2's answers have no Result element.
export function ec2Xml(action: string, inner: string): FakeResponse {
  return {
    status: 200,
    body: `<?xml version="1.0" encoding="UTF-8"?>\n<${action}Response xmlns="http://ec2.amazonaws.com/doc/2016-11-15/"><requestId>req-1</requestId>${inner}</${action}Response>`,
  };
}

export function awsJson(body: JSONValue): FakeResponse {
  return json(body);
}

export function awsJsonError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: JSON.stringify({ __type: `com.amazonaws.coral#${code}`, message }),
  };
}

export function awsXmlError(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: `<ErrorResponse><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>req-1</RequestId></ErrorResponse>`,
  };
}

export function ec2Error(
  status: number,
  code: string,
  message: string = "denied",
): FakeResponse {
  return {
    status,
    body: `<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors><RequestID>req-1</RequestID></Response>`,
  };
}

// STS AssumeRole's answer: a session whose key names the role's account.
export function assumeRoleAnswer(account: string): FakeResponse {
  return {
    status: 200,
    body: `<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><AssumeRoleResult><AssumedRoleUser><Arn>arn:aws:sts::${account}:assumed-role/OneUptimeReadOnly/x</Arn><AssumedRoleId>AROA:x</AssumedRoleId></AssumedRoleUser><Credentials><AccessKeyId>ASIA${account}ROLE</AccessKeyId><SecretAccessKey>assumed-secret-${account}</SecretAccessKey><SessionToken>session-token-${account}</SessionToken><Expiration>2099-01-01T00:00:00Z</Expiration></Credentials></AssumeRoleResult></AssumeRoleResponse>`,
  };
}

// ---- Azure -------------------------------------------------------------------

export const AZURE_TENANT: string = "b3c1b5fc-828c-45fa-a1e1-10d74f6d6e9c";
export const AZURE_CLIENT: string = "00001111-aaaa-2222-bbbb-3333cccc4444";
export const AZURE_SUBSCRIPTION: string =
  "d0cfe6b2-9ac0-4464-9919-dccaee2e48c0";
export const AZURE_CLIENT_SECRET: string = "client-secret~value-1234";

export interface FakeAzureLive extends FakeProviderApi {
  // The scope each sign-in asked for, in order.
  tokenScopes: Array<string>;
  armCalls: Array<URL>;
  logCalls: Array<{ url: URL; body: JSONObject; authorization: string }>;
}

export function createFakeAzureLive(options: {
  arm?:
    | ((url: URL, request: DataSourceHttpRequest) => FakeResponse)
    | undefined;
  logs?:
    | ((
        url: URL,
        body: JSONObject,
        request: DataSourceHttpRequest,
      ) => FakeResponse)
    | undefined;
  tokenError?: FakeResponse | undefined;
}): FakeAzureLive {
  const tokenScopes: Array<string> = [];
  const armCalls: Array<URL> = [];
  const logCalls: FakeAzureLive["logCalls"] = [];

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "login.microsoftonline.com",
      path: `/${AZURE_TENANT}/oauth2/v2.0/token`,
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const body: Record<string, string> = (request.body || {}) as Record<
          string,
          string
        >;
        const scope: string = body["scope"] || "";
        tokenScopes.push(scope);

        if (options.tokenError) {
          return options.tokenError;
        }

        return json({
          access_token: scope.includes("loganalytics")
            ? "logs-access-token"
            : "arm-access-token",
          expires_in: 3599,
        });
      },
    },
    {
      host: "management.azure.com",
      path: /^\//,
      respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
        armCalls.push(url);

        if (!options.arm) {
          return json({ error: { code: "NoFake" } }, 404);
        }

        return options.arm(url, request);
      },
    },
    {
      host: "api.loganalytics.io",
      path: /^\//,
      respond: (request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const body: JSONObject =
          typeof request.body === "string"
            ? (JSON.parse(request.body) as JSONObject)
            : {};
        logCalls.push({
          url,
          body,
          authorization: headerOf(request, "Authorization"),
        });

        if (!options.logs) {
          return json({ error: { code: "NoFake" } }, 404);
        }

        return options.logs(url, body, request);
      },
    },
  ]);

  return { ...api, tokenScopes, armCalls, logCalls };
}

// ---- Google Cloud ------------------------------------------------------------

export interface FakeGcpLive extends FakeProviderApi {
  assetCalls: Array<URL>;
  loggingCalls: Array<JSONObject>;
  monitoringCalls: Array<URL>;
}

export function createFakeGcpLive(options: {
  asset?: ((url: URL) => FakeResponse) | undefined;
  logging?: ((body: JSONObject) => FakeResponse) | undefined;
  monitoring?: ((url: URL) => FakeResponse) | undefined;
}): FakeGcpLive {
  const assetCalls: Array<URL> = [];
  const loggingCalls: Array<JSONObject> = [];
  const monitoringCalls: Array<URL> = [];

  const api: FakeProviderApi = createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "ya29.live-token", expires_in: 3599 });
      },
    },
    {
      host: "cloudasset.googleapis.com",
      path: /^\//,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        assetCalls.push(url);
        return options.asset ? options.asset(url) : json({ results: [] });
      },
    },
    {
      host: "logging.googleapis.com",
      path: "/v2/entries:list",
      method: "POST",
      respond: (request: DataSourceHttpRequest): FakeResponse => {
        const body: JSONObject =
          typeof request.body === "string"
            ? (JSON.parse(request.body) as JSONObject)
            : {};
        loggingCalls.push(body);
        return options.logging ? options.logging(body) : json({ entries: [] });
      },
    },
    {
      host: "monitoring.googleapis.com",
      path: /^\//,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        monitoringCalls.push(url);
        return options.monitoring
          ? options.monitoring(url)
          : json({ timeSeries: [] });
      },
    },
  ]);

  return { ...api, assetCalls, loggingCalls, monitoringCalls };
}
