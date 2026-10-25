import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

import BackupNotifications, {
  BACKUP_FAILURE_NOTIFICATION_INTERVAL_IN_HOURS,
  BACKUPS_PAGE_ROUTE,
  shouldNotifyBackupFailure,
} from "../../../Server/Backup/BackupNotifications";
import * as InstanceHealthNotification from "App/FeatureSet/Workers/Jobs/InstanceHealth/InstanceHealthNotification";
import EnterpriseFeature from "Common/Server/Enterprise/EnterpriseFeature";
import {
  BackupRunKind,
  BackupRunTrigger,
} from "Common/Types/Backup/BackupRunTypes";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  BackupTables,
  silenceLogger,
  useBackupTables,
} from "./Fakes/BackupTestBed";

/*
 * Telling the master admins a backup or a restore failed: one email each,
 * worded for what failed, with the step's reason and a button to the
 * Backups page; a backup that keeps failing is told once every 12 hours,
 * a restore every time, and the next backup that succeeds lets the next
 * failure be told at once.
 */

const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;

describe("shouldNotifyBackupFailure", () => {
  test("a restore that failed is always told", () => {
    expect(
      shouldNotifyBackupFailure({
        kind: BackupRunKind.Restore,
        lastFailureNotifiedAt: new Date(NOW.getTime() - HOUR),
        now: NOW,
      }),
    ).toBe(true);
  });

  test("the first failed backup is told; the next ones within 12 hours are not; after 12 hours again", () => {
    expect(BACKUP_FAILURE_NOTIFICATION_INTERVAL_IN_HOURS).toBe(12);
    expect(
      shouldNotifyBackupFailure({
        kind: BackupRunKind.Backup,
        lastFailureNotifiedAt: null,
        now: NOW,
      }),
    ).toBe(true);
    expect(
      shouldNotifyBackupFailure({
        kind: BackupRunKind.Backup,
        lastFailureNotifiedAt: new Date(NOW.getTime() - 11.9 * HOUR),
        now: NOW,
      }),
    ).toBe(false);
    expect(
      shouldNotifyBackupFailure({
        kind: BackupRunKind.Backup,
        lastFailureNotifiedAt: new Date(NOW.getTime() - 12 * HOUR),
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("BackupNotifications", () => {
  let tables: BackupTables;
  let send: jest.SpiedFunction<
    typeof InstanceHealthNotification.sendInstanceHealthNotificationToMasterAdmins
  >;

  beforeEach(() => {
    silenceLogger();
    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);
    tables = useBackupTables();
    send = jest
      .spyOn(
        InstanceHealthNotification,
        "sendInstanceHealthNotificationToMasterAdmins",
      )
      .mockResolvedValue({ sent: 2, failed: 0 } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  test("a failed backup emails the master admins what, when, where and why, with the Backups page a click away", async () => {
    await BackupNotifications.notifyFailure({
      kind: BackupRunKind.Backup,
      trigger: BackupRunTrigger.Scheduled,
      error:
        "The bucket oneuptime-backups does not exist (HTTP 404, NoSuchBucket). Check the bucket name and the endpoint.",
      location: "s3://oneuptime-backups/prod/20261024T020000Z-3f2a9c1b/",
      startedAt: new Date("2026-10-24T02:00:00.000Z"),
      now: NOW,
    });

    expect(send).toHaveBeenCalledTimes(1);

    const sent: Parameters<
      typeof InstanceHealthNotification.sendInstanceHealthNotificationToMasterAdmins
    >[0] = send.mock.calls[0]![0];

    expect(sent.templateType).toBe(EmailTemplateType.BackupFailed);
    expect(sent.check.subject).toMatch(/^A backup of your .+ instance failed$/);
    expect(sent.check.badgeText).toBe("Backup failed");
    expect(
      sent.check.details.map((detail: { title: string }): string => {
        return detail.title;
      }),
    ).toEqual(["What: ", "Started: ", "Where: ", "Why: "]);
    expect(sent.check.details[0]!.text).toBe("The scheduled backup");
    expect(sent.check.details[3]!.text).toContain("NoSuchBucket");
    expect(sent.healthPageButtonText).toBe("Open Backups");
  });

  test("the button opens Settings > Backups in the Admin Dashboard, not a page under /admin/admin", () => {
    const link: string =
      InstanceHealthNotification.getAdminDashboardHealthLink(
        BACKUPS_PAGE_ROUTE,
      );

    if (link) {
      expect(new URL(link).pathname).toBe("/admin/settings/backups");
    }

    expect(BACKUPS_PAGE_ROUTE).toBe("/settings/backups");
  });

  test("a backup that keeps failing is told once every 12 hours", async () => {
    const failure: Parameters<typeof BackupNotifications.notifyFailure>[0] = {
      kind: BackupRunKind.Backup,
      trigger: BackupRunTrigger.Scheduled,
      error: "ClickHouse could not reach the storage.",
      now: NOW,
    };

    await BackupNotifications.notifyFailure(failure);
    await BackupNotifications.notifyFailure({
      ...failure,
      now: new Date(NOW.getTime() + HOUR),
    });

    expect(send).toHaveBeenCalledTimes(1);
    expect(
      new Date(
        tables.settings.rows[0]!["lastFailureNotifiedAt"] as Date,
      ).toISOString(),
    ).toBe(NOW.toISOString());

    await BackupNotifications.notifyFailure({
      ...failure,
      now: new Date(NOW.getTime() + 12 * HOUR),
    });

    expect(send).toHaveBeenCalledTimes(2);
  });

  test("a backup that succeeds lets the next failure be told at once", async () => {
    await BackupNotifications.notifyFailure({
      kind: BackupRunKind.Backup,
      trigger: BackupRunTrigger.Manual,
      error: "pg_dump failed.",
      now: NOW,
    });

    await BackupNotifications.clearFailureNotification();

    expect(
      tables.settings.rows[0]!["lastFailureNotifiedAt"] ?? null,
    ).toBeNull();

    await BackupNotifications.notifyFailure({
      kind: BackupRunKind.Backup,
      trigger: BackupRunTrigger.Manual,
      error: "pg_dump failed again.",
      now: new Date(NOW.getTime() + HOUR),
    });

    expect(send).toHaveBeenCalledTimes(2);
  });

  test("a restore that failed is told every time, worded as a restore, and leaves the backups' throttle alone", async () => {
    for (let index: number = 0; index < 2; index++) {
      await BackupNotifications.notifyFailure({
        kind: BackupRunKind.Restore,
        trigger: BackupRunTrigger.Manual,
        error: "pg_restore failed: out of memory.",
        now: NOW,
      });
    }

    expect(send).toHaveBeenCalledTimes(2);
    expect(send.mock.calls[0]![0].check.subject).toMatch(
      /^A restore of your .+ instance failed$/,
    );
    expect(send.mock.calls[0]![0].check.badgeText).toBe("Restore failed");
    expect(send.mock.calls[0]![0].check.details[0]!.text).toBe(
      "A restore started from the Admin Dashboard",
    );
    expect(
      tables.settings.rows[0]!["lastFailureNotifiedAt"] ?? null,
    ).toBeNull();
  });

  test.each<[BackupRunTrigger, string]>([
    [BackupRunTrigger.Scheduled, "The scheduled backup"],
    [BackupRunTrigger.Manual, "A backup started from the Admin Dashboard"],
    [BackupRunTrigger.BeforeRestore, "The backup taken before a restore"],
  ])(
    "a %s backup is named for what started it",
    async (trigger: BackupRunTrigger, what: string) => {
      await BackupNotifications.notifyFailure({
        kind: BackupRunKind.Backup,
        trigger,
        error: "failed",
        now: NOW,
      });

      expect(send.mock.calls[0]![0].check.details[0]!.text).toBe(what);
    },
  );
});
