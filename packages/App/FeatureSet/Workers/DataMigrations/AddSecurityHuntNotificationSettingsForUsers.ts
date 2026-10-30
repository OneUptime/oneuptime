import DataMigrationBase from "./DataMigrationBase";
import { addSecurityCaseNotificationSettingsForMembers } from "./AddSecurityCaseNotificationSettingsForUsers";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";

/*
 * Backfills the notification setting that came with scheduled hunts - a
 * scheduled hunt that names me or my team finds security events - with
 * email and push on, for every existing project member.
 *
 * Defaults are only written when a user joins a project, and Notification
 * Settings shows an event with no row as switched off. SecurityHuntNotifications
 * seeds a person's row itself before it tells them anything, so nobody would
 * miss a hunt without this - but until then, everyone who joined before
 * hunts existed would see it as off while it is in fact on. The members'
 * walk is the security case settings' (addSecurityCaseNotificationSettingsForMembers),
 * here adding the hunt's setting; idempotent - a setting a member already
 * has is left as it is.
 */
export default class AddSecurityHuntNotificationSettingsForUsers extends DataMigrationBase {
  public constructor() {
    super("AddSecurityHuntNotificationSettingsForUsers");
  }

  public override async migrate(): Promise<void> {
    await addSecurityCaseNotificationSettingsForMembers(
      this.name,
      (userId: ObjectID, projectId: ObjectID): Promise<void> => {
        return UserNotificationSettingService.addSecurityHuntNotificationSettings(
          userId,
          projectId,
        );
      },
    );
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
