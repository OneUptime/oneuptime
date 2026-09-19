import { BILLING_ENABLED, IS_ENTERPRISE_EDITION } from "Common/UI/Config";

/*
 * Whether this server offers single sign-on at all. SSO login is part of the
 * OneUptime Enterprise Edition, which the cloud (billing on) also runs.
 * IS_ENTERPRISE_EDITION in env.js is the EFFECTIVE edition - true only when
 * the enterprise code is actually loaded - so a Community Edition server never
 * offers an SSO flow whose routes it does not serve.
 *
 * Read at call time, never at module load, so the page always reflects the
 * env.js it was served with.
 */
export const isSsoLoginOffered: () => boolean = (): boolean => {
  return IS_ENTERPRISE_EDITION || BILLING_ENABLED;
};

/*
 * The answers an SSO lookup gets from a server that has no SSO login: 404
 * when the Community Edition does not serve the route at all, 402 when the
 * Enterprise Edition's license has lapsed or does not include SSO (SSO is
 * then off until a license is activated). isSsoLoginOffered() is true on the
 * latter, so the SSO page can still be reached there, and what it says must
 * fit both. Anything else (400 "no SSO config for this email", 5xx) is a real
 * answer from a server that does offer SSO.
 */
export const isSsoUnavailableStatusCode: (statusCode: number) => boolean = (
  statusCode: number,
): boolean => {
  return statusCode === 404 || statusCode === 402;
};
