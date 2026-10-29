import DataMigrationBase from "./DataMigrationBase";
import { addSecurityCaseNotificationSettingsForMembers } from "./AddSecurityCaseNotificationSettingsForUsers";

/*
 * Backfills the two security case notification settings that came with
 * response targets and case tasks - a case I am on about to miss, or
 * missing, a response target; a task on a case assigned to me - with email
 * and push on, for every existing project member.
 *
 * AddSecurityCaseNotificationSettingsForUsers ran before these events
 * existed, so a member from then has the three older settings and not
 * these: Notification Settings would show them as off while they are in
 * fact on (SecurityCaseNotifications seeds a person's rows before it tells
 * them anything). The same walk, under a name of its own so it runs once
 * more; idempotent - every setting a member already has is left as it is.
 */
export default class AddSecurityCaseTargetAndTaskNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddSecurityCaseTargetAndTaskNotificationSettingsForUsers");
  }

  public override async migrate(): Promise<void> {
    await addSecurityCaseNotificationSettingsForMembers(this.name);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
