/*
 * A tunnel the outbound proxy would not open, in a browser build, which
 * takes this file in place of ProxyTunnelRefusal.ts (the "browser" field of
 * packages/Common/package.json).
 *
 * A browser sends a request itself, through whatever proxy its own machine
 * uses (OutboundRequestRouting.browser.ts): OneUptime's outbound proxy opens
 * no tunnel for it, and no error a browser meets is Node's ERR_PROXY_TUNNEL
 * or OutboundFetch's refusal. So the API client finds no refusal here to say,
 * and a page does not download the words for one with every request it sends
 * (about 0.6 KiB gzipped of each public page's first load,
 * packages/Common/Scripts/first-load-budgets.js).
 */
export const PROXY_TUNNEL_ERROR_CODE: string = "ERR_PROXY_TUNNEL";

export default class ProxyTunnelRefusal {
  // No tunnel of OneUptime's proxy is ever refused to a browser.
  public static describe(_error: unknown): string | null {
    return null;
  }
}
