import DataMigrationBase from "./DataMigrationBase";
import { addSecurityCaseNotificationSettingsForMembers } from "./AddSecurityCaseNotificationSettingsForUsers";

/*
 * Backfills the security case notification setting that came with the
 * Response Plan's own step checks (#10340) - a step of a case I am on stops
 * holding - with email and push on, for every existing project member.
 *
 * The earlier walks ran before this event existed, so a member from then
 * has the older settings and not this one: Notification Settings would show
 * it as off while it is in fact on (SecurityCaseNotifications seeds a
 * person's rows before it tells them anything). The same walk, under a name
 * of its own so it runs once more; idempotent - every setting a member
 * already has is left as it is.
 */
export default class AddSecurityCaseStepRegressedNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddSecurityCaseStepRegressedNotificationSettingsForUsers");
  }

  public override async migrate(): Promise<void> {
    await addSecurityCaseNotificationSettingsForMembers(this.name);
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
