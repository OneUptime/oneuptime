import PrivateAccessCopy, {
  REQUIRE_SSO_SWITCH_TEST_ID,
} from "./PrivateAccessCopy";
import { PrivateAccessKind, SignInResourceModel } from "./PrivateAccessKinds";
import ObjectID from "Common/Types/ObjectID";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "SSO Settings", under a public link's single sign-on providers (#10250):
 * one switch, "Require SSO to Sign In", that saves the moment it is
 * flipped, as a status page's does (StatusPageRequireSsoCard). Requiring
 * SSO asks first, with a red button: from then on private users who sign in
 * with an email and password are refused, and every session one of them
 * signed in with ends at its next request. Turning it off saves at once: it
 * locks nobody out.
 */

export interface ComponentProps {
  kind: PrivateAccessKind;
  parentId: ObjectID;
}

// The column of the resource the switch writes.
export type RequireSsoColumn = "requireSsoForLogin";

export const REQUIRE_SSO_COLUMN: RequireSsoColumn = "requireSsoForLogin";

export const getRequireSsoConfirmation: (data: {
  isTurningOn: boolean;
  kind: PrivateAccessKind;
}) => ModelSwitchConfirmation | undefined = (data: {
  isTurningOn: boolean;
  kind: PrivateAccessKind;
}): ModelSwitchConfirmation | undefined => {
  if (!data.isTurningOn) {
    return undefined;
  }

  return {
    title: PrivateAccessCopy.requireSsoConfirmTitle,
    description: data.kind.copy.requireSsoConfirmDescription,
    submitButtonText: PrivateAccessCopy.requireSsoConfirmButton,
    submitButtonType: ButtonStyleType.DANGER,
  };
};

const RequireSsoCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<SignInResourceModel>
      modelType={props.kind.resourceModel}
      modelId={props.parentId}
      column={REQUIRE_SSO_COLUMN}
      cardTitle={PrivateAccessCopy.requireSsoCardTitle}
      title={PrivateAccessCopy.requireSsoSwitchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? PrivateAccessCopy.requireSsoOnDescription
          : PrivateAccessCopy.requireSsoOffDescription;
      }}
      note={props.kind.copy.requireSsoNote}
      getConfirmation={(isTurningOn: boolean) => {
        return getRequireSsoConfirmation({
          isTurningOn,
          kind: props.kind,
        });
      }}
      dataTestId={REQUIRE_SSO_SWITCH_TEST_ID}
    />
  );
};

export default RequireSsoCard;
