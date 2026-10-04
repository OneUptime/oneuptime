import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import ModelSwitchCard from "Common/UI/Components/ModelSwitch/ModelSwitchCard";
import React, { FunctionComponent, ReactElement } from "react";
import MonitorGroupsSwitchCopy, {
  MONITOR_GROUPS_SWITCH_COLUMN,
  MONITOR_GROUPS_SWITCH_TEST_ID,
} from "./MonitorGroupsSwitchCopy";

/*
 * "Feature Flags", on Settings -> Feature Flags: the "Monitor Groups"
 * switch, which saves the moment it is flipped. The menus that show
 * Monitor Groups hear the save through ModelSwitchEvents
 * (Utils/SelectedProjectSwitches), so nothing reloads. See
 * MonitorGroupsSwitchCopy.
 */

export interface ComponentProps {
  projectId: ObjectID;
}

const MonitorGroupsSwitchCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <ModelSwitchCard<Project>
      modelType={Project}
      modelId={props.projectId}
      column={MONITOR_GROUPS_SWITCH_COLUMN}
      cardTitle={MonitorGroupsSwitchCopy.cardTitle}
      cardDescription={MonitorGroupsSwitchCopy.cardDescription}
      title={MonitorGroupsSwitchCopy.switchTitle}
      getDescription={(isOn: boolean): string => {
        return isOn
          ? MonitorGroupsSwitchCopy.switchOnDescription
          : MonitorGroupsSwitchCopy.switchOffDescription;
      }}
      note={MonitorGroupsSwitchCopy.note}
      dataTestId={MONITOR_GROUPS_SWITCH_TEST_ID}
    />
  );
};

export default MonitorGroupsSwitchCard;
