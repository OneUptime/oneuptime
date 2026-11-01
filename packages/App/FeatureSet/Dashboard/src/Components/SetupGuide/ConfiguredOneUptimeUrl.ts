import { getSetupGuideOneUptimeUrl } from "./SetupGuide";
import Protocol from "Common/Types/API/Protocol";
import { HOST, HTTP_PROTOCOL } from "Common/UI/Config";

/*
 * This OneUptime's address as its settings name it (HOST and
 * HTTP_PROTOCOL): https://oneuptime.com on OneUptime Cloud, a self-hosted
 * install's own domain. Every setup guide fills ONEUPTIME_URL in with it,
 * and the agents' install commands download from it, so the two always
 * agree. <YOUR_ONEUPTIME_URL> when HOST is not set.
 */
export function getConfiguredOneUptimeUrl(): string {
  return getSetupGuideOneUptimeUrl({
    host: HOST,
    isHttps: HTTP_PROTOCOL === Protocol.HTTPS,
  });
}
