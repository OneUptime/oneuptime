import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement } from "react";
import GlobalProbesOnNewMonitorsCopy, {
  GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN,
  GLOBAL_PROBES_ON_NEW_MONITORS_SWITCH_TEST_ID,
} from "./GlobalProbesOnNewMonitorsCopy";

/*
 * "Add global probes to new monitors", on Monitors -> Settings -> Probes: one
 * switch that saves the moment it is flipped, on while a new monitor starts
 * with OneUptime's global probes. See GlobalProbesOnNewMonitorsCopy for what
 * it replaced.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

const GlobalProbesOnNewMonitorsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={GLOBAL_PROBES_ON_NEW_MONITORS_COLUMN}
      isInverted={true}
      cardTitle={GlobalProbesOnNewMonitorsCopy.cardTitle}
      cardDescription={GlobalProbesOnNewMonitorsCopy.cardDescription}
      title={GlobalProbesOnNewMonitorsCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? GlobalProbesOnNewMonitorsCopy.switchOnDescription
          : GlobalProbesOnNewMonitorsCopy.switchOffDescription;
      }}
      note={GlobalProbesOnNewMonitorsCopy.note}
      dataTestId={GLOBAL_PROBES_ON_NEW_MONITORS_SWITCH_TEST_ID}
    />
  );
};

export default GlobalProbesOnNewMonitorsCard;
