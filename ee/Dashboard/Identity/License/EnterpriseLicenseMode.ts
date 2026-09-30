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
 * enterprise identity configuration (SAML / OIDC providers, SCIM settings),
 * and whether the feature a screen is about is running.
 *
 * The server is the authority: without a valid license (after the trial or
 * the grace period) it answers 402 to every create or update of these models,
 * and it also stops SSO sign-in, refuses SCIM requests and stops recording
 * audit logs until a license is activated. A license whose features leave one
 * of those out stops that one the same way. This only lets the screens say so
 * up front, and hide the buttons that would fail, instead of letting someone
 * fill in a whole form first.
 *
 * It never gates reading or deleting configuration, or the two tighten-only
 * changes the server accepts without a license (TightenOnlyUpdates.ts).
 * Unknown - not loaded yet, or unreadable - never hides anything and never
 * claims that sign-in, SCIM or audit logging has stopped.
 *
 * Used by the Dashboard and the Admin Dashboard screens. It imports only
 * Common/..., so both frontends can bundle it.
 */
export enum EnterpriseLicenseMode {
  // A valid license, or OneUptime Cloud (plans gate these features there).
  Editable = "editable",
  // No valid license, but still inside the grace period: editable, with a warning.
  Grace = "grace",
  // No valid license and the grace period is over: configuration is read-only.
  ReadOnly = "read-only",
  /*
   * A usable license (valid, or in its trial or grace period) whose features
   * leave out the feature this screen is about. The server treats that
   * feature as it does after a lapse: it is off, and its configuration is
   * read-only. Only answered when a screen names its feature.
   */
  NotIncluded = "not-included",
  // Not loaded yet, or the license could not be read. Nothing is hidden.
  Unknown = "unknown",
}

/*
 * The license features a screen can be about. The values are those of the
 * server's EnterpriseFeature (packages/Common/Server/Enterprise/
 * EnterpriseFeature.ts), which the license format fixes; a test keeps the two
 * equal. Only the ones a screen asks about are listed.
 */
export enum LicensedFeature {
  SSO = "sso",
  SCIM = "scim",
  AuditLogs = "audit-logs",
}

// The features claim value that entitles every feature (ENTERPRISE_FEATURE_WILDCARD).
export const LICENSED_FEATURES_WILDCARD: string = "*";

// Snapshot statuses (EnterpriseLicenseSnapshot["status"]) that make configuration read-only.
export const READ_ONLY_LICENSE_STATUSES: ReadonlyArray<string> = [
  "missing",
  "expired",
  "invalid",
];

export const LICENSE_ROUTE: Route = new Route("/global-config/license");

/*
 * Whether the license response says the license leaves `feature` out. Only an
 * explicit list of feature names that lacks it counts. "all", a list with the
 * wildcard, and a response without a readable `features` field (a server that
 * does not send it) never do: an answer this cannot read must not claim that
 * anything stopped.
 */
export const isFeatureLeftOutOfLicense: (
  payload: JSONObject | null | undefined,
  feature: LicensedFeature,
) => boolean = (
  payload: JSONObject | null | undefined,
  feature: LicensedFeature,
): boolean => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const features: unknown = payload["features"];

  if (!Array.isArray(features)) {
    return false;
  }

  const names: Array<string> = features.filter((name: unknown): boolean => {
    return typeof name === "string";
  }) as Array<string>;

  if (names.length !== features.length) {
    // Not a list of names: not an answer this understands.
    return false;
  }

  if (names.includes(LICENSED_FEATURES_WILDCARD)) {
    return false;
  }

  return !names.includes(feature);
};

// The mode the license status alone gives, whatever the screen is about.
const getLicenseStatusMode: (
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

/*
 * Reads the answer of GET /api/global-config/license. Prefers the snapshot
 * `status` (valid / grace / missing / expired / invalid); falls back to
 * `licenseValid` for a server that does not send it (true for a valid license
 * AND during the grace period). Anything else is Unknown, never ReadOnly: a
 * screen must not lock itself because of a response it does not understand.
 *
 * With a `feature`, a usable license (Editable or Grace) whose `features`
 * leave that feature out is NotIncluded: the server does not run a feature
 * the license does not include (EnterpriseLicenseSnapshotUtil.entitles).
 */
export const getEnterpriseLicenseMode: (
  payload: JSONObject | null | undefined,
  feature?: LicensedFeature | undefined,
) => EnterpriseLicenseMode = (
  payload: JSONObject | null | undefined,
  feature?: LicensedFeature | undefined,
): EnterpriseLicenseMode => {
  const mode: EnterpriseLicenseMode = getLicenseStatusMode(payload);

  if (
    feature &&
    (mode === EnterpriseLicenseMode.Editable ||
      mode === EnterpriseLicenseMode.Grace) &&
    isFeatureLeftOutOfLicense(payload, feature)
  ) {
    return EnterpriseLicenseMode.NotIncluded;
  }

  return mode;
};

/*
 * Whether the screen's configuration is read-only - and, equally, whether the
 * feature it is about has stopped: after a lapse (ReadOnly), or because the
 * license does not include it (NotIncluded).
 */
export const isEnterpriseConfigurationReadOnly: (
  mode: EnterpriseLicenseMode,
) => boolean = (mode: EnterpriseLicenseMode): boolean => {
  return (
    mode === EnterpriseLicenseMode.ReadOnly ||
    mode === EnterpriseLicenseMode.NotIncluded
  );
};

export const getEnterpriseLicenseUrl: () => URL = (): URL => {
  return URL.fromURL(APP_API_URL).addRoute(LICENSE_ROUTE);
};

/*
 * Fetches the license state, for the screen's `feature` when it names one. On
 * OneUptime Cloud (billing on) there is no license to ask about - the
 * project's plan decides, and the shell around these screens has already
 * checked it - so it answers Editable without a request. Never throws: a
 * failed read is Unknown.
 */
export const fetchEnterpriseLicenseMode: (
  feature?: LicensedFeature | undefined,
) => Promise<EnterpriseLicenseMode> = async (
  feature?: LicensedFeature | undefined,
): Promise<EnterpriseLicenseMode> => {
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

    return getEnterpriseLicenseMode(response.data as JSONObject, feature);
  } catch {
    return EnterpriseLicenseMode.Unknown;
  }
};
