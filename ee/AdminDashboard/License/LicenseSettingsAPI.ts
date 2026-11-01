import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL, BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * The Admin Dashboard's side of the license: whether this installation has
 * one to manage, and the calls Settings > License makes.
 *
 *   GET  /global-config/license          where the license stands
 *   POST /global-config/license          activate: {licenseKey} online, or
 *                                        {licenseToken} offline
 *   POST /global-config/license/refresh  re-fetch the stored key's license
 *
 * Both POSTs exist only in the Enterprise server, and only a master admin's
 * session gets through them (ee/Server/License/API/LicenseClientAPI.ts).
 */

const LICENSE_ROUTE: Route = new Route("/global-config/license");
const LICENSE_REFRESH_ROUTE: Route = new Route(
  "/global-config/license/refresh",
);

/*
 * Only a self-hosted Enterprise installation has a license to manage. The
 * Enterprise image running as the Community Edition has none, and OneUptime
 * Cloud bounds seats and plans through subscriptions and shows no edition
 * pill at all: there the page and its side menu entry draw nothing.
 */
export const isLicenseSettingsAvailable: () => boolean = (): boolean => {
  return IS_ENTERPRISE_EDITION && !BILLING_ENABLED;
};

type ToBodyFunction = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
) => JSONObject;

const toBody: ToBodyFunction = (
  response: HTTPResponse<JSONObject> | HTTPErrorResponse,
): JSONObject => {
  if (!response.isSuccess()) {
    throw response;
  }

  return (response.data as JSONObject) || {};
};

/*
 * The route also serves the login page, so on its own it answers a caller
 * with no session with the reduced anonymous payload and a 200. This page is
 * only ever opened signed in, so no session means an expired one: saying so
 * makes the server answer 401, which the API client refreshes and replays.
 */
export const fetchLicense: () => Promise<JSONObject> =
  async (): Promise<JSONObject> => {
    const url: URL = URL.fromURL(APP_API_URL).addRoute(LICENSE_ROUTE);

    url.addQueryParam("signedIn", "true");

    return toBody(
      await API.fetch<JSONObject>({ method: HTTPMethod.GET, url: url }),
    );
  };

/*
 * Every write answers with the same body the GET gives a master admin, read
 * fresh after the write, so the page shows the new terms from one source.
 */
export const activateLicenseKey: (licenseKey: string) => Promise<JSONObject> =
  async (licenseKey: string): Promise<JSONObject> => {
    return toBody(
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: URL.fromURL(APP_API_URL).addRoute(LICENSE_ROUTE),
        data: { licenseKey: licenseKey },
      }),
    );
  };

// For an installation that cannot reach oneuptime.com.
export const activateLicenseToken: (
  licenseToken: string,
) => Promise<JSONObject> = async (
  licenseToken: string,
): Promise<JSONObject> => {
  return toBody(
    await API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: URL.fromURL(APP_API_URL).addRoute(LICENSE_ROUTE),
      data: { licenseToken: licenseToken },
    }),
  );
};

/*
 * Re-asks oneuptime.com about the license this installation already holds.
 * Deliberately sends no key: the server refreshes the stored one.
 */
export const refreshLicense: () => Promise<JSONObject> =
  async (): Promise<JSONObject> => {
    return toBody(
      await API.fetch<JSONObject>({
        method: HTTPMethod.POST,
        url: URL.fromURL(APP_API_URL).addRoute(LICENSE_REFRESH_ROUTE),
      }),
    );
  };
