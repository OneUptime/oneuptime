import Dictionary from "../../../../Types/Dictionary";
import {
  DeviceManagementConfig,
  getWorkspaceOneApiBaseUrl,
  getWorkspaceOneTokenHost,
  getWorkspaceOneTokenUrl,
} from "../../../../Types/DeviceManagement/DeviceManagementConnectionSettings";
import { JSONObject } from "../../../../Types/JSON";
import { LlmConnectionFailureKind } from "../../../../Types/LlmObservability/LlmConnectionTest";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import LlmProviderError from "../../LlmObservability/LlmProviderError";
import { DeviceManagementTransport } from "../DeviceManagementTypes";
import TenantServerClient, {
  TenantServerRefusal,
  TenantServerSignIn,
  firstLineOf,
} from "../TenantServerClient";
import { readWorkspaceOneError } from "./WorkspaceOneParsers";

/*
 * THE ONE WAY ONEUPTIME TALKS TO WORKSPACE ONE UEM (#10086).
 *
 * Every request goes to the tenant's API server - a host the customer
 * typed - through TenantServerClient: HTTPS, that host and its /API path
 * only, through the egress-guarded transport, paced, budgeted and retried
 * as every device manager's API is. Each asks for MDM API V1
 * (Accept: application/json;version=1), the version every Workspace ONE
 * release answers.
 *
 * OneUptime signs in one of two ways (WorkspaceOneAuthMethod):
 *
 *   - an OAuth client: the client credentials grant at the Workspace ONE
 *     token service of the tenant's region
 *     (POST https://<region>.uemauth.workspaceone.com/connect/token), a host
 *     of Omnissa's that no one types, and the token it gets as a bearer
 *     token, renewed once when the API says it expired (errorCode 1029).
 *     No REST API key goes with it: the OAuth client is the tenant's.
 *   - an administrator's account: Basic authentication with the tenant's
 *     REST API key as the aw-tenant-code header, for a server without the
 *     token service (on premises).
 *
 * The API counts every request against the tenant's API quota, per minute
 * and per day (Groups & Settings > All Settings > System > Advanced > API
 * > REST API): a 429 is waited out as any is, but a daily quota used up
 * is not tried again this read.
 */

export const WORKSPACE_ONE_TITLE: string = "Workspace ONE UEM";
export const WORKSPACE_ONE_EGRESS_LABEL: string = "Workspace ONE UEM server";
export const WORKSPACE_ONE_ACCEPT: string = "application/json;version=1";
/*
 * Gentle on purpose: the tenant's per-minute API throttle is shared with
 * every other integration of the tenant.
 */
export const WORKSPACE_ONE_REQUESTS_PER_SECOND: number = 2;
// A token is asked for again this long before Workspace ONE says it expires.
export const WORKSPACE_ONE_TOKEN_EXPIRY_MARGIN_IN_MS: number = 5 * 60 * 1000;

/*
 * The role every call reads with, as Workspace ONE's role editor names its
 * permissions: API > REST, Devices and Apps, Read only.
 */
export const WORKSPACE_ONE_READ_PERMISSIONS: string =
  "API > REST: Devices and Apps, Read";

export interface WorkspaceOneClientOptions {
  config: DeviceManagementConfig;
  // The OAuth client's secret.
  clientSecret?: string | undefined;
  // The administrator's password and the tenant's REST API key.
  password?: string | undefined;
  apiKey?: string | undefined;
  transport: DeviceManagementTransport;
  now?: (() => Date) | undefined;
  sleep?: ((milliseconds: number) => Promise<void>) | undefined;
  random?: (() => number) | undefined;
  maxRequests?: number | undefined;
  deadlineMs?: number | undefined;
  requestTimeoutInMs?: number | undefined;
}

function asObject(value: unknown): JSONObject | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined;
}

/*
 * What the token service said went wrong, and what it means: its OAuth
 * `error` ("invalid_client") and description.
 */
export function readWorkspaceOneTokenError(response: DataSourceHttpResponse): {
  kind: LlmConnectionFailureKind;
  hint: string;
  said: string;
} {
  const body: JSONObject | undefined = asObject(response.bodyJson);
  const error: string = typeof body?.["error"] === "string" ? body["error"] : "";
  const description: string =
    typeof body?.["error_description"] === "string"
      ? firstLineOf(body["error_description"])
      : "";
  const said: string = [error, description].filter(Boolean).join(": ");

  if (
    error === "invalid_client" ||
    error === "unauthorized_client" ||
    response.statusCode === 401
  ) {
    return {
      kind: LlmConnectionFailureKind.Authentication,
      hint: "The token service refused the OAuth client's ID or secret, or the client is in another region.",
      said,
    };
  }

  if (response.statusCode === 429) {
    return {
      kind: LlmConnectionFailureKind.RateLimited,
      hint: "The token service asked OneUptime to slow down.",
      said,
    };
  }

  if (response.statusCode === 404) {
    return {
      kind: LlmConnectionFailureKind.Settings,
      hint: "No token service answered at this region's address.",
      said,
    };
  }

  return {
    kind: LlmProviderError.kindFromStatus(response.statusCode),
    hint: "",
    said: said || firstLineOf(response.bodyText || ""),
  };
}

/*
 * An OAuth client's sign-in: a token from the region's token service, kept
 * until shortly before it expires.
 */
export class WorkspaceOneOAuthSignIn implements TenantServerSignIn {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly region: string | undefined;
  private readonly now: () => Date;
  private token: { value: string; expiresAtMs: number } | null = null;

  public constructor(data: {
    clientId: string;
    clientSecret: string;
    region: string | undefined;
    now: () => Date;
  }) {
    this.clientId = data.clientId;
    this.clientSecret = data.clientSecret;
    this.region = data.region;
    this.now = data.now;
  }

  public async authorize(
    client: TenantServerClient,
  ): Promise<Dictionary<string>> {
    if (!this.token || this.now().getTime() >= this.token.expiresAtMs) {
      this.token = await this.requestToken(client);
    }

    return { Authorization: `Bearer ${this.token.value}` };
  }

  public forget(): boolean {
    this.token = null;
    return true;
  }

  public secretValues(): Array<string> {
    return [this.clientSecret, this.token?.value || ""].filter(
      (value: string): boolean => {
        return Boolean(value);
      },
    );
  }

  private async requestToken(
    client: TenantServerClient,
  ): Promise<{ value: string; expiresAtMs: number }> {
    const response: DataSourceHttpResponse = await client.sendSignInRequest(
      {
        method: "POST",
        url: getWorkspaceOneTokenUrl(this.region),
        headers: { Accept: "application/json" },
        body: {
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
        },
        formUrlEncoded: true,
      },
      "token request",
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const failure: {
        kind: LlmConnectionFailureKind;
        hint: string;
        said: string;
      } = readWorkspaceOneTokenError(response);

      throw new LlmProviderError({
        message: client.redact(
          `The Workspace ONE token service (${getWorkspaceOneTokenHost(this.region)}) refused OneUptime's sign-in (HTTP ${response.statusCode}).${failure.hint ? ` ${failure.hint}` : ""}${failure.said ? ` ${failure.said}` : ""}`,
        ),
        kind: failure.kind,
        statusCode: response.statusCode,
      });
    }

    const body: JSONObject | undefined = asObject(response.bodyJson);
    const accessToken: unknown = body?.["access_token"];

    if (typeof accessToken !== "string" || !accessToken) {
      throw new LlmProviderError({
        message:
          "The Workspace ONE token service answered OneUptime's sign-in without a token.",
        kind: LlmConnectionFailureKind.Other,
        statusCode: response.statusCode,
      });
    }

    const expiresIn: number = Number(body?.["expires_in"]);
    const lifetimeMs: number =
      Number.isFinite(expiresIn) && expiresIn > 0
        ? expiresIn * 1000
        : 10 * 60 * 1000;

    return {
      value: accessToken,
      expiresAtMs:
        this.now().getTime() +
        Math.max(
          60 * 1000,
          lifetimeMs - WORKSPACE_ONE_TOKEN_EXPIRY_MARGIN_IN_MS,
        ),
    };
  }
}

/*
 * An administrator's sign-in: Basic authentication and the REST API key.
 * Nothing to renew: a 401 is the answer.
 */
export class WorkspaceOneBasicSignIn implements TenantServerSignIn {
  private readonly authorization: string;
  private readonly password: string;
  private readonly apiKey: string;

  public constructor(data: {
    username: string;
    password: string;
    apiKey: string;
  }) {
    this.password = data.password;
    this.apiKey = data.apiKey;
    this.authorization = Buffer.from(
      `${data.username}:${data.password}`,
      "utf8",
    ).toString("base64");
  }

  public async authorize(): Promise<Dictionary<string>> {
    return {
      Authorization: `Basic ${this.authorization}`,
      "aw-tenant-code": this.apiKey,
    };
  }

  public forget(): boolean {
    return false;
  }

  public secretValues(): Array<string> {
    return [this.password, this.apiKey, this.authorization].filter(
      (value: string): boolean => {
        return Boolean(value);
      },
    );
  }
}

/*
 * What a Workspace ONE answer that is not a success means: a 401 a
 * credential, a 403 the role (its error codes 1011, 5143, 5145 and 6092
 * all say the same), and a 400 that says the organization group is not
 * the client's.
 */
export function describeWorkspaceOneRefusal(
  status: number,
  said: string,
): TenantServerRefusal | undefined {
  if (status === 403) {
    return {
      kind: LlmConnectionFailureKind.Permission,
      hint: `Give OneUptime's admin role the permissions ${WORKSPACE_ONE_READ_PERMISSIONS}, at the organization group whose devices it reads.`,
    };
  }

  if (status === 401) {
    return { kind: LlmConnectionFailureKind.Authentication };
  }

  if (
    status === 400 &&
    said.toLowerCase().includes("organization group") &&
    said.toLowerCase().includes("access")
  ) {
    return {
      kind: LlmConnectionFailureKind.Permission,
      hint: "Make the OAuth client, or the administrator, at the organization group whose devices OneUptime reads.",
    };
  }

  return undefined;
}

// Whether a 429 says the tenant's daily quota is used up.
export function isWorkspaceOneQuotaUsedUp(said: string): boolean {
  return said.toLowerCase().includes("quota");
}

// The client a connection's settings read with.
export function createWorkspaceOneClient(
  options: WorkspaceOneClientOptions,
): TenantServerClient {
  const now: () => Date =
    options.now ||
    ((): Date => {
      return new Date();
    });
  const signIn: TenantServerSignIn =
    options.config.authMethod === "basic"
      ? new WorkspaceOneBasicSignIn({
          username: options.config.username || "",
          password: options.password || "",
          apiKey: options.apiKey || "",
        })
      : new WorkspaceOneOAuthSignIn({
          clientId: options.config.clientId || "",
          clientSecret: options.clientSecret || "",
          region: options.config.region,
          now,
        });

  return new TenantServerClient({
    serviceTitle: WORKSPACE_ONE_TITLE,
    egressLabel: WORKSPACE_ONE_EGRESS_LABEL,
    apiBaseUrl: getWorkspaceOneApiBaseUrl(options.config.tenant),
    signIn,
    headers: { Accept: WORKSPACE_ONE_ACCEPT },
    readError: readWorkspaceOneError,
    describeRefusal: describeWorkspaceOneRefusal,
    isRateLimitFinal: isWorkspaceOneQuotaUsedUp,
    transport: options.transport,
    now,
    sleep: options.sleep,
    random: options.random,
    requestsPerSecond: WORKSPACE_ONE_REQUESTS_PER_SECOND,
    maxRequests: options.maxRequests,
    deadlineMs: options.deadlineMs,
    requestTimeoutInMs: options.requestTimeoutInMs,
  });
}
