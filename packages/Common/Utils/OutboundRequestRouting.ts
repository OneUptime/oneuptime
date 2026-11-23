import type { AxiosRequestConfig } from "axios";
import OutboundProxyAgents from "../Server/Utils/OutboundProxyAgents";

/*
 * HOW A REQUEST OF THE SHARED API CLIENT REACHES ITS URL, ON A SERVER
 * (issue #10442).
 *
 * The API client (Utils/API) runs in the browser and on every server
 * program: the API, the workers, the probe, the Runner. On a server a
 * request goes through the outbound proxy the environment names, or
 * directly, as OutboundProxyAgents decides for its URL - never through a
 * proxy axios reads from the environment itself, which sent the proxy's user
 * name and password percent-encoded. A request that brings its own agents
 * is routed by them, with no proxy of axios's on top.
 *
 * A browser build takes OutboundRequestRouting.browser.ts in place of this
 * file (the "browser" field of packages/Common/package.json): a browser has
 * no outbound proxy of OneUptime's, and no Node agents.
 */
export default class OutboundRequestRouting {
  // The request's config, with its route set (OutboundProxyAgents).
  public static route<T extends AxiosRequestConfig>(config: T): T {
    return OutboundProxyAgents.routeAxiosRequest(config);
  }
}
