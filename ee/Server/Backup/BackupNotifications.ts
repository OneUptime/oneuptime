import {
  getAdminDashboardHealthLink,
  NotificationDeliverySummary,
  sendInstanceHealthNotificationToMasterAdmins,
} from "App/FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification";
import BackupSettingService from "Common/Server/Services/BackupSettingService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import logger from "Common/Server/Utils/Logger";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import {
  BackupRunKind,
  BackupRunTrigger,
} from "Common/Types/Backup/BackupRunTypes";
import OneUptimeDate from "Common/Types/Date";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";

/*
 * Telling the master admins when a backup or a restore fails: one email to
 * each (the instance health notifications' sender, with the BackupFailed
 * template, which escapes every value it is given - an error comes from a
 * storage's or ClickHouse's own words). A failed backup is told at most
 * every 12 hours while backups keep failing, so an hourly schedule against
 * a broken bucket is one email, not 24; the next backup that succeeds
 * clears that, so the next failure is told at once. A failed restore is
 * always told.
 */

export const BACKUP_FAILURE_NOTIFICATION_INTERVAL_IN_HOURS: number = 12;

/*
 * Where the email's button opens: Admin Dashboard > Settings > Backups,
 * from the Admin Dashboard's own address (which ends in /admin).
 */
export const BACKUPS_PAGE_ROUTE: string = "/settings/backups";

export function shouldNotifyBackupFailure(data: {
  kind: BackupRunKind;
  lastFailureNotifiedAt: Date | null | undefined;
  now: Date;
}): boolean {
  if (data.kind === BackupRunKind.Restore || !data.lastFailureNotifiedAt) {
    return true;
  }

  return (
    data.now.getTime() - new Date(data.lastFailureNotifiedAt).getTime() >=
    BACKUP_FAILURE_NOTIFICATION_INTERVAL_IN_HOURS * 60 * 60 * 1000
  );
}

function describeTrigger(
  kind: BackupRunKind,
  trigger: BackupRunTrigger,
): string {
  if (kind === BackupRunKind.Restore) {
    return "A restore started from the Admin Dashboard";
  }

  switch (trigger) {
    case BackupRunTrigger.Scheduled:
      return "The scheduled backup";
    case BackupRunTrigger.BeforeRestore:
      return "The backup taken before a restore";
    default:
      return "A backup started from the Admin Dashboard";
  }
}

export default class BackupNotifications {
  public static async notifyFailure(data: {
    kind: BackupRunKind;
    trigger: BackupRunTrigger;
    error: string;
    location?: string | undefined;
    startedAt?: Date | undefined;
    now?: Date | undefined;
  }): Promise<NotificationDeliverySummary | null> {
    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const setting: BackupSetting | null =
      await BackupSettingService.getSetting();

    if (
      !shouldNotifyBackupFailure({
        kind: data.kind,
        lastFailureNotifiedAt: setting?.lastFailureNotifiedAt,
        now,
      })
    ) {
      logger.debug(
        "Backups: a backup failed again; the master admins were told less than 12 hours ago.",
      );
      return null;
    }

    const product: string = ProductBrandingText.getProductName();
    const isRestore: boolean = data.kind === BackupRunKind.Restore;
    const details: Array<{ title: string; text: string }> = [
      { title: "What: ", text: describeTrigger(data.kind, data.trigger) },
    ];

    if (data.startedAt) {
      details.push({
        title: "Started: ",
        text: OneUptimeDate.getDateAsUserFriendlyFormattedString(
          new Date(data.startedAt),
        ),
      });
    }

    if (data.location) {
      details.push({ title: "Where: ", text: data.location });
    }

    details.push({ title: "Why: ", text: data.error });

    const summary: NotificationDeliverySummary =
      await sendInstanceHealthNotificationToMasterAdmins({
        templateType: EmailTemplateType.BackupFailed,
        check: {
          isBreaching: true,
          isCritical: true,
          subject: isRestore
            ? `A restore of your ${product} instance failed`
            : `A backup of your ${product} instance failed`,
          badgeText: isRestore ? "Restore failed" : "Backup failed",
          details,
          remediation: isRestore
            ? "Open Backups in the Admin Dashboard to see the step it stopped on. What the restore had set up was put back, unless the step says otherwise."
            : "Open Backups in the Admin Dashboard to see the step it stopped on and fix what it names. The backups that succeeded before it are kept.",
          breachMessage: data.error,
          resolvedMessage: "",
        },
        healthPageLink: getAdminDashboardHealthLink(BACKUPS_PAGE_ROUTE),
        healthPageButtonText: "Open Backups",
      });

    if (setting?.id && !isRestore) {
      await BackupSettingService.updateOneById({
        id: setting.id,
        data: { lastFailureNotifiedAt: now },
        props: { isRoot: true },
      });
    }

    return summary;
  }

  // The next backup that succeeds: the next failure is told at once.
  public static async clearFailureNotification(): Promise<void> {
    const setting: BackupSetting | null =
      await BackupSettingService.getSetting();

    if (setting?.id && setting.lastFailureNotifiedAt) {
      await BackupSettingService.updateOneById({
        id: setting.id,
        data: { lastFailureNotifiedAt: null as unknown as Date },
        props: { isRoot: true },
      });
    }
  }
}
