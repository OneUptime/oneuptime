import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { ModelSwitchConfirmation } from "Common/UI/Components/ModelSwitch/ModelSwitchRow";
import React, { FunctionComponent, ReactElement } from "react";
import CallRecordingSwitchCopy, {
  CALL_RECORDING_SWITCH_COLUMN,
  CALL_RECORDING_SWITCH_TEST_ID,
} from "./CallRecordingSwitchCopy";

/*
 * "Call transcripts" on the Video Calls page: the project's switch for
 * recording and transcribing incident calls, which saves the moment it is
 * flipped. Turning it on asks first; turning it off never does (see
 * CallRecordingSwitchCopy).
 */

export interface ComponentProps {
  projectId: ObjectID;
}

export const getRecordIncidentCallsConfirmation: (
  isTurningOn: boolean,
) => ModelSwitchConfirmation | undefined = (
  isTurningOn: boolean,
): ModelSwitchConfirmation | undefined => {
  if (!isTurningOn) {
    return undefined;
  }

  return {
    title: CallRecordingSwitchCopy.turnOnConfirmTitle,
    description: CallRecordingSwitchCopy.turnOnConfirmDescription,
    submitButtonText: CallRecordingSwitchCopy.turnOnConfirmButton,
  };
};

const CallRecordingSwitchCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={CALL_RECORDING_SWITCH_COLUMN}
      cardTitle={CallRecordingSwitchCopy.cardTitle}
      cardDescription={CallRecordingSwitchCopy.cardDescription}
      title={CallRecordingSwitchCopy.switchTitle}
      getDescription={(): string => {
        return CallRecordingSwitchCopy.switchDescription;
      }}
      note={CallRecordingSwitchCopy.switchNote}
      getConfirmation={getRecordIncidentCallsConfirmation}
      dataTestId={CALL_RECORDING_SWITCH_TEST_ID}
    />
  );
};

export default CallRecordingSwitchCard;
