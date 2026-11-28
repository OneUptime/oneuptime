import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import ProjectUtil from "Common/UI/Utils/Project";
import React, { FunctionComponent, ReactElement } from "react";
import { INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY } from "./IncidentDeclaredByHandStartCopy";

/*
 * "Incidents Declared by Hand" on Incidents -> Settings -> Incident State,
 * under the list of states (#11137, IncidentDeclaredByHandStartCopy): one
 * switch, off for every project, that saves its Project column the moment
 * it is flipped. A project owner or admin may flip it; for anyone else it is
 * locked and says why. Each state says what it means for paging.
 */
const IncidentDeclaredByHandStartCard: FunctionComponent = (): ReactElement => {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

  if (!projectId) {
    return <></>;
  }

  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={projectId}
      column={INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.column}
      cardTitle={INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.cardTitle}
      cardDescription={
        INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.cardDescription
      }
      title={INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.switchOnDescription
          : INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.switchOffDescription;
      }}
      dataTestId={INCIDENT_DECLARED_BY_HAND_START_SETTING_COPY.dataTestId}
    />
  );
};

export default IncidentDeclaredByHandStartCard;
