import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { subscribeToModelSwitchSaved } from "Common/UI/Components/ModelSwitch/ModelSwitchEvents";
import { ModelSwitchColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import { MONITOR_GROUPS_SWITCH_COLUMN } from "../Components/MonitorGroup/MonitorGroupsSwitchCopy";

/*
 * The project the dashboard has selected is read once, from the project
 * list (ProjectAPI's list-user-projects), and kept: App.tsx hands it to
 * every page, and ProjectUtil keeps a copy for code outside the pages.
 * Some of its columns decide what the menus show - Monitor Groups decides
 * whether the Monitors menu has a Monitor Groups page, and whether a status
 * page's menu reads "Resources" or "Monitors".
 *
 * Such a column is saved by a switch that saves the moment it is flipped
 * (Settings -> Feature Flags), with no reload. So the dashboard listens for
 * the switch's save (ModelSwitchEvents) and swaps in a copy of the project
 * that has the new value: the menus follow at once. Before, the card's Edit
 * dialog reloaded the whole dashboard after saving.
 */

// The selected project's columns that a switch saves and the menus read.
export const SELECTED_PROJECT_SWITCH_COLUMNS: ReadonlyArray<
  ModelSwitchColumn<Project>
> = [MONITOR_GROUPS_SWITCH_COLUMN];

/*
 * A copy of the project with the column set: a new object, so React sees a
 * change, with every other column the project had.
 */
export const getProjectWithSwitchedColumn: (data: {
  project: Project;
  column: ModelSwitchColumn<Project>;
  value: boolean;
}) => Project = (data: {
  project: Project;
  column: ModelSwitchColumn<Project>;
  value: boolean;
}): Project => {
  const copy: Project = BaseModel.fromJSON(
    BaseModel.toJSON(data.project, Project),
    Project,
  ) as Project;

  copy.setColumnValue(data.column, data.value);

  return copy;
};

/*
 * Calls onSaved with the column and the value it now stores, whenever a
 * switch saves one of SELECTED_PROJECT_SWITCH_COLUMNS for this project.
 * Returns the unsubscribe.
 */
export const followSelectedProjectSwitches: (data: {
  projectId: ObjectID;
  onSaved: (column: ModelSwitchColumn<Project>, value: boolean) => void;
}) => () => void = (data: {
  projectId: ObjectID;
  onSaved: (column: ModelSwitchColumn<Project>, value: boolean) => void;
}): (() => void) => {
  const unsubscribes: Array<() => void> = SELECTED_PROJECT_SWITCH_COLUMNS.map(
    (column: ModelSwitchColumn<Project>): (() => void) => {
      return subscribeToModelSwitchSaved({
        modelType: Project,
        modelId: data.projectId,
        column: column,
        onSaved: (value: boolean): void => {
          data.onSaved(column, value);
        },
      });
    },
  );

  return (): void => {
    for (const unsubscribe of unsubscribes) {
      unsubscribe();
    }
  };
};
