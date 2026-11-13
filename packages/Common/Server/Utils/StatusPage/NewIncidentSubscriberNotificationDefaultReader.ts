import Incident from "../../../Models/DatabaseModels/Incident";
import Project from "../../../Models/DatabaseModels/Project";
import ObjectID from "../../../Types/ObjectID";
import NewIncidentSubscriberNotificationDefault from "../../../Types/StatusPage/NewIncidentSubscriberNotificationDefault";
import ProjectService from "../../Services/ProjectService";
import logger from "../Logger";

/*
 * THE SERVER'S SIDE OF "NOTIFY STATUS PAGE SUBSCRIBERS BY DEFAULT" (#7606,
 * Common/Types/StatusPage/NewIncidentSubscriberNotificationDefault).
 *
 * The switch on Incidents -> Settings -> Subscriber Notifications says how
 * the "Notify Status Page Subscribers" box starts on Declare New Incident.
 * People also declare incidents where no box asks: Slack's and Microsoft
 * Teams' Declare Incident forms, and OneUptime AI when someone asks it to
 * (the create_incident tool, which the person approves). There, what the box
 * would have started at is the answer, so an incident declared there follows
 * the switch too: off, it is declared without notifying - the team that
 * turned it off tells subscribers when it is ready, with a public note - and
 * on, it is declared as it always was.
 *
 * Incidents nobody declares by hand - a monitor's, a workflow's, the API's,
 * a public form's, a security playbook's - keep what they send or their own
 * defaults: the switch is about people declaring incidents.
 */
export default class NewIncidentSubscriberNotificationDefaultReader {
  /*
   * Whether the project starts "Notify Status Page Subscribers" ticked. Read
   * as OneUptime: the project's choice decides it, whoever declares. A
   * project that cannot be read keeps the box ticked, as it always started:
   * declaring an incident never waits on, or fails over, this setting, and
   * when the server cannot tell, it does what every project always did.
   */
  public static async isTickedByDefault(projectId: ObjectID): Promise<boolean> {
    try {
      const project: Project | null = await ProjectService.findOneById({
        id: projectId,
        select: {
          notifyStatusPageSubscribersOfNewIncidentsByDefault: true,
        },
        props: {
          isRoot: true,
        },
      });

      return NewIncidentSubscriberNotificationDefault.isTickedByDefault(
        project,
      );
    } catch (err) {
      logger.warn(
        "Could not read whether the project notifies status page subscribers of new incidents by default; the incident notifies them, as before.",
        {
          projectId: projectId.toString(),
        },
      );
      logger.warn(err, { projectId: projectId.toString() });
      return true;
    }
  }

  /*
   * For an incident a person declares where no box asks: in a project that
   * starts the box unticked, it is declared without notifying status page
   * subscribers. In any other project it is left as it is - the incident's
   * own default, which notifies them - so nothing changes there. A private
   * incident is never announced either way (IncidentService).
   */
  public static async applyToIncidentDeclaredWithoutBox(data: {
    incident: Incident;
    projectId: ObjectID;
  }): Promise<void> {
    if (await this.isTickedByDefault(data.projectId)) {
      return;
    }

    data.incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated =
      false;
  }
}
