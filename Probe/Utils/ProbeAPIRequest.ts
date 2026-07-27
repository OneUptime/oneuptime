import { PROBE_API_REQUEST_TIMEOUT_IN_MS, PROBE_KEY } from "../Config";
import ProbeUtil from "./Probe";
import ProxyConfig from "./ProxyConfig";
import URL from "Common/Types/API/URL";
import { RequestOptions } from "Common/Utils/API";
import { JSONObject } from "Common/Types/JSON";

export default class ProbeAPIRequest {
  public static getDefaultRequestBody(): JSONObject {
    return {
      probeKey: PROBE_KEY,
      probeId: ProbeUtil.getProbeId().toString(),
    };
  }

  /*
   * Every control-plane request to the server goes through this: proxy
   * agents when a proxy is configured, plus an explicit timeout so a
   * non-responding server produces a logged failure instead of an
   * infinitely hung request (axios's default timeout is 0 = no timeout,
   * and a hung request from a cron tick piles onto the next tick's).
   */
  public static getDefaultRequestOptions(url: URL): RequestOptions {
    return {
      ...ProxyConfig.getRequestProxyAgents(url),
      timeout: PROBE_API_REQUEST_TIMEOUT_IN_MS,
    };
  }
}
