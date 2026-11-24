import {
  getFrontendEnvVars,
  isEnterpriseEditionRequested,
} from "../EnvironmentConfig";
import EnterpriseEdition from "../Enterprise/EnterpriseEdition";
import { ExpressRequest, ExpressResponse } from "./Express";
import Response from "./Response";
import { JSONObject } from "../../Types/JSON";
import ProductBrandingUtil, {
  PRODUCT_BRANDING_ENVIRONMENT_KEY,
  ProductBranding,
} from "../../Types/Branding/ProductBranding";
import {
  HELP_AND_SUPPORT_ENVIRONMENT_KEY,
  HelpAndSupportSettings,
  shouldCarryHelpAndSupport,
  toHelpAndSupportEnvironmentValue,
} from "../../Types/HelpAndSupport/HelpAndSupport";

export const FRONTEND_ENVIRONMENT_CACHE_CONTROL: string =
  "private, no-store, no-cache, must-revalidate";

/*
 * What a route knows about the env.js it serves, beyond the environment
 * itself: which frontend asks, and where the server sends its people for
 * help (Types/HelpAndSupport/HelpAndSupport), read by the combined App
 * server, which has the database. The Dashboard's and the sign-in pages'
 * env.js carry it (HELP_AND_SUPPORT_ENVIRONMENT_KEY) while any place is off
 * its default; no other frontend's ever does. A standalone frontend server
 * reads no database and hands neither, so its env.js reads as it always did.
 */
export interface FrontendEnvironmentOptions {
  // The frontend asking, as its route names it: "dashboard", "accounts".
  frontend?: string | undefined;
  helpAndSupport?: HelpAndSupportSettings | null | undefined;
}

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
export const getFrontendEnvironmentVariables: (
  options?: FrontendEnvironmentOptions | undefined,
) => JSONObject = (
  options?: FrontendEnvironmentOptions | undefined,
): JSONObject => {
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

  /*
   * How the installation names and shows itself, only when the enterprise
   * module says it may differ from OneUptime's own (see
   * Types/Branding/ProductBranding.ts). Otherwise the key is not there at
   * all, and the frontends show OneUptime.
   */
  const productBranding: ProductBranding | null =
    EnterpriseEdition.getProductBranding();

  if (productBranding) {
    frontendEnv[PRODUCT_BRANDING_ENVIRONMENT_KEY] =
      ProductBrandingUtil.toEnvironmentValue(productBranding);
  }

  /*
   * Where the server sends its people for help: every place's choice, and
   * only the values a page anybody can open shows - never a chat link or
   * the mobile app's page, which signed-in people read from the server.
   * Left out while every place is on OneUptime's default, and on every
   * frontend but the Dashboard and the sign-in pages.
   */
  const helpAndSupportValue: string | null =
    options?.frontend &&
    options.helpAndSupport &&
    shouldCarryHelpAndSupport(options.frontend)
      ? toHelpAndSupportEnvironmentValue(options.helpAndSupport)
      : null;

  if (helpAndSupportValue) {
    frontendEnv[HELP_AND_SUPPORT_ENVIRONMENT_KEY] = helpAndSupportValue;
  }

  return frontendEnv;
};

/*
 * The combined App server and the five standalone frontend servers must emit
 * exactly the same environment payload. Keeping the serializer here prevents
 * either route family from growing a second, less restrictive copy.
 */
export const getFrontendEnvironmentScript: (
  options?: FrontendEnvironmentOptions | undefined,
) => string = (options?: FrontendEnvironmentOptions | undefined): string => {
  return `
if(!window.process){
  window.process = {}
}

if(!window.process.env){
  window.process.env = {}
}
window.process.env = ${JSON.stringify(getFrontendEnvironmentVariables(options))};
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
  options?: FrontendEnvironmentOptions | undefined,
) => void = (
  req: ExpressRequest,
  res: ExpressResponse,
  options?: FrontendEnvironmentOptions | undefined,
): void => {
  Response.setNoCacheHeaders(res);
  res.setHeader("Cache-Control", FRONTEND_ENVIRONMENT_CACHE_CONTROL);
  Response.sendJavaScriptResponse(
    req,
    res,
    getFrontendEnvironmentScript(options),
  );
};
