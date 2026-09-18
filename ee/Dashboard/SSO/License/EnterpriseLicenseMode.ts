import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL, BILLING_ENABLED } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";

/*
 * Whether this installation's Enterprise license lets people change the
 * enterprise identity configuration (SAML / OIDC providers, SCIM settings).
 *
 * The server is the authority: without a valid license (after the grace
 * period) it answers 402 to every create or update of these models. This only
 * lets the screens say so up front, and hide the buttons that would fail,
 * instead of letting someone fill in a whole form first.
 *
 * It never gates anything that keeps working without a license - SSO sign-in,
 * SCIM provisioning and deprovisioning, reading and deleting configuration.
 *
 * Used by the Dashboard and the Admin Dashboard identity screens. It imports
 * only Common/..., so both frontends can bundle it.
 */
export enum EnterpriseLicenseMode {
  // A valid license, or OneUptime Cloud (plans gate these features there).
  Editable = "editable",
  // No valid license, but still inside the grace period: editable, with a warning.
  Grace = "grace",
  // No valid license and the grace period is over: configuration is read-only.
  ReadOnly = "read-only",
  // Not loaded yet, or the license could not be read. Nothing is hidden.
  Unknown = "unknown",
}

// Snapshot statuses (EnterpriseLicenseSnapshot["status"]) that make configuration read-only.
export const READ_ONLY_LICENSE_STATUSES: ReadonlyArray<string> = [
  "missing",
  "expired",
  "invalid",
];

export const LICENSE_ROUTE: Route = new Route("/global-config/license");

/*
 * Reads the answer of GET /api/global-config/license. Prefers the snapshot
 * `status` (valid / grace / missing / expired / invalid); falls back to
 * `licenseValid` for a server that does not send it (true for a valid license
 * AND during the grace period). Anything else is Unknown, never ReadOnly: a
 * screen must not lock itself because of a response it does not understand.
 */
export const getEnterpriseLicenseMode: (
  payload: JSONObject | null | undefined,
) => EnterpriseLicenseMode = (
  payload: JSONObject | null | undefined,
): EnterpriseLicenseMode => {
  if (!payload || typeof payload !== "object") {
    return EnterpriseLicenseMode.Unknown;
  }

  const status: unknown = payload["status"];

  if (typeof status === "string") {
    if (status === "valid") {
      return EnterpriseLicenseMode.Editable;
    }

    if (status === "grace") {
      return EnterpriseLicenseMode.Grace;
    }

    if (READ_ONLY_LICENSE_STATUSES.includes(status)) {
      return EnterpriseLicenseMode.ReadOnly;
    }

    return EnterpriseLicenseMode.Unknown;
  }

  const licenseValid: unknown = payload["licenseValid"];

  if (typeof licenseValid === "boolean") {
    return licenseValid
      ? EnterpriseLicenseMode.Editable
      : EnterpriseLicenseMode.ReadOnly;
  }

  return EnterpriseLicenseMode.Unknown;
};

export const isEnterpriseConfigurationReadOnly: (
  mode: EnterpriseLicenseMode,
) => boolean = (mode: EnterpriseLicenseMode): boolean => {
  return mode === EnterpriseLicenseMode.ReadOnly;
};

export const getEnterpriseLicenseUrl: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(LICENSE_ROUTE);
};

/*
 * Fetches the license state. On OneUptime Cloud (billing on) there is no
 * license to ask about - the project's plan decides, and the shell around
 * these screens has already checked it - so it answers Editable without a
 * request. Never throws: a failed read is Unknown.
 */
export const fetchEnterpriseLicenseMode: () => Promise<EnterpriseLicenseMode> =
  async (): Promise<EnterpriseLicenseMode> => {
    if (BILLING_ENABLED) {
      return EnterpriseLicenseMode.Editable;
    }

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.GET,
          url: getEnterpriseLicenseUrl(),
        });

      if (!response.isSuccess()) {
        return EnterpriseLicenseMode.Unknown;
      }

      return getEnterpriseLicenseMode(response.data as JSONObject);
    } catch {
      return EnterpriseLicenseMode.Unknown;
    }
  };
