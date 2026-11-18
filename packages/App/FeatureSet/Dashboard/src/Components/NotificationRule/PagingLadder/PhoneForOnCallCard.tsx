import {
  PHONE_FOR_ON_CALL_TITLE,
  PROJECT_PAGING_DEFAULTS_COPY,
} from "./ProjectPagingDefaultsWords";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The project's ask for a phone method from everyone on call (#7449), in
 * Project Settings > Notification Channels' More settings, beside the default
 * ladder (DefaultPagingLadderCard): one switch, saved when flipped.
 *
 * A card of its own module, with a default export, as every card folded under
 * a page's More settings is: the card-in-card guard reads a module's default
 * export to know it draws a whole card (#9464).
 */

export interface PhoneForOnCallCardProps {
  projectId: ObjectID;
  onChange?: ((isOn: boolean) => void) | undefined;
}

const PhoneForOnCallCard: FunctionComponent<PhoneForOnCallCardProps> = (
  props: PhoneForOnCallCardProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column="requirePhoneMethodForOnCall"
      cardTitle={PHONE_FOR_ON_CALL_TITLE}
      cardDescription={PROJECT_PAGING_DEFAULTS_COPY.phoneCardDescription}
      title={PROJECT_PAGING_DEFAULTS_COPY.phoneTitle}
      getDescription={(): string => {
        return PROJECT_PAGING_DEFAULTS_COPY.phoneDescription;
      }}
      onChange={props.onChange}
      dataTestId="phone-for-on-call"
    />
  );
};

export default PhoneForOnCallCard;
