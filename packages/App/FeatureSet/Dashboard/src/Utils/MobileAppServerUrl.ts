import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";

/*
 * The address the OneUptime On-Call app connects to for this OneUptime: what
 * the app's first screen ("Connect your workspace") asks for as its Server
 * URL. The app checks it by reading `<address>/api/status`, so it is the
 * origin the API is served from - this Dashboard's own host, as the agent
 * and MCP setup pages print it. OneUptime Cloud's address is the one the app
 * fills in by itself; a self-hosted server's has to be typed in, which is
 * why the "Get the mobile app" steps name it.
 */
export function getMobileAppServerUrl(): string {
  if (HOST) {
    return `${HTTP_PROTOCOL}${HOST}`;
  }

  // No host configured, as in a development build: where this page came from.
  return window.location.origin;
}
