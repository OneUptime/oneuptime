import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import {
  defaultConnectorRequest,
  jsonObject,
  jsonObjects,
  MAX_CONNECTOR_PAGES,
  parseCredentialJson,
  requestJson,
  requiredSetting,
} from "./ConnectorHttp";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
  SecurityEventConnectorHttpRequest,
} from "./Types";

const QUERY: string = `query OneUptimeFirewallEvents($zoneTag: string, $filter: FirewallEventsAdaptiveFilter_InputObject!) {
  viewer {
    zones(filter: { zoneTag: $zoneTag }) {
      firewallEventsAdaptive(filter: $filter, limit: 1000, orderBy: [datetime_ASC]) {
        action clientASNDescription clientCountryName clientIP clientRequestHTTPHost
        clientRequestHTTPMethodName clientRequestHTTPProtocol clientRequestPath
        clientRequestQuery datetime description originResponseStatus rayName
        ref ruleId source userAgent
      }
    }
  }
}`;

interface TimeWindow {
  startTime: Date;
  endTime: Date;
}

export default class CloudflareSecurityEventClient
  implements SecurityEventConnectorClient
{
  private readonly zoneId: string;
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
    this.zoneId = requiredSetting(configuration, "zoneId", "Cloudflare");
    this.apiToken = requiredSetting(credentials, "apiToken", "Cloudflare");
    this.request = request;
  }

  private static readEvents(body: JSONObject): Array<JSONObject> {
    const viewer: JSONObject = jsonObject(body["data"], "Cloudflare GraphQL");
    const viewerObject: JSONObject = jsonObject(
      viewer["viewer"],
      "Cloudflare GraphQL",
    );
    const zones: Array<JSONObject> = jsonObjects(
      viewerObject["zones"],
      "Cloudflare GraphQL zones",
      true,
    );
    if (!zones[0]) {
      throw new BadDataException(
        "Cloudflare returned no matching zone. Check the zone ID and API token access.",
      );
    }
    return jsonObjects(
      zones[0]["firewallEventsAdaptive"],
      "Cloudflare firewall events",
      true,
    );
  }

  private static pendingWindows(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
  }): Array<TimeWindow> {
    const stored: JSONValue | undefined = data.continuation?.["pendingWindows"];
    if (stored === undefined) {
      return [{ startTime: data.startTime, endTime: data.endTime }];
    }
    if (!Array.isArray(stored)) {
      throw new BadDataException("Cloudflare pagination state is not valid.");
    }
    const windows: Array<TimeWindow> = [];
    for (const value of stored) {
      const object: JSONObject = jsonObject(
        value,
        "Cloudflare pagination state",
      );
      const startTime: Date = new Date(String(object["startTime"] || ""));
      const endTime: Date = new Date(String(object["endTime"] || ""));
      if (
        !Number.isFinite(startTime.getTime()) ||
        !Number.isFinite(endTime.getTime()) ||
        startTime >= endTime ||
        startTime < data.startTime ||
        endTime > data.endTime
      ) {
        throw new BadDataException(
          "Cloudflare pagination window is not valid.",
        );
      }
      windows.push({ startTime, endTime });
    }
    return windows;
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    const pending: Array<TimeWindow> =
      CloudflareSecurityEventClient.pendingWindows(data);
    const events: Array<JSONObject> = [];
    const warnings: Array<string> = [];
    let complete: boolean = true;
    let requestCount: number = 0;

    while (pending.length > 0 && requestCount < MAX_CONNECTOR_PAGES) {
      const window: TimeWindow = pending.shift()!;
      const result: { body: JSONObject } = await requestJson({
        request: this.request,
        method: "POST",
        url: "https://api.cloudflare.com/client/v4/graphql",
        headers: {
          Authorization: `Bearer ${this.apiToken}`,
          Accept: "application/json",
        },
        body: {
          query: QUERY,
          variables: {
            zoneTag: this.zoneId,
            filter: {
              datetime_geq: window.startTime.toISOString(),
              datetime_lt: window.endTime.toISOString(),
            },
          },
        },
        label: "Cloudflare",
        signal: data.signal,
      });
      requestCount++;
      const errors: JSONValue = result.body["errors"];
      if (Array.isArray(errors) && errors.length > 0) {
        throw new BadDataException(
          `Cloudflare GraphQL rejected the firewall-events query: ${JSON.stringify(errors).slice(0, 500)}`,
        );
      }
      const batch: Array<JSONObject> = CloudflareSecurityEventClient.readEvents(
        result.body,
      );
      if (batch.length < 1000) {
        events.push(...batch);
        continue;
      }
      const duration: number =
        window.endTime.getTime() - window.startTime.getTime();
      if (duration <= 1000) {
        events.push(...batch);
        complete = false;
        warnings.push(
          "Cloudflare returned 1,000 events in a one-second window; that window may be truncated.",
        );
        continue;
      }
      const midpoint: Date = new Date(
        Math.floor((window.startTime.getTime() + window.endTime.getTime()) / 2),
      );
      pending.unshift(
        { startTime: window.startTime, endTime: midpoint },
        { startTime: midpoint, endTime: window.endTime },
      );
    }

    if (pending.length > 0) {
      complete = false;
      warnings.push(
        "Cloudflare required more split windows than one poll can safely request; the cursor was held for retry.",
      );
    }
    return {
      events,
      complete,
      requestCount,
      warnings,
      ...(pending.length
        ? {
            continuation: {
              pendingWindows: pending.map((window: TimeWindow): JSONObject => {
                return {
                  startTime: window.startTime.toISOString(),
                  endTime: window.endTime.toISOString(),
                };
              }),
            },
          }
        : {}),
    };
  }
}
