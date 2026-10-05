import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import RequireSsoForLoginSwitchCopy, {
  REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN,
  REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID,
} from "./RequireSsoForLoginSwitchCopy";

/*
 * "SSO Settings", on Settings -> SSO: one switch, "Require SSO for Login",
 * that saves the moment it is flipped. Requiring SSO asks first, with a red
 * button, because it locks everyone who is not signed in with SSO out of
 * the project, whoever flipped it included; turning it off saves at once
 * (see RequireSsoForLoginSwitchCopy).
 *
 * Below the Scale plan the SSO page is the plan's upsell, and the card is
 * drawn under it only while the project still requires SSO
 * (RequireSsoForLoginLeftover), so it can be turned off. `isPlanLeftover`
 * then leaves out the line about the test link, which is not on that page,
 * and locks the switch once it is off, saying the plan: requiring SSO
 * again needs Scale, and its dialog would point at the missing test link.
 */

export interface ComponentProps {
  projectId: ObjectID;
  /*
   * Drawn under the plan's upsell (RequireSsoForLoginLeftover), not on the
   * SSO page with its providers and test link.
   */
  isPlanLeftover?: boolean | undefined;
  // The project, already read with requireSsoForLogin: no second read.
  initialProject?: Project | undefined;
}

export const getRequireSsoForLoginConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: RequireSsoForLoginSwitchCopy.requireConfirmTitle,
    description: RequireSsoForLoginSwitchCopy.requireConfirmDescription,
    submitButtonText: RequireSsoForLoginSwitchCopy.requireConfirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const RequireSsoForLoginCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN}
      cardTitle={RequireSsoForLoginSwitchCopy.cardTitle}
      cardDescription={
        props.isPlanLeftover
          ? undefined
          : RequireSsoForLoginSwitchCopy.cardDescription
      }
      title={RequireSsoForLoginSwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? RequireSsoForLoginSwitchCopy.switchOnDescription
          : RequireSsoForLoginSwitchCopy.switchOffDescription;
      }}
      getConfirmation={getRequireSsoForLoginConfirmation}
      dataTestId={REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID}
      initialItem={props.initialProject}
      locksWhenPlanNeeded={props.isPlanLeftover}
    />
  );
};

export default RequireSsoForLoginCard;
