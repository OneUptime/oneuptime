/*
 * The two periods a self-hosted Enterprise Edition install runs without a
 * current license. They are different periods with different lengths, and
 * the product must never call one by the other's name:
 *
 *   trial  an Enterprise install that has never had a license, counted from
 *          GlobalConfig.enterpriseEditionFirstSeenAt
 *   grace  a license that expired (a verified license's signed expiry, or an
 *          unverified legacy license's stored expiry column), counted from
 *          its expiry
 *
 * Until either ends nothing changes; after it, enterprise configuration
 * becomes read-only and SSO, SCIM and audit logging stop
 * (EnterpriseEdition.isFeatureActive) until a license is activated.
 *
 * They live here, with no server dependency, so the copy that states them in
 * the browser (the edition dialog, the enterprise banners) derives the
 * numbers from the same place the license classifier does. Server code reads
 * them through Common/Server/Enterprise/EnterpriseLicenseSnapshot.
 */

// How long an expired license keeps working, counted from its expiry.
export const ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS: number = 30;

/*
 * How long an Enterprise install with no license at all is on trial, counted
 * from GlobalConfig.enterpriseEditionFirstSeenAt.
 */
export const ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS: number = 14;
