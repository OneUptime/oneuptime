import { BackupsCopy } from "./BackupsCopy";
import BackupSetting from "Common/Models/DatabaseModels/BackupSetting";
import BackupDestinationType from "Common/Types/Backup/BackupDestinationType";
import {
  BackupDestinationDefinition,
  BackupDestinationField,
  BackupProvider,
  BackupProviderDefinition,
  getBackupDestinationDefinition,
  getBackupProviderDefinition,
  isBackupFieldShown,
  readBackupConfigValue,
  resolveBackupProvider,
} from "Common/Types/Backup/BackupDestinationCatalog";
import {
  BackupFrequency,
  DEFAULT_BACKUP_DAY_OF_WEEK,
  DEFAULT_BACKUP_FREQUENCY,
  DEFAULT_BACKUP_RETENTION_IN_DAYS,
  DEFAULT_BACKUP_TIME_OF_DAY,
  isBackupFrequency,
} from "Common/Types/Backup/BackupSchedule";
import HashedString from "Common/Types/HashedString";
import { JSONObject, JSONValue } from "Common/Types/JSON";

/*
 * The backup settings form, without React: what its values mean, what is
 * sent to save and to test them. Each recommended destination's fields are
 * named apart in the one form (a value typed for MinIO never carries over to
 * Cloudflare R2's field of the same key). Pinned in ee/Tests/UI/Backups.
 */

export const BACKUP_PROVIDER_FIELD: string = "provider";

export function backupConfigFieldName(
  provider: BackupProvider | string,
  key: string,
): string {
  return `${provider}__config__${key}`;
}

export function backupSecretFieldName(
  provider: BackupProvider | string,
  key: string,
): string {
  return `${provider}__secret__${key}`;
}

function readText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  // The form hands a password over as a HashedString.
  if (value instanceof HashedString) {
    return value.toString().trim();
  }

  // A dropdown value not unwrapped yet ({ label, value }).
  if (typeof value === "object" && !Array.isArray(value) && "value" in value) {
    return readText((value as JSONObject)["value"]);
  }

  return typeof value === "string" ? value.trim() : String(value).trim();
}

// The recommended destination the form is for: an edit's, or the one picked.
export function readBackupProvider(
  values: JSONObject,
): BackupProviderDefinition | undefined {
  return getBackupProviderDefinition(readText(values[BACKUP_PROVIDER_FIELD]));
}

/*
 * A field of a provider: the storage's, with what the provider says about
 * it instead (R2's endpoint is <account-id>.r2.cloudflarestorage.com).
 */
export function getProviderField(
  provider: BackupProviderDefinition,
  field: BackupDestinationField,
): BackupDestinationField {
  if (field.key !== "endpoint") {
    return field;
  }

  return {
    ...field,
    ...(provider.endpointPlaceholder
      ? { placeholder: provider.endpointPlaceholder }
      : {}),
    ...(provider.endpointDescription
      ? { description: provider.endpointDescription }
      : {}),
  };
}

function readConfig(
  provider: BackupProviderDefinition,
  definition: BackupDestinationDefinition,
  values: JSONObject,
): JSONObject {
  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const value: string = readText(
      values[backupConfigFieldName(provider.provider, field.key)] as
        | JSONValue
        | undefined,
    );

    if (value !== "") {
      config[field.key] = value;
    }
  }

  // A field another field turns off is not sent (Azure's key with a SAS token).
  for (const field of definition.configFields) {
    if (!isBackupFieldShown({ definition, field, config })) {
      delete config[field.key];
    }
  }

  return config;
}

function readSecrets(
  provider: BackupProviderDefinition,
  definition: BackupDestinationDefinition,
  values: JSONObject,
  config: JSONObject,
): JSONObject {
  const secrets: JSONObject = {};

  for (const field of definition.secretFields) {
    if (!isBackupFieldShown({ definition, field, config })) {
      continue;
    }

    const value: string = readText(
      values[backupSecretFieldName(provider.provider, field.key)] as
        | JSONValue
        | undefined,
    );

    if (value !== "") {
      secrets[field.key] = value;
    }
  }

  return secrets;
}

export interface BackupDestinationSubmission {
  destinationType: BackupDestinationType;
  destinationProvider: BackupProvider;
  config: JSONObject;
  // Only what was typed: a blank credential keeps the stored one.
  secrets: JSONObject;
}

export function readBackupDestination(
  values: JSONObject,
): BackupDestinationSubmission {
  const provider: BackupProviderDefinition | undefined =
    readBackupProvider(values);
  const definition: BackupDestinationDefinition | undefined =
    getBackupDestinationDefinition(provider?.type);

  if (!provider || !definition) {
    throw new Error(BackupsCopy.testChooseDestinationFirst);
  }

  const config: JSONObject = readConfig(provider, definition, values);

  return {
    destinationType: provider.type,
    destinationProvider: provider.provider,
    config,
    secrets: readSecrets(provider, definition, values, config),
  };
}

export interface BackupScheduleSubmission {
  frequency: BackupFrequency;
  timeOfDay: string;
  dayOfWeek: number;
  retentionInDays: number;
  includesClickhouse: boolean;
}

function readBoolean(value: JSONValue | undefined, fallback: boolean): boolean {
  if (typeof value === "boolean") {
    return value;
  }

  if (value === "true") {
    return true;
  }

  if (value === "false") {
    return false;
  }

  return fallback;
}

export function readBackupSchedule(
  values: JSONObject,
): BackupScheduleSubmission {
  const frequency: string = readText(values["frequency"]);
  const day: number = parseInt(readText(values["dayOfWeek"]), 10);
  const retention: number = parseInt(readText(values["retentionInDays"]), 10);

  return {
    frequency: isBackupFrequency(frequency)
      ? frequency
      : DEFAULT_BACKUP_FREQUENCY,
    timeOfDay: readText(values["timeOfDay"]) || DEFAULT_BACKUP_TIME_OF_DAY,
    dayOfWeek: Number.isInteger(day) ? day : DEFAULT_BACKUP_DAY_OF_WEEK,
    retentionInDays: Number.isInteger(retention)
      ? retention
      : DEFAULT_BACKUP_RETENTION_IN_DAYS,
    includesClickhouse: readBoolean(values["includesClickhouse"], true),
  };
}

/*
 * Whether an edit keeps the stored credentials: it stays with the same
 * destination. Another product of the same storage (MinIO to Cloudflare
 * R2, both S3-compatible) has keys of its own, so it asks for them.
 */
export function keepsStoredBackupSecrets(data: {
  provider: BackupProvider | string | undefined;
  setting?: BackupSetting | undefined;
}): boolean {
  if (!data.setting?.id || !data.provider) {
    return false;
  }

  const stored: BackupProviderDefinition | undefined = resolveBackupProvider({
    type: data.setting.destinationType,
    provider: data.setting.destinationProvider,
  });

  return stored?.provider === data.provider;
}

function keepsStoredSecrets(data: {
  submission: BackupDestinationSubmission;
  setting?: BackupSetting | undefined;
}): boolean {
  return keepsStoredBackupSecrets({
    provider: data.submission.destinationProvider,
    setting: data.setting,
  });
}

/*
 * What the form tests: the settings as typed, never saved. On edit, the
 * saved settings' id with the edits over them - a blank credential is
 * tested with the stored one, which the server reads and never returns.
 */
export function backupTestBody(data: {
  values: JSONObject;
  setting?: BackupSetting | undefined;
}): JSONObject {
  const submission: BackupDestinationSubmission = readBackupDestination(
    data.values,
  );
  const schedule: BackupScheduleSubmission = readBackupSchedule(data.values);

  return {
    ...(data.setting?.id ? { settingId: data.setting.id.toString() } : {}),
    destinationType: submission.destinationType,
    destinationProvider: submission.destinationProvider,
    config: submission.config,
    secrets: submission.secrets,
    includesClickhouse: schedule.includesClickhouse,
  };
}

/*
 * Why the form's test cannot run yet: a destination to pick, a required
 * setting left empty, or - for new settings, or a new kind of storage - a
 * credential to paste (there is no stored one to fall back on).
 */
export function backupTestDisabledReason(data: {
  values: JSONObject;
  setting?: BackupSetting | undefined;
}): string | undefined {
  const provider: BackupProviderDefinition | undefined = readBackupProvider(
    data.values,
  );
  const definition: BackupDestinationDefinition | undefined =
    getBackupDestinationDefinition(provider?.type);

  if (!provider || !definition) {
    return BackupsCopy.testChooseDestinationFirst;
  }

  const config: JSONObject = readConfig(provider, definition, data.values);

  const isMissing: (
    field: BackupDestinationField,
    fieldName: string,
  ) => boolean = (
    field: BackupDestinationField,
    fieldName: string,
  ): boolean => {
    return (
      field.required &&
      isBackupFieldShown({ definition, field, config }) &&
      readText(data.values[fieldName] as JSONValue | undefined) === "" &&
      readBackupConfigValue({}, field) === undefined
    );
  };

  if (
    definition.configFields.some((field: BackupDestinationField): boolean => {
      return isMissing(
        field,
        backupConfigFieldName(provider.provider, field.key),
      );
    })
  ) {
    return BackupsCopy.testFillSettingsFirst;
  }

  if (
    keepsStoredSecrets({
      submission: {
        destinationType: provider.type,
        destinationProvider: provider.provider,
        config,
        secrets: {},
      },
      setting: data.setting,
    })
  ) {
    return undefined;
  }

  return definition.secretFields.some(
    (field: BackupDestinationField): boolean => {
      return isMissing(
        field,
        backupSecretFieldName(provider.provider, field.key),
      );
    },
  )
    ? BackupsCopy.testPasteCredentialsFirst
    : undefined;
}

// The form's values for saved settings: their config, never their credentials.
export function getBackupFormInitialValues(
  setting: BackupSetting | undefined,
): JSONObject {
  const values: JSONObject = {
    frequency: setting?.frequency || DEFAULT_BACKUP_FREQUENCY,
    timeOfDay: setting?.timeOfDay || DEFAULT_BACKUP_TIME_OF_DAY,
    dayOfWeek: String(setting?.dayOfWeek ?? DEFAULT_BACKUP_DAY_OF_WEEK),
    retentionInDays: String(
      setting?.retentionInDays ?? DEFAULT_BACKUP_RETENTION_IN_DAYS,
    ),
    includesClickhouse: setting ? setting.includesClickhouse !== false : true,
  };

  if (!setting?.destinationType) {
    return values;
  }

  const provider: BackupProviderDefinition | undefined = resolveBackupProvider({
    type: setting.destinationType,
    provider: setting.destinationProvider,
  });
  const definition: BackupDestinationDefinition | undefined =
    getBackupDestinationDefinition(setting.destinationType);

  if (!provider || !definition) {
    return values;
  }

  values[BACKUP_PROVIDER_FIELD] = provider.provider;

  const config: JSONObject = setting.config || {};

  for (const field of definition.configFields) {
    const value: JSONValue | undefined = config[field.key] as
      | JSONValue
      | undefined;

    if (value !== undefined && value !== null && value !== "") {
      values[backupConfigFieldName(provider.provider, field.key)] =
        typeof value === "number" ? String(value) : value;
    }
  }

  return values;
}

/*
 * What a save sends: the destination (credentials only when typed, or when
 * the storage changed and the stored ones cannot apply), and the schedule.
 */
export function backupSettingPayload(data: {
  values: JSONObject;
  setting?: BackupSetting | undefined;
}): JSONObject {
  const submission: BackupDestinationSubmission = readBackupDestination(
    data.values,
  );
  const schedule: BackupScheduleSubmission = readBackupSchedule(data.values);
  const sendsSecrets: boolean =
    Object.keys(submission.secrets).length > 0 ||
    !keepsStoredSecrets({ submission, setting: data.setting });

  return {
    destinationType: submission.destinationType,
    destinationProvider: submission.destinationProvider,
    config: submission.config,
    ...(sendsSecrets ? { secrets: JSON.stringify(submission.secrets) } : {}),
    frequency: schedule.frequency,
    timeOfDay: schedule.timeOfDay,
    dayOfWeek: schedule.dayOfWeek,
    retentionInDays: schedule.retentionInDays,
    includesClickhouse: schedule.includesClickhouse,
  };
}
