import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import { ModelSwitchColumn } from "Common/UI/Components/ModelSwitch/ModelSwitchUtil";
import { MutableRefObject, useEffect, useRef } from "react";
import {
  followSelectedProjectSwitches,
  getProjectWithSwitchedColumn,
} from "./SelectedProjectSwitches";

/*
 * Keeps the dashboard's selected project in step with the switches that
 * save its menu columns (SelectedProjectSwitches): when one is saved for
 * the selected project, onProjectUpdated gets a copy of the project with
 * the new value, for App.tsx to put where the old one was.
 *
 * It listens for as long as the same project is selected. A save for
 * another project, or one that arrives after the selection moved on, is
 * ignored.
 */
const useSelectedProjectSwitches: (data: {
  selectedProject: Project | null;
  onProjectUpdated: (project: Project) => void;
}) => void = (data: {
  selectedProject: Project | null;
  onProjectUpdated: (project: Project) => void;
}): void => {
  // The latest render's project and callback, for a save heard later.
  const latestRef: MutableRefObject<typeof data> = useRef<typeof data>(data);
  latestRef.current = data;

  const projectId: string | undefined = data.selectedProject?._id?.toString();

  useEffect(() => {
    if (!projectId || !ObjectID.isValidUUID(projectId)) {
      return;
    }

    return followSelectedProjectSwitches({
      projectId: new ObjectID(projectId),
      onSaved: (column: ModelSwitchColumn<Project>, value: boolean): void => {
        const current: Project | null = latestRef.current.selectedProject;

        if (!current || current._id?.toString() !== projectId) {
          return;
        }

        const updated: Project = getProjectWithSwitchedColumn({
          project: current,
          column: column,
          value: value,
        });

        // A second save before the next render builds on this one.
        latestRef.current = { ...latestRef.current, selectedProject: updated };

        latestRef.current.onProjectUpdated(updated);
      },
    });
  }, [projectId]);
};

export default useSelectedProjectSwitches;
