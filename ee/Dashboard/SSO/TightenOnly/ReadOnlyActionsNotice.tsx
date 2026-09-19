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
 * server allows them without a license - an administrator must never have to
 * wait for a license to shut out a compromised identity provider or a leaked
 * token (see TightenOnlyUpdates.ts).
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
  "Without a valid Enterprise license this configuration is read-only, but disabling a provider is always allowed, because it can only tighten security. If an identity provider is compromised, use Disable to stop sign-ins through it right away. Turning a provider back on needs a valid license.";

export const SCIM_ACTIONS_TITLE: string =
  "You can still reset a SCIM bearer token.";

export const SCIM_ACTIONS_DESCRIPTION: string =
  "Without a valid Enterprise license this configuration is read-only, but resetting a bearer token is always allowed, because it can only tighten security. If a token has leaked, use Reset Bearer Token to replace it, then give the new token to your identity provider.";

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
