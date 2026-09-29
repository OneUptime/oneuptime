import {
  DEFAULT_ENTERPRISE_LICENSE_SERVER_URL,
  resolveEnterpriseLicenseServerUrl,
} from "Common/Server/EnvironmentConfig";

const TRAILING_SLASHES: RegExp = /\/+$/;

/*
 * ENTERPRISE_LICENSE_SERVER_URL is resolved in EnvironmentConfig, which cannot
 * log (the logger imports it): an unusable value - not https outside
 * development/test, unparseable - silently falls back to oneuptime.com. The
 * license client says so at boot, because an operator who pointed it at a
 * staging license server would otherwise be activating against production
 * without knowing.
 *
 * Returns the warning, or null when the variable is unset or honoured.
 */
export const describeIgnoredLicenseServerUrl: (data: {
  rawValue: string | undefined;
  allowInsecure: boolean;
}) => string | null = (data: {
  rawValue: string | undefined;
  allowInsecure: boolean;
}): string | null => {
  const requested: string = (data.rawValue || "")
    .trim()
    .replace(TRAILING_SLASHES, "");

  if (!requested) {
    return null;
  }

  const resolved: string = resolveEnterpriseLicenseServerUrl(
    data.rawValue,
    data.allowInsecure,
  );

  if (resolved === requested) {
    return null;
  }

  return (
    `ENTERPRISE_LICENSE_SERVER_URL "${requested}" was ignored: the license server must be an https URL` +
    `${data.allowInsecure ? "" : " (plain http is accepted only in development and test)"}. ` +
    `Licenses are activated against ${DEFAULT_ENTERPRISE_LICENSE_SERVER_URL} instead.`
  );
};
