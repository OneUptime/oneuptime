import DataMigrationBase from "./DataMigrationBase";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import logger from "Common/Server/Utils/Logger";

/*
 * Accepting an invitation is per project now, not per team: someone who has
 * joined a project is added to its other teams straight away, and accepting
 * one invitation into a project accepts the rest of that project's (see
 * TeamMemberService.onBeforeCreate and acceptPendingInvitationsInProject).
 *
 * Before that, every team a member of the project was added to became an
 * invitation of its own, so members have invitations left over in projects
 * they are already in - still listed under Project Invitations, still asking
 * them to accept a project they joined, and, until they do, those teams'
 * permissions do not apply to them. This accepts exactly those, as adding the
 * person to the team today would have, and refreshes the person's cached
 * permissions. Invitations of people who have not joined the project are
 * left alone: they still have to accept.
 *
 * Idempotent, and safe to run twice at once (see Workers/Utils/DataMigration.ts):
 * an accepted invitation is no longer pending, and the UPDATE only ever
 * touches pending rows.
 */
export default class AcceptPendingTeamInvitationsOfProjectMembers extends DataMigrationBase {
  public constructor() {
    super("AcceptPendingTeamInvitationsOfProjectMembers");
  }

  public override async migrate(): Promise<void> {
    const accepted: number =
      await TeamMemberService.acceptPendingInvitationsOfProjectMembers();

    logger.info(
      `AcceptPendingTeamInvitationsOfProjectMembers: accepted ${accepted} team invitation(s) of people already in the project.`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: these members are in the project, and an accepted
     * membership is what the rule now gives them.
     */
    return;
  }
}
