import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import {
  STATUS_PAGE_REQUIRE_SSO_COLUMN,
  STATUS_PAGE_REQUIRE_SSO_SWITCH_TEST_ID,
  StatusPageRequireSsoCopy,
} from "./StatusPageAccessCopy";

/*
 * "SSO Settings", on a status page's Security -> SSO, under the providers
 * and the link that tests them: one switch, "Require SSO for Login", that
 * saves the moment it is flipped (it was a card whose Edit dialog held one
 * switch, "Force SSO for Login"). Requiring SSO asks first, with a red
 * button: from then on private users who sign in with an email and password
 * are refused (Identity's status page login), and only people the page's
 * SSO or OIDC provider lets in can see it. Turning it off saves at once: it
 * locks nobody out. See StatusPageRequireSsoCopy.
 */

export interface ComponentProps {
  statusPageId: ObjectID;
  /*
   * Drawn under the Scale plan's upsell (StatusPageRequireSsoLeftover), not
   * on the SSO page with its providers and test link: the line about the
   * test link is left out.
   */
  isPlanLeftover?: boolean | undefined;
  // The status page, already read with requireSsoForLogin: no second read.
  initialStatusPage?: StatusPage | undefined;
  // Told whether SSO is required, each time the switch is saved.
  onSaved?: ((isOn: boolean) => void) | undefined;
}

export const getStatusPageRequireSsoConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: StatusPageRequireSsoCopy.confirmTitle,
    description: StatusPageRequireSsoCopy.confirmDescription,
    submitButtonText: StatusPageRequireSsoCopy.confirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const StatusPageRequireSsoCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<StatusPage>
      modelType={StatusPage}
      modelId={props.statusPageId}
      column={STATUS_PAGE_REQUIRE_SSO_COLUMN}
      cardTitle={StatusPageRequireSsoCopy.cardTitle}
      cardDescription={
        props.isPlanLeftover
          ? undefined
          : StatusPageRequireSsoCopy.cardDescription
      }
      title={StatusPageRequireSsoCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? StatusPageRequireSsoCopy.switchOnDescription
          : StatusPageRequireSsoCopy.switchOffDescription;
      }}
      note={StatusPageRequireSsoCopy.note}
      getConfirmation={getStatusPageRequireSsoConfirmation}
      dataTestId={STATUS_PAGE_REQUIRE_SSO_SWITCH_TEST_ID}
      initialItem={props.initialStatusPage}
      onSaved={props.onSaved}
    />
  );
};

export default StatusPageRequireSsoCard;
