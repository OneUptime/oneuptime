import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import ScheduledMaintenancePublication from "Common/Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import StatusPageVisibilitySwitchCopy, {
  getStatusPageVisibilitySwitchDescription,
  PRIVATE_EPISODE_VISIBILITY_COPY,
  SCHEDULED_MAINTENANCE_WAITING_TO_PUBLISH_DESCRIPTION,
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
 *
 * A scheduled maintenance event kept to the team until its publish time
 * (#5249) says, switched on, when it shows on its status pages
 * (SCHEDULED_MAINTENANCE_WAITING_TO_PUBLISH_DESCRIPTION).
 */

export interface ComponentProps {
  kind: StatusPageVisibilityKind;
  modelId: ObjectID;
}

const StatusPageVisibilityCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // The episode's privacy, read with the switch.
  const [isPrivate, setIsPrivate] = useState<boolean>(false);
  // Where the switch is now.
  const [isOn, setIsOn] = useState<boolean>(false);
  // The event's publish time, read with the switch: none for most events.
  const [publishAt, setPublishAt] = useState<Date | null>(null);

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
        getDescription={(switchIsOn: boolean): string => {
          // On, but not on its status pages until its publish time.
          if (
            switchIsOn &&
            publishAt &&
            !ScheduledMaintenancePublication.isPublished({
              publishOnStatusPageAt: publishAt,
            })
          ) {
            return translator.translateTemplate(
              SCHEDULED_MAINTENANCE_WAITING_TO_PUBLISH_DESCRIPTION,
              {
                time: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                  publishAt,
                ),
              },
            );
          }

          return getDescription(switchIsOn);
        }}
        select={{ publishOnStatusPageAt: true }}
        onLoaded={(event: ScheduledMaintenance): void => {
          setPublishAt(ScheduledMaintenancePublication.getPublishAt(event));
        }}
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
