import {
  getFrontendEnvVars,
  isEnterpriseEditionRequested,
} from "../EnvironmentConfig";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import { ExpressRequest, ExpressResponse } from "./Express";
import Response from "./Response";
import { JSONObject } from "../../Types/JSON";

export const FRONTEND_ENVIRONMENT_CACHE_CONTROL: string =
  "private, no-store, no-cache, must-revalidate";

/*
 * The edition the frontends are told about is the EFFECTIVE one: whether the
 * enterprise module actually loaded in this process, not what the raw
 * IS_ENTERPRISE_EDITION variable claims. A Community image with a leftover
 * IS_ENTERPRISE_EDITION=true must not show enterprise pages whose server
 * routes do not exist; ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED lets the
 * admin UI explain that mismatch to a master admin instead.
 *
 * "Requested" is EnvironmentConfig's isEnterpriseEditionRequested, the same
 * definition the App's boot guard uses: an explicit ONEUPTIME_EDITION=community
 * withdraws the request, so the Enterprise image (which bakes
 * IS_ENTERPRISE_EDITION=true) run as the Community Edition on purpose is not
 * told to switch images. It is read on every call, like the rest of the
 * environment served here.
 */
export const getFrontendEnvironmentVariables: () => JSONObject =
  (): JSONObject => {
    const frontendEnv: JSONObject = getFrontendEnvVars();
    const isEnterpriseEditionLoaded: boolean = EnterpriseEdition.isLoaded();
    const isEnterpriseEditionExpected: boolean = isEnterpriseEditionRequested(
      process.env,
    );

    frontendEnv["IS_ENTERPRISE_EDITION"] = isEnterpriseEditionLoaded
      ? "true"
      : "false";
    frontendEnv["ENTERPRISE_EDITION_REQUESTED_BUT_NOT_LOADED"] =
      isEnterpriseEditionExpected && !isEnterpriseEditionLoaded
        ? "true"
        : "false";

    return frontendEnv;
  };

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
window.process.env = ${JSON.stringify(getFrontendEnvironmentVariables())};
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
