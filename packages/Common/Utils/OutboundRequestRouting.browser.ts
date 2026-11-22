import type { AxiosRequestConfig } from "axios";

/*
 * How a request of the shared API client reaches its URL, in a browser
 * build, which takes this file in place of OutboundRequestRouting.ts (the
 * "browser" field of packages/Common/package.json).
 *
 * The browser sends the request itself, through whatever proxy the person's
 * own machine uses: OneUptime's outbound proxy, and Node's agents with it,
 * are the server's. The config goes as it is, so a page does not bring the
 * server's proxy rules and Node's http modules with it.
 */
export default class OutboundRequestRouting {
  public static route<T extends AxiosRequestConfig>(config: T): T {
    return config;
  }
}
