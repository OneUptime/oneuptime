import {
  CloudHttpRequest,
  CloudHttpResponse,
} from "../../Executors/Cloud/CloudHttp";
import { signAwsRequest } from "../../Executors/Cloud/AwsSigV4";

/*
 * Fake clouds for the Cloud AI agent's tests. Every request the executor
 * would send goes through FakeCloud.transport, is recorded exactly, and is
 * answered by the last route that matches it (a test overrides a default
 * by adding a route). On top of it:
 *
 *   FakeAws    every *.amazonaws.com call: checks the SigV4 signature
 *              against the secret of the key that signed it (and the fake
 *              clock), reads the IAM action from the protocol (Query
 *              Action, X-Amz-Target, Lambda's REST paths), enforces the
 *              session policy of an assumed-role session (an action no
 *              statement allows is AccessDenied and recorded), answers STS
 *              itself, and hands everything else to per-action handlers.
 *              The ECS container credentials endpoint answers too.
 *   FakeArm    Azure Resource Manager and the two token endpoints.
 *   FakeGcp    the metadata server and Google's APIs.
 */

export type FakeAnswer = CloudHttpResponse | Error;

type Responder = (
  request: CloudHttpRequest,
  url: URL,
) => FakeAnswer | Promise<FakeAnswer>;

interface FakeRoute {
  method: string;
  matches: (url: URL) => boolean;
  respond: Responder;
}

export function reply(
  status: number,
  body: string,
  headers: Record<string, string> = {},
): CloudHttpResponse {
  const lowered: Record<string, string> = {};

  for (const [name, value] of Object.entries(headers)) {
    lowered[name.toLowerCase()] = value;
  }

  return { status, headers: lowered, body, truncated: false };
}

export function jsonReply(
  body: unknown,
  status: number = 200,
  headers: Record<string, string> = {},
): CloudHttpResponse {
  return reply(status, JSON.stringify(body), {
    "content-type": "application/json",
    ...headers,
  });
}

export function xmlReply(
  body: string,
  status: number = 200,
): CloudHttpResponse {
  return reply(status, body, { "content-type": "text/xml" });
}

// Origin and path, without the query: what routes match on.
export function bareUrl(url: URL): string {
  return `${url.origin}${url.pathname}`;
}

export class FakeCloud {
  public readonly requests: Array<CloudHttpRequest> = [];
  private readonly routes: Array<FakeRoute> = [];

  /*
   * Answer METHOD (or "*") requests to this URL (origin and path, query
   * ignored), URLs this pattern matches, or URLs the predicate accepts.
   */
  public on(
    method: string,
    url: string | RegExp | ((url: URL) => boolean),
    respond: Responder,
  ): this {
    const matches: (candidate: URL) => boolean =
      typeof url === "string"
        ? (candidate: URL): boolean => {
            return bareUrl(candidate) === url;
          }
        : url instanceof RegExp
          ? (candidate: URL): boolean => {
              return url.test(candidate.toString());
            }
          : url;

    this.routes.push({ method, matches, respond });
    return this;
  }

  public readonly transport: (
    request: CloudHttpRequest,
  ) => Promise<CloudHttpResponse> = async (
    request: CloudHttpRequest,
  ): Promise<CloudHttpResponse> => {
    this.requests.push(request);

    const url: URL = new URL(request.url);

    for (let index: number = this.routes.length - 1; index >= 0; index--) {
      const route: FakeRoute | undefined = this.routes[index];

      if (
        route &&
        (route.method === "*" || route.method === request.method) &&
        route.matches(url)
      ) {
        const answer: FakeAnswer = await route.respond(request, url);

        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      }
    }

    return jsonReply(
      { message: `no fake route for ${request.method} ${request.url}` },
      404,
    );
  };

  // "METHOD url" of every request, in order.
  public urls(): Array<string> {
    return this.requests.map((request: CloudHttpRequest): string => {
      return `${request.method} ${request.url}`;
    });
  }
}

function header(request: CloudHttpRequest, name: string): string | null {
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === name.toLowerCase()) {
      return value;
    }
  }

  return null;
}

// ---- AWS --------------------------------------------------------------------------------

export const AWS_ACCOUNT: string = "123456789012";
export const AWS_REGION: string = "us-east-1";
export const AWS_TASK_ROLE_ARN: string = `arn:aws:iam::${AWS_ACCOUNT}:role/OneUptimeAiAgentTask`;
export const AWS_WRITE_ROLE_ARN: string = `arn:aws:iam::${AWS_ACCOUNT}:role/OneUptimeAiAgentWrite`;
// A session name without a long run of base64 letters (the redactor would mask one).
export const AWS_TASK_CALLER_ARN: string = `arn:aws:sts::${AWS_ACCOUNT}:assumed-role/OneUptimeAiAgentTask/ecs-agent-task`;

// The base credentials the ECS container credentials endpoint hands out.
export const AWS_TASK_ACCESS_KEY: string = "ASIATASKROLE00000001";
export const AWS_TASK_SECRET: string =
  "task-role-secret-0000000000000000000000";
export const AWS_TASK_TOKEN: string = "task-role-session-token";
export const AWS_CREDENTIALS_PATH: string = "/v2/credentials/0f1e2d3c";

export interface AwsCall {
  // The IAM action: "ecs:UpdateService".
  action: string;
  region: string;
  service: string;
  accessKeyId: string;
  method: string;
  url: URL;
  // Query protocol parameters (decoded).
  form: Record<string, string>;
  // A JSON body.
  json: Record<string, unknown> | null;
  request: CloudHttpRequest;
}

export interface AssumeRoleCall {
  roleArn: string;
  sessionName: string;
  durationSeconds: string;
  policy: Record<string, unknown>;
  // The session's key, which signs the change's calls.
  accessKeyId: string;
  // Who asked (the base key).
  callerAccessKeyId: string;
}

export function stsCallerIdentityXml(arn: string, account: string): string {
  return `<GetCallerIdentityResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <GetCallerIdentityResult>
    <Arn>${arn}</Arn>
    <UserId>AROAEXAMPLE:agent</UserId>
    <Account>${account}</Account>
  </GetCallerIdentityResult>
  <ResponseMetadata><RequestId>01234567-89ab-cdef-0123-456789abcdef</RequestId></ResponseMetadata>
</GetCallerIdentityResponse>`;
}

export function awsQueryError(
  code: string,
  message: string,
  status: number = 403,
): CloudHttpResponse {
  return xmlReply(
    `<ErrorResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/"><Error><Type>Sender</Type><Code>${code}</Code><Message>${message}</Message></Error><RequestId>req-1</RequestId></ErrorResponse>`,
    status,
  );
}

export function ec2Error(
  code: string,
  message: string,
  status: number = 400,
): CloudHttpResponse {
  return xmlReply(
    `<?xml version="1.0" encoding="UTF-8"?>\n<Response><Errors><Error><Code>${code}</Code><Message>${message}</Message></Error></Errors><RequestID>req-1</RequestID></Response>`,
    status,
  );
}

export function awsJsonError(
  type: string,
  message: string,
  status: number = 400,
): CloudHttpResponse {
  return jsonReply({ __type: type, message }, status);
}

// The IAM action a Lambda REST call is.
function lambdaAction(method: string, path: string): string {
  const parts: Array<string> = path.split("/").filter(Boolean);

  if (parts[1] === "tags") {
    return "lambda:ListTags";
  }

  if (parts[3] === "concurrency") {
    return method === "GET"
      ? "lambda:GetFunctionConcurrency"
      : method === "PUT"
        ? "lambda:PutFunctionConcurrency"
        : "lambda:DeleteFunctionConcurrency";
  }

  if (parts[3] === "aliases") {
    return method === "GET" ? "lambda:GetAlias" : "lambda:UpdateAlias";
  }

  if (parts[3] === "versions") {
    return "lambda:ListVersionsByFunction";
  }

  return `lambda:${method} ${path}`;
}

const TARGET_SERVICES: Readonly<Record<string, string>> = {
  AmazonEC2ContainerServiceV20141113: "ecs",
  AnyScaleFrontendService: "application-autoscaling",
  AmazonSQS: "sqs",
};

// Whether a session policy lets this action through.
export function policyAllows(
  policy: Record<string, unknown>,
  action: string,
): boolean {
  const statements: Array<unknown> = Array.isArray(policy["Statement"])
    ? (policy["Statement"] as Array<unknown>)
    : [];

  return statements.some((statement: unknown): boolean => {
    if (!statement || typeof statement !== "object") {
      return false;
    }

    const entry: Record<string, unknown> = statement as Record<string, unknown>;
    const actions: unknown = entry["Action"];

    return (
      entry["Effect"] === "Allow" &&
      Array.isArray(actions) &&
      (actions as Array<unknown>).includes(action)
    );
  });
}

export class FakeAws {
  public readonly calls: Array<AwsCall> = [];
  public readonly assumed: Array<AssumeRoleCall> = [];
  public readonly signatureFailures: Array<string> = [];
  public readonly policyDenials: Array<string> = [];
  public credentialRequests: number = 0;
  // The account and ARN GetCallerIdentity answers for the base credentials.
  public callerAccount: string = AWS_ACCOUNT;
  public callerArn: string = AWS_TASK_CALLER_ARN;
  // The account an AssumeRole session acts in (the role's, by default).
  public sessionAccount: string | null = null;
  private readonly secrets: Map<string, string> = new Map<string, string>();
  private readonly policies: Map<string, Record<string, unknown>> = new Map<
    string,
    Record<string, unknown>
  >();
  private readonly handlers: Map<string, (call: AwsCall) => FakeAnswer> =
    new Map<string, (call: AwsCall) => FakeAnswer>();
  private sessions: number = 0;

  public constructor(
    public readonly cloud: FakeCloud,
    private readonly clock: { nowMs: number },
  ) {
    this.secrets.set(AWS_TASK_ACCESS_KEY, AWS_TASK_SECRET);

    cloud.on(
      "GET",
      `http://169.254.170.2${AWS_CREDENTIALS_PATH}`,
      (): FakeAnswer => {
        this.credentialRequests++;

        return jsonReply({
          AccessKeyId: AWS_TASK_ACCESS_KEY,
          SecretAccessKey: AWS_TASK_SECRET,
          Token: AWS_TASK_TOKEN,
          Expiration: new Date(
            this.clock.nowMs + 6 * 60 * 60 * 1000,
          ).toISOString(),
          RoleArn: AWS_TASK_ROLE_ARN,
        });
      },
    );

    cloud.on(
      "*",
      (url: URL): boolean => {
        return (
          url.protocol === "https:" && url.hostname.endsWith(".amazonaws.com")
        );
      },
      (request: CloudHttpRequest, url: URL): FakeAnswer => {
        return this.dispatch(request, url);
      },
    );
  }

  // Credentials the fake accepts (env keys a test configures).
  public registerKey(accessKeyId: string, secret: string): this {
    this.secrets.set(accessKeyId, secret);
    return this;
  }

  public handle(action: string, respond: (call: AwsCall) => FakeAnswer): this {
    this.handlers.set(action, respond);
    return this;
  }

  public callsTo(action: string): Array<AwsCall> {
    return this.calls.filter((call: AwsCall): boolean => {
      return call.action === action;
    });
  }

  // The actions called, in order (STS included).
  public actions(): Array<string> {
    return this.calls.map((call: AwsCall): string => {
      return call.action;
    });
  }

  private verify(
    request: CloudHttpRequest,
    url: URL,
  ): { accessKeyId: string; region: string; service: string } | string {
    const authorization: string = header(request, "Authorization") || "";
    const match: RegExpMatchArray | null = authorization.match(
      /^AWS4-HMAC-SHA256 Credential=([^/]+)\/(\d{8})\/([^/]+)\/([^/]+)\/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})$/,
    );

    if (!match) {
      return `no SigV4 Authorization header: ${authorization}`;
    }

    const [
      ,
      accessKeyId = "",
      dateStamp = "",
      region = "",
      service = "",
      signedHeaders = "",
      signature = "",
    ] = match;
    const secret: string | undefined = this.secrets.get(accessKeyId);
    const amzDate: string = header(request, "X-Amz-Date") || "";
    const expectedDate: string = new Date(this.clock.nowMs)
      .toISOString()
      .replace(/\.\d{3}Z$/, "Z")
      .replace(/[-:]/g, "");

    if (!secret) {
      return `unknown access key ${accessKeyId}`;
    }

    if (amzDate !== expectedDate || !amzDate.startsWith(dateStamp)) {
      return `X-Amz-Date ${amzDate} is not the clock's ${expectedDate}`;
    }

    const headers: Record<string, string> = {};

    for (const name of signedHeaders.split(";")) {
      if (["host", "x-amz-date", "x-amz-security-token"].includes(name)) {
        continue;
      }

      const value: string | null = header(request, name);

      if (value === null) {
        return `signed header ${name} was not sent`;
      }

      headers[name] = value;
    }

    const query: Record<string, string> = {};

    url.searchParams.forEach((value: string, name: string): void => {
      query[name] = value;
    });

    const resigned: string = signAwsRequest({
      method: request.method,
      path: url.pathname,
      query,
      host: url.host,
      headers,
      body: request.body || "",
      service,
      region,
      date: new Date(this.clock.nowMs),
      credentials: {
        accessKeyId,
        secretAccessKey: secret,
        sessionToken: header(request, "X-Amz-Security-Token"),
      },
    }).signature;

    if (resigned !== signature) {
      return `the signature of ${request.method} ${request.url} does not verify`;
    }

    const hostPrefix: string = url.hostname.split(".")[0] || "";
    const hostRegion: string = url.hostname.split(".")[1] || "";

    if (
      url.hostname !== "sts.amazonaws.com" &&
      (hostRegion !== region ||
        (hostPrefix !== service && hostPrefix !== "sts"))
    ) {
      return `signed for ${region}/${service} but sent to ${url.hostname}`;
    }

    return { accessKeyId, region, service };
  }

  private dispatch(request: CloudHttpRequest, url: URL): FakeAnswer {
    const verified:
      | { accessKeyId: string; region: string; service: string }
      | string = this.verify(request, url);

    if (typeof verified === "string") {
      this.signatureFailures.push(verified);
      return awsQueryError("SignatureDoesNotMatch", verified, 403);
    }

    const form: Record<string, string> = {};
    let json: Record<string, unknown> | null = null;
    const contentType: string = header(request, "Content-Type") || "";
    let action: string;

    if (contentType.startsWith("application/x-www-form-urlencoded")) {
      new URLSearchParams(request.body || "").forEach(
        (value: string, name: string): void => {
          form[name] = value;
        },
      );
      action = `${verified.service}:${form["Action"] || ""}`;
    } else {
      const target: string | null = header(request, "X-Amz-Target");

      if (request.body) {
        json = JSON.parse(request.body) as Record<string, unknown>;
      }

      if (target) {
        const [prefix = "", operation = ""] = target.split(".");
        action = `${TARGET_SERVICES[prefix] || prefix}:${operation}`;
      } else {
        action = lambdaAction(request.method, url.pathname);
      }
    }

    const call: AwsCall = {
      action,
      region: verified.region,
      service: verified.service,
      accessKeyId: verified.accessKeyId,
      method: request.method,
      url,
      form,
      json,
      request,
    };

    this.calls.push(call);

    const policy: Record<string, unknown> | undefined = this.policies.get(
      verified.accessKeyId,
    );

    if (policy && !policyAllows(policy, action)) {
      this.policyDenials.push(action);
      return awsJsonError(
        "AccessDeniedException",
        `User: session is not authorized to perform: ${action} because no session policy allows the ${action} action`,
        400,
      );
    }

    const handler: ((call: AwsCall) => FakeAnswer) | undefined =
      this.handlers.get(action);

    if (handler) {
      return handler(call);
    }

    if (action === "sts:GetCallerIdentity") {
      return xmlReply(stsCallerIdentityXml(this.callerArn, this.callerAccount));
    }

    if (action === "sts:AssumeRole") {
      return this.assumeRole(call);
    }

    return awsJsonError(
      "UnknownOperationException",
      `no fake handler for ${action}`,
      400,
    );
  }

  private assumeRole(call: AwsCall): FakeAnswer {
    this.sessions++;

    const accessKeyId: string = `ASIASESSION${String(this.sessions).padStart(9, "0")}`;
    const secret: string = `session-secret-${this.sessions}`;
    const roleArn: string = call.form["RoleArn"] || "";
    const roleName: string = roleArn.slice(roleArn.lastIndexOf("/") + 1);
    const account: string = this.sessionAccount || roleArn.split(":")[4] || "";
    const sessionName: string = call.form["RoleSessionName"] || "";
    const policy: Record<string, unknown> = JSON.parse(
      call.form["Policy"] || "{}",
    ) as Record<string, unknown>;

    this.secrets.set(accessKeyId, secret);
    this.policies.set(accessKeyId, policy);
    this.assumed.push({
      roleArn,
      sessionName,
      durationSeconds: call.form["DurationSeconds"] || "",
      policy,
      accessKeyId,
      callerAccessKeyId: call.accessKeyId,
    });

    return xmlReply(`<AssumeRoleResponse xmlns="https://sts.amazonaws.com/doc/2011-06-15/">
  <AssumeRoleResult>
    <Credentials>
      <AccessKeyId>${accessKeyId}</AccessKeyId>
      <SecretAccessKey>${secret}</SecretAccessKey>
      <SessionToken>session-token-${this.sessions}</SessionToken>
      <Expiration>${new Date(this.clock.nowMs + 15 * 60 * 1000).toISOString()}</Expiration>
    </Credentials>
    <AssumedRoleUser>
      <AssumedRoleId>AROAWRITE:${sessionName}</AssumedRoleId>
      <Arn>arn:aws:sts::${account}:assumed-role/${roleName}/${sessionName}</Arn>
    </AssumedRoleUser>
    <PackedPolicySize>7</PackedPolicySize>
  </AssumeRoleResult>
  <ResponseMetadata><RequestId>req-assume</RequestId></ResponseMetadata>
</AssumeRoleResponse>`);
  }
}

// ---- Azure ------------------------------------------------------------------------------

export const AZURE_SUBSCRIPTION: string =
  "0b1c2d3e-4f50-4172-8394-a5b6c7d8e9f0";
export const AZURE_TOKEN: string = "arm-access-token-1";
export const AZURE_IDENTITY_ENDPOINT: string =
  "http://localhost:42356/msi/token";
export const AZURE_IDENTITY_HEADER: string = "identity-header-secret";
export const AZURE_IMDS_URL: string =
  "http://169.254.169.254/metadata/identity/oauth2/token";

export interface ArmCall {
  method: string;
  path: string;
  apiVersion: string | null;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  authorization: string | null;
  url: URL;
}

export class FakeArm {
  public readonly calls: Array<ArmCall> = [];
  public readonly tokenRequests: Array<CloudHttpRequest> = [];
  public token: string = AZURE_TOKEN;
  public expiresInSeconds: number = 3600;
  private readonly handlers: Array<{
    method: string;
    path: string;
    respond: (call: ArmCall) => FakeAnswer;
  }> = [];

  public constructor(
    public readonly cloud: FakeCloud,
    private readonly clock: { nowMs: number },
  ) {
    const token: () => FakeAnswer = (): FakeAnswer => {
      return jsonReply({
        access_token: this.token,
        expires_on: String(
          Math.floor(this.clock.nowMs / 1000) + this.expiresInSeconds,
        ),
        resource: "https://management.azure.com/",
        token_type: "Bearer",
      });
    };

    cloud.on(
      "GET",
      AZURE_IDENTITY_ENDPOINT,
      (request: CloudHttpRequest): FakeAnswer => {
        this.tokenRequests.push(request);
        return token();
      },
    );
    cloud.on("GET", AZURE_IMDS_URL, (request: CloudHttpRequest): FakeAnswer => {
      this.tokenRequests.push(request);
      return token();
    });
    cloud.on(
      "*",
      (url: URL): boolean => {
        return url.origin === "https://management.azure.com";
      },
      (request: CloudHttpRequest, url: URL): FakeAnswer => {
        return this.dispatch(request, url);
      },
    );
  }

  // Answer METHOD on this path (compared case-insensitively, as ARM does).
  public handle(
    method: string,
    path: string,
    respond: (call: ArmCall) => FakeAnswer,
  ): this {
    this.handlers.push({ method, path: path.toLowerCase(), respond });
    return this;
  }

  public callsTo(method: string, path: string): Array<ArmCall> {
    return this.calls.filter((call: ArmCall): boolean => {
      return (
        call.method === method && call.path.toLowerCase() === path.toLowerCase()
      );
    });
  }

  // "METHOD path" of every ARM call, in order.
  public paths(): Array<string> {
    return this.calls.map((call: ArmCall): string => {
      return `${call.method} ${call.path}`;
    });
  }

  private dispatch(request: CloudHttpRequest, url: URL): FakeAnswer {
    const query: Record<string, string> = {};

    url.searchParams.forEach((value: string, name: string): void => {
      query[name] = value;
    });

    const call: ArmCall = {
      method: request.method,
      path: url.pathname,
      apiVersion: url.searchParams.get("api-version"),
      query,
      body: request.body
        ? (JSON.parse(request.body) as Record<string, unknown>)
        : null,
      authorization: header(request, "Authorization"),
      url,
    };

    this.calls.push(call);

    for (let index: number = this.handlers.length - 1; index >= 0; index--) {
      const handler:
        | {
            method: string;
            path: string;
            respond: (call: ArmCall) => FakeAnswer;
          }
        | undefined = this.handlers[index];

      if (
        handler &&
        handler.method === request.method &&
        handler.path === url.pathname.toLowerCase()
      ) {
        return handler.respond(call);
      }
    }

    return jsonReply(
      {
        error: {
          code: "ResourceNotFound",
          message: `The Resource '${url.pathname}' was not found.`,
        },
      },
      404,
    );
  }
}

// ---- Google Cloud ---------------------------------------------------------------------------

export const GCP_PROJECT: string = "shop-prod-1234";
export const GCP_PROJECT_NUMBER: string = "987654321012";
export const GCP_SERVICE_ACCOUNT: string =
  "oneuptime-ai-agent@shop-prod-1234.iam.gserviceaccount.com";
export const GCP_TOKEN: string = "ya29.gcp-access-token";
export const GCP_METADATA: string =
  "http://metadata.google.internal/computeMetadata/v1";

export interface GcpCall {
  method: string;
  url: URL;
  // Origin and path.
  bare: string;
  query: Record<string, string>;
  body: Record<string, unknown> | null;
  authorization: string | null;
}

export class FakeGcp {
  public readonly calls: Array<GcpCall> = [];
  public readonly metadataRequests: Array<CloudHttpRequest> = [];
  public project: string = GCP_PROJECT;
  public projectNumber: string = GCP_PROJECT_NUMBER;
  public region: string | null = "us-central1";
  public token: string = GCP_TOKEN;
  private readonly handlers: Array<{
    method: string;
    url: string;
    respond: (call: GcpCall) => FakeAnswer;
  }> = [];

  public constructor(public readonly cloud: FakeCloud) {
    const metadata: (path: string, body: () => string | null) => void = (
      path: string,
      body: () => string | null,
    ): void => {
      cloud.on(
        "GET",
        `${GCP_METADATA}/${path}`,
        (request: CloudHttpRequest): FakeAnswer => {
          this.metadataRequests.push(request);

          if (header(request, "Metadata-Flavor") !== "Google") {
            return reply(403, "Missing Metadata-Flavor:Google header.");
          }

          const text: string | null = body();

          return text === null
            ? reply(404, "Not Found", { "Metadata-Flavor": "Google" })
            : reply(200, text, { "Metadata-Flavor": "Google" });
        },
      );
    };

    metadata("instance/service-accounts/default/token", (): string => {
      return JSON.stringify({
        access_token: this.token,
        expires_in: 3599,
        token_type: "Bearer",
      });
    });
    metadata("project/project-id", (): string => {
      return this.project;
    });
    metadata("project/numeric-project-id", (): string => {
      return this.projectNumber;
    });
    metadata("instance/service-accounts/default/email", (): string => {
      return GCP_SERVICE_ACCOUNT;
    });
    metadata("instance/region", (): string | null => {
      return this.region
        ? `projects/${this.projectNumber}/regions/${this.region}`
        : null;
    });

    cloud.on(
      "*",
      (url: URL): boolean => {
        return (
          url.protocol === "https:" && url.hostname.endsWith(".googleapis.com")
        );
      },
      (request: CloudHttpRequest, url: URL): FakeAnswer => {
        return this.dispatch(request, url);
      },
    );
  }

  public handle(
    method: string,
    url: string,
    respond: (call: GcpCall) => FakeAnswer,
  ): this {
    this.handlers.push({ method, url, respond });
    return this;
  }

  public callsTo(method: string, url: string): Array<GcpCall> {
    return this.calls.filter((call: GcpCall): boolean => {
      return call.method === method && call.bare === url;
    });
  }

  private dispatch(request: CloudHttpRequest, url: URL): FakeAnswer {
    const query: Record<string, string> = {};

    url.searchParams.forEach((value: string, name: string): void => {
      query[name] = value;
    });

    const call: GcpCall = {
      method: request.method,
      url,
      bare: bareUrl(url),
      query,
      body: request.body
        ? (JSON.parse(request.body) as Record<string, unknown>)
        : null,
      authorization: header(request, "Authorization"),
    };

    this.calls.push(call);

    for (let index: number = this.handlers.length - 1; index >= 0; index--) {
      const handler:
        | {
            method: string;
            url: string;
            respond: (call: GcpCall) => FakeAnswer;
          }
        | undefined = this.handlers[index];

      if (
        handler &&
        handler.method === request.method &&
        handler.url === call.bare
      ) {
        return handler.respond(call);
      }
    }

    return jsonReply(
      {
        error: {
          code: 404,
          message: `The resource '${url.pathname}' was not found`,
          status: "NOT_FOUND",
        },
      },
      404,
    );
  }
}

// A clock that only moves when the executor sleeps (or a test moves it).
export class FakeClock {
  public nowMs: number = Date.parse("2026-10-27T12:00:00.000Z");
  public readonly sleeps: Array<number> = [];

  public readonly now: () => Date = (): Date => {
    return new Date(this.nowMs);
  };

  public readonly sleep: (ms: number) => Promise<void> = (
    ms: number,
  ): Promise<void> => {
    this.sleeps.push(ms);
    this.nowMs += ms;
    return Promise.resolve();
  };
}
