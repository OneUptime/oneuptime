import {
  EnterpriseLicenseMode,
  isEnterpriseConfigurationReadOnly,
} from "../License/EnterpriseLicenseMode";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * What the identity screens say, under the read-only banner, about the one
 * change they still offer without a valid license: disabling a provider, or
 * resetting a SCIM bearer token. Both can only tighten security, so the
 * server allows them without a license (see TightenOnlyUpdates.ts).
 *
 * While the license is lapsed, sign-in through the providers is already off
 * and SCIM requests are already refused; both come back, for everything still
 * enabled, the moment a license is activated. So the copy must not promise
 * that Disable "stops sign-ins right away" - it says what the action is for:
 * making sure a compromised provider or a leaked token stays shut out when the
 * license returns, without waiting for that license first.
 *
 * Shown only while configuration is read-only. With a valid license, in the
 * grace period, on OneUptime Cloud, or when the license cannot be read, the
 * normal forms offer these changes and this says nothing.
 *
 * The strings are plain English, like the rest of these screens. Alert
 * translates them through the locale entry under the same English key.
 */

export enum ReadOnlyActionsKind {
  // SSO (SAML) and OIDC providers, and global providers' project attachments.
  Provider = "provider",
  // SCIM configurations.
  Scim = "scim",
}

export const PROVIDER_ACTIONS_TITLE: string =
  "You can still disable a provider.";

export const PROVIDER_ACTIONS_DESCRIPTION: string =
  "Without a valid Enterprise license this configuration is read-only and sign-in through these providers is off, but disabling a provider is always allowed, because it can only tighten security. Sign-in resumes through every enabled provider as soon as a license is activated, so if an identity provider is compromised, use Disable now to keep it off. Turning a provider back on needs a valid license.";

export const SCIM_ACTIONS_TITLE: string =
  "You can still reset a SCIM bearer token.";

export const SCIM_ACTIONS_DESCRIPTION: string =
  "Without a valid Enterprise license this configuration is read-only and SCIM requests are refused, but resetting a bearer token is always allowed, because it can only tighten security. SCIM requests are accepted again as soon as a license is activated, so if a token has leaked, use Reset Bearer Token now to replace it, then give the new token to your identity provider.";

export const READ_ONLY_ACTIONS_NOTICE_TEST_ID: string =
  "enterprise-read-only-actions-notice";

export interface ComponentProps {
  mode: EnterpriseLicenseMode;
  kind: ReadOnlyActionsKind;
}

const ReadOnlyActionsNotice: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isEnterpriseConfigurationReadOnly(props.mode)) {
    return <></>;
  }

  const isScim: boolean = props.kind === ReadOnlyActionsKind.Scim;

  return (
    <Alert
      type={AlertType.INFO}
      strongTitle={isScim ? SCIM_ACTIONS_TITLE : PROVIDER_ACTIONS_TITLE}
      title={isScim ? SCIM_ACTIONS_DESCRIPTION : PROVIDER_ACTIONS_DESCRIPTION}
      dataTestId={READ_ONLY_ACTIONS_NOTICE_TEST_ID}
      className="mb-5"
    />
  );
};

export default ReadOnlyActionsNotice;
