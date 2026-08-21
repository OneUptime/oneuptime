import jwt from "jsonwebtoken";
import BadDataException from "../../../../Types/Exception/BadDataException";
import APIException from "../../../../Types/Exception/ApiException";
import { JSONArray, JSONObject, JSONValue } from "../../../../Types/JSON";

/*
 * Minimal Google SecOps (Chronicle) API client for the detections poller.
 *
 * Auth is the standard Google service-account JWT-bearer exchange: sign a
 * short-lived RS256 assertion with the account's private key, trade it at
 * the token endpoint for an access token, cache until near expiry. No
 * Google SDK dependency — the exchange is three fields and one POST.
 *
 * The HTTP layer is injectable so unit tests exercise the real request
 * construction and response parsing against fixtures.
 */

export interface GoogleServiceAccountCredentials {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
}

export interface FetchResponseLike {
  ok: boolean;
  status: number;
  text: () => Promise<string>;
}

export type FetchLike = (
  url: string,
  init: {
    method: string;
    headers: Record<string, string>;
    body?: string | undefined;
  },
) => Promise<FetchResponseLike>;

const CHRONICLE_SCOPE: string =
  "https://www.googleapis.com/auth/cloud-platform";
const TOKEN_LIFETIME_IN_SECONDS: number = 3600;
const TOKEN_EXPIRY_SLACK_IN_SECONDS: number = 60;
const DEFAULT_MAX_ALERTS: number = 1000;

const REGION_REGEX: RegExp = /^[a-z][a-z0-9-]{0,30}$/;
const INSTANCE_REGEX: RegExp =
  /^projects\/[^/\s]+\/locations\/[^/\s]+\/instances\/[^/\s]+$/;

export default class GoogleSecOpsClient {
  private region: string;
  private instanceResourceName: string;
  private credentials: GoogleServiceAccountCredentials;
  private fetchImplementation: FetchLike;

  private cachedAccessToken: string | null = null;
  private cachedAccessTokenExpiresAtInMs: number = 0;

  public constructor(data: {
    region: string;
    instanceResourceName: string;
    serviceAccountJson: string;
    fetchImplementation?: FetchLike | undefined;
  }) {
    GoogleSecOpsClient.validateRegion(data.region);
    GoogleSecOpsClient.validateInstanceResourceName(data.instanceResourceName);

    this.region = data.region;
    this.instanceResourceName = data.instanceResourceName;
    this.credentials = GoogleSecOpsClient.parseServiceAccountJson(
      data.serviceAccountJson,
    );
    this.fetchImplementation =
      data.fetchImplementation || (fetch as unknown as FetchLike);
  }

  public static validateRegion(region: string): void {
    if (!REGION_REGEX.test(region || "")) {
      throw new BadDataException(
        "Region must be a Google SecOps regional prefix like 'us' or 'europe'.",
      );
    }
  }

  public static validateInstanceResourceName(name: string): void {
    if (!INSTANCE_REGEX.test(name || "")) {
      throw new BadDataException(
        "Instance resource name must look like projects/{project}/locations/{location}/instances/{instance}.",
      );
    }
  }

  public static parseServiceAccountJson(
    serviceAccountJson: string,
  ): GoogleServiceAccountCredentials {
    let parsed: JSONObject;

    try {
      parsed = JSON.parse(serviceAccountJson || "") as JSONObject;
    } catch {
      throw new BadDataException("Service account JSON is not valid JSON.");
    }

    const clientEmail: string = String(parsed["client_email"] || "");
    const privateKey: string = String(parsed["private_key"] || "");
    const tokenUri: string = String(
      parsed["token_uri"] || "https://oauth2.googleapis.com/token",
    );

    if (!clientEmail || !privateKey) {
      throw new BadDataException(
        "Service account JSON must contain client_email and private_key.",
      );
    }

    return { clientEmail, privateKey, tokenUri };
  }

  public getApiBaseUrl(): string {
    return `https://${this.region}-chronicle.googleapis.com/v1alpha/${this.instanceResourceName}`;
  }

  private async getAccessToken(): Promise<string> {
    const nowInMs: number = Date.now();

    if (
      this.cachedAccessToken &&
      nowInMs <
        this.cachedAccessTokenExpiresAtInMs -
          TOKEN_EXPIRY_SLACK_IN_SECONDS * 1000
    ) {
      return this.cachedAccessToken;
    }

    const issuedAtInSeconds: number = Math.floor(nowInMs / 1000);

    const assertion: string = jwt.sign(
      {
        iss: this.credentials.clientEmail,
        scope: CHRONICLE_SCOPE,
        aud: this.credentials.tokenUri,
        iat: issuedAtInSeconds,
        exp: issuedAtInSeconds + TOKEN_LIFETIME_IN_SECONDS,
      },
      this.credentials.privateKey,
      { algorithm: "RS256" },
    );

    const body: string = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: assertion,
    }).toString();

    const response: FetchResponseLike = await this.fetchImplementation(
      this.credentials.tokenUri,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body,
      },
    );

    const responseText: string = await response.text();

    if (!response.ok) {
      throw new APIException(
        `Google token exchange failed (HTTP ${response.status}): ${responseText.slice(0, 500)}`,
      );
    }

    const tokenResponse: JSONObject = JSON.parse(responseText) as JSONObject;
    const accessToken: string = String(tokenResponse["access_token"] || "");
    const expiresInSeconds: number = Number(
      tokenResponse["expires_in"] || TOKEN_LIFETIME_IN_SECONDS,
    );

    if (!accessToken) {
      throw new APIException("Google token exchange returned no access_token.");
    }

    this.cachedAccessToken = accessToken;
    this.cachedAccessTokenExpiresAtInMs = nowInMs + expiresInSeconds * 1000;

    return accessToken;
  }

  /*
   * Fetch detection alerts created in a time window, via the Chronicle
   * v1alpha legacy alerts view. Response shapes vary across tenant
   * versions, so parsing is deliberately tolerant: `alerts`, `detections`,
   * or a bare array all work; anything else returns [] rather than
   * guessing.
   */
  public async fetchDetectionAlerts(data: {
    startTime: Date;
    endTime: Date;
    maxAlerts?: number | undefined;
  }): Promise<Array<JSONObject>> {
    const accessToken: string = await this.getAccessToken();

    const params: URLSearchParams = new URLSearchParams({
      "timeRange.startTime": data.startTime.toISOString(),
      "timeRange.endTime": data.endTime.toISOString(),
      pageSize: String(data.maxAlerts || DEFAULT_MAX_ALERTS),
    });

    const url: string = `${this.getApiBaseUrl()}/legacy:legacyFetchAlertsView?${params.toString()}`;

    const response: FetchResponseLike = await this.fetchImplementation(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const responseText: string = await response.text();

    if (!response.ok) {
      throw new APIException(
        `Google SecOps alerts fetch failed (HTTP ${response.status}): ${responseText.slice(0, 500)}`,
      );
    }

    let parsed: JSONValue;

    try {
      parsed = JSON.parse(responseText) as JSONValue;
    } catch {
      throw new APIException(
        "Google SecOps alerts fetch returned a non-JSON body.",
      );
    }

    return GoogleSecOpsClient.extractAlerts(parsed);
  }

  public static extractAlerts(payload: JSONValue): Array<JSONObject> {
    if (Array.isArray(payload)) {
      return (payload as JSONArray).filter((item: JSONValue): boolean => {
        return (
          typeof item === "object" && item !== null && !Array.isArray(item)
        );
      }) as Array<JSONObject>;
    }

    if (!payload || typeof payload !== "object") {
      return [];
    }

    const asObject: JSONObject = payload as JSONObject;

    for (const key of ["alerts", "detections"]) {
      const nested: JSONValue = asObject[key] as JSONValue;
      if (Array.isArray(nested)) {
        return GoogleSecOpsClient.extractAlerts(nested);
      }
    }

    return [];
  }
}
