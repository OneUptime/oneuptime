import PageComponentProps from "../../PageComponentProps";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import { NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY } from "../../../Components/Incident/NewIncidentNotifyDefaultCopy";

export type ComponentProps = PageComponentProps;

/*
 * Incidents -> Settings -> Subscriber Notifications: whether "Notify Status
 * Page Subscribers" starts ticked when someone declares an incident (#7606,
 * NewIncidentSubscriberNotificationDefault). One switch, on for every
 * project, that saves the moment it is flipped; a project owner or admin
 * may flip it, and for anyone else it is locked and says why. A page of its
 * own, named for what it holds, so someone looking for how subscribers hear
 * about new incidents finds it by name in the menu or the search.
 */
const IncidentSubscriberNotificationsSettings: FunctionComponent<
  ComponentProps
> = (_props: ComponentProps): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={projectId}
      column={NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.column}
      cardTitle={NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardTitle}
      cardDescription={NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.cardDescription}
      title={NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOnDescription
          : NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.switchOffDescription;
      }}
      dataTestId={NEW_INCIDENT_NOTIFY_DEFAULT_SETTING_COPY.dataTestId}
    />
  );
};

export default IncidentSubscriberNotificationsSettings;
