import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Asks before a project is moved to another Microsoft 365 organization.
 *
 * A project is connected to one organization, and every Microsoft sign-in
 * for it goes there: an admin of another organization is stopped on
 * Microsoft's own page. Moving it means disconnecting it first, as
 * Uninstall does - OneUptime stops posting to the organization's channels,
 * and every member's Microsoft Teams account and the notification methods
 * set up with one go with it (WorkspaceProjectAuthTokenService) - and then
 * a Microsoft 365 admin of the other organization grants consent, which
 * goes to any organization again. The notification rules and summaries
 * stay.
 */
export const CONNECT_ANOTHER_TEAMS_ORGANIZATION_MENU_ITEM: string =
  translationKey("Connect a Different Organization");

export const CONNECT_ANOTHER_TEAMS_ORGANIZATION_TITLE: string = translationKey(
  "Connect a different Microsoft 365 organization?",
);

export const CONNECT_ANOTHER_TEAMS_ORGANIZATION_WARNING: string =
  translationKey(
    "OneUptime first disconnects this project's Microsoft 365 organization and every member's Microsoft Teams account. Rules and summaries are kept.",
  );

export const CONNECT_ANOTHER_TEAMS_ORGANIZATION_BUTTON: string = translationKey(
  "Disconnect and Continue",
);

export interface ComponentProps {
  isDisconnecting: boolean;
  // Why the last try failed; empty when it did not.
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}

const ConnectAnotherTeamsOrganizationConfirm: FunctionComponent<
  ComponentProps
> = (props: ComponentProps): ReactElement => {
  return (
    <ConfirmModal
      title={CONNECT_ANOTHER_TEAMS_ORGANIZATION_TITLE}
      description={CONNECT_ANOTHER_TEAMS_ORGANIZATION_WARNING}
      submitButtonText={CONNECT_ANOTHER_TEAMS_ORGANIZATION_BUTTON}
      submitButtonType={ButtonStyleType.DANGER}
      isLoading={props.isDisconnecting}
      error={props.error || undefined}
      onClose={props.onClose}
      onSubmit={props.onConfirm}
    />
  );
};

export default ConnectAnotherTeamsOrganizationConfirm;
