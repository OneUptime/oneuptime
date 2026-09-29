import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import ProxyConfig, { ProxyAgents } from "../ProxyConfig";

export interface RdapHttpResponse {
  statusCode: number;
  body: JSONObject | null;
}

/*
 * The one place RDAP talks HTTP. Both the IANA bootstrap fetch and the
 * per-domain query go through here so they share the probe's proxy config
 * and the RDAP media type.
 */
export default class RdapHttp {
  public static async getJson(
    urlString: string,
    options: { timeoutInMs: number },
  ): Promise<RdapHttpResponse> {
    const url: URL = URL.fromString(urlString);

    const proxyAgents: ProxyAgents = ProxyConfig.getRequestProxyAgents(url);

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await API.get<JSONObject>({
        url: url,
        headers: {
          /*
           * RFC 9083 media type. Some registries content-negotiate on it and
           * a few reject application/json outright, so it goes first.
           */
          Accept: "application/rdap+json, application/json",
        },
        options: {
          timeout: options.timeoutInMs,
          ...proxyAgents,
        },
      });

    return {
      statusCode: response.statusCode,
      body: RdapHttp.toJSONObject(response.data),
    };
  }

  private static toJSONObject(data: unknown): JSONObject | null {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      return null;
    }

    return data as JSONObject;
  }
}
