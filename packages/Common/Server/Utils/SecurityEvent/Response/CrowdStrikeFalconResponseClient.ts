import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { ConnectorTransport } from "../Connectors/Types";
import { getCrowdStrikeFalconBaseUrl } from "../Connectors/CrowdStrikeFalcon/CrowdStrikeFalconClient";
import ResponseHttp, { ResponseHttpResult } from "./ResponseHttp";

/*
 * The Falcon calls a playbook makes to network-contain a host, from the
 * Falcon API (Hosts collection):
 *
 *   POST {base}/oauth2/token                              client credentials
 *   GET  {base}/devices/queries/devices/v1?filter=hostname:'<host>'
 *                                                          device ids for a hostname
 *   POST {base}/devices/entities/devices-actions/v2?action_name=contain
 *        { "ids": [...] }                                  contain them
 *
 * The API client needs the Hosts: Write scope (and Hosts: Read to find the
 * device); a client made for importing alerts has only Alerts: Read and is
 * answered 403, which the error says.
 */

const DEVICE_QUERY_LIMIT: number = 10;

// FQL string literal: backslashes and single quotes escaped.
export function falconQuotedValue(value: string): string {
  return `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

export default class CrowdStrikeFalconResponseClient {
  private baseUrl: string;
  private clientId: string;
  private clientSecret: string;
  private transport: ConnectorTransport;
  private accessToken: string | null = null;

  public constructor(options: {
    cloud: string;
    clientId: string;
    clientSecret: string;
    transport: ConnectorTransport;
  }) {
    const baseUrl: string | null = getCrowdStrikeFalconBaseUrl(options.cloud);

    if (!baseUrl) {
      throw new APIException(
        `The connection's Falcon cloud "${options.cloud}" is not one OneUptime knows.`,
      );
    }

    this.baseUrl = baseUrl;
    this.clientId = options.clientId;
    this.clientSecret = options.clientSecret;
    this.transport = options.transport;
  }

  private secrets(): Array<string> {
    return [this.clientSecret, this.accessToken || ""];
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken) {
      return this.accessToken;
    }

    const step: string = "CrowdStrike Falcon token request";
    const result: ResponseHttpResult = await ResponseHttp.send({
      transport: this.transport,
      request: {
        method: "POST",
        url: `${this.baseUrl}/oauth2/token`,
        headers: { Accept: "application/json" },
        body: { client_id: this.clientId, client_secret: this.clientSecret },
        formUrlEncoded: true,
      },
      step,
      secrets: this.secrets(),
    });

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({ step, result, secrets: this.secrets() });
    }

    const token: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "access_token"
    ];

    if (typeof token !== "string" || !token) {
      throw new APIException(`${step} returned no access_token.`);
    }

    this.accessToken = token;
    return token;
  }

  private async sendAuthenticated(
    step: string,
    method: "GET" | "POST",
    url: string,
    body?: string,
  ): Promise<ResponseHttpResult> {
    const token: string = await this.getAccessToken();

    return await ResponseHttp.send({
      transport: this.transport,
      request: {
        method,
        url,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        },
        body,
      },
      step,
      secrets: this.secrets(),
    });
  }

  public async findDeviceIds(hostname: string): Promise<Array<string>> {
    const step: string = "CrowdStrike Falcon device lookup";
    const params: URLSearchParams = new URLSearchParams();
    params.set("filter", `hostname:${falconQuotedValue(hostname)}`);
    params.set("limit", String(DEVICE_QUERY_LIMIT));

    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "GET",
      `${this.baseUrl}/devices/queries/devices/v1?${params.toString()}`,
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The connection's API client needs the Hosts: Read scope."
            : undefined,
      });
    }

    const resources: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "resources"
    ];

    return Array.isArray(resources)
      ? resources.filter((id: unknown): id is string => {
          return typeof id === "string" && id.length > 0;
        })
      : [];
  }

  public async containDevices(deviceIds: Array<string>): Promise<void> {
    const step: string = "CrowdStrike Falcon contain";
    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "POST",
      `${this.baseUrl}/devices/entities/devices-actions/v2?action_name=contain`,
      JSON.stringify({ ids: deviceIds }),
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The connection's API client needs the Hosts: Write scope to contain hosts."
            : undefined,
      });
    }
  }
}
