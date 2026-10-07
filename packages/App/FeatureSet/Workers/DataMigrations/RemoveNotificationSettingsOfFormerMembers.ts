import DataMigrationBase from "./DataMigrationBase";
import ProjectLeaveNotificationCleanup, {
  FormerMemberCleanupResult,
} from "Common/Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import logger from "Common/Server/Utils/Logger";

/*
 * A person's own notification settings for a project - their notification
 * rules, methods (email, SMS, call, WhatsApp, Telegram, push, webhook, Slack,
 * Microsoft Teams), settings, email rollup preference and pending rollup
 * mail, routed call number and shift reminders - are removed when they
 * leave it now
 * (TeamMemberService.removePersonalNotificationSettingsIfUserLeftProject).
 * Before, they stayed behind. This removes the ones people who already left
 * still have, exactly as leaving does today: only for (project, person) pairs
 * with no accepted membership of the project, re-checked just before each
 * removal (ProjectLeaveNotificationCleanup
 * .removePersonalNotificationSettingsOfFormerMembers).
 *
 * Postgres-only. Idempotent, and safe to run twice at once: it only ever
 * removes rows of people who are not members, and nothing of a member is
 * touched. A pair that fails is logged and the rest go on, so one person's
 * rows never halt the chain; failing to read the pairs at all does, like any
 * other migration, and it runs again.
 */
export default class RemoveNotificationSettingsOfFormerMembers extends DataMigrationBase {
  public constructor() {
    super("RemoveNotificationSettingsOfFormerMembers");
  }

  public override async migrate(): Promise<void> {
    const result: FormerMemberCleanupResult =
      await ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers();

    logger.info(
      `RemoveNotificationSettingsOfFormerMembers: removed ${result.removedRowCount} notification setting row(s) of ${result.cleanedPairCount} former project member(s); ${result.failedPairCount} could not be fully removed (logged).`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the rows belonged to people who are no longer in the
     * project, and joining again starts from the defaults.
     */
    return;
  }
}
