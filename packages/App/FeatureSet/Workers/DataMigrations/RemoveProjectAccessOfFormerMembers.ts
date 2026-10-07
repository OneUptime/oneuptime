import DataMigrationBase from "./DataMigrationBase";
import { FormerMemberCleanupResult } from "Common/Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import ProjectLeaveAccessCleanup from "Common/Server/Utils/TeamMember/ProjectLeaveAccessCleanup";
import logger from "Common/Server/Utils/Logger";

/*
 * The MCP clients a person connected to a project and their consent to its
 * single sign-on go when they leave it now
 * (TeamMemberService.removeProjectAccessIfUserLeftProject), and neither is
 * honoured for somebody who is not a member when it is used. Before, both
 * stayed behind. This removes the ones people who already left still have,
 * exactly as leaving does today: only for (project, person) pairs with no
 * accepted membership of the project, re-checked just before each removal
 * (ProjectLeaveAccessCleanup.removeProjectAccessOfFormerMembers).
 *
 * Postgres-only. Idempotent, and safe to run twice at once: it only ever
 * removes rows of people who are not members, and nothing of a member is
 * touched. A pair that fails is logged and the rest go on, so one person's
 * rows never halt the chain; failing to read the pairs at all does, like any
 * other migration, and it runs again.
 */
export default class RemoveProjectAccessOfFormerMembers extends DataMigrationBase {
  public constructor() {
    super("RemoveProjectAccessOfFormerMembers");
  }

  public override async migrate(): Promise<void> {
    const result: FormerMemberCleanupResult =
      await ProjectLeaveAccessCleanup.removeProjectAccessOfFormerMembers();

    logger.info(
      `RemoveProjectAccessOfFormerMembers: removed ${result.removedRowCount} connected MCP client and single sign-on consent row(s) of ${result.cleanedPairCount} former project member(s); ${result.failedPairCount} could not be fully removed (logged).`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the rows belonged to people who are no longer in the
     * project. A client is connected again, and SSO confirmed again, by the
     * person themselves.
     */
    return;
  }
}
