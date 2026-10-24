import { AuditLogExportCopy, AuditLogExportHealth } from "./AuditLogExportCopy";
import AuditLogExport from "Common/Models/DatabaseModels/AuditLogExport";
import AuditLogExportDestinationType from "Common/Types/AuditLog/Export/AuditLogExportDestinationType";
import {
  AUDIT_LOG_EXPORT_DEFAULT_FOLDER,
  AuditLogExportDestinationDefinition,
  AuditLogExportDestinationField,
  AuditLogExportDestinationKind,
  getAuditLogExportDestinationDefinition,
  isAuditLogExportFieldShown,
  readAuditLogExportConfigValue,
} from "Common/Types/AuditLog/Export/AuditLogExportDestinationCatalog";
import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import HashedString from "Common/Types/HashedString";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import {
  RelativeTimeUnit,
  TimeAgoDistance,
  getFeedLocale,
  getFeedTimeAgoDistance,
} from "Common/UI/Components/Feed/FeedTime";

/*
 * The audit log export form and table, without React: what the form's
 * values mean, what is sent to save and to test them, what the table says
 * about an export. Shared by the project's page and the instance's, and
 * pinned in ee/Tests/UI/AuditLogExport.
 */

/*
 * Each destination's fields are named apart in the one form, so a value
 * never carries over to another destination's field of the same key (S3's
 * bucket and Google Cloud Storage's).
 */
export function exportConfigFieldName(
  type: AuditLogExportDestinationType | string,
  key: string,
): string {
  return `${type}__config__${key}`;
}

export function exportSecretFieldName(
  type: AuditLogExportDestinationType | string,
  key: string,
): string {
  return `${type}__secret__${key}`;
}

/*
 * What the form saves. Not whether the export is on: that is the row's Turn
 * on and Turn off, so an edit never writes back a switch someone flipped
 * while the form was open.
 */
export interface AuditLogExportFormSubmission {
  destinationType: AuditLogExportDestinationType;
  name: string;
  config: JSONObject;
  // Only what was typed: a blank credential keeps the stored one.
  secrets: JSONObject;
  // Only when one was picked: empty on create means from now on.
  startsAt: Date | null;
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

/*
 * A pasted service account key or certificate is kept as it was pasted -
 * never trimmed inside, newlines included - so it reaches the server byte
 * for byte. Whitespace alone is blank.
 */
function readVerbatimText(value: JSONValue | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (value instanceof HashedString) {
    return readVerbatimText(value.toString());
  }

  if (typeof value === "string") {
    return value.trim() === "" ? "" : value;
  }

  return JSON.stringify(value);
}

function readFieldValue(
  field: AuditLogExportDestinationField,
  value: JSONValue | undefined,
): string {
  return field.type === "json" || field.isMultiline
    ? readVerbatimText(value)
    : readText(value);
}

// A port as the form holds it: digits only.
const WHOLE_NUMBER: RegExp = /^\d+$/;

function readStartsAt(value: JSONValue | undefined): Date | null {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(readText(value) || "");

  return Number.isNaN(date.getTime()) ? null : date;
}

// The destination the form is for: the one an edit keeps, or the one picked.
export function readExportDestinationType(
  values: JSONObject,
  lockedType?: AuditLogExportDestinationType | undefined,
): AuditLogExportDestinationType | undefined {
  const type: string = lockedType || readText(values["destinationType"]);

  return getAuditLogExportDestinationDefinition(type)?.type;
}

// The config as the form holds it, by the catalog's keys, defaults included.
function readConfig(
  definition: AuditLogExportDestinationDefinition,
  values: JSONObject,
): JSONObject {
  const config: JSONObject = {};

  for (const field of definition.configFields) {
    const value: string = readFieldValue(
      field,
      values[exportConfigFieldName(definition.type, field.key)] as
        | JSONValue
        | undefined,
    );

    if (value === "") {
      continue;
    }

    config[field.key] =
      field.type === "number" && WHOLE_NUMBER.test(value)
        ? Number(value)
        : value;
  }

  // A field another field turns off is not sent (Azure's key with a SAS token).
  for (const field of definition.configFields) {
    if (!isAuditLogExportFieldShown({ definition, field, config })) {
      delete config[field.key];
    }
  }

  return config;
}

function readSecrets(
  definition: AuditLogExportDestinationDefinition,
  values: JSONObject,
  config: JSONObject,
): JSONObject {
  const secrets: JSONObject = {};

  for (const field of definition.secretFields) {
    if (!isAuditLogExportFieldShown({ definition, field, config })) {
      continue;
    }

    const value: string = readFieldValue(
      field,
      values[exportSecretFieldName(definition.type, field.key)] as
        | JSONValue
        | undefined,
    );

    if (value !== "") {
      secrets[field.key] = value;
    }
  }

  return secrets;
}

export function readAuditLogExportForm(
  values: JSONObject,
  lockedType?: AuditLogExportDestinationType | undefined,
): AuditLogExportFormSubmission {
  const definition: AuditLogExportDestinationDefinition | undefined =
    getAuditLogExportDestinationDefinition(
      readExportDestinationType(values, lockedType),
    );

  if (!definition) {
    throw new Error(AuditLogExportCopy.testChooseDestinationFirst);
  }

  const config: JSONObject = readConfig(definition, values);

  return {
    destinationType: definition.type,
    name: readText(values["name"]) || definition.title,
    config,
    secrets: readSecrets(definition, values, config),
    startsAt: readStartsAt(values["startsAt"] as JSONValue | undefined),
  };
}

/*
 * What the form tests: the settings as typed, never saved. On edit, the
 * saved export's id with the edits over it - a blank credential is tested
 * with the stored one, which the server reads and never returns.
 */
export function auditLogExportTestBody(data: {
  values: JSONObject;
  auditLogExport?: AuditLogExport | undefined;
}): JSONObject {
  const submission: AuditLogExportFormSubmission = readAuditLogExportForm(
    data.values,
    data.auditLogExport?.destinationType,
  );

  if (data.auditLogExport?.id) {
    return {
      exportId: data.auditLogExport.id.toString(),
      config: submission.config,
      secrets: submission.secrets,
    };
  }

  return {
    destinationType: submission.destinationType,
    config: submission.config,
    secrets: submission.secrets,
  };
}

/*
 * The edit: a blank credential keeps the stored one, so it is left out, and
 * Export From is sent only when it moved - sending it starts the export
 * again from there.
 */
export function auditLogExportUpdatePayload(data: {
  submission: AuditLogExportFormSubmission;
  auditLogExport: AuditLogExport;
}): JSONObject {
  const stored: Date | null = data.auditLogExport.startsAt
    ? new Date(data.auditLogExport.startsAt)
    : null;
  // To the second: the date and time field shows no more than that.
  const toSecond: (date: Date) => number = (date: Date): number => {
    return Math.floor(date.getTime() / 1000);
  };
  const startsAtMoved: boolean = Boolean(
    data.submission.startsAt &&
      (!stored || toSecond(stored) !== toSecond(data.submission.startsAt)),
  );

  return {
    name: data.submission.name,
    config: data.submission.config,
    ...(Object.keys(data.submission.secrets).length > 0
      ? { secrets: JSON.stringify(data.submission.secrets) }
      : {}),
    ...(startsAtMoved && data.submission.startsAt
      ? { startsAt: data.submission.startsAt.toISOString() }
      : {}),
  };
}

/*
 * Why the form's test cannot run yet: a new export has no stored credential
 * to fall back on, so a required one has to be pasted first.
 */
export function auditLogExportTestDisabledReason(data: {
  values: JSONObject;
  auditLogExport?: AuditLogExport | undefined;
}): string | undefined {
  const definition: AuditLogExportDestinationDefinition | undefined =
    getAuditLogExportDestinationDefinition(
      readExportDestinationType(
        data.values,
        data.auditLogExport?.destinationType,
      ),
    );

  if (!definition) {
    return AuditLogExportCopy.testChooseDestinationFirst;
  }

  const config: JSONObject = readConfig(definition, data.values);

  const isMissing: (
    field: AuditLogExportDestinationField,
    fieldName: string,
  ) => boolean = (
    field: AuditLogExportDestinationField,
    fieldName: string,
  ): boolean => {
    return (
      field.required &&
      isAuditLogExportFieldShown({ definition, field, config }) &&
      readFieldValue(field, data.values[fieldName] as JSONValue | undefined) ===
        "" &&
      readAuditLogExportConfigValue({}, field) === undefined
    );
  };

  if (
    definition.configFields.some(
      (field: AuditLogExportDestinationField): boolean => {
        return isMissing(
          field,
          exportConfigFieldName(definition.type, field.key),
        );
      },
    )
  ) {
    return AuditLogExportCopy.testFillSettingsFirst;
  }

  if (data.auditLogExport?.id) {
    return undefined;
  }

  return definition.secretFields.some(
    (field: AuditLogExportDestinationField): boolean => {
      return isMissing(
        field,
        exportSecretFieldName(definition.type, field.key),
      );
    },
  )
    ? AuditLogExportCopy.testPasteCredentialsFirst
    : undefined;
}

// The form's values for a saved export: its config, never its credentials.
export function getAuditLogExportInitialValues(
  auditLogExport: AuditLogExport | undefined,
  lockedType: AuditLogExportDestinationType | undefined,
): JSONObject {
  const definition: AuditLogExportDestinationDefinition | undefined =
    getAuditLogExportDestinationDefinition(lockedType);

  const values: JSONObject = {
    name: auditLogExport?.name || definition?.title || "",
  };

  if (lockedType) {
    values["destinationType"] = lockedType;
  }

  if (auditLogExport?.startsAt) {
    values["startsAt"] = new Date(auditLogExport.startsAt).toISOString();
  }

  if (auditLogExport && definition) {
    const config: JSONObject = auditLogExport.config || {};

    for (const field of definition.configFields) {
      const value: JSONValue | undefined = config[field.key] as
        | JSONValue
        | undefined;

      if (value !== undefined && value !== null && value !== "") {
        values[exportConfigFieldName(definition.type, field.key)] =
          typeof value === "number" ? String(value) : value;
      }
    }
  }

  return values;
}

// Two or more slashes in a row, where a folder's own slashes meet the path's.
const REPEATED_SLASHES: RegExp = /\/+/g;

/*
 * The host (and port) of an address the form holds - a webhook's URL, an
 * S3-compatible endpoint - or the address as typed when it is not a URL.
 */
function readHost(address: string): string {
  if (!address) {
    return "";
  }

  try {
    return new URL(address).host || address;
  } catch {
    return address;
  }
}

/*
 * Where an export sends, in one short line under its name: a bucket and
 * its folder (on its endpoint's host, for S3-compatible storage), a storage
 * account and its container, a webhook's host, a syslog receiver. Never a
 * credential.
 */
export function describeAuditLogExportTarget(
  auditLogExport: Pick<AuditLogExport, "destinationType" | "config">,
): string {
  const definition: AuditLogExportDestinationDefinition | undefined =
    getAuditLogExportDestinationDefinition(auditLogExport.destinationType);
  const config: JSONObject = auditLogExport.config || {};
  const text: (key: string) => string = (key: string): string => {
    return readText(config[key] as JSONValue | undefined);
  };

  if (!definition) {
    return "";
  }

  if (definition.kind === AuditLogExportDestinationKind.Files) {
    const folder: string = text("folder") || AUDIT_LOG_EXPORT_DEFAULT_FOLDER;

    /*
     * As a path-style address reads it: minio.acme.internal:9000/audit/...
     * Without its host, every S3-compatible export read like any other
     * bucket, whichever storage it wrote to.
     */
    const place: Array<string> =
      definition.type === AuditLogExportDestinationType.AzureBlobStorage
        ? [text("accountName"), text("container"), folder]
        : definition.type === AuditLogExportDestinationType.S3Compatible
          ? [readHost(text("endpoint")), text("bucket"), folder]
          : [text("bucket"), folder];

    return place.filter(Boolean).join("/").replace(REPEATED_SLASHES, "/");
  }

  if (definition.type === AuditLogExportDestinationType.Webhook) {
    return readHost(text("url"));
  }

  const port: string = text("port");

  return port ? `${text("host")}:${port}` : text("host");
}

/*
 * The parts of Intl.NumberFormat used to word a span: its unit style is
 * newer than the ES2017 library ee compiles against, while every browser
 * the Dashboard supports has it.
 */
interface UnitNumberFormat {
  format: (value: number) => string;
}

type UnitNumberFormatConstructor = new (
  locale: string,
  options: { style: "unit"; unit: string; unitDisplay: "long" },
) => UnitNumberFormat;

const ENGLISH_DURATION_UNITS: Record<RelativeTimeUnit, [string, string]> = {
  second: ["second", "seconds"],
  minute: ["minute", "minutes"],
  hour: ["hour", "hours"],
  day: ["day", "days"],
  month: ["month", "months"],
  year: ["year", "years"],
};

/*
 * How long something has lasted, in the reader's language - "2 hours",
 * "2 Stunden", "2 時間" - for "Failing for {{duration}}". Rounded as the
 * table's "Last exported 3 minutes ago" is (getFeedTimeAgoDistance), never
 * under a minute. English when the browser cannot word the unit; empty for
 * a date that is not one.
 */
export function formatAuditLogExportDuration(data: {
  since: Date;
  now: Date;
  language: string;
}): string {
  const seconds: number = (data.now.getTime() - data.since.getTime()) / 1000;

  if (Number.isNaN(seconds)) {
    return "";
  }

  const distance: TimeAgoDistance = getFeedTimeAgoDistance(seconds);

  try {
    const NumberFormat: UnitNumberFormatConstructor =
      Intl.NumberFormat as unknown as UnitNumberFormatConstructor;

    return new NumberFormat(getFeedLocale(data.language), {
      style: "unit",
      unit: distance.unit,
      unitDisplay: "long",
    }).format(distance.count);
  } catch {
    const names: [string, string] = ENGLISH_DURATION_UNITS[distance.unit];

    return `${distance.count} ${distance.count === 1 ? names[0] : names[1]}`;
  }
}

export function getAuditLogExportHealth(
  auditLogExport: Pick<
    AuditLogExport,
    "isEnabled" | "lastError" | "lastExportedAt" | "lastAttemptAt"
  >,
): AuditLogExportHealth {
  if (auditLogExport.isEnabled === false) {
    return AuditLogExportHealth.Paused;
  }

  if (auditLogExport.lastError) {
    return AuditLogExportHealth.Failing;
  }

  if (auditLogExport.lastExportedAt) {
    return AuditLogExportHealth.Exporting;
  }

  if (auditLogExport.lastAttemptAt) {
    return AuditLogExportHealth.Waiting;
  }

  return AuditLogExportHealth.Starting;
}

export function getAuditLogExportHealthColor(
  health: AuditLogExportHealth,
): Color {
  switch (health) {
    case AuditLogExportHealth.Failing:
      return Red;
    case AuditLogExportHealth.Exporting:
      return Green;
    case AuditLogExportHealth.Paused:
      return Yellow;
    default:
      return Gray500;
  }
}
