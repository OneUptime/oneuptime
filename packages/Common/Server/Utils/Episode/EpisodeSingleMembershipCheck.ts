import Project from "../../../Models/DatabaseModels/Project";
import { EpisodeSingleMembershipKind } from "../../../Types/Episode/EpisodeSingleMembership";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import ProjectService from "../../Services/ProjectService";

/*
 * The server's side of EpisodeSingleMembership: whether a project allows an
 * incident (or an alert) in only one episode, and the refusal when it does
 * and one is in another episode already.
 *
 * The member services ask it only once they know the record is in some
 * episode (the member rows say so first), so the project is read only when
 * the answer matters - adding a record that is in no episode, the usual
 * case, never reads it.
 */

/*
 * A refusal because the incident (or alert) is in another episode and the
 * project allows one: a BadDataException, so the API answers 400 with its
 * words, that the batch and the grouping engines can tell from any other.
 */
export class RecordInAnotherEpisodeException extends BadDataException {}

export default class EpisodeSingleMembershipCheck {
  /*
   * Whether the project allows an incident (EpisodeSingleMembershipKind
   * INCIDENT_SINGLE_MEMBERSHIP) or an alert (ALERT_SINGLE_MEMBERSHIP) in
   * only one episode. Read as OneUptime: it decides what is refused,
   * whoever asks. A project that cannot be found allows several, as every
   * project did before the switch.
   */
  public static async isOn(data: {
    projectId: ObjectID;
    kind: EpisodeSingleMembershipKind;
  }): Promise<boolean> {
    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: {
        limitIncidentsToOneEpisode: true,
        limitAlertsToOneEpisode: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!project) {
      return false;
    }

    if (data.kind.column === "limitAlertsToOneEpisode") {
      return project.limitAlertsToOneEpisode === true;
    }

    return project.limitIncidentsToOneEpisode === true;
  }
}
