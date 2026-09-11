import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import {
  CONNECTOR_TIMEOUT_MS,
  defaultConnectorRequest,
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

function nextLink(value: string): string {
  for (const part of value.split(",")) {
    const match: RegExpMatchArray | null = part.match(
      /<([^>]+)>\s*;\s*rel=["']?next["']?/i,
    );
    if (match?.[1]) {
      return match[1];
    }
  }
  return "";
}

function safeLogUrl(value: string, baseUrl: URL): string {
  const parsed: URL = new URL(value);
  if (parsed.origin !== baseUrl.origin || parsed.pathname !== "/api/v1/logs") {
    throw new BadDataException("Okta returned an unsafe pagination URL.");
  }
  return parsed.toString();
}

export default class OktaSystemLogClient
  implements SecurityEventConnectorClient
{
  private readonly baseUrl: URL;
  private readonly apiToken: string;
  private readonly request: SecurityEventConnectorHttpRequest;

  public constructor(
    connection: SecurityEventConnection,
    request: SecurityEventConnectorHttpRequest = defaultConnectorRequest,
  ) {
    const configuration: JSONObject = connection.configuration || {};
    const credentials: JSONObject = parseCredentialJson(
      connection.credentialJson || "",
    );
    this.baseUrl = new URL(requiredSetting(configuration, "baseUrl", "Okta"));
    this.apiToken = requiredSetting(credentials, "apiToken", "Okta");
    this.request = request;
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    const first: URL = new URL("/api/v1/logs", this.baseUrl);
    first.searchParams.set("since", data.startTime.toISOString());
    first.searchParams.set("limit", "200");
    first.searchParams.set("sortOrder", "ASCENDING");
    const events: Array<JSONObject> = [];
    let url: string =
      stringValue(data.continuation?.["nextUrl"]) || first.toString();
    let pageCount: number = 0;

    while (url && pageCount < MAX_CONNECTOR_PAGES) {
      url = safeLogUrl(url, this.baseUrl);
      const response: DataSourceHttpResponse = await this.request({
        method: "GET",
        url,
        headers: {
          Authorization: `SSWS ${this.apiToken}`,
          Accept: "application/json",
        },
        timeoutInMs: CONNECTOR_TIMEOUT_MS,
        egressOptions: {
          targetLabel: "Okta System Log endpoint",
          privateNetworkHint:
            "Private Okta-compatible endpoints are available on self-hosted OneUptime deployments.",
        },
        signal: data.signal,
      });
      const pageEvents: Array<JSONObject> = jsonObjects(
        response.bodyJson,
        "Okta System Log",
        true,
      );
      events.push(...pageEvents);
      url = nextLink(response.headers?.["link"] || "");
      pageCount++;
      if (!url) {
        throw new BadDataException(
          "Okta System Log did not return its required next polling link.",
        );
      }
      url = safeLogUrl(url, this.baseUrl);
      if (pageEvents.length === 0) {
        break;
      }
    }

    return {
      events,
      complete: true,
      requestCount: pageCount,
      continuation: { nextUrl: url },
      warnings:
        pageCount === MAX_CONNECTOR_PAGES
          ? [
              "Okta returned a full bounded page batch; the next polling link was saved for the following poll.",
            ]
          : [],
    };
  }
}
