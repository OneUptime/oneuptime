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

interface MicrosoftGraphCollectionResult {
  events: Array<JSONObject>;
  complete: boolean;
  requestCount: number;
  nextUrl: string;
}

export default class MicrosoftGraphSecurityClient
  implements SecurityEventConnectorClient
{
  private readonly tenantId: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly request: SecurityEventConnectorHttpRequest;

  public constructor(
    connection: SecurityEventConnection,
    request: SecurityEventConnectorHttpRequest = defaultConnectorRequest,
  ) {
    const configuration: JSONObject = connection.configuration || {};
    const credentials: JSONObject = parseCredentialJson(
      connection.credentialJson || "",
    );
    this.tenantId = requiredSetting(configuration, "tenantId", "Microsoft");
    this.clientId = requiredSetting(credentials, "clientId", "Microsoft");
    this.clientSecret = requiredSetting(
      credentials,
      "clientSecret",
      "Microsoft",
    );
    this.request = request;
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const response: DataSourceHttpResponse = await this.request({
      method: "POST",
      url: `https://login.microsoftonline.com/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
      headers: { Accept: "application/json" },
      body: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: "client_credentials",
        scope: "https://graph.microsoft.com/.default",
      },
      formUrlEncoded: true,
      timeoutInMs: CONNECTOR_TIMEOUT_MS,
      egressOptions: { targetLabel: "Microsoft identity endpoint" },
      signal,
    });
    const body: JSONObject = jsonObject(
      response.bodyJson,
      "Microsoft identity",
    );
    const token: string = stringValue(body["access_token"]);
    if (!token) {
      throw new BadDataException(
        "Microsoft identity returned no access_token.",
      );
    }
    return token;
  }

  private async fetchCollection(data: {
    url: string;
    token: string;
    resourceType: "alert" | "incident";
    signal?: AbortSignal | undefined;
  }): Promise<MicrosoftGraphCollectionResult> {
    const events: Array<JSONObject> = [];
    let nextUrl: string = data.url;
    let requestCount: number = 0;

    while (nextUrl && requestCount < MAX_CONNECTOR_PAGES) {
      const parsed: URL = new URL(nextUrl);
      if (
        parsed.protocol !== "https:" ||
        parsed.hostname !== "graph.microsoft.com" ||
        !parsed.pathname.startsWith("/v1.0/security/")
      ) {
        throw new BadDataException(
          "Microsoft Graph returned an unsafe pagination URL.",
        );
      }
      const response: DataSourceHttpResponse = await this.request({
        method: "GET",
        url: parsed.toString(),
        headers: {
          Authorization: `Bearer ${data.token}`,
          Accept: "application/json",
        },
        timeoutInMs: CONNECTOR_TIMEOUT_MS,
        egressOptions: { targetLabel: "Microsoft Graph endpoint" },
        signal: data.signal,
      });
      const body: JSONObject = jsonObject(
        response.bodyJson,
        "Microsoft Graph Security",
      );
      for (const event of jsonObjects(
        body["value"],
        "Microsoft Graph Security results",
        true,
      )) {
        if (!event["@odata.type"]) {
          event["@odata.type"] =
            data.resourceType === "incident"
              ? "#microsoft.graph.security.incident"
              : "#microsoft.graph.security.alert";
        }
        events.push(event);
      }
      nextUrl = stringValue(body["@odata.nextLink"]);
      requestCount++;
    }
    return { events, complete: !nextUrl, requestCount, nextUrl };
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    const token: string = await this.accessToken(data.signal);
    const filter: string =
      `lastUpdateDateTime ge ${data.startTime.toISOString()} and ` +
      `lastUpdateDateTime lt ${data.endTime.toISOString()}`;
    const alertUrl: URL = new URL(
      "https://graph.microsoft.com/v1.0/security/alerts_v2",
    );
    alertUrl.searchParams.set("$filter", filter);
    alertUrl.searchParams.set("$top", "50");
    const incidentUrl: URL = new URL(
      "https://graph.microsoft.com/v1.0/security/incidents",
    );
    incidentUrl.searchParams.set("$filter", filter);
    incidentUrl.searchParams.set("$top", "50");
    incidentUrl.searchParams.set("$expand", "alerts");

    const phase: string = stringValue(data.continuation?.["phase"]);
    const continuationUrl: string = stringValue(data.continuation?.["nextUrl"]);
    if (phase && !["alerts", "incidents"].includes(phase)) {
      throw new BadDataException(
        "Microsoft Graph pagination state is not valid.",
      );
    }
    if (phase && !continuationUrl) {
      throw new BadDataException(
        "Microsoft Graph pagination state has no next URL.",
      );
    }

    const alerts: MicrosoftGraphCollectionResult =
      phase === "incidents"
        ? { events: [], complete: true, requestCount: 0, nextUrl: "" }
        : await this.fetchCollection({
            url: phase === "alerts" ? continuationUrl : alertUrl.toString(),
            token,
            resourceType: "alert",
            signal: data.signal,
          });
    if (!alerts.complete) {
      return {
        events: alerts.events,
        complete: false,
        requestCount: 1 + alerts.requestCount,
        continuation: { phase: "alerts", nextUrl: alerts.nextUrl },
        warnings: [
          "Microsoft Graph alert pagination will continue in the next poll.",
        ],
      };
    }
    const incidents: MicrosoftGraphCollectionResult =
      await this.fetchCollection({
        url: phase === "incidents" ? continuationUrl : incidentUrl.toString(),
        token,
        resourceType: "incident",
        signal: data.signal,
      });
    const complete: boolean = alerts.complete && incidents.complete;
    return {
      events: [...alerts.events, ...incidents.events],
      complete,
      requestCount: 1 + alerts.requestCount + incidents.requestCount,
      ...(!incidents.complete
        ? {
            continuation: {
              phase: "incidents",
              nextUrl: incidents.nextUrl,
            },
          }
        : {}),
      warnings: complete
        ? []
        : [
            "Microsoft Graph returned more pages than one poll can safely read; the cursor was held for retry.",
          ],
    };
  }
}
