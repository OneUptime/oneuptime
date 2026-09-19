import { EnterpriseLicenseMode } from "./EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the identity screens show above their configuration when the
 * Enterprise license does not allow (or will soon stop allowing) changes.
 *
 * The copy says what keeps working, because that is the question an admin
 * has at this point: SSO sign-in and SCIM provisioning never stop because of
 * the license, only changes to the configuration do.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them when a locale has an entry under the same English key.
 */

export const READ_ONLY_TITLE: string =
  "Enterprise license required: this configuration is read-only.";

export const READ_ONLY_DESCRIPTION: string =
  "Single sign-on and SCIM keep working as configured: members can still sign in, and your identity provider can still provision and deprovision users. To add or change providers, activate or renew the Enterprise license in the Admin Dashboard.";

export const GRACE_TITLE: string = "Enterprise license grace period.";

export const GRACE_DESCRIPTION: string =
  "This installation does not have a valid Enterprise license. You can still change this configuration during the grace period; after it ends the configuration becomes read-only. Single sign-on and SCIM keep working either way.";

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
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
