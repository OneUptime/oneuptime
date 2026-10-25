import { describe, expect, test } from "@jest/globals";
import {
  BACKUP_CONNECTION_STEP_ID,
  BACKUP_SCHEDULE_STEP_ID,
  getBackupConnectionFields,
  getBackupScheduleFields,
} from "../../../AdminDashboard/Backups/BackupSettingsFormModal";
import {
  backupConfigFieldName,
  backupSecretFieldName,
} from "../../../AdminDashboard/Backups/BackupDestinationForm";
import { BackupsCopy } from "../../../AdminDashboard/Backups/BackupsCopy";
import { savedSetting } from "./BackupsFixtures";
import {
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProvider,
  BackupProviderCatalog,
  BackupProviderDefinition,
  getBackupDestinationDefinition,
} from "Common/Types/Backup/BackupDestinationCatalog";
import {
  BackupFrequency,
  MAX_BACKUP_RETENTION_IN_DAYS,
  MIN_BACKUP_RETENTION_IN_DAYS,
} from "Common/Types/Backup/BackupSchedule";
import { JSONObject } from "Common/Types/JSON";
import Field from "Common/UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { createTranslator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The setup form's fields, as the form is handed them: every recommended
 * destination's own fields, each shown only while that destination is the
 * one picked; what it cannot do without first, its credentials next, the
 * rest folded under More fields; the destination's setup guide beside the
 * first; a stored credential kept on edit (and said so); and the schedule's
 * fields, the time only when there is one to choose, the day only weekly.
 */

type FormField = Field<JSONObject>;

function nameOf(field: FormField): string {
  return Object.keys(field.field || {})[0] || "";
}

function shown(fields: Array<FormField>, values: JSONObject): Array<string> {
  return fields
    .filter((field: FormField): boolean => {
      return field.showIf
        ? field.showIf(values as FormValues<JSONObject>)
        : true;
    })
    .map(nameOf);
}

function fieldNamed(fields: Array<FormField>, name: string): FormField {
  const field: FormField | undefined = fields.find(
    (candidate: FormField): boolean => {
      return nameOf(candidate) === name;
    },
  );

  if (!field) {
    throw new Error(`No field ${name}`);
  }

  return field;
}

describe("each destination's fields", () => {
  const fields: Array<FormField> = getBackupConnectionFields({});

  test("every recommended destination has every field of its storage, on the connection step", () => {
    for (const provider of BackupProviderCatalog as Array<BackupProviderDefinition>) {
      const definition: BackupDestinationDefinition =
        getBackupDestinationDefinition(provider.type)!;

      for (const field of definition.configFields) {
        expect(
          fieldNamed(
            fields,
            backupConfigFieldName(provider.provider, field.key),
          ).stepId,
        ).toBe(BACKUP_CONNECTION_STEP_ID);
      }

      for (const field of definition.secretFields) {
        const secret: FormField = fieldNamed(
          fields,
          backupSecretFieldName(provider.provider, field.key),
        );

        expect(secret.fieldType).toBe(FormFieldSchemaType.Password);
        expect(secret.required).toBe(field.required);
      }
    }
  });

  test("only the picked destination's fields show: what it needs first, its credentials next", () => {
    expect(shown(fields, { provider: BackupProvider.MinIO })).toEqual([
      "minio__config__endpoint",
      "minio__config__bucket",
      "minio__config__accessKeyId",
      "minio__secret__secretAccessKey",
      "minio__config__region",
      "minio__config__folder",
    ]);
    expect(shown(fields, { provider: BackupProvider.AmazonS3 })).toEqual([
      "amazon-s3__config__bucket",
      "amazon-s3__config__region",
      "amazon-s3__config__accessKeyId",
      "amazon-s3__secret__secretAccessKey",
      "amazon-s3__config__folder",
    ]);
    expect(shown(fields, {})).toEqual([]);
  });

  test("Azure asks for the credential its sign-in takes: a SAS token, or an access key", () => {
    const azure: BackupProvider = BackupProvider.AzureBlobStorage;

    expect(shown(fields, { provider: azure })).toContain(
      backupSecretFieldName(azure, "sasToken"),
    );
    expect(shown(fields, { provider: azure })).not.toContain(
      backupSecretFieldName(azure, "accountKey"),
    );

    const withKey: Array<string> = shown(fields, {
      provider: azure,
      [backupConfigFieldName(azure, "authentication")]: {
        label: "Access key",
        value: "access-key",
      },
    });

    expect(withKey).toContain(backupSecretFieldName(azure, "accountKey"));
    expect(withKey).not.toContain(backupSecretFieldName(azure, "sasToken"));
  });

  test("a folder, a region and an Azure cloud wait under More fields", () => {
    const advanced: Array<string> = fields
      .filter((field: FormField): boolean => {
        return Boolean(field.collapsibleSection);
      })
      .map(nameOf);

    expect(advanced).toContain("minio__config__folder");
    expect(advanced).toContain("minio__config__region");
    expect(advanced).toContain("azure-blob-storage__config__cloud");
    expect(advanced).not.toContain("minio__config__endpoint");
    // Amazon S3 needs its region: it is not folded away.
    expect(advanced).not.toContain("amazon-s3__config__region");
  });

  test("each destination's first field has its setup guide beside it, in a new tab", () => {
    for (const provider of BackupProviderCatalog as Array<BackupProviderDefinition>) {
      const linked: Array<FormField> = fields.filter(
        (field: FormField): boolean => {
          return (
            Boolean(field.sideLink) &&
            nameOf(field).startsWith(`${provider.provider}__`)
          );
        },
      );

      expect(linked).toHaveLength(1);
      expect(linked[0]!.sideLink!.text).toBe(BackupsCopy.setupGuide);
      expect(linked[0]!.sideLink!.url.toString()).toBe(provider.docsPath);
      expect(linked[0]!.sideLink!.openLinkInNewTab).toBe(true);
    }
  });

  test("an S3-compatible product's endpoint suggests that product's address", () => {
    expect(
      fieldNamed(fields, "cloudflare-r2__config__endpoint").placeholder,
    ).toBe("https://<account-id>.r2.cloudflarestorage.com");
    expect(fieldNamed(fields, "wasabi__config__endpoint").placeholder).toBe(
      "https://s3.us-east-1.wasabisys.com",
    );
    expect(fieldNamed(fields, "amazon-s3__config__region").defaultValue).toBe(
      "us-east-1",
    );
  });

  test("Azure's choices are the catalog's", () => {
    const authentication: FormField = fieldNamed(
      fields,
      "azure-blob-storage__config__authentication",
    );
    const definition: BackupDestinationDefinition =
      getBackupDestinationDefinition(
        BackupProviderCatalog.find((provider: BackupProviderDefinition) => {
          return provider.provider === BackupProvider.AzureBlobStorage;
        })!.type,
      )!;
    const catalogField: BackupDestinationField = definition.configFields.find(
      (field: BackupDestinationField): boolean => {
        return field.key === "authentication";
      },
    )!;

    expect(authentication.fieldType).toBe(FormFieldSchemaType.Dropdown);
    expect(authentication.dropdownOptions).toEqual(
      (catalogField.options || []).map(
        (option: { label: string; value: string }) => {
          return { label: option.label, value: option.value };
        },
      ),
    );
  });
});

describe("credentials on edit", () => {
  test("staying with the saved destination: its credential is not asked for, and says Unchanged", () => {
    const fields: Array<FormField> = getBackupConnectionFields({
      setting: savedSetting(),
    });
    const minio: FormField = fieldNamed(
      fields,
      "minio__secret__secretAccessKey",
    );

    expect(minio.required).toBe(false);
    expect(minio.placeholder).toBe(BackupsCopy.unchangedPlaceholder);

    // Another destination has no stored credential to keep.
    const r2: FormField = fieldNamed(
      fields,
      "cloudflare-r2__secret__secretAccessKey",
    );

    expect(r2.required).toBe(true);
    expect(r2.placeholder).toBeUndefined();
  });
});

describe("the schedule's fields", () => {
  const fields: Array<FormField> = getBackupScheduleFields({
    translator: createTranslator(undefined, "en"),
  });

  test("how often, at what time, on which day, for how long, and ClickHouse - on the last step", () => {
    expect(fields.map(nameOf)).toEqual([
      "frequency",
      "timeOfDay",
      "dayOfWeek",
      "retentionInDays",
      "includesClickhouse",
    ]);

    for (const field of fields) {
      expect(field.stepId).toBe(BACKUP_SCHEDULE_STEP_ID);
    }
  });

  test("every frequency is offered, in the order of how often", () => {
    expect(
      (
        (fieldNamed(fields, "frequency").dropdownOptions || []) as Array<{
          value: unknown;
        }>
      ).map((option: { value: unknown }) => {
        return option.value;
      }),
    ).toEqual([
      BackupFrequency.EveryHour,
      BackupFrequency.Every6Hours,
      BackupFrequency.Every12Hours,
      BackupFrequency.Daily,
      BackupFrequency.Weekly,
    ]);
  });

  test("every hour runs on the hour: no time to choose; the day is asked only weekly", () => {
    expect(shown(fields, { frequency: BackupFrequency.EveryHour })).toEqual([
      "frequency",
      "retentionInDays",
      "includesClickhouse",
    ]);
    expect(shown(fields, { frequency: BackupFrequency.Daily })).toEqual([
      "frequency",
      "timeOfDay",
      "retentionInDays",
      "includesClickhouse",
    ]);
    expect(
      shown(fields, {
        frequency: { label: "Every week", value: BackupFrequency.Weekly },
      }),
    ).toEqual([
      "frequency",
      "timeOfDay",
      "dayOfWeek",
      "retentionInDays",
      "includesClickhouse",
    ]);
  });

  test("the days are the week's seven, in the reader's language", () => {
    expect(fieldNamed(fields, "dayOfWeek").dropdownOptions).toEqual([
      { value: "0", label: "Sunday" },
      { value: "1", label: "Monday" },
      { value: "2", label: "Tuesday" },
      { value: "3", label: "Wednesday" },
      { value: "4", label: "Thursday" },
      { value: "5", label: "Friday" },
      { value: "6", label: "Saturday" },
    ]);
  });

  test("backups are kept 1 to 3650 days", () => {
    const retention: FormField = fieldNamed(fields, "retentionInDays");

    expect(retention.fieldType).toBe(FormFieldSchemaType.Number);
    expect(retention.validation).toEqual({
      minValue: MIN_BACKUP_RETENTION_IN_DAYS,
      maxValue: MAX_BACKUP_RETENTION_IN_DAYS,
    });
    expect(MIN_BACKUP_RETENTION_IN_DAYS).toBe(1);
    expect(MAX_BACKUP_RETENTION_IN_DAYS).toBe(3650);
  });
});
