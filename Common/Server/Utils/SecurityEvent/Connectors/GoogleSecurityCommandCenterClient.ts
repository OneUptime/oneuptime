import jwt from "jsonwebtoken";
import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import {
  CONNECTOR_TIMEOUT_MS,
  defaultConnectorRequest,
  jsonObject,
  jsonObjects,
  MAX_CONNECTOR_PAGES,
  parseCredentialJson,
  requiredSetting,
  stringValue,
} from "./ConnectorHttp";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
  SecurityEventConnectorHttpRequest,
} from "./Types";

const GOOGLE_SCOPE: string = "https://www.googleapis.com/auth/cloud-platform";

export default class GoogleSecurityCommandCenterClient
  implements SecurityEventConnectorClient
{
  private readonly parent: string;
  private readonly clientEmail: string;
  private readonly privateKey: string;
  private readonly tokenUri: string;
  private readonly request: SecurityEventConnectorHttpRequest;

  public constructor(
    connection: SecurityEventConnection,
    request: SecurityEventConnectorHttpRequest = defaultConnectorRequest,
  ) {
    const configuration: JSONObject = connection.configuration || {};
    const credentials: JSONObject = parseCredentialJson(
      connection.credentialJson || "",
    );
    this.parent = requiredSetting(
      configuration,
      "parent",
      "Google Security Command Center",
    );
    this.clientEmail = requiredSetting(
      credentials,
      "client_email",
      "Google service account",
    );
    this.privateKey = requiredSetting(
      credentials,
      "private_key",
      "Google service account",
    );
    this.tokenUri =
      stringValue(credentials["token_uri"]) ||
      "https://oauth2.googleapis.com/token";
    this.request = request;
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const issuedAt: number = Math.floor(Date.now() / 1000) - 30;
    const assertion: string = jwt.sign(
      {
        iss: this.clientEmail,
        scope: GOOGLE_SCOPE,
        aud: this.tokenUri,
        iat: issuedAt,
        exp: issuedAt + 3600,
      },
      this.privateKey,
      { algorithm: "RS256" },
    );
    const response: DataSourceHttpResponse = await this.request({
      method: "POST",
      url: this.tokenUri,
      headers: { Accept: "application/json" },
      body: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      },
      formUrlEncoded: true,
      timeoutInMs: CONNECTOR_TIMEOUT_MS,
      egressOptions: { targetLabel: "Google identity endpoint" },
      signal,
    });
    const body: JSONObject = jsonObject(response.bodyJson, "Google identity");
    const token: string = stringValue(body["access_token"]);
    if (!token) {
      throw new BadDataException("Google identity returned no access_token.");
    }
    return token;
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    const token: string = await this.accessToken(data.signal);
    const events: Array<JSONObject> = [];
    let pageToken: string = stringValue(data.continuation?.["pageToken"]);
    let pageCount: number = 0;

    do {
      const url: URL = new URL(
        `https://securitycenter.googleapis.com/v2/${this.parent
          .split("/")
          .map(encodeURIComponent)
          .join("/")}/findings`,
      );
      url.searchParams.set(
        "filter",
        `eventTime >= "${data.startTime.toISOString()}" AND eventTime < "${data.endTime.toISOString()}"`,
      );
      url.searchParams.set("pageSize", "200");
      url.searchParams.set("orderBy", "eventTime asc");
      if (pageToken) {
        url.searchParams.set("pageToken", pageToken);
      }
      const response: DataSourceHttpResponse = await this.request({
        method: "GET",
        url: url.toString(),
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        timeoutInMs: CONNECTOR_TIMEOUT_MS,
        egressOptions: {
          targetLabel: "Google Security Command Center endpoint",
        },
        signal: data.signal,
      });
      const body: JSONObject = jsonObject(
        response.bodyJson,
        "Google Security Command Center",
      );
      for (const entry of jsonObjects(
        body["listFindingsResults"],
        "Google Security Command Center findings",
      )) {
        const finding: JSONObject = jsonObject(
          entry["finding"],
          "Google Security Command Center finding",
        );
        events.push({
          finding,
          ...(entry["resource"] ? { resource: entry["resource"] } : {}),
          ...(entry["stateChange"]
            ? { stateChange: entry["stateChange"] }
            : {}),
        });
      }
      pageToken = stringValue(body["nextPageToken"]);
      pageCount++;
    } while (pageToken && pageCount < MAX_CONNECTOR_PAGES);

    const complete: boolean = !pageToken;
    return {
      events,
      complete,
      requestCount: 1 + pageCount,
      ...(pageToken ? { continuation: { pageToken } } : {}),
      warnings: complete
        ? []
        : [
            "Google Security Command Center returned more pages than one poll can safely read; the cursor was held for retry.",
          ],
    };
  }
}
