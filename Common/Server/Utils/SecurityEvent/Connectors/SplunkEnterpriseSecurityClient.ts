import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import {
  CONNECTOR_TIMEOUT_MS,
  defaultConnectorRequest,
  jsonObjects,
  parseCredentialJson,
  requiredSetting,
  stringValue,
} from "./ConnectorHttp";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
  SecurityEventConnectorHttpRequest,
} from "./Types";

const MAX_RESULTS: number = 1_000;
const DEFAULT_SEARCH: string = "search (index=notable OR index=risk)";

export default class SplunkEnterpriseSecurityClient
  implements SecurityEventConnectorClient
{
  private readonly baseUrl: URL;
  private readonly search: string;
  private readonly credentials: JSONObject;
  private readonly request: SecurityEventConnectorHttpRequest;

  public constructor(
    connection: SecurityEventConnection,
    request: SecurityEventConnectorHttpRequest = defaultConnectorRequest,
  ) {
    const configuration: JSONObject = connection.configuration || {};
    this.baseUrl = new URL(requiredSetting(configuration, "baseUrl", "Splunk"));
    this.search = stringValue(configuration["search"]) || DEFAULT_SEARCH;
    this.credentials = parseCredentialJson(connection.credentialJson || "");
    this.request = request;
  }

  private authHeader(): string {
    const apiToken: string = stringValue(this.credentials["apiToken"]);
    if (apiToken) {
      const scheme: string = stringValue(this.credentials["tokenScheme"]);
      return `${scheme || "Bearer"} ${apiToken}`;
    }
    const username: string = requiredSetting(
      this.credentials,
      "username",
      "Splunk",
    );
    const password: string = requiredSetting(
      this.credentials,
      "password",
      "Splunk",
    );
    return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`;
  }

  private static parseExport(bodyText: string): {
    events: Array<JSONObject>;
    warnings: Array<string>;
  } {
    const events: Array<JSONObject> = [];
    const warnings: Array<string> = [];
    for (const line of bodyText.split(/\r?\n/)) {
      if (!line.trim()) {
        continue;
      }
      let parsed: JSONValue;
      try {
        parsed = JSON.parse(line) as JSONValue;
      } catch {
        throw new BadDataException(
          "Splunk search export returned a non-JSON result line.",
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new BadDataException(
          "Splunk search export returned an invalid result object.",
        );
      }
      const envelope: JSONObject = parsed as JSONObject;
      for (const message of jsonObjects(
        envelope["messages"],
        "Splunk search messages",
      )) {
        const type: string = stringValue(message["type"]).toUpperCase();
        const text: string =
          stringValue(message["text"]) || "Splunk returned a search message.";
        if (type === "ERROR" || type === "FATAL") {
          throw new BadDataException(
            `Splunk search failed: ${text.slice(0, 500)}`,
          );
        }
        if (type === "WARN" || type === "WARNING") {
          warnings.push(`Splunk search warning: ${text.slice(0, 500)}`);
        }
      }
      const result: JSONValue = envelope["result"];
      if (result && typeof result === "object" && !Array.isArray(result)) {
        events.push(result as JSONObject);
      } else {
        events.push(
          ...jsonObjects(envelope["results"], "Splunk search results"),
        );
      }
    }
    return { events, warnings: [...new Set(warnings)] };
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    const url: URL = new URL("/services/search/v2/jobs/export", this.baseUrl);
    const response: DataSourceHttpResponse = await this.request({
      method: "POST",
      url: url.toString(),
      headers: {
        Authorization: this.authHeader(),
        Accept: "application/json",
      },
      body: {
        search: this.search,
        earliest_time: data.startTime.toISOString(),
        latest_time: data.endTime.toISOString(),
        output_mode: "json",
        preview: "false",
        max_count: String(MAX_RESULTS),
      },
      formUrlEncoded: true,
      timeoutInMs: CONNECTOR_TIMEOUT_MS,
      egressOptions: {
        targetLabel: "Splunk management endpoint",
        privateNetworkHint:
          "Private Splunk servers are available on self-hosted OneUptime deployments.",
      },
      signal: data.signal,
    });
    const parsed: { events: Array<JSONObject>; warnings: Array<string> } =
      SplunkEnterpriseSecurityClient.parseExport(response.bodyText);
    const events: Array<JSONObject> = parsed.events;
    const complete: boolean = events.length < MAX_RESULTS;
    return {
      events,
      complete,
      requestCount: 1,
      warnings: [
        ...parsed.warnings,
        ...(!complete
          ? [
              "Splunk returned the configured 1,000-result ceiling; the time window will be narrowed and retried.",
            ]
          : []),
      ],
    };
  }
}
