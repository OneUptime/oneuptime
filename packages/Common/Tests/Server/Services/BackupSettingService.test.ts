import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import BackupSetting from "../../../Models/DatabaseModels/BackupSetting";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import BackupSettingService, {
  BACKUP_SETTING_BOOKKEEPING_MESSAGE,
  BACKUP_SETTING_EXISTS_MESSAGE,
  BACKUP_SETTING_REFUSED_MESSAGE,
  Service as BackupSettingServiceClass,
} from "../../../Server/Services/BackupSettingService";
import { BackupDestinationSettings } from "../../../Server/Utils/Backup/BackupSettings";
import logger from "../../../Server/Utils/Logger";
import BackupDestinationType from "../../../Types/Backup/BackupDestinationType";
import { BackupProvider } from "../../../Types/Backup/BackupDestinationCatalog";
import { BackupFrequency } from "../../../Types/Backup/BackupSchedule";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  installFakeEnterpriseModuleWithFeatures,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { getJestSpyOn } from "../../Spy";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { startEachTestOnSelfHostedEgressPolicy } from "../Utils/EgressPolicyEnvironment";

/*
 * The instance's backup settings, saved through the whole write as the
 * people who save them: only a master admin may, once (one row), with a
 * destination and a schedule a backup can run with; the credentials are
 * encrypted, never read back - not even by a master admin - and kept by an
 * edit that leaves them blank; and the next backup moves with the schedule.
 *
 * Self-hosted with the Enterprise Edition and a license that includes
 * backups, unless a test says otherwise.
 */

jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const SETTING_ID: string = "7ba7b821-9dad-41d1-80b4-00c04fd43101";
const PROJECT_ID: ObjectID = new ObjectID(
  "7ba7b822-9dad-41d1-80b4-00c04fd43101",
);
// A Saturday, at noon UTC.
const NOW: Date = new Date("2026-10-24T12:00:00.000Z");
const SECRET: string = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY";
const OLD_SECRET: string = "oldSecretOldSecretOldSecretOldSecret0000";

const MASTER_ADMIN: DatabaseCommonInteractionProps = {
  ...ON_HIGHEST_PLAN,
  userId: ObjectID.generate(),
  userType: UserType.MasterAdmin,
  isMasterAdmin: true,
} as unknown as DatabaseCommonInteractionProps;

const PROJECT_OWNER: DatabaseCommonInteractionProps = {
  ...ON_HIGHEST_PLAN,
  tenantId: PROJECT_ID,
  userId: ObjectID.generate(),
  userType: UserType.User,
  userTenantAccessPermission: {
    [PROJECT_ID.toString()]: {
      _type: "UserTenantAccessPermission",
      projectId: PROJECT_ID,
      permissions: [
        {
          _type: "UserPermission",
          permission: Permission.ProjectOwner,
          labelIds: [],
          isBlockPermission: false,
        } as UserPermission,
      ],
    },
  },
} as unknown as DatabaseCommonInteractionProps;

const SIGNED_IN_USER: DatabaseCommonInteractionProps = {
  ...ON_HIGHEST_PLAN,
  userId: ObjectID.generate(),
  userType: UserType.User,
} as unknown as DatabaseCommonInteractionProps;

function newS3Setting(overrides: Record<string, unknown> = {}): BackupSetting {
  const setting: BackupSetting = new BackupSetting();
  setting.destinationType = BackupDestinationType.AmazonS3;
  setting.destinationProvider = BackupProvider.AmazonS3;
  setting.config = {
    bucket: "acme-backups",
    region: "eu-west-1",
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  };
  setting.secrets = JSON.stringify({ secretAccessKey: SECRET });
  Object.assign(setting, overrides);
  return setting;
}

describe("BackupSettingService, through the whole write", () => {
  let settings: InMemoryTable;

  startEachTestOnSelfHostedEgressPolicy();

  beforeEach(() => {
    for (const silenced of ["debug", "info", "warn", "error"]) {
      getJestSpyOn(logger, silenced).mockImplementation((): void => {
        return undefined;
      });
    }

    setTestBillingEnabled(false);
    installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.Backups]);
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    settings = useInMemoryTable(BackupSettingService, []);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    uninstallEnterpriseModule();
  });

  function inserted(): StoredRow {
    const row: StoredRow | undefined =
      settings.inserts[settings.inserts.length - 1];

    if (!row) {
      throw new Error("Nothing was inserted.");
    }

    return row;
  }

  function lastUpdate(): StoredRow {
    const update: { id: string; set: StoredRow } | undefined =
      settings.updates[settings.updates.length - 1];

    if (!update) {
      throw new Error("Nothing was updated.");
    }

    return update.set;
  }

  function seedSetting(overrides: StoredRow = {}): void {
    settings.rows.push({
      _id: SETTING_ID,
      destinationType: BackupDestinationType.AmazonS3,
      destinationProvider: BackupProvider.AmazonS3,
      config: {
        bucket: "acme-backups",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      },
      secrets: JSON.stringify({ secretAccessKey: OLD_SECRET }),
      isEnabled: true,
      frequency: BackupFrequency.Daily,
      timeOfDay: "02:00",
      dayOfWeek: 0,
      retentionInDays: 30,
      includesClickhouse: true,
      nextBackupAt: new Date("2026-10-25T02:00:00.000Z"),
      version: 1,
      ...overrides,
    });
  }

  async function update(
    data: JSONObject,
    props: DatabaseCommonInteractionProps = MASTER_ADMIN,
  ): Promise<void> {
    await BackupSettingService.updateOneById({
      id: new ObjectID(SETTING_ID),
      data: data as never,
      props,
    });
  }

  describe("setting backups up", () => {
    test("a master admin sets them up: on, ClickHouse in, every day at 02:00 UTC for 30 days, the first one tonight, the key never in clear", async () => {
      await BackupSettingService.create({
        data: newS3Setting(),
        props: MASTER_ADMIN,
      });

      const row: StoredRow = inserted();

      expect(row["destinationType"]).toBe("s3");
      expect(row["destinationProvider"]).toBe("amazon-s3");
      expect(row["config"]).toEqual({
        bucket: "acme-backups",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      });
      expect(row["isEnabled"]).toBe(true);
      expect(row["includesClickhouse"]).toBe(true);
      expect(row["frequency"]).toBe("daily");
      expect(row["timeOfDay"]).toBe("02:00");
      expect(row["dayOfWeek"]).toBe(0);
      expect(row["retentionInDays"]).toBe(30);
      expect(new Date(row["nextBackupAt"] as Date).toISOString()).toBe(
        "2026-10-25T02:00:00.000Z",
      );
      expect(String(row["secrets"])).not.toContain(SECRET);
      expect(String(row["secrets"])).not.toContain("secretAccessKey");
    });

    test("keeps the schedule it is given, written the way it is stored", async () => {
      await BackupSettingService.create({
        data: newS3Setting({
          frequency: BackupFrequency.Weekly,
          timeOfDay: "3:30",
          dayOfWeek: 3,
          retentionInDays: 90,
          includesClickhouse: false,
        }),
        props: MASTER_ADMIN,
      });

      const row: StoredRow = inserted();

      expect(row["frequency"]).toBe("weekly");
      expect(row["timeOfDay"]).toBe("03:30");
      expect(row["dayOfWeek"]).toBe(3);
      expect(row["retentionInDays"]).toBe(90);
      expect(row["includesClickhouse"]).toBe(false);
      // Wednesday after Saturday 2026-10-24.
      expect(new Date(row["nextBackupAt"] as Date).toISOString()).toBe(
        "2026-10-28T03:30:00.000Z",
      );
    });

    test.each([
      ["a project owner", PROJECT_OWNER],
      ["a signed-in user", SIGNED_IN_USER],
    ])(
      "%s cannot set them up",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        await expect(
          BackupSettingService.create({ data: newS3Setting(), props }),
        ).rejects.toThrow();
        expect(settings.inserts).toHaveLength(0);
      },
    );

    test("a project owner is refused as not allowed, before any of the settings is read", async () => {
      await expect(
        BackupSettingService.create({
          data: newS3Setting(),
          props: PROJECT_OWNER,
        }),
      ).rejects.toBeInstanceOf(NotAuthorizedException);
    });

    test("the service itself refuses anyone but a master admin, whatever the other checks say", async () => {
      const service: {
        onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        onCreatePermitted: (onCreate: unknown) => Promise<void>;
        onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
      } = BackupSettingService as unknown as {
        onBeforeCreate: (createBy: unknown) => Promise<unknown>;
        onCreatePermitted: (onCreate: unknown) => Promise<void>;
        onBeforeUpdate: (updateBy: unknown) => Promise<unknown>;
      };

      for (const props of [PROJECT_OWNER, SIGNED_IN_USER]) {
        await expect(
          service.onBeforeCreate({ data: newS3Setting(), props }),
        ).rejects.toThrow(BACKUP_SETTING_REFUSED_MESSAGE);
        await expect(
          service.onCreatePermitted({
            createBy: { data: newS3Setting(), props },
            carryForward: null,
          }),
        ).rejects.toThrow(BACKUP_SETTING_REFUSED_MESSAGE);
        await expect(
          service.onBeforeUpdate({
            query: { _id: SETTING_ID },
            data: { retentionInDays: 7 },
            props,
          }),
        ).rejects.toThrow(BACKUP_SETTING_REFUSED_MESSAGE);
      }

      await expect(
        service.onCreatePermitted({
          createBy: { data: newS3Setting(), props: MASTER_ADMIN },
          carryForward: null,
        }),
      ).resolves.toBeUndefined();
    });

    test("there is one setting for the instance: a second is refused", async () => {
      seedSetting();

      await expect(
        BackupSettingService.create({
          data: newS3Setting(),
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow(BACKUP_SETTING_EXISTS_MESSAGE);
      expect(settings.inserts).toHaveLength(0);
    });

    test.each<[string, Record<string, unknown>, string]>([
      [
        "a retention of no days",
        { retentionInDays: 0 },
        "Keep backups for must be a whole number of days from 1 to 3650.",
      ],
      [
        "a retention past ten years",
        { retentionInDays: 3651 },
        "Keep backups for must be a whole number of days from 1 to 3650.",
      ],
      [
        "a retention in parts of a day",
        { retentionInDays: 1.5 },
        "Keep backups for must be a whole number of days from 1 to 3650.",
      ],
      [
        "a time that is not one",
        { timeOfDay: "25:00" },
        "Time must be a time of day as HH:MM, from 00:00 to 23:59 (UTC).",
      ],
      [
        "a frequency it does not know",
        { frequency: "monthly" },
        "Frequency must be one of: every-hour, every-6-hours, every-12-hours, daily or weekly.",
      ],
      [
        "a day that is not one",
        { frequency: BackupFrequency.Weekly, dayOfWeek: 7 },
        "Day must be a day of the week, from 0 (Sunday) to 6 (Saturday).",
      ],
    ])(
      "refuses %s, saying what it takes",
      async (
        _case: string,
        overrides: Record<string, unknown>,
        message: string,
      ) => {
        await expect(
          BackupSettingService.create({
            data: newS3Setting(overrides),
            props: MASTER_ADMIN,
          }),
        ).rejects.toThrow(message);
        expect(settings.inserts).toHaveLength(0);
      },
    );

    test("refuses a destination a backup could not use, naming the field", async () => {
      await expect(
        BackupSettingService.create({
          data: newS3Setting({
            config: {
              bucket: "Acme_Backups",
              region: "eu-west-1",
              accessKeyId: "AKIAEXAMPLE",
            },
          }),
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow("Bucket must be an S3 bucket name");
    });

    test("refuses settings without the credential they need", async () => {
      await expect(
        BackupSettingService.create({
          data: newS3Setting({ secrets: JSON.stringify({}) }),
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow("Secret access key");
    });

    test("refuses an S3-compatible endpoint the egress policy blocks", async () => {
      await expect(
        BackupSettingService.create({
          data: newS3Setting({
            destinationType: BackupDestinationType.S3Compatible,
            destinationProvider: BackupProvider.MinIO,
            config: {
              endpoint: "http://169.254.169.254",
              bucket: "oneuptime-backups",
              accessKeyId: "minio",
            },
          }),
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow();
      expect(settings.inserts).toHaveLength(0);
    });

    test.each(["nextBackupAt", "lastFailureNotifiedAt"])(
      "the scheduler's %s is OneUptime's to write",
      async (column: string) => {
        await expect(
          BackupSettingService.create({
            data: newS3Setting({ [column]: new Date("2026-10-24T13:00:00Z") }),
            props: MASTER_ADMIN,
          }),
        ).rejects.toThrow(BACKUP_SETTING_BOOKKEEPING_MESSAGE);
      },
    );

    test("needs a license that includes backups", async () => {
      installFakeEnterpriseModuleWithFeatures([EnterpriseFeature.AuditLogs]);

      await expect(
        BackupSettingService.create({
          data: newS3Setting(),
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow();
      expect(settings.inserts).toHaveLength(0);
    });

    test("needs the Enterprise Edition: the Community Edition has no backups", async () => {
      uninstallEnterpriseModule();

      await expect(
        BackupSettingService.create({
          data: newS3Setting(),
          props: MASTER_ADMIN,
        }),
      ).rejects.toThrow();
      expect(settings.inserts).toHaveLength(0);
    });
  });

  describe("changing them", () => {
    beforeEach(() => {
      seedSetting();
    });

    test("a blank credential keeps the stored one", async () => {
      await update({
        config: {
          bucket: "acme-backups-2",
          region: "eu-west-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        },
        secrets: JSON.stringify({ secretAccessKey: "" }),
      });

      const stored: BackupDestinationSettings =
        await BackupSettingService.getDestinationSettings(
          new ObjectID(SETTING_ID),
        );

      expect(stored.config["bucket"]).toBe("acme-backups-2");
      expect(stored.secrets).toEqual({ secretAccessKey: OLD_SECRET });
    });

    test("a pasted credential replaces the stored one, and is never stored in clear", async () => {
      await update({ secrets: JSON.stringify({ secretAccessKey: SECRET }) });

      expect(String(lastUpdate()["secrets"])).not.toContain(SECRET);

      const stored: BackupDestinationSettings =
        await BackupSettingService.getDestinationSettings(
          new ObjectID(SETTING_ID),
        );

      expect(stored.secrets).toEqual({ secretAccessKey: SECRET });
    });

    test("another storage starts from no credentials: the old storage's are not carried over", async () => {
      await expect(
        update({
          destinationType: BackupDestinationType.S3Compatible,
          destinationProvider: BackupProvider.MinIO,
          config: {
            endpoint: "https://minio.example.com:9000",
            bucket: "oneuptime-backups",
            accessKeyId: "minio-admin",
          },
        }),
      ).rejects.toThrow("Secret access key");
    });

    test("another storage, with its own credentials, is saved with only them", async () => {
      await update({
        destinationType: BackupDestinationType.S3Compatible,
        destinationProvider: BackupProvider.MinIO,
        config: {
          endpoint: "http://10.0.0.5:9000",
          bucket: "oneuptime-backups",
          accessKeyId: "minio-admin",
        },
        secrets: JSON.stringify({ secretAccessKey: SECRET }),
      });

      const stored: BackupDestinationSettings =
        await BackupSettingService.getDestinationSettings(
          new ObjectID(SETTING_ID),
        );

      expect(stored.type).toBe(BackupDestinationType.S3Compatible);
      expect(stored.provider).toBe(BackupProvider.MinIO);
      expect(stored.secrets).toEqual({ secretAccessKey: SECRET });
    });

    test("a new schedule moves the next backup to its next time", async () => {
      await update({
        frequency: BackupFrequency.Every6Hours,
        timeOfDay: "01:00",
      });

      // 01:00, 07:00, 13:00, 19:00: 13:00 is next after noon.
      expect(new Date(lastUpdate()["nextBackupAt"] as Date).toISOString()).toBe(
        "2026-10-24T13:00:00.000Z",
      );
    });

    test("turning backups back on starts the schedule from now, not from a missed time", async () => {
      settings.rows[0]!["isEnabled"] = false;
      settings.rows[0]!["nextBackupAt"] = new Date("2026-10-01T02:00:00.000Z");

      await update({ isEnabled: true });

      expect(new Date(lastUpdate()["nextBackupAt"] as Date).toISOString()).toBe(
        "2026-10-25T02:00:00.000Z",
      );
    });

    test("turning them off, or keeping ClickHouse out, leaves the next backup where it is", async () => {
      await update({ isEnabled: false });
      expect(lastUpdate()["nextBackupAt"]).toBeUndefined();

      await update({ includesClickhouse: false });
      expect(lastUpdate()["nextBackupAt"]).toBeUndefined();
    });

    test("a new retention is checked, and does not move the next backup", async () => {
      await expect(update({ retentionInDays: 0 })).rejects.toThrow(
        "Keep backups for must be a whole number of days from 1 to 3650.",
      );

      await update({ retentionInDays: 7 });

      expect(lastUpdate()["retentionInDays"]).toBe(7);
      expect(lastUpdate()["nextBackupAt"]).toBeUndefined();
    });

    test("a master admin may not write the scheduler's bookkeeping", async () => {
      await expect(
        update({ nextBackupAt: new Date("2026-10-24T12:01:00.000Z") }),
      ).rejects.toThrow(BACKUP_SETTING_BOOKKEEPING_MESSAGE);
    });

    test.each([
      ["a project owner", PROJECT_OWNER],
      ["a signed-in user", SIGNED_IN_USER],
    ])(
      "%s cannot change them",
      async (_who: string, props: DatabaseCommonInteractionProps) => {
        await expect(update({ retentionInDays: 7 }, props)).rejects.toThrow();
        expect(settings.updates).toHaveLength(0);
      },
    );

    test("with a license that has lapsed, they cannot be changed", async () => {
      installFakeEnterpriseModuleWithFeatures([]);

      await expect(update({ retentionInDays: 7 })).rejects.toThrow();
      expect(settings.updates).toHaveLength(0);
    });
  });

  describe("reading them", () => {
    beforeEach(() => {
      seedSetting();
    });

    function lastSelect(): Record<string, unknown> {
      const calls: Array<Array<unknown>> = settings.repository.find.mock
        .calls as Array<Array<unknown>>;
      const options: { select?: Record<string, unknown> } | undefined = calls[
        calls.length - 1
      ]?.[0] as { select?: Record<string, unknown> } | undefined;

      return options?.select || {};
    }

    test("never asks the database for the credentials on a master admin's read, who reads everything else", async () => {
      const read: BackupSetting | null = await BackupSettingService.findOneById(
        {
          id: new ObjectID(SETTING_ID),
          select: { _id: true, config: true, secrets: true, isEnabled: true },
          props: MASTER_ADMIN,
        },
      );

      expect(read?.config).toEqual({
        bucket: "acme-backups",
        region: "eu-west-1",
        accessKeyId: "AKIAIOSFODNN7EXAMPLE",
      });
      expect(read?.isEnabled).toBe(true);
      expect(lastSelect()["config"]).toBe(true);
      expect(lastSelect()["secrets"]).toBeUndefined();
    });

    test("OneUptime's own read is the one that asks for them", async () => {
      await BackupSettingService.getDestinationSettings(
        new ObjectID(SETTING_ID),
      );

      expect(lastSelect()["secrets"]).toBe(true);
    });

    test("cannot be searched by its credentials", () => {
      const findBy: { select: JSONObject; query: JSONObject } =
        BackupSettingService.dropSecretsFromRead({
          select: { secrets: true, config: true },
          query: { secrets: OLD_SECRET },
          props: MASTER_ADMIN,
        } as never) as never;

      expect(findBy.select).toEqual({ config: true });
      expect(findBy.query).toEqual({});
    });

    test("a project owner reads nothing", async () => {
      await expect(
        BackupSettingService.findOneById({
          id: new ObjectID(SETTING_ID),
          select: { _id: true, config: true },
          props: PROJECT_OWNER,
        }),
      ).rejects.toThrow();
    });

    test("OneUptime reads the settings it backs up with, credentials decrypted", async () => {
      expect(
        await BackupSettingService.getDestinationSettings(
          new ObjectID(SETTING_ID),
        ),
      ).toEqual({
        type: BackupDestinationType.AmazonS3,
        provider: BackupProvider.AmazonS3,
        config: {
          bucket: "acme-backups",
          region: "eu-west-1",
          accessKeyId: "AKIAIOSFODNN7EXAMPLE",
        },
        secrets: { secretAccessKey: OLD_SECRET },
      });
    });

    test("the one setting, or none", async () => {
      expect((await BackupSettingService.getSetting())?.id?.toString()).toBe(
        SETTING_ID,
      );

      settings.rows.length = 0;

      expect(await BackupSettingService.getSetting()).toBeNull();
    });
  });
});

describe("BackupSettingService's rules on their own", () => {
  test("a schedule left out is the default one", () => {
    expect(
      BackupSettingServiceClass.validateSchedule({
        frequency: undefined,
        timeOfDay: "",
        dayOfWeek: null,
        retentionInDays: undefined,
      }),
    ).toEqual({
      frequency: BackupFrequency.Daily,
      timeOfDay: "02:00",
      dayOfWeek: 0,
      retentionInDays: 30,
    });
  });

  test("a form's numbers as text are read as numbers", () => {
    expect(
      BackupSettingServiceClass.validateSchedule({
        frequency: "weekly",
        timeOfDay: "23:15",
        dayOfWeek: "6",
        retentionInDays: "365",
      }),
    ).toEqual({
      frequency: BackupFrequency.Weekly,
      timeOfDay: "23:15",
      dayOfWeek: 6,
      retentionInDays: 365,
    });
  });

  test("an edit's credentials go over the stored ones of the same storage", () => {
    expect(
      BackupSettingServiceClass.mergeSecrets({
        type: BackupDestinationType.AzureBlobStorage,
        storedType: BackupDestinationType.AzureBlobStorage,
        stored: JSON.stringify({ sasToken: "sv=old&sig=old" }),
        provided: { accountKey: "bmV3S2V5" },
      }),
    ).toEqual({ sasToken: "sv=old&sig=old", accountKey: "bmV3S2V5" });

    expect(
      BackupSettingServiceClass.mergeSecrets({
        type: BackupDestinationType.AmazonS3,
        storedType: BackupDestinationType.AmazonS3,
        stored: JSON.stringify({ secretAccessKey: OLD_SECRET }),
        provided: { secretAccessKey: "" },
      }),
    ).toEqual({ secretAccessKey: OLD_SECRET });
  });

  test("another storage's credentials are never merged in", () => {
    expect(
      BackupSettingServiceClass.mergeSecrets({
        type: BackupDestinationType.S3Compatible,
        storedType: BackupDestinationType.AmazonS3,
        stored: JSON.stringify({ secretAccessKey: OLD_SECRET }),
        provided: {},
      }),
    ).toEqual({});
  });
});
