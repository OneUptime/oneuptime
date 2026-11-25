import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import IncidentDeclaredByHandStart from "Common/Types/Incident/IncidentDeclaredByHandStart";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * Whether the selected project starts incidents declared by hand
 * acknowledged (Project.startIncidentsDeclaredByHandAcknowledged, Incidents
 * -> Settings -> Incident State, #11137): what Declare Incident says about
 * where the incident starts. The server decides where it does start, from
 * the same rule (IncidentDeclaredByHandStart), so the page only has to say
 * it.
 *
 * Read fresh each time the form opens, so a switch flipped a moment ago -
 * here or by someone else - counts at once. The form waits for it
 * (isLoading), because it latches its fields' words on first render; the
 * read runs alongside the form's other reads, so it adds no wait of its
 * own. A project that cannot be read is off, as every project starts.
 */

export interface IncidentDeclaredByHandStartSwitch {
  isLoading: boolean;
  isSwitchOn: boolean;
}

const readSelectedProjectId: () => ObjectID | null = (): ObjectID | null => {
  try {
    return ProjectUtil.getCurrentProjectId();
  } catch {
    return null;
  }
};

const useIncidentDeclaredByHandStart: () => IncidentDeclaredByHandStartSwitch =
  (): IncidentDeclaredByHandStartSwitch => {
    const [state, setState] = useState<IncidentDeclaredByHandStartSwitch>({
      isLoading: true,
      isSwitchOn: false,
    });

    useEffect(() => {
      let isCurrent: boolean = true;
      const projectId: ObjectID | null = readSelectedProjectId();

      const read: () => Promise<void> = async (): Promise<void> => {
        let project: Project | null = null;

        if (projectId) {
          try {
            project = await ModelAPI.getItem<Project>({
              modelType: Project,
              id: projectId,
              select: {
                _id: true,
                startIncidentsDeclaredByHandAcknowledged: true,
              },
            });
          } catch {
            // Unknown: off, as every project starts.
            project = null;
          }
        }

        if (isCurrent) {
          setState({
            isLoading: false,
            isSwitchOn: IncidentDeclaredByHandStart.isOn(project),
          });
        }
      };

      void read();

      return () => {
        isCurrent = false;
      };
    }, []);

    return state;
  };

export default useIncidentDeclaredByHandStart;
