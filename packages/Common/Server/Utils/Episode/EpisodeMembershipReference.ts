import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import ProjectReferenceCheck from "../Database/ProjectReferenceCheck";
import RelationIdUtil from "../Database/RelationIdUtil";

/*
 * An incident's episode (incidentEpisodeId) and an alert's (alertEpisodeId)
 * name the latest episode it is still a member of, or none. Membership is
 * the IncidentEpisodeMember / AlertEpisodeMember rows; the reference only
 * mirrors them. The member services keep it in step, as OneUptime's own
 * writes: adding a member points the record at that episode, and removing
 * one points it at the latest episode the record is still in, or at none
 * (onCreateSuccess / onDeleteSuccess).
 *
 * Written any other way, the reference names an episode the record is not a
 * member of. The episode's overview, which finds its incidents and alerts by
 * this column, lists the record while the episode's members do not; and a
 * record created with it set is never grouped - the grouping engines leave a
 * record that has an episode alone - so no member row is ever made for it.
 *
 * So no project role may write it: the columns' create and update lists are
 * empty, which also keeps them out of the API's write schemas, the Terraform
 * provider, the MCP tools and the workflow builder. That leaves the writes
 * that skip column permissions - a workflow step, which writes as root in
 * its project, and a master admin - and this refuses those as well. Only a
 * write OneUptime makes itself (root, with no project on the request -
 * ProjectReferenceCheck.isServerWrite) may set it. A record joins or leaves
 * an episode through the episode's members, which are checked like any
 * other write.
 */

export interface EpisodeMembershipReferenceColumn {
  // The reference's two names, ID column first (see RelationIdUtil).
  keys: Array<string>;
  // What a refused write is told: how to join or leave an episode instead.
  refusal: string;
}

export const INCIDENT_EPISODE_REFERENCE: EpisodeMembershipReferenceColumn = {
  keys: ["incidentEpisodeId", "incidentEpisode"],
  refusal:
    "incidentEpisodeId cannot be set directly. Add the incident to an episode, or remove it from one, through the episode's members (Incident Episode Member, /incident-episode-member): OneUptime sets the incident's episode from them.",
};

export const ALERT_EPISODE_REFERENCE: EpisodeMembershipReferenceColumn = {
  keys: ["alertEpisodeId", "alertEpisode"],
  refusal:
    "alertEpisodeId cannot be set directly. Add the alert to an episode, or remove it from one, through the episode's members (Alert Episode Member, /alert-episode-member): OneUptime sets the alert's episode from them.",
};

export default class EpisodeMembershipReference {
  /*
   * Refuses a create or update that writes the episode reference, under
   * either name and a clear (null) included, unless OneUptime makes the
   * write itself. Reads nothing: the payload and who sends it decide.
   */
  public static refuseWriteMadeInProject(data: {
    payload: unknown;
    props: DatabaseCommonInteractionProps;
    reference: EpisodeMembershipReferenceColumn;
  }): void {
    if (ProjectReferenceCheck.isServerWrite(data.props)) {
      return;
    }

    if (
      RelationIdUtil.isPresent(
        data.payload as Record<string, unknown> | undefined | null,
        data.reference.keys,
      )
    ) {
      throw new BadDataException(data.reference.refusal);
    }
  }
}
