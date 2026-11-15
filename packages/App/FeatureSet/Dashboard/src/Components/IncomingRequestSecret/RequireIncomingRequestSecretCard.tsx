import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import IncomingRequestSecretsCopy, {
  REQUIRE_INCOMING_REQUEST_SECRET_COLUMN,
  REQUIRE_INCOMING_REQUEST_SECRET_SWITCH_TEST_ID,
} from "./IncomingRequestSecretsCopy";

/*
 * "Require a secret on every request", at the top of Monitors -> Settings ->
 * Incoming Request Secrets: one switch that saves the moment it is flipped
 * (Project.requireIncomingRequestSecret).
 *
 * Turning it on asks first. It can be turned off again, but what happens
 * while it is on cannot be taken back: a sender that does not send a secret
 * yet is refused from that moment, its monitor stops hearing from it, and a
 * heartbeat criteria pages someone. Turning it off asks nothing - nothing is
 * refused that was accepted before. The server refuses turning it on while
 * the project has no secret, and the switch says why and moves back.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

export const getRequireIncomingRequestSecretConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: IncomingRequestSecretsCopy.confirmTurnOnTitle,
    description: IncomingRequestSecretsCopy.confirmTurnOnDescription,
    submitButtonText: IncomingRequestSecretsCopy.confirmTurnOnButton,
  };
};

const RequireIncomingRequestSecretCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={REQUIRE_INCOMING_REQUEST_SECRET_COLUMN}
      cardId="require-a-secret"
      cardTitle={IncomingRequestSecretsCopy.requirementCardTitle}
      cardDescription={IncomingRequestSecretsCopy.requirementCardDescription}
      title={IncomingRequestSecretsCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? IncomingRequestSecretsCopy.switchOnDescription
          : IncomingRequestSecretsCopy.switchOffDescription;
      }}
      note={IncomingRequestSecretsCopy.switchNote}
      getConfirmation={getRequireIncomingRequestSecretConfirmation}
      dataTestId={REQUIRE_INCOMING_REQUEST_SECRET_SWITCH_TEST_ID}
    />
  );
};

export default RequireIncomingRequestSecretCard;
