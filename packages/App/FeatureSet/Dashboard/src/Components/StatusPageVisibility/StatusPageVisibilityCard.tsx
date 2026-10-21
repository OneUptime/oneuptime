import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement, useState } from "react";
import StatusPageVisibilitySwitchCopy, {
  getStatusPageVisibilitySwitchDescription,
  PRIVATE_EPISODE_VISIBILITY_COPY,
  STATUS_PAGE_VISIBILITY_KIND_COPY,
  STATUS_PAGE_VISIBILITY_SWITCH_COLUMN,
  STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID,
  StatusPageVisibilityKind,
} from "./StatusPageVisibilitySwitchCopy";

/*
 * "Status Pages", on an incident episode's or a scheduled maintenance
 * event's Settings page: one switch, "Visible on Status Page", that saves
 * the moment it is flipped. See StatusPageVisibilitySwitchCopy for what it
 * replaced and what hiding one does.
 *
 * A private episode is never shown on a status page: while it is private
 * the switch says so and is locked off (PRIVATE_EPISODE_VISIBILITY_COPY).
 * One stored on from before can still be switched off.
 */

export interface ComponentProps {
  kind: StatusPageVisibilityKind;
  modelId: ObjectID;
}

const StatusPageVisibilityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  // The episode's privacy, read with the switch.
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  // Where the switch is now.
  const [isOn, setIsOn] = useState<boolean>(false);

  const cardDescription: string =
    STATUS_PAGE_VISIBILITY_KIND_COPY[props.kind].cardDescription;

  const getDescription: (isOn: boolean) => string = (isOn: boolean): string => {
    return getStatusPageVisibilitySwitchDescription({
      kind: props.kind,
      isOn,
    });
  };

  if (props.kind === StatusPageVisibilityKind.ScheduledMaintenance) {
    return (
      <ModelSwitchCard<ScheduledMaintenance>
        modelType={ScheduledMaintenance}
        modelId={props.modelId}
        column={STATUS_PAGE_VISIBILITY_SWITCH_COLUMN}
        cardTitle={StatusPageVisibilitySwitchCopy.cardTitle}
        cardDescription={cardDescription}
        title={StatusPageVisibilitySwitchCopy.switchTitle}
        getDescription={getDescription}
        dataTestId={STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID}
      />
    );
  }

  return (
    <ModelSwitchCard<IncidentEpisode>
      modelType={IncidentEpisode}
      modelId={props.modelId}
      column={STATUS_PAGE_VISIBILITY_SWITCH_COLUMN}
      cardTitle={StatusPageVisibilitySwitchCopy.cardTitle}
      cardDescription={cardDescription}
      title={StatusPageVisibilitySwitchCopy.switchTitle}
      getDescription={(switchIsOn: boolean): string => {
        return isPrivate
          ? PRIVATE_EPISODE_VISIBILITY_COPY.description
          : getDescription(switchIsOn);
      }}
      select={{ isPrivate: true }}
      onLoaded={(episode: IncidentEpisode): void => {
        setIsPrivate(episode.isPrivate === true);
      }}
      onChange={(switchIsOn: boolean): void => {
        setIsOn(switchIsOn);
      }}
      lockedReason={
        isPrivate && !isOn
          ? PRIVATE_EPISODE_VISIBILITY_COPY.lockedReason
          : undefined
      }
      dataTestId={STATUS_PAGE_VISIBILITY_SWITCH_TEST_ID}
    />
  );
};

export default StatusPageVisibilityCard;
