import { ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS } from "Common/Server/Enterprise/EnterpriseLicenseSnapshot";

/*
 * The knobs of the license client, in one place.
 */

/*
 * Whether licenses this build cannot verify offline are accepted: legacy HS256
 * tokens issued before signed licenses existed, and EdDSA tokens signed by a
 * key that is not in TrustedLicenseKeys. Such a license takes its expiry and
 * seat limit from the stored columns (with the same grace period).
 *
 * TRUE at merge, and it has to be: TrustedLicenseKeys ships empty, so every
 * license in the field is unverified until the key ceremony release. Turning
 * this off is a later, announced release; until then the signed license format
 * protects nothing on its own.
 */
export const ACCEPT_UNVERIFIED_LEGACY_LICENSES: boolean = true;

// How long an expired license (or an unlicensed install) keeps working.
export const LICENSE_GRACE_PERIOD_IN_DAYS: number =
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS;

/*
 * How long this process trusts the license INPUTS it read from GlobalConfig
 * (the token and the stored columns). The snapshot itself is recomputed from
 * them on every read, so expiry and grace boundaries are exact; the TTL only
 * bounds how long a license written by another process (a worker's daily
 * report, an activation served by another replica) takes to be seen here.
 */
export const LICENSE_INPUTS_CACHE_TTL_IN_MS: number = 60 * 1000;

/*
 * After a failed read, how long to keep answering from the last good inputs
 * before trying the database again. Keeps a database outage from turning every
 * permission check into another failing query.
 */
export const LICENSE_INPUTS_RETRY_AFTER_FAILURE_IN_MS: number = 5 * 1000;
