import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import NewIncidentSubscriberNotificationDefault from "Common/Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * How "Notify Status Page Subscribers" starts on Declare New Incident: as
 * the selected project says (Project.notifyStatusPageSubscribersOfNewIncidentsByDefault,
 * Incidents -> Settings -> Subscriber Notifications).
 *
 * Read fresh each time the form opens, so a switch flipped a moment ago -
 * here or by someone else - counts at once. The form waits for it
 * (isLoading), because it latches where its boxes start on first render;
 * the read runs alongside the form's other reads, so it adds no wait of
 * its own. A project that cannot be read starts the box ticked, as it
 * always started.
 */

export interface NewIncidentNotifyDefault {
  isLoading: boolean;
  isTickedByDefault: boolean;
}

const readSelectedProjectId: () => ObjectID | null = (): ObjectID | null => {
  try {
    return ProjectUtil.getCurrentProjectId();
  } catch {
    return null;
  }
};

const useNewIncidentNotifyDefault: () => NewIncidentNotifyDefault =
  (): NewIncidentNotifyDefault => {
    const [state, setState] = useState<NewIncidentNotifyDefault>({
      isLoading: true,
      isTickedByDefault: true,
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
                notifyStatusPageSubscribersOfNewIncidentsByDefault: true,
              },
            });
          } catch {
            // Unknown: the box starts ticked, as it always did.
            project = null;
          }
        }

        if (isCurrent) {
          setState({
            isLoading: false,
            isTickedByDefault:
              NewIncidentSubscriberNotificationDefault.isTickedByDefault(
                project,
              ),
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

export default useNewIncidentNotifyDefault;
