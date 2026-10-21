import DataMigrationBase from "./DataMigrationBase";
import ProjectLeaveNotificationCleanup from "Common/Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import { FormerMemberCleanupResult } from "Common/Server/Utils/TeamMember/ProjectLeaveRows";
import logger from "Common/Server/Utils/Logger";

/*
 * A person's own notification settings for a project - their notification
 * rules, methods (email, SMS, call, WhatsApp, Telegram, push, webhook,
 * Slack, Microsoft Teams), settings, email rollup preference and pending
 * rollup mail, routed call number and shift reminders - are added only by a
 * member of the project now (CreatePermission.checkCreateInMemberProject).
 * Before, somebody signed in who was not a member could add their own to a
 * project too. Nothing was ever delivered through them (every sender asks
 * the membership first, ProjectMembership), and no code is sent for them or
 * checked against them any more (ChannelVerification); this removes them,
 * exactly as leaving the project removes a person's own: only for (project,
 * person) pairs with no accepted membership of the project, re-checked just
 * before each removal (ProjectLeaveNotificationCleanup
 * .removePersonalNotificationSettingsOfFormerMembers, the walk
 * RemoveNotificationSettingsOfFormerMembers ran for the people who had left).
 *
 * Postgres-only. Idempotent, and safe to run twice at once: it only ever
 * removes rows of people who are not members, and nothing of a member is
 * touched. A pair that fails is logged and the rest go on; failing to read
 * the pairs at all stops the chain, like any other migration, and it runs
 * again.
 */
export default class RemoveNotificationSettingsOfNonMembers extends DataMigrationBase {
  public constructor() {
    super("RemoveNotificationSettingsOfNonMembers");
  }

  public override async migrate(): Promise<void> {
    const result: FormerMemberCleanupResult =
      await ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers();

    logger.info(
      `RemoveNotificationSettingsOfNonMembers: removed ${result.removedRowCount} notification setting row(s) of ${result.cleanedPairCount} person(s) who are not members of the project they were in; ${result.failedPairCount} could not be fully removed (logged).`,
    );
  }

  public override async rollback(): Promise<void> {
    /*
     * Nothing to undo: the rows belonged to people who are not in the
     * project, and joining it starts from the defaults.
     */
    return;
  }
}
