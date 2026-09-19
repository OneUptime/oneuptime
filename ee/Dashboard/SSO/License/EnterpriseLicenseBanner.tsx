import { EnterpriseLicenseMode, LicensedFeature } from "./EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the identity screens show above their configuration when the
 * Enterprise license has lapsed, or is about to.
 *
 * The copy says what stops, because that is what an admin has to know: once
 * the trial or the grace period is over, single sign-on stops and "Require
 * SSO" is no longer enforced (members sign in with their password, so nobody
 * is locked out), and the identity provider's SCIM requests are refused - the Community Edition's behaviour - until a license
 * is activated, when everything resumes without a restart. Nothing configured
 * here is deleted. Before the lapse (the Grace mode, which covers both the
 * trial and the grace period) the banner warns about exactly that.
 *
 * A license whose features leave single sign-on or SCIM out stops that one
 * the same way while the license is otherwise fine (NotIncluded). The banner
 * then names the feature the screen is about and says only what stopped for
 * it: the other one may well be running.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them when a locale has an entry under the same English key.
 */

export const READ_ONLY_TITLE: string =
  "Enterprise license required: single sign-on and SCIM are off, and this configuration is read-only.";

export const READ_ONLY_DESCRIPTION: string =
  'Without a valid Enterprise license, single sign-on is off and "Require SSO" is not enforced, so members sign in with their password (anyone who only ever used single sign-on can set one with "Forgot password"). Your identity provider\'s SCIM requests are refused, so it cannot provision or deprovision users until the license is back. Nothing configured here is deleted: activate or renew the Enterprise license in the Admin Dashboard and everything resumes as configured.';

export const GRACE_TITLE: string =
  "No valid Enterprise license: single sign-on and SCIM stop when the trial or grace period ends.";

export const GRACE_DESCRIPTION: string =
  'Everything here works during the 14-day trial or grace period, and you can still change this configuration. When it ends, single sign-on stops, "Require SSO" is no longer enforced (members sign in with their password), your identity provider\'s SCIM requests are refused and this configuration becomes read-only, until an Enterprise license is activated in the Admin Dashboard.';

export const NOT_INCLUDED_SSO_TITLE: string =
  "Your Enterprise license does not include single sign-on: single sign-on is off, and this configuration is read-only.";

export const NOT_INCLUDED_SSO_DESCRIPTION: string =
  'The installed license leaves single sign-on out, so single sign-on is off and "Require SSO" is not enforced: members sign in with their password (anyone who only ever used single sign-on can set one with "Forgot password"). Nothing configured here is deleted: activate a license that includes single sign-on in the Admin Dashboard and everything resumes as configured.';

export const NOT_INCLUDED_SCIM_TITLE: string =
  "Your Enterprise license does not include SCIM: SCIM is off, and this configuration is read-only.";

export const NOT_INCLUDED_SCIM_DESCRIPTION: string =
  "The installed license leaves SCIM provisioning out, so your identity provider's SCIM requests are refused and it cannot provision or deprovision users. Nothing configured here is deleted: activate a license that includes SCIM in the Admin Dashboard and everything resumes as configured.";

// For a screen that did not name its feature (it never gets NotIncluded).
export const NOT_INCLUDED_TITLE: string =
  "Your Enterprise license does not include this feature: it is off, and this configuration is read-only.";

export const NOT_INCLUDED_DESCRIPTION: string =
  "Nothing configured here is deleted: activate a license that includes this feature in the Admin Dashboard and everything resumes as configured.";

export interface NotIncludedCopy {
  title: string;
  description: string;
}

export const getNotIncludedCopy: (
  feature: LicensedFeature | undefined,
) => NotIncludedCopy = (
  feature: LicensedFeature | undefined,
): NotIncludedCopy => {
  if (feature === LicensedFeature.SSO) {
    return {
      title: NOT_INCLUDED_SSO_TITLE,
      description: NOT_INCLUDED_SSO_DESCRIPTION,
    };
  }

  if (feature === LicensedFeature.SCIM) {
    return {
      title: NOT_INCLUDED_SCIM_TITLE,
      description: NOT_INCLUDED_SCIM_DESCRIPTION,
    };
  }

  return { title: NOT_INCLUDED_TITLE, description: NOT_INCLUDED_DESCRIPTION };
};

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
  // The feature the screen is about: single sign-on (SAML and OIDC) or SCIM.
  feature?: LicensedFeature | undefined;
}

const EnterpriseLicenseBanner: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.mode === EnterpriseLicenseMode.ReadOnly) {
    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={READ_ONLY_TITLE}
        title={READ_ONLY_DESCRIPTION}
        dataTestId="enterprise-license-read-only-banner"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.NotIncluded) {
    const copy: NotIncludedCopy = getNotIncludedCopy(props.feature);

    return (
      <Alert
        type={AlertType.DANGER}
        strongTitle={copy.title}
        title={copy.description}
        dataTestId="enterprise-license-not-included-banner"
        className="mb-5"
      />
    );
  }

  if (props.mode === EnterpriseLicenseMode.Grace) {
    return (
      <Alert
        type={AlertType.WARNING}
        strongTitle={GRACE_TITLE}
        title={GRACE_DESCRIPTION}
        dataTestId="enterprise-license-grace-banner"
        className="mb-5"
      />
    );
  }

  return <></>;
};

export default EnterpriseLicenseBanner;
