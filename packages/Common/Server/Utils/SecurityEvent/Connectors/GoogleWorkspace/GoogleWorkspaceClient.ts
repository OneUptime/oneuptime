import jwt from "jsonwebtoken";
import APIException from "../../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject, JSONValue } from "../../../../../Types/JSON";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../DataSource/HttpFetch";
import {
  REDACTED,
  redactLogString,
  redactLogValue,
} from "../../../LogRedaction";
import ConnectorErrorMessage from "../../ConnectorErrorMessage";
import GoogleSecOpsClient from "../GoogleSecOps/GoogleSecOpsClient";
import { ConnectorTransport } from "../Types";

/*
 * Google Workspace's audit logs through the Admin SDK Reports API, read by
 * a Google Cloud service account acting as a Workspace administrator
 * (domain-wide delegation):
 *
 *  - Token: an RS256 JWT assertion signed with the key's private_key, with
 *    `sub` naming the administrator, exchanged at the key's token_uri
 *    (developers.google.com/identity/protocols/oauth2/service-account
 *    #delegatingauthority). The scope is the Reports API's read-only audit
 *    scope, nothing more - unless the caller asks for another: a playbook
 *    that suspends or signs out a user mints its token for the Directory
 *    API's user scopes (GoogleWorkspaceResponseClient), which the
 *    delegation must list too.
 *
 *  - Activities: GET https://admin.googleapis.com/admin/reports/v1/activity/
 *    users/all/applications/{application} (developers.google.com/admin-sdk/
 *    reports/reference/rest/v1/activities/list), by the time of the
 *    activity, newest first, at most 1,000 a page, the next page named by
 *    nextPageToken.
 *
 * The key is read and checked by the parser the Google SecOps connection
 * uses (client_email and private_key present, a readable PEM key, token_uri
 * an https URL on a Google host), so the assertion is never sent anywhere
 * else. Every request goes through the injected ConnectorTransport (the
 * SSRF-guarded DataSourceHttpFetch in production) and every status comes
 * back as a response, so a failure is named by its step with Google's own
 * reason, its echoed body run through the log redactor first.
 */

export const GOOGLE_WORKSPACE_REPORTS_SCOPE: string =
  "https://www.googleapis.com/auth/admin.reports.audit.readonly";

export const GOOGLE_WORKSPACE_REPORTS_BASE_URL: string =
  "https://admin.googleapis.com/admin/reports/v1/activity/users/all/applications";

// The most activities one page holds.
export const GOOGLE_WORKSPACE_PAGE_SIZE: number = 1000;

const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
// Signed this far in the past, so a fast clock here is not "not yet valid".
const CLOCK_SKEW_IN_SECONDS: number = 60;
const EXPIRY_SLACK_IN_MS: number = 60 * 1000;
const ERROR_PREFIX: string = "Google Workspace";

// Google names a failure with an identifier: letters, digits, underscores.
const REASON_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9_]{1,79}$/;
// An application name the Reports API takes: lowercase words joined by underscores.
const APPLICATION_REGEX: RegExp = /^[a-z][a-z_]{1,39}$/;

/*
 * What Google answered with: the HTTP status and Google's own reason for
 * it - a token endpoint's `error` (unauthorized_client, invalid_grant) or
 * an API error's reason (forbidden, accessNotConfigured, SERVICE_DISABLED)
 * - which the connector's remediation reads.
 */
export class GoogleWorkspaceHttpError extends APIException {
  public statusCode: number;
  public reason: string;

  public constructor(message: string, statusCode: number, reason: string) {
    super(message);
    this.statusCode = statusCode;
    this.reason = reason;
  }
}

export interface GoogleWorkspaceClientOptions {
  serviceAccountJson: string;
  // The administrator the service account acts as.
  adminEmail: string;
  transport: ConnectorTransport;
  requestTimeoutInMs: number;
  // The scope its tokens are minted for: the Reports API's audit scope when left out.
  scope?: string | undefined;
}

export interface GoogleWorkspaceActivityPage {
  activities: Array<JSONObject>;
  // The nextPageToken of the page, or null on the last page.
  nextPageToken: string | null;
}

export interface GoogleWorkspaceListRequest {
  application: string;
  startTime: Date;
  endTime: Date;
  pageSize?: number | undefined;
  // Only activities holding this event (the Reports API's eventName).
  eventName?: string | undefined;
  pageToken?: string | undefined;
}

function isJsonObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default class GoogleWorkspaceClient {
  private clientEmail: string;
  private privateKey: string;
  private tokenUri: string;
  private adminEmail: string;
  private scope: string;
  private transport: ConnectorTransport;
  private requestTimeoutInMs: number;
  private cached: { token: string; expiresAtMs: number } | null = null;
  private requestCount: number = 0;

  public constructor(options: GoogleWorkspaceClientOptions) {
    const credentials: {
      clientEmail: string;
      privateKey: string;
      tokenUri: string;
    } = GoogleSecOpsClient.parseServiceAccountJson(options.serviceAccountJson);

    this.clientEmail = credentials.clientEmail;
    this.privateKey = credentials.privateKey;
    this.tokenUri = credentials.tokenUri;
    this.adminEmail = options.adminEmail;
    this.scope = options.scope || GOOGLE_WORKSPACE_REPORTS_SCOPE;
    this.transport = options.transport;
    this.requestTimeoutInMs = options.requestTimeoutInMs;
  }

  // Every request that left this instance, token requests included.
  public getRequestCount(): number {
    return this.requestCount;
  }

  // The service account, for messages: never a secret.
  public getClientEmail(): string {
    return this.clientEmail;
  }

  public buildActivitiesUrl(request: GoogleWorkspaceListRequest): string {
    if (!APPLICATION_REGEX.test(request.application)) {
      throw new APIException(
        `${ERROR_PREFIX}: "${request.application}" is not a Reports API application.`,
      );
    }

    const url: URL = new URL(
      `${GOOGLE_WORKSPACE_REPORTS_BASE_URL}/${request.application}`,
    );

    url.searchParams.set("startTime", request.startTime.toISOString());
    url.searchParams.set("endTime", request.endTime.toISOString());
    url.searchParams.set(
      "maxResults",
      String(
        Math.max(
          1,
          Math.min(
            GOOGLE_WORKSPACE_PAGE_SIZE,
            Math.floor(request.pageSize || GOOGLE_WORKSPACE_PAGE_SIZE),
          ),
        ),
      ),
    );

    if (request.eventName) {
      url.searchParams.set("eventName", request.eventName);
    }

    if (request.pageToken) {
      url.searchParams.set("pageToken", request.pageToken);
    }

    return url.toString();
  }

  /*
   * An access token for the administrator, minted with the service
   * account's key and cached for its life. Google refuses it when the
   * client ID has no domain-wide delegation for the scope
   * (unauthorized_client) or the administrator is not a user of the
   * domain (invalid_grant).
   */
  public async getAccessToken(): Promise<string> {
    if (
      this.cached &&
      this.cached.expiresAtMs - EXPIRY_SLACK_IN_MS > Date.now()
    ) {
      return this.cached.token;
    }

    const issuedAt: number =
      Math.floor(Date.now() / 1000) - CLOCK_SKEW_IN_SECONDS;
    const assertion: string = jwt.sign(
      {
        iss: this.clientEmail,
        sub: this.adminEmail,
        scope: this.scope,
        aud: this.tokenUri,
        iat: issuedAt,
        exp: issuedAt + TOKEN_LIFETIME_IN_SECONDS,
      },
      this.privateKey,
      { algorithm: "RS256" },
    );

    const response: DataSourceHttpResponse = await this.send("token request", {
      method: "POST",
      url: this.tokenUri,
      headers: { Accept: "application/json" },
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      },
      formUrlEncoded: true,
      timeoutInMs: this.requestTimeoutInMs,
      egressOptions: { targetLabel: "Google" },
      acceptAnyStatus: true,
    });

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const reason: string = GoogleWorkspaceClient.readTokenError(
        response.bodyJson,
      );

      throw new GoogleWorkspaceHttpError(
        `${ERROR_PREFIX} token request failed (HTTP ${response.statusCode}): ${GoogleWorkspaceClient.redactErrorBody(response.bodyText, [assertion, this.privateKey])}${GoogleWorkspaceClient.describeTokenFailure(reason, response.bodyJson, this.scope)}`,
        response.statusCode,
        reason,
      );
    }

    const json: JSONValue = GoogleWorkspaceClient.parseJsonBody(response);
    const token: unknown = isJsonObject(json)
      ? json["access_token"]
      : undefined;

    if (typeof token !== "string" || !token) {
      throw new APIException(
        `${ERROR_PREFIX} token request returned no access_token.`,
      );
    }

    const expiresIn: number = isJsonObject(json)
      ? Number(json["expires_in"])
      : NaN;

    this.cached = {
      token,
      expiresAtMs:
        Date.now() +
        (Number.isFinite(expiresIn) && expiresIn > 0
          ? expiresIn * 1000
          : 5 * 60 * 1000),
    };

    return token;
  }

  // One page of an application's activities.
  public async listActivities(
    request: GoogleWorkspaceListRequest,
  ): Promise<GoogleWorkspaceActivityPage> {
    const url: string = this.buildActivitiesUrl(request);
    const step: string = `${request.application} activities request`;
    const send: () => Promise<DataSourceHttpResponse> =
      async (): Promise<DataSourceHttpResponse> => {
        const token: string = await this.getAccessToken();

        return this.send(step, {
          method: "GET",
          url,
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: "application/json",
          },
          timeoutInMs: this.requestTimeoutInMs,
          egressOptions: { targetLabel: "Google Workspace Reports API" },
          acceptAnyStatus: true,
        });
      };

    let response: DataSourceHttpResponse = await send();

    // A token can be revoked or expire between pages: mint a new one once.
    if (response.statusCode === 401 && this.cached) {
      this.cached = null;
      response = await send();
    }

    if (response.statusCode < 200 || response.statusCode >= 300) {
      const reason: string = GoogleWorkspaceClient.readApiErrorReason(
        response.bodyJson,
      );

      throw new GoogleWorkspaceHttpError(
        `${ERROR_PREFIX} ${step} failed (HTTP ${response.statusCode}): ${GoogleWorkspaceClient.redactErrorBody(response.bodyText, [])}${reason ? ` — reason ${reason}` : ""}`,
        response.statusCode,
        reason,
      );
    }

    const json: JSONValue = GoogleWorkspaceClient.parseJsonBody(response);

    if (!isJsonObject(json)) {
      throw new APIException(
        `${ERROR_PREFIX} ${step} returned an unrecognized response shape.`,
      );
    }

    // A page with no activities has no items member at all.
    const items: unknown = json["items"];

    if (items !== undefined && !Array.isArray(items)) {
      throw new APIException(
        `${ERROR_PREFIX} ${step} returned an unrecognized response shape.`,
      );
    }

    const nextPageToken: unknown = json["nextPageToken"];

    return {
      activities: ((items as JSONArray | undefined) || []).filter(
        (item: JSONValue): boolean => {
          return isJsonObject(item);
        },
      ) as Array<JSONObject>,
      nextPageToken:
        typeof nextPageToken === "string" && nextPageToken
          ? nextPageToken
          : null,
    };
  }

  // Every request leaves through here, counted; a transport failure is named.
  private async send(
    step: string,
    request: DataSourceHttpRequest,
  ): Promise<DataSourceHttpResponse> {
    this.requestCount++;

    try {
      return await this.transport(request);
    } catch (error) {
      throw new APIException(
        `${ERROR_PREFIX} ${step} did not complete: ${redactLogString(
          ConnectorErrorMessage.toMessage(error, { truncate: false }),
        )}`,
      );
    }
  }

  private static parseJsonBody(response: DataSourceHttpResponse): JSONValue {
    if (response.bodyJson !== undefined) {
      return response.bodyJson as JSONValue;
    }

    try {
      return JSON.parse(response.bodyText || "") as JSONValue;
    } catch {
      return null;
    }
  }

  /*
   * Decoded before redacting, so an escaped secret cannot slip past the
   * redactor; the assertion and the key are blanked by value as well.
   */
  private static redactErrorBody(body: string, secrets: Array<string>): string {
    if (!body) {
      return "";
    }

    let text: string;

    try {
      text = JSON.stringify(redactLogValue(JSON.parse(body) as JSONValue));
    } catch {
      text = redactLogString(body);
    }

    for (const secret of secrets) {
      if (secret) {
        text = text.split(secret).join(REDACTED);
      }
    }

    return text.slice(0, 1000);
  }

  // The token endpoint's `error`, when identifier-shaped.
  public static readTokenError(body: unknown): string {
    const error: unknown = isJsonObject(body) ? body["error"] : undefined;

    return typeof error === "string" && REASON_REGEX.test(error) ? error : "";
  }

  /*
   * An API error's reason: the first of Google's legacy errors[].reason, an
   * ErrorInfo detail's reason, or the error's status - identifier-shaped
   * only, never a credential.
   */
  public static readApiErrorReason(body: unknown): string {
    if (!isJsonObject(body) || !isJsonObject(body["error"])) {
      return "";
    }

    const error: JSONObject = body["error"];
    const candidates: Array<unknown> = [];

    if (Array.isArray(error["details"])) {
      for (const detail of error["details"] as JSONArray) {
        if (isJsonObject(detail)) {
          candidates.push(detail["reason"]);
        }
      }
    }

    if (Array.isArray(error["errors"])) {
      for (const item of error["errors"] as JSONArray) {
        if (isJsonObject(item)) {
          candidates.push(item["reason"]);
        }
      }
    }

    candidates.push(error["status"]);

    for (const candidate of candidates) {
      if (typeof candidate === "string" && REASON_REGEX.test(candidate)) {
        return candidate;
      }
    }

    return "";
  }

  // What Google's token error means, by its stable `error` and description.
  private static describeTokenFailure(
    reason: string,
    body: unknown,
    scope: string,
  ): string {
    const description: string = isJsonObject(body)
      ? String(body["error_description"] || "").toLowerCase()
      : "";

    if (reason === "unauthorized_client" || reason === "access_denied") {
      // The scope's own name: "admin.reports.audit.readonly".
      const scopeName: string = scope.split("/").pop() || scope;

      return ` — Google refused to let the service account act as the administrator: its client ID has no domain-wide delegation for the ${scopeName} scope.`;
    }

    if (reason === "invalid_grant" && description.includes("email")) {
      return " — Google does not know the Administrator email as a user of this Google Workspace.";
    }

    if (reason === "invalid_grant" && description.includes("signature")) {
      return " — Google no longer accepts this key: it was deleted or disabled.";
    }

    return "";
  }
}
