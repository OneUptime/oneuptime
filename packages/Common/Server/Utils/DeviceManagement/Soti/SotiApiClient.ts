import Dictionary from "../../../../Types/Dictionary";
import {
  DeviceManagementConfig,
  getSotiApiBaseUrl,
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
import { readSotiError } from "./SotiParsers";

/*
 * THE ONE WAY ONEUPTIME TALKS TO SOTI MOBICONTROL (#10087).
 *
 * Every request goes to the MobiControl server - a host the customer typed,
 * in SOTI's cloud or on premises - through TenantServerClient: HTTPS, that
 * host and its /MobiControl/api path only, through the egress-guarded
 * transport, paced, budgeted and retried as every device manager's API is.
 *
 * OneUptime signs in at the server's own token endpoint, as MobiControl's
 * REST API reference says, with the resource owner password grant:
 *
 *   POST /MobiControl/api/token
 *   Authorization: Basic base64(<API client ID>:<API client secret>)
 *   grant_type=password&username=<API user>&password=<its password>
 *
 * and reads with the bearer token it gets, asking for a new one once when
 * the server says the one it had expired. The token endpoint is on the
 * server, so it is vetted as every request to it is.
 */

export const SOTI_TITLE: string = "SOTI MobiControl";
export const SOTI_EGRESS_LABEL: string = "SOTI MobiControl server";
export const SOTI_REQUESTS_PER_SECOND: number = 4;
// A token is asked for again this long before MobiControl says it expires.
export const SOTI_TOKEN_EXPIRY_MARGIN_IN_MS: number = 5 * 60 * 1000;

/*
 * The permissions every call reads with, as MobiControl names them: two
 * general permissions, and one device group permission.
 */
export const SOTI_READ_PERMISSIONS: string =
  "Web Console Access and View Installed Applications, and View Groups on the device groups to read";

export interface SotiClientOptions {
  config: DeviceManagementConfig;
  clientSecret?: string | undefined;
  password?: string | undefined;
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
 * What the token endpoint said went wrong, and what it means: its OAuth
 * `error` - invalid_client for the API client, invalid_grant for the user.
 */
export function readSotiTokenError(response: DataSourceHttpResponse): {
  kind: LlmConnectionFailureKind;
  hint: string;
  said: string;
} {
  const body: JSONObject | undefined = asObject(response.bodyJson);
  const error: string =
    typeof body?.["error"] === "string" ? body["error"] : "";
  const description: string =
    typeof body?.["error_description"] === "string"
      ? firstLineOf(body["error_description"])
      : "";
  const said: string =
    [error, description].filter(Boolean).join(": ") ||
    firstLineOf(response.bodyText || "");

  if (error === "invalid_client" || error === "unauthorized_client") {
    return {
      kind: LlmConnectionFailureKind.Authentication,
      hint: "MobiControl refused the API client's ID or secret.",
      said,
    };
  }

  if (error === "invalid_grant") {
    return {
      kind: LlmConnectionFailureKind.Authentication,
      hint: "MobiControl refused the user's username or password, or the user may not sign in to the web console.",
      said,
    };
  }

  if (response.statusCode === 429) {
    return {
      kind: LlmConnectionFailureKind.RateLimited,
      hint: "MobiControl asked OneUptime to slow down.",
      said,
    };
  }

  if (response.statusCode === 404) {
    return {
      kind: LlmConnectionFailureKind.Settings,
      hint: "No MobiControl API answered at this address.",
      said,
    };
  }

  return {
    kind:
      response.statusCode === 401
        ? LlmConnectionFailureKind.Authentication
        : LlmProviderError.kindFromStatus(response.statusCode),
    hint: "",
    said,
  };
}

/*
 * The API client's and the user's sign-in: a token from the server's
 * token endpoint, kept until shortly before it expires.
 */
export class SotiPasswordSignIn implements TenantServerSignIn {
  private readonly clientAuthorization: string;
  private readonly clientSecret: string;
  private readonly username: string;
  private readonly password: string;
  private readonly now: () => Date;
  private token: { value: string; expiresAtMs: number } | null = null;

  public constructor(data: {
    clientId: string;
    clientSecret: string;
    username: string;
    password: string;
    now: () => Date;
  }) {
    this.clientSecret = data.clientSecret;
    this.username = data.username;
    this.password = data.password;
    this.now = data.now;
    // As MobiControl documents it: the ID and the secret, a colon between them, in Base64.
    this.clientAuthorization = Buffer.from(
      `${data.clientId}:${data.clientSecret}`,
      "utf8",
    ).toString("base64");
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
    return [
      this.clientSecret,
      this.password,
      this.clientAuthorization,
      this.token?.value || "",
    ].filter((value: string): boolean => {
      return Boolean(value);
    });
  }

  private async requestToken(
    client: TenantServerClient,
  ): Promise<{ value: string; expiresAtMs: number }> {
    const tokenUrl: string = client.urlOf("/token");

    if (!client.isAllowedServerUrl(tokenUrl)) {
      throw new LlmProviderError({
        message: `The MobiControl server's token endpoint is outside the server (${client.getServerHost()}); nothing was sent there.`,
        kind: LlmConnectionFailureKind.Settings,
      });
    }

    const response: DataSourceHttpResponse = await client.sendSignInRequest(
      {
        method: "POST",
        url: tokenUrl,
        headers: {
          Accept: "application/json",
          Authorization: `Basic ${this.clientAuthorization}`,
        },
        body: {
          grant_type: "password",
          username: this.username,
          password: this.password,
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
      } = readSotiTokenError(response);

      throw new LlmProviderError({
        message: client.redact(
          `The MobiControl server refused OneUptime's sign-in (HTTP ${response.statusCode}).${failure.hint ? ` ${failure.hint}` : ""}${failure.said ? ` ${failure.said}` : ""}`,
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
          "The MobiControl server answered OneUptime's sign-in without a token.",
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
        Math.max(60 * 1000, lifetimeMs - SOTI_TOKEN_EXPIRY_MARGIN_IN_MS),
    };
  }
}

/*
 * What a MobiControl answer that is not a success means: a 403 a
 * permission the user lacks - the apps' own, View Installed Applications,
 * on the app list - and a 401 the token.
 */
export function describeSotiRefusal(
  status: number,
): TenantServerRefusal | undefined {
  if (status === 403) {
    return {
      kind: LlmConnectionFailureKind.Permission,
      hint: `Give the MobiControl user the permissions ${SOTI_READ_PERMISSIONS}.`,
    };
  }

  if (status === 401) {
    return { kind: LlmConnectionFailureKind.Authentication };
  }

  return undefined;
}

// The client a connection's settings read with.
export function createSotiClient(
  options: SotiClientOptions,
): TenantServerClient {
  const now: () => Date =
    options.now ||
    ((): Date => {
      return new Date();
    });

  return new TenantServerClient({
    serviceTitle: SOTI_TITLE,
    egressLabel: SOTI_EGRESS_LABEL,
    apiBaseUrl: getSotiApiBaseUrl(options.config.tenant),
    signIn: new SotiPasswordSignIn({
      clientId: options.config.clientId || "",
      clientSecret: options.clientSecret || "",
      username: options.config.username || "",
      password: options.password || "",
      now,
    }),
    readError: readSotiError,
    describeRefusal: describeSotiRefusal,
    transport: options.transport,
    now,
    sleep: options.sleep,
    random: options.random,
    requestsPerSecond: SOTI_REQUESTS_PER_SECOND,
    maxRequests: options.maxRequests,
    deadlineMs: options.deadlineMs,
    requestTimeoutInMs: options.requestTimeoutInMs,
  });
}
