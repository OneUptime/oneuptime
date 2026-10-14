import APIException from "../../../../Types/Exception/ApiException";
import { JSONObject } from "../../../../Types/JSON";
import { ConnectorTransport } from "../Connectors/Types";
import ResponseHttp, { ResponseHttpResult } from "./ResponseHttp";

/*
 * The Microsoft Defender for Endpoint calls a playbook makes to isolate a
 * device (https://learn.microsoft.com/defender-endpoint/api/get-machines,
 * .../api/isolate-machine):
 *
 *   POST {login}/{tenant}/oauth2/v2.0/token   client credentials, scope {api resource}/.default
 *   GET  {api}/api/machines?$filter=...         the device by its DNS name
 *   POST {api}/api/machines/{id}/isolate        { Comment, IsolationType }
 *
 * The connection's app registration is the one the Defender XDR connection
 * imports alerts with; isolating needs the WindowsDefenderATP application
 * permissions Machine.Read.All and Machine.Isolate besides, with admin
 * consent, and the error says so when Defender answers 403.
 */

interface CloudEndpoints {
  loginHost: string;
  apiHost: string;
  resource: string;
}

const CLOUDS: Record<string, CloudEndpoints> = {
  public: {
    loginHost: "https://login.microsoftonline.com",
    apiHost: "https://api.security.microsoft.com",
    resource: "https://api.securitycenter.microsoft.com",
  },
  usgov: {
    loginHost: "https://login.microsoftonline.us",
    apiHost: "https://api-gov.securitycenter.microsoft.us",
    resource: "https://api-gov.securitycenter.microsoft.us",
  },
};

export interface DefenderMachine {
  id: string;
  computerDnsName: string;
}

// OData string literal: a single quote doubled.
export function odataQuotedValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export default class MicrosoftDefenderEndpointClient {
  private endpoints: CloudEndpoints;
  private tenantId: string;
  private clientId: string;
  private clientSecret: string;
  private transport: ConnectorTransport;
  private accessToken: string | null = null;

  public constructor(options: {
    tenantId: string;
    clientId: string;
    clientSecret: string;
    cloud: string;
    transport: ConnectorTransport;
  }) {
    const endpoints: CloudEndpoints | undefined =
      Object.prototype.hasOwnProperty.call(CLOUDS, options.cloud)
        ? CLOUDS[options.cloud]
        : undefined;

    if (!endpoints) {
      throw new APIException(
        `The connection's Microsoft cloud "${options.cloud}" is not one OneUptime knows.`,
      );
    }

    this.endpoints = endpoints;
    this.tenantId = options.tenantId;
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

    const step: string = "Microsoft Defender token request";
    const result: ResponseHttpResult = await ResponseHttp.send({
      transport: this.transport,
      request: {
        method: "POST",
        url: `${this.endpoints.loginHost}/${encodeURIComponent(this.tenantId)}/oauth2/v2.0/token`,
        headers: { Accept: "application/json" },
        body: {
          grant_type: "client_credentials",
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: `${this.endpoints.resource}/.default`,
        },
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

  /*
   * The devices whose DNS name is this host: the name itself, or the name
   * followed by a domain ("web-01" finds "web-01.contoso.com", never
   * "web-010.contoso.com").
   */
  public async findMachines(hostname: string): Promise<Array<DefenderMachine>> {
    const step: string = "Microsoft Defender device lookup";
    const host: string = hostname.trim().toLowerCase();
    const params: URLSearchParams = new URLSearchParams();
    params.set(
      "$filter",
      `startswith(computerDnsName,${odataQuotedValue(host)})`,
    );
    params.set("$top", "25");

    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "GET",
      `${this.endpoints.apiHost}/api/machines?${params.toString()}`,
    );

    // Defender answers 404 when it has no matching device.
    if (result.statusCode === 404) {
      return [];
    }

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The app registration needs the WindowsDefenderATP permission Machine.Read.All, with admin consent."
            : undefined,
      });
    }

    const value: unknown = (result.bodyJson as JSONObject | undefined)?.[
      "value"
    ];

    if (!Array.isArray(value)) {
      return [];
    }

    const machines: Array<DefenderMachine> = [];

    for (const item of value) {
      if (!item || typeof item !== "object") {
        continue;
      }

      const machine: JSONObject = item as JSONObject;
      const id: string = typeof machine["id"] === "string" ? machine["id"] : "";
      const name: string =
        typeof machine["computerDnsName"] === "string"
          ? machine["computerDnsName"]
          : "";
      const lowered: string = name.toLowerCase();

      if (id && (lowered === host || lowered.startsWith(`${host}.`))) {
        machines.push({ id, computerDnsName: name });
      }
    }

    return machines;
  }

  public async isolateMachine(data: {
    machineId: string;
    isolationType: "Full" | "Selective";
    comment: string;
  }): Promise<void> {
    const step: string = "Microsoft Defender isolate";
    const result: ResponseHttpResult = await this.sendAuthenticated(
      step,
      "POST",
      `${this.endpoints.apiHost}/api/machines/${encodeURIComponent(data.machineId)}/isolate`,
      JSON.stringify({
        Comment: data.comment,
        IsolationType: data.isolationType,
      }),
    );

    if (!ResponseHttp.isSuccess(result)) {
      throw ResponseHttp.failure({
        step,
        result,
        secrets: this.secrets(),
        hint:
          result.statusCode === 403
            ? "The app registration needs the WindowsDefenderATP permission Machine.Isolate, with admin consent."
            : undefined,
      });
    }
  }
}
