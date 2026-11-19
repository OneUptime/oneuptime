import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ModelSwitchRow, {
  ModelSwitchConfirmation,
} from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useState,
} from "react";
import ProjectSavedSignInSettings from "./ProjectSavedSignInSettings";
import ManageSignInWithSsoSwitchCopy, {
  MANAGE_SIGN_IN_WITH_SSO_SWITCH_COLUMN,
  MANAGE_SIGN_IN_WITH_SSO_SWITCH_TEST_ID,
} from "./ManageSignInWithSsoSwitchCopy";
import RequireSsoForLoginSwitchCopy, {
  REQUIRE_SSO_FOR_LOGIN_SWITCH_COLUMN,
  REQUIRE_SSO_FOR_LOGIN_SWITCH_TEST_ID,
} from "./RequireSsoForLoginSwitchCopy";

/*
 * "SSO Settings", on Settings -> SSO: one switch, "Require SSO to Sign In",
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
 *
 * While the project requires SSO, a second switch hangs under the first:
 * Manage Sign-In with SSO (#9763, ManageSignInWithSsoSwitchCopy), which
 * saves on its own column - turning Require SSO on never turns it on. While
 * that one is on too, the project's owners see how many of its people
 * still have a password or a second step saved from before, and can clear
 * them (#9820, ProjectSavedSignInSettings).
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
  /*
   * Whether the SSO page draws its test link above the card: it does once
   * the project has a provider to try (ProjectSignInTestCard). Without it
   * the card leaves out the line pointing at the link. Drawn by default.
   */
  isTestLinkShown?: boolean | undefined;
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
        props.isPlanLeftover || props.isTestLinkShown === false
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
      select={{ [MANAGE_SIGN_IN_WITH_SSO_SWITCH_COLUMN]: true }}
      getDetails={(item: Project, isOn: boolean): ReactNode => {
        /*
         * Whether the project also manages its people's sign-in with SSO
         * (#9763): only while it requires SSO, when the switch decides
         * something. It saves on its own, and keeps its setting while
         * Require SSO is off.
         */
        if (!isOn) {
          return null;
        }

        return (
          <ManageSignInWithSsoDetails
            projectId={props.projectId}
            initialValue={Boolean(item.manageSignInWithSso)}
            isPlanLeftover={props.isPlanLeftover}
          />
        );
      }}
    />
  );
};

/*
 * The Manage Sign-In with SSO switch, and - while it is saved on - what
 * the project's people still have saved from before, for its owners to
 * clear (#9820, ProjectSavedSignInSettings). Not under the plan's upsell,
 * which is there only so what a trial left on can be switched off.
 */
const ManageSignInWithSsoDetails: FunctionComponent<{
  projectId: ObjectID;
  initialValue: boolean;
  isPlanLeftover?: boolean | undefined;
}> = (props: {
  projectId: ObjectID;
  initialValue: boolean;
  isPlanLeftover?: boolean | undefined;
}): ReactElement => {
  const [isManaging, setIsManaging] = useState<boolean>(props.initialValue);

  return (
    <>
      <ModelSwitchRow<Project>
        modelType={Project}
        modelId={props.projectId}
        column={MANAGE_SIGN_IN_WITH_SSO_SWITCH_COLUMN}
        initialValue={props.initialValue}
        title={ManageSignInWithSsoSwitchCopy.switchTitle}
        getDescription={(isOn: boolean): string => {
          return isOn
            ? ManageSignInWithSsoSwitchCopy.switchOnDescription
            : ManageSignInWithSsoSwitchCopy.switchOffDescription;
        }}
        dataTestId={MANAGE_SIGN_IN_WITH_SSO_SWITCH_TEST_ID}
        locksWhenPlanNeeded={props.isPlanLeftover}
        onSaved={(isOn: boolean): void => {
          setIsManaging(isOn);
        }}
      />
      {isManaging && !props.isPlanLeftover ? (
        <ProjectSavedSignInSettings projectId={props.projectId} />
      ) : (
        <></>
      )}
    </>
  );
};

export default RequireSsoForLoginCard;
