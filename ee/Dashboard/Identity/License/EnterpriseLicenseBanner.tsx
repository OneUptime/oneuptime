import { EnterpriseLicenseMode, LicensedFeature } from "./EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import {
  ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS,
  ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS,
} from "Common/Types/EnterpriseLicense/EnterpriseLicensePeriods";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the SCIM screens show above their configuration when the Enterprise
 * license has lapsed, or is about to.
 *
 * The copy says what stops, because that is what an admin has to know: once
 * the trial or the grace period is over, the identity provider's SCIM
 * requests are refused - the Community Edition's behaviour - and this
 * configuration becomes read-only, until a license is activated, when
 * everything resumes without a restart. Nothing configured here is deleted.
 * Before the lapse (the Grace mode, which covers both the trial and the grace
 * period) the banner warns about exactly that. The two are different lengths
 * (ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS for an installation with no
 * license, ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS after a license expires),
 * and the copy names each with its own.
 *
 * A license whose features leave SCIM out stops it the same way while the
 * license is otherwise fine (NotIncluded). The banner then says the license
 * leaves SCIM out, and does not blame a missing or expired license.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them when a locale has an entry under the same English key.
 */

export const READ_ONLY_TITLE: string =
  "Enterprise license required: SCIM is off, and this configuration is read-only.";

export const READ_ONLY_DESCRIPTION: string =
  "Without a valid Enterprise license, your identity provider's SCIM requests are refused, so it cannot provision or deprovision users until the license is back. Nothing configured here is deleted: activate or renew the Enterprise license in the Admin Dashboard and everything resumes as configured.";

export const GRACE_TITLE: string =
  "No valid Enterprise license: SCIM stops when the trial or grace period ends.";

export const GRACE_DESCRIPTION: string = `Everything here works during the ${ENTERPRISE_LICENSE_TRIAL_PERIOD_IN_DAYS}-day trial of an installation with no license, or the ${ENTERPRISE_LICENSE_GRACE_PERIOD_IN_DAYS}-day grace period after a license expires, and you can still change this configuration. When it ends, your identity provider's SCIM requests are refused and this configuration becomes read-only, until an Enterprise license is activated in the Admin Dashboard.`;

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
  // The feature the screen is about (SCIM), for the NotIncluded copy.
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
