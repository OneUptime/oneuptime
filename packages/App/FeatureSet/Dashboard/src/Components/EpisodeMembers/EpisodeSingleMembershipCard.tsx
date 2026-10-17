import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement } from "react";
import { EpisodeSingleMembershipCopy } from "./EpisodeSingleMembershipCopy";

/*
 * "Episode Membership", on Incidents -> Settings -> Episodes and Alerts ->
 * Settings -> Episodes: the one switch that says an incident (or an alert)
 * can be in only one episode, saved the moment it is flipped. See
 * EpisodeSingleMembershipCopy for its words, and
 * Common/Types/Episode/EpisodeSingleMembership for what it does.
 */

export interface ComponentProps {
  copy: EpisodeSingleMembershipCopy;
  projectId: ObjectID;
}

const EpisodeSingleMembershipCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={props.copy.column}
      cardTitle={props.copy.cardTitle}
      cardDescription={props.copy.cardDescription}
      title={props.copy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? props.copy.switchOnDescription
          : props.copy.switchOffDescription;
      }}
      note={props.copy.note}
      dataTestId={props.copy.dataTestId}
    />
  );
};

export default EpisodeSingleMembershipCard;
