import { getFrontendEnvVars } from "../EnvironmentConfig";
import { ExpressRequest, ExpressResponse } from "./Express";
import Response from "./Response";

export const FRONTEND_ENVIRONMENT_CACHE_CONTROL: string =
  "private, no-store, no-cache, must-revalidate";

/*
 * The combined App server and the five standalone frontend servers must emit
 * exactly the same environment payload. Keeping the serializer here prevents
 * either route family from growing a second, less restrictive copy.
 */
export const getFrontendEnvironmentScript: () => string = (): string => {
  return `
if(!window.process){
  window.process = {}
}

if(!window.process.env){
  window.process.env = {}
}
window.process.env = ${JSON.stringify(getFrontendEnvVars())};
`;
};

/*
 * Keep the cache policy beside the one serializer used by every frontend. A
 * pre-remediation env.js may contain a backend exporter credential, so merely
 * fixing the next response is insufficient if a browser or intermediary is
 * allowed to retain the old bytes. `private` is defence in depth for shared
 * caches; `no-store` is the controlling requirement.
 */
export const sendFrontendEnvironmentResponse: (
  req: ExpressRequest,
  res: ExpressResponse,
) => void = (req: ExpressRequest, res: ExpressResponse): void => {
  Response.setNoCacheHeaders(res);
  res.setHeader("Cache-Control", FRONTEND_ENVIRONMENT_CACHE_CONTROL);
  Response.sendJavaScriptResponse(req, res, getFrontendEnvironmentScript());
};
