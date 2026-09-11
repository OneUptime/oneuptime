import SecurityEventConnection from "../../../../Models/DatabaseModels/SecurityEventConnection";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import { DataSourceHttpResponse } from "../../DataSource/HttpFetch";
import {
  CONNECTOR_TIMEOUT_MS,
  defaultConnectorRequest,
  jsonObject,
  jsonObjects,
  parseCredentialJson,
  requestJson,
  requiredSetting,
  stringValues,
  stringValue,
} from "./ConnectorHttp";
import {
  SecurityEventConnectorClient,
  SecurityEventConnectorFetchResult,
  SecurityEventConnectorHttpRequest,
} from "./Types";

const CLOUD_HOSTS: Record<string, string> = {
  "us-1": "api.crowdstrike.com",
  "us-2": "api.us-2.crowdstrike.com",
  "eu-1": "api.eu-1.crowdstrike.com",
  "us-gov-1": "api.laggar.gcw.crowdstrike.com",
};

export default class CrowdStrikeFalconClient
  implements SecurityEventConnectorClient
{
  private readonly baseUrl: string;
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
    const cloud: string = stringValue(configuration["cloud"]) || "us-1";
    const host: string = CLOUD_HOSTS[cloud] || "";
    if (!host) {
      throw new BadDataException("CrowdStrike cloud is not supported.");
    }
    this.baseUrl = `https://${host}`;
    this.clientId = requiredSetting(credentials, "clientId", "CrowdStrike");
    this.clientSecret = requiredSetting(
      credentials,
      "clientSecret",
      "CrowdStrike",
    );
    this.request = request;
  }

  private async accessToken(signal?: AbortSignal): Promise<string> {
    const response: DataSourceHttpResponse = await this.request({
      method: "POST",
      url: `${this.baseUrl}/oauth2/token`,
      headers: { Accept: "application/json" },
      body: {
        client_id: this.clientId,
        client_secret: this.clientSecret,
      },
      formUrlEncoded: true,
      timeoutInMs: CONNECTOR_TIMEOUT_MS,
      egressOptions: { targetLabel: "CrowdStrike identity endpoint" },
      signal,
    });
    const body: JSONObject = jsonObject(response.bodyJson, "CrowdStrike OAuth");
    const token: string = stringValue(body["access_token"]);
    if (!token) {
      throw new BadDataException("CrowdStrike OAuth returned no access_token.");
    }
    return token;
  }

  private static errorMessages(body: JSONObject): Array<string> {
    return jsonObjects(body["errors"], "CrowdStrike errors").map(
      (error: JSONObject): string => {
        const code: string = stringValue(error["code"]);
        const message: string =
          stringValue(error["message"]) || stringValue(error["detail"]);
        return [code, message].filter(Boolean).join(": ") || "unknown error";
      },
    );
  }

  public async fetchEvents(data: {
    startTime: Date;
    endTime: Date;
    continuation?: JSONObject | undefined;
    signal?: AbortSignal | undefined;
  }): Promise<SecurityEventConnectorFetchResult> {
    if (data.continuation) {
      throw new BadDataException(
        "CrowdStrike does not support resuming mutable alert offsets; retry the saved time window without a provider continuation.",
      );
    }
    const token: string = await this.accessToken(data.signal);
    const url: URL = new URL(`${this.baseUrl}/alerts/queries/alerts/v2`);
    url.searchParams.set(
      "filter",
      `updated_timestamp:>='${data.startTime.toISOString()}'+updated_timestamp:<'${data.endTime.toISOString()}'`,
    );
    url.searchParams.set("limit", "500");
    url.searchParams.set("offset", "0");
    const response: DataSourceHttpResponse = await this.request({
      method: "GET",
      url: url.toString(),
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
      },
      timeoutInMs: CONNECTOR_TIMEOUT_MS,
      egressOptions: { targetLabel: "CrowdStrike alerts endpoint" },
      signal: data.signal,
    });
    const body: JSONObject = jsonObject(
      response.bodyJson,
      "CrowdStrike alerts query",
    );
    const queryErrors: Array<string> =
      CrowdStrikeFalconClient.errorMessages(body);
    if (queryErrors.length) {
      throw new BadDataException(
        `CrowdStrike alert query failed: ${queryErrors.join("; ").slice(0, 500)}`,
      );
    }
    const ids: Array<string> = stringValues(
      body["resources"],
      "CrowdStrike alert query",
      true,
    );
    const meta: JSONObject = jsonObject(
      body["meta"] || {},
      "CrowdStrike alerts metadata",
    );
    const pagination: JSONObject = jsonObject(
      meta["pagination"] || {},
      "CrowdStrike alerts pagination",
    );
    const total: number = Number(pagination["total"] || ids.length);

    const events: Array<JSONObject> = [];
    const warnings: Array<string> = [];
    let entityIncomplete: boolean = false;
    let entityRequests: number = 0;
    for (let index: number = 0; index < ids.length; index += 200) {
      const requestedIds: Array<string> = ids.slice(index, index + 200);
      const result: { body: JSONObject } = await requestJson({
        request: this.request,
        method: "POST",
        url: `${this.baseUrl}/alerts/entities/alerts/v2`,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
        },
        body: { composite_ids: requestedIds },
        label: "CrowdStrike alert entities",
        signal: data.signal,
      });
      const entityErrors: Array<string> = CrowdStrikeFalconClient.errorMessages(
        result.body,
      );
      const resources: Array<JSONObject> = jsonObjects(
        result.body["resources"],
        "CrowdStrike alert entities",
        true,
      );
      events.push(...resources);
      const returnedIds: Array<string> = resources
        .map((resource: JSONObject): string => {
          return (
            stringValue(resource["composite_id"]) || stringValue(resource["id"])
          );
        })
        .filter(Boolean);
      const returnedIdSet: Set<string> = new Set(returnedIds);
      const missingIds: Array<string> =
        returnedIds.length === resources.length
          ? requestedIds.filter((requestedId: string): boolean => {
              return !returnedIdSet.has(requestedId);
            })
          : requestedIds.slice(resources.length);
      if (entityErrors.length || missingIds.length > 0) {
        entityIncomplete = true;
        warnings.push(
          entityErrors.length
            ? `CrowdStrike did not return every requested alert entity: ${entityErrors.join("; ").slice(0, 500)}`
            : `CrowdStrike omitted ${missingIds.length} of ${requestedIds.length} requested alert entities.`,
        );
      }
      entityRequests++;
    }
    const queryComplete: boolean = ids.length >= total;
    const complete: boolean = queryComplete && !entityIncomplete;
    return {
      events,
      complete,
      requestCount: 2 + entityRequests,
      warnings: [
        ...warnings,
        ...(!queryComplete
          ? [
              "CrowdStrike returned more alerts than one stable ID page; the time window will be narrowed and retried without mutable offset pagination.",
            ]
          : []),
      ],
    };
  }
}
