import Project from "Common/Models/DatabaseModels/Project";
import ObjectID from "Common/Types/ObjectID";
import IncidentDeclaredByHandStart from "Common/Types/Incident/IncidentDeclaredByHandStart";
import NewIncidentSubscriberNotificationDefault from "Common/Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { useEffect, useState } from "react";

/*
 * WHAT THE SELECTED PROJECT SAYS ABOUT AN INCIDENT SOMEONE DECLARES, AS
 * DECLARE INCIDENT OPENS - one read of the project, for both of its
 * declare defaults:
 *
 *   - how "Notify Status Page Subscribers" starts
 *     (Project.notifyStatusPageSubscribersOfNewIncidentsByDefault, Incidents
 *     -> Settings -> Subscriber Notifications, #7606): ticked unless the
 *     project turned that off;
 *   - whether an incident declared by hand starts acknowledged when no
 *     state is picked and no on-call policy pages
 *     (Project.startIncidentsDeclaredByHandAcknowledged, Incidents ->
 *     Settings -> Incident State, #11137): what the form says about where
 *     the incident starts. The server decides where it does start, from the
 *     same rule (IncidentDeclaredByHandStart).
 *
 * Read fresh each time the form opens, so a switch flipped a moment ago -
 * here or by someone else - counts at once. The form waits for it
 * (isLoading), because it latches where its boxes start and its fields'
 * words on first render; the read runs alongside the form's other reads, so
 * it adds no wait of its own. A project that cannot be read keeps what every
 * project starts with: the box ticked, and incidents starting where they
 * always did.
 */

export interface DeclareIncidentDefaults {
  isLoading: boolean;
  // "Notify Status Page Subscribers" starts ticked.
  isNotifyTickedByDefault: boolean;
  // An incident declared by hand that pages no one starts acknowledged.
  isDeclaredByHandAcknowledged: boolean;
}

const readSelectedProjectId: () => ObjectID | null = (): ObjectID | null => {
  try {
    return ProjectUtil.getCurrentProjectId();
  } catch {
    return null;
  }
};

const useDeclareIncidentDefaults: () => DeclareIncidentDefaults =
  (): DeclareIncidentDefaults => {
    const [state, setState] = useState<DeclareIncidentDefaults>({
      isLoading: true,
      isNotifyTickedByDefault: true,
      isDeclaredByHandAcknowledged: false,
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
                startIncidentsDeclaredByHandAcknowledged: true,
              },
            });
          } catch {
            // Unknown: what every project starts with.
            project = null;
          }
        }

        if (isCurrent) {
          setState({
            isLoading: false,
            isNotifyTickedByDefault:
              NewIncidentSubscriberNotificationDefault.isTickedByDefault(
                project,
              ),
            isDeclaredByHandAcknowledged:
              IncidentDeclaredByHandStart.isOn(project),
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

export default useDeclareIncidentDefaults;
