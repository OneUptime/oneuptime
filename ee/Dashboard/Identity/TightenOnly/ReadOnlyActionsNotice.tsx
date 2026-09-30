import {
  EnterpriseLicenseMode,
  isEnterpriseConfigurationReadOnly,
} from "../License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the SCIM screens say, under the read-only banner, about the one change
 * they still offer without a valid license: resetting a SCIM bearer token. It
 * can only tighten security, so the server allows it without a license (see
 * TightenOnlyUpdates.ts).
 *
 * While the license is lapsed, SCIM requests are already refused; they are
 * accepted again, for every configuration still in place, the moment a
 * license is activated. So the copy says what the reset is for: making sure a
 * leaked token stays shut out when the license returns, without waiting for
 * that license first.
 *
 * Shown only while configuration is read-only. With a valid license, in the
 * grace period, on OneUptime Cloud, or when the license cannot be read, the
 * normal forms offer the reset and this says nothing.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them through the locale entry under the same English key.
 */

export const SCIM_ACTIONS_TITLE: string =
  "You can still reset a SCIM bearer token.";

export const SCIM_ACTIONS_DESCRIPTION: string =
  "Without a valid Enterprise license this configuration is read-only and SCIM requests are refused, but resetting a bearer token is always allowed, because it can only tighten security. SCIM requests are accepted again as soon as a license is activated, so if a token has leaked, use Reset Bearer Token now to replace it, then give the new token to your identity provider.";

export const READ_ONLY_ACTIONS_NOTICE_TEST_ID: string =
  "enterprise-read-only-actions-notice";

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
}

const ReadOnlyActionsNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isEnterpriseConfigurationReadOnly(props.mode)) {
    return <></>;
  }

  return (
    <Alert
      type={AlertType.INFO}
      strongTitle={SCIM_ACTIONS_TITLE}
      title={SCIM_ACTIONS_DESCRIPTION}
      dataTestId={READ_ONLY_ACTIONS_NOTICE_TEST_ID}
      className="mb-5"
    />
  );
};

export default ReadOnlyActionsNotice;
