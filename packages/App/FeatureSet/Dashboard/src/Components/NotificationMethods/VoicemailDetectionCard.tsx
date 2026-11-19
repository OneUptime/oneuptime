import {
  VOICEMAIL_DETECTION_COLUMN,
  VOICEMAIL_DETECTION_COPY,
  VOICEMAIL_DETECTION_TEST_ID,
  VOICEMAIL_DETECTION_TITLE,
} from "./VoicemailDetectionWords";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Whether the project's on-call calls tell a voicemail from a person
 * answering (#6594, VoicemailDetectionWords), in Project Settings >
 * Notification Channels' More settings: one switch, saved when flipped.
 *
 * A card of its own module, with a default export, as every card folded under
 * a page's More settings is: the card-in-card guard reads a module's default
 * export to know it draws a whole card (#9464).
 */

export interface VoicemailDetectionCardProps {
  projectId: ObjectID;
  onChange?: ((isOn: boolean) => void) | undefined;
}

const VoicemailDetectionCard: FunctionComponent<VoicemailDetectionCardProps> = (
  props: VoicemailDetectionCardProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={VOICEMAIL_DETECTION_COLUMN}
      cardTitle={VOICEMAIL_DETECTION_TITLE}
      cardDescription={VOICEMAIL_DETECTION_COPY.cardDescription}
      title={VOICEMAIL_DETECTION_COPY.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? VOICEMAIL_DETECTION_COPY.switchOnDescription
          : VOICEMAIL_DETECTION_COPY.switchOffDescription;
      }}
      onChange={props.onChange}
      dataTestId={VOICEMAIL_DETECTION_TEST_ID}
    />
  );
};

export default VoicemailDetectionCard;
