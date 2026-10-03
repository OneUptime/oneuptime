import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import SessionReplayAllowedSwitchCopy, {
  SESSION_REPLAY_ALLOWED_SWITCH_COLUMN,
  SESSION_REPLAY_ALLOWED_SWITCH_TEST_ID,
} from "./SessionReplayAllowedSwitchCopy";

/*
 * "Session Replay for this Project": the project's master switch for
 * recording end users' screens, which saves the moment it is flipped.
 * Turning recording on asks first; turning it off never does (see
 * SessionReplayAllowedSwitchCopy).
 */

export interface ComponentProps {
  projectId: ObjectID;
}

export const getAllowSessionReplayConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: SessionReplayAllowedSwitchCopy.allowConfirmTitle,
    description: SessionReplayAllowedSwitchCopy.allowConfirmDescription,
    submitButtonText: SessionReplayAllowedSwitchCopy.allowConfirmButton,
  };
};

const SessionReplayAllowedCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={SESSION_REPLAY_ALLOWED_SWITCH_COLUMN}
      cardTitle={SessionReplayAllowedSwitchCopy.cardTitle}
      cardDescription={SessionReplayAllowedSwitchCopy.cardDescription}
      title={SessionReplayAllowedSwitchCopy.switchTitle}
      getDescription={(): string => {
        return SessionReplayAllowedSwitchCopy.switchDescription;
      }}
      getConfirmation={getAllowSessionReplayConfirmation}
      dataTestId={SESSION_REPLAY_ALLOWED_SWITCH_TEST_ID}
    />
  );
};

export default SessionReplayAllowedCard;
