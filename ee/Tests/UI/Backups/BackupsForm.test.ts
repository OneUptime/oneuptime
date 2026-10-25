import { describe, expect, test } from "@jest/globals";
import {
  BACKUP_PROVIDER_FIELD,
  backupConfigFieldName,
  backupSecretFieldName,
  backupSettingPayload,
  backupTestBody,
  backupTestDisabledReason,
  getBackupFormInitialValues,
  getProviderField,
  keepsStoredBackupSecrets,
  readBackupDestination,
  readBackupProvider,
  readBackupSchedule,
} from "../../../AdminDashboard/Backups/BackupDestinationForm";
import { BackupsCopy } from "../../../AdminDashboard/Backups/BackupsCopy";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import {
  BackupDestinationField,
  BackupProvider,
  BackupProviderDefinition,
  getBackupDestinationDefinition,
  getBackupProviderDefinition,
} from "Common/Types/Backup/BackupDestinationCatalog";
import { BackupFrequency } from "Common/Types/Backup/BackupSchedule";
import HashedString from "Common/Types/HashedString";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";

/*
 * The backup settings form without React (BackupDestinationForm): what its
 * values mean, and what it sends to test them and to save them.
 *
 *   - each recommended destination's fields are named apart, so a value
 *     typed for one never reaches another's field of the same key;
 *   - a field another one turns off is not sent (Azure's access key while
 *     a SAS token signs in), nor an empty one;
 *   - a credential is sent only when typed - an edit that stays with its
 *     destination keeps the stored one, and the test is told whose settings
 *     to fall back on; moving to another product of the same storage (MinIO
 *     to Cloudflare R2) asks for new keys;
 *   - the test can say before it runs why it cannot yet;
 *   - an edit opens on the saved settings, never on their credentials.
 */

const SETTING_ID: string = "77777777-7777-4777-8777-777777777777";
const SECRET: string = "minio-secret-9f8e7d6c5b4a";

function config(provider: BackupProvider, key: string): string {
  return backupConfigFieldName(provider, key);
}

function secret(provider: BackupProvider, key: string): string {
  return backupSecretFieldName(provider, key);
}

// MinIO, filled in as the form hands it over (a password is a HashedString).
function minioValues(extra: JSONObject = {}): JSONObject {
  return {
    [BACKUP_PROVIDER_FIELD]: BackupProvider.MinIO,
    [config(BackupProvider.MinIO, "endpoint")]:
      " https://minio.acme.internal:9000 ",
    [config(BackupProvider.MinIO, "bucket")]: "oneuptime-backups",
    [config(BackupProvider.MinIO, "accessKeyId")]: "backup-writer",
    [secret(BackupProvider.MinIO, "secretAccessKey")]: new HashedString(
      SECRET,
    ) as unknown as JSONObject,
    frequency: BackupFrequency.Daily,
    timeOfDay: "02:00",
    dayOfWeek: "0",
    retentionInDays: "30",
    includesClickhouse: true,
    ...extra,
  };
}

function savedMinio(
  fields: Partial<Record<string, unknown>> = {},
): BackupSetting {
  const setting: BackupSetting = new BackupSetting();
  setting.id = new ObjectID(SETTING_ID);
  setting.destinationType = BackupDestinationType.S3Compatible;
  setting.destinationProvider = BackupProvider.MinIO;
  setting.config = {
    endpoint: "https://minio.acme.internal:9000",
    bucket: "oneuptime-backups",
    accessKeyId: "backup-writer",
    folder: "prod/",
  };
  setting.frequency = BackupFrequency.Weekly;
  setting.timeOfDay = "03:00";
  setting.dayOfWeek = 6;
  setting.retentionInDays = 14;
  setting.includesClickhouse = false;
  setting.isEnabled = true;

  for (const key of Object.keys(fields)) {
    (setting as unknown as Record<string, unknown>)[key] = fields[key];
  }

  return setting;
}

describe("the form's field names", () => {
  test("are each destination's own: <provider>__config__<key> and <provider>__secret__<key>", () => {
    expect(config(BackupProvider.CloudflareR2, "endpoint")).toBe(
      "cloudflare-r2__config__endpoint",
    );
    expect(secret(BackupProvider.AzureBlobStorage, "sasToken")).toBe(
      "azure-blob-storage__secret__sasToken",
    );
    expect(BACKUP_PROVIDER_FIELD).toBe("provider");
  });

  test("the destination picked is read whether the form hands a value or a dropdown option", () => {
    expect(
      readBackupProvider({ provider: BackupProvider.Wasabi })?.provider,
    ).toBe(BackupProvider.Wasabi);
    expect(
      readBackupProvider({
        provider: { label: "Wasabi", value: BackupProvider.Wasabi },
      })?.provider,
    ).toBe(BackupProvider.Wasabi);
    expect(readBackupProvider({})).toBeUndefined();
    expect(readBackupProvider({ provider: "dropbox" })).toBeUndefined();
  });

  test("an S3-compatible product's endpoint field says where its console shows it", () => {
    const definition: ReturnType<typeof getBackupDestinationDefinition> =
      getBackupDestinationDefinition(BackupDestinationType.S3Compatible)!;
    const endpoint: BackupDestinationField = definition.configFields.find(
      (field: BackupDestinationField): boolean => {
        return field.key === "endpoint";
      },
    )!;
    const bucket: BackupDestinationField = definition.configFields.find(
      (field: BackupDestinationField): boolean => {
        return field.key === "bucket";
      },
    )!;
    const r2: BackupProviderDefinition = getBackupProviderDefinition(
      BackupProvider.CloudflareR2,
    )!;
    const other: BackupProviderDefinition = getBackupProviderDefinition(
      BackupProvider.OtherS3Compatible,
    )!;

    expect(getProviderField(r2, endpoint)).toMatchObject({
      key: "endpoint",
      placeholder: "https://<account-id>.r2.cloudflarestorage.com",
      description:
        "Your account's S3 API address, from R2 > the bucket > Settings.",
      required: true,
    });
    // A provider with nothing to add keeps the storage's description.
    expect(getProviderField(other, endpoint).description).toBe(
      endpoint.description,
    );
    // Only the endpoint differs between products.
    expect(getProviderField(r2, bucket)).toBe(bucket);
  });
});

describe("readBackupDestination", () => {
  test("MinIO: S3-compatible storage, the endpoint trimmed, the secret apart from the config", () => {
    expect(readBackupDestination(minioValues())).toEqual({
      destinationType: BackupDestinationType.S3Compatible,
      destinationProvider: BackupProvider.MinIO,
      config: {
        endpoint: "https://minio.acme.internal:9000",
        bucket: "oneuptime-backups",
        accessKeyId: "backup-writer",
      },
      secrets: { secretAccessKey: SECRET },
    });
  });

  test("a value typed for another destination is never read: each has its own fields", () => {
    const values: JSONObject = {
      ...minioValues(),
      // Typed while Cloudflare R2 was picked, then MinIO was.
      [config(BackupProvider.CloudflareR2, "endpoint")]:
        "https://abc.r2.cloudflarestorage.com",
      [config(BackupProvider.CloudflareR2, "bucket")]: "r2-bucket",
      [secret(BackupProvider.CloudflareR2, "secretAccessKey")]: "r2-secret",
    };

    const submission: ReturnType<typeof readBackupDestination> =
      readBackupDestination(values);

    expect(submission.config["endpoint"]).toBe(
      "https://minio.acme.internal:9000",
    );
    expect(submission.config["bucket"]).toBe("oneuptime-backups");
    expect(submission.secrets).toEqual({ secretAccessKey: SECRET });

    // Nor does it fill one not typed yet for the destination picked.
    const untyped: JSONObject = { ...values };
    delete untyped[config(BackupProvider.MinIO, "bucket")];
    delete untyped[secret(BackupProvider.MinIO, "secretAccessKey")];

    const empty: ReturnType<typeof readBackupDestination> =
      readBackupDestination(untyped);

    expect(empty.config).not.toHaveProperty("bucket");
    expect(empty.secrets).toEqual({});
  });

  test("empty fields are left out, so the server's defaults apply", () => {
    const submission: ReturnType<typeof readBackupDestination> =
      readBackupDestination(
        minioValues({
          [config(BackupProvider.MinIO, "region")]: "   ",
          [config(BackupProvider.MinIO, "folder")]: "",
        }),
      );

    expect(Object.keys(submission.config).sort()).toEqual(
      ["accessKeyId", "bucket", "endpoint"].sort(),
    );
  });

  test("Azure signs in with a SAS token unless Access key is chosen: only that credential is sent", () => {
    const azure: JSONObject = {
      [BACKUP_PROVIDER_FIELD]: BackupProvider.AzureBlobStorage,
      [config(BackupProvider.AzureBlobStorage, "accountName")]:
        "oneuptimebackups",
      [config(BackupProvider.AzureBlobStorage, "container")]:
        "oneuptime-backups",
      [secret(BackupProvider.AzureBlobStorage, "sasToken")]: "sv=2022&sig=x",
      [secret(BackupProvider.AzureBlobStorage, "accountKey")]: "account-key",
    };

    // Nothing chosen: the dropdown's default, a SAS token.
    expect(readBackupDestination(azure).secrets).toEqual({
      sasToken: "sv=2022&sig=x",
    });

    const withKey: ReturnType<typeof readBackupDestination> =
      readBackupDestination({
        ...azure,
        [config(BackupProvider.AzureBlobStorage, "authentication")]: {
          label: "Access key",
          value: "access-key",
        },
      });

    expect(withKey.destinationType).toBe(
      BackupDestinationType.AzureBlobStorage,
    );
    expect(withKey.config["authentication"]).toBe("access-key");
    expect(withKey.secrets).toEqual({ accountKey: "account-key" });
  });

  test("without a destination picked it says to choose one", () => {
    expect(() => {
      return readBackupDestination({});
    }).toThrow(BackupsCopy.testChooseDestinationFirst);
  });
});

describe("readBackupSchedule", () => {
  test("reads the form's strings as the schedule's numbers", () => {
    expect(
      readBackupSchedule({
        frequency: BackupFrequency.Weekly,
        timeOfDay: "04:00",
        dayOfWeek: "3",
        retentionInDays: "90",
        includesClickhouse: false,
      }),
    ).toEqual({
      frequency: BackupFrequency.Weekly,
      timeOfDay: "04:00",
      dayOfWeek: 3,
      retentionInDays: 90,
      includesClickhouse: false,
    });
  });

  test("what is missing or unknown is the default: every day at 02:00, kept 30 days, ClickHouse too", () => {
    expect(readBackupSchedule({ frequency: "every-minute" })).toEqual({
      frequency: BackupFrequency.Daily,
      timeOfDay: "02:00",
      dayOfWeek: 0,
      retentionInDays: 30,
      includesClickhouse: true,
    });
  });

  test("a dropdown option and a toggle's string are read as their values", () => {
    expect(
      readBackupSchedule({
        frequency: {
          label: "Every 6 hours",
          value: BackupFrequency.Every6Hours,
        },
        includesClickhouse: "false",
      }),
    ).toMatchObject({
      frequency: BackupFrequency.Every6Hours,
      includesClickhouse: false,
    });
  });
});

describe("keepsStoredBackupSecrets", () => {
  test("an edit that stays with its destination keeps the stored credentials", () => {
    expect(
      keepsStoredBackupSecrets({
        provider: BackupProvider.MinIO,
        setting: savedMinio(),
      }),
    ).toBe(true);
  });

  test("another product of the same storage has keys of its own: MinIO to Cloudflare R2 asks for them", () => {
    expect(
      keepsStoredBackupSecrets({
        provider: BackupProvider.CloudflareR2,
        setting: savedMinio(),
      }),
    ).toBe(false);
    expect(
      keepsStoredBackupSecrets({
        provider: BackupProvider.AmazonS3,
        setting: savedMinio(),
      }),
    ).toBe(false);
  });

  test("new settings have nothing stored to keep", () => {
    expect(
      keepsStoredBackupSecrets({
        provider: BackupProvider.MinIO,
        setting: undefined,
      }),
    ).toBe(false);
    expect(
      keepsStoredBackupSecrets({
        provider: BackupProvider.MinIO,
        setting: new BackupSetting(),
      }),
    ).toBe(false);
  });

  test("settings saved without a product read as Other S3-compatible storage", () => {
    const setting: BackupSetting = savedMinio({
      destinationProvider: undefined,
    });

    expect(
      keepsStoredBackupSecrets({
        provider: BackupProvider.OtherS3Compatible,
        setting,
      }),
    ).toBe(true);
    expect(
      keepsStoredBackupSecrets({ provider: BackupProvider.MinIO, setting }),
    ).toBe(false);
  });
});

describe("the test, before anything is saved", () => {
  test("new settings: everything typed, and no settings to fall back on", () => {
    expect(backupTestBody({ values: minioValues() })).toEqual({
      destinationType: BackupDestinationType.S3Compatible,
      destinationProvider: BackupProvider.MinIO,
      config: {
        endpoint: "https://minio.acme.internal:9000",
        bucket: "oneuptime-backups",
        accessKeyId: "backup-writer",
      },
      secrets: { secretAccessKey: SECRET },
      includesClickhouse: true,
    });
  });

  test("an edit names its settings, so a credential left blank is tested with the stored one", () => {
    const body: JSONObject = backupTestBody({
      values: {
        ...getBackupFormInitialValues(savedMinio()),
        [config(BackupProvider.MinIO, "bucket")]: "oneuptime-backups-2",
      },
      setting: savedMinio(),
    });

    expect(body).toEqual({
      settingId: SETTING_ID,
      destinationType: BackupDestinationType.S3Compatible,
      destinationProvider: BackupProvider.MinIO,
      config: {
        endpoint: "https://minio.acme.internal:9000",
        bucket: "oneuptime-backups-2",
        accessKeyId: "backup-writer",
        folder: "prod/",
      },
      secrets: {},
      includesClickhouse: false,
    });
  });

  test("says why it cannot run yet: no destination, a required setting empty, no credential", () => {
    expect(backupTestDisabledReason({ values: {} })).toBe(
      BackupsCopy.testChooseDestinationFirst,
    );
    expect(
      backupTestDisabledReason({
        values: minioValues({ [config(BackupProvider.MinIO, "bucket")]: "" }),
      }),
    ).toBe(BackupsCopy.testFillSettingsFirst);
    expect(
      backupTestDisabledReason({
        values: minioValues({
          [secret(BackupProvider.MinIO, "secretAccessKey")]: "",
        }),
      }),
    ).toBe(BackupsCopy.testPasteCredentialsFirst);
    expect(backupTestDisabledReason({ values: minioValues() })).toBeUndefined();
  });

  test("a field with a default needs nothing typed: Amazon S3's region is us-east-1", () => {
    expect(
      backupTestDisabledReason({
        values: {
          [BACKUP_PROVIDER_FIELD]: BackupProvider.AmazonS3,
          [config(BackupProvider.AmazonS3, "bucket")]: "acme-backups",
          [config(BackupProvider.AmazonS3, "accessKeyId")]: "AKIAEXAMPLE",
          [secret(BackupProvider.AmazonS3, "secretAccessKey")]: SECRET,
        },
      }),
    ).toBeUndefined();
  });

  test("an edit runs on the stored credentials - until the destination changes", () => {
    const values: JSONObject = getBackupFormInitialValues(savedMinio());

    expect(
      backupTestDisabledReason({ values, setting: savedMinio() }),
    ).toBeUndefined();
    expect(
      backupTestDisabledReason({
        values: {
          ...values,
          [BACKUP_PROVIDER_FIELD]: BackupProvider.CloudflareR2,
          [config(BackupProvider.CloudflareR2, "endpoint")]:
            "https://abc.r2.cloudflarestorage.com",
          [config(BackupProvider.CloudflareR2, "bucket")]: "r2-backups",
          [config(BackupProvider.CloudflareR2, "accessKeyId")]: "r2-key",
        },
        setting: savedMinio(),
      }),
    ).toBe(BackupsCopy.testPasteCredentialsFirst);
  });
});

describe("the form's values for saved settings", () => {
  test("new settings: every day at 02:00 UTC, kept 30 days, ClickHouse included", () => {
    expect(getBackupFormInitialValues(undefined)).toEqual({
      frequency: BackupFrequency.Daily,
      timeOfDay: "02:00",
      dayOfWeek: "0",
      retentionInDays: "30",
      includesClickhouse: true,
    });
  });

  test("an edit opens on its destination, its settings and its schedule - never its credentials", () => {
    const values: JSONObject = getBackupFormInitialValues(
      savedMinio({
        secrets: JSON.stringify({ secretAccessKey: SECRET }),
        config: {
          endpoint: "https://minio.acme.internal:9000",
          bucket: "oneuptime-backups",
          accessKeyId: "backup-writer",
          // A number stored through the API reads as the text field's value.
          region: 7 as unknown as string,
        },
      }),
    );

    expect(values).toEqual({
      provider: BackupProvider.MinIO,
      [config(BackupProvider.MinIO, "endpoint")]:
        "https://minio.acme.internal:9000",
      [config(BackupProvider.MinIO, "bucket")]: "oneuptime-backups",
      [config(BackupProvider.MinIO, "accessKeyId")]: "backup-writer",
      [config(BackupProvider.MinIO, "region")]: "7",
      frequency: BackupFrequency.Weekly,
      timeOfDay: "03:00",
      dayOfWeek: "6",
      retentionInDays: "14",
      includesClickhouse: false,
    });
    expect(JSON.stringify(values)).not.toContain(SECRET);
  });
});

describe("what a save sends", () => {
  test("new settings: the destination, its credentials (as the stored JSON) and the schedule", () => {
    const payload: JSONObject = backupSettingPayload({ values: minioValues() });

    expect(payload).toEqual({
      destinationType: BackupDestinationType.S3Compatible,
      destinationProvider: BackupProvider.MinIO,
      config: {
        endpoint: "https://minio.acme.internal:9000",
        bucket: "oneuptime-backups",
        accessKeyId: "backup-writer",
      },
      secrets: JSON.stringify({ secretAccessKey: SECRET }),
      frequency: BackupFrequency.Daily,
      timeOfDay: "02:00",
      dayOfWeek: 0,
      retentionInDays: 30,
      includesClickhouse: true,
    });
  });

  test("an edit with no credential typed leaves the stored one: no secrets are sent", () => {
    const payload: JSONObject = backupSettingPayload({
      values: getBackupFormInitialValues(savedMinio()),
      setting: savedMinio(),
    });

    expect(payload).not.toHaveProperty("secrets");
    expect(payload).toMatchObject({
      destinationProvider: BackupProvider.MinIO,
      frequency: BackupFrequency.Weekly,
      dayOfWeek: 6,
      retentionInDays: 14,
      includesClickhouse: false,
    });
  });

  test("an edit with a new credential pasted sends it", () => {
    const payload: JSONObject = backupSettingPayload({
      values: {
        ...getBackupFormInitialValues(savedMinio()),
        [secret(BackupProvider.MinIO, "secretAccessKey")]: "rotated-secret",
      },
      setting: savedMinio(),
    });

    expect(JSON.parse(payload["secrets"] as string)).toEqual({
      secretAccessKey: "rotated-secret",
    });
  });

  test("a move to another storage never keeps the old credentials", () => {
    const payload: JSONObject = backupSettingPayload({
      values: {
        ...getBackupFormInitialValues(savedMinio()),
        [BACKUP_PROVIDER_FIELD]: BackupProvider.GoogleCloudStorage,
        [config(BackupProvider.GoogleCloudStorage, "bucket")]: "gcs-backups",
        [config(BackupProvider.GoogleCloudStorage, "accessKeyId")]: "GOOG1E",
      },
      setting: savedMinio(),
    });

    expect(payload["destinationType"]).toBe(
      BackupDestinationType.GoogleCloudStorage,
    );
    // The stored MinIO secret is replaced (by nothing: the form asks for one).
    expect(payload["secrets"]).toBe("{}");
  });
});
