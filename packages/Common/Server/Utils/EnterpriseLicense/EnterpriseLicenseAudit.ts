import EnterpriseLicense from "../../../Models/DatabaseModels/EnterpriseLicense";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import EnterpriseLicenseUsageUtil from "../../../Utils/EnterpriseLicense/EnterpriseLicenseUsage";

/*
 * The audit trail of OneUptime Cloud's enterprise licenses.
 *
 * A license belongs to no project - only OneUptime's master admins read or
 * write one (the model's access control is empty) - so the audit log, which
 * is kept per project, has nowhere to put a change to it. Master admin
 * actions are recorded the way the Admin Dashboard's others are (a project's
 * trial extended, a user's two factor auth required): a server log line
 * naming who did it and what changed. EnterpriseLicenseService writes one for
 * every license deleted and every change to a license's terms a person
 * makes; the license server's own bookkeeping (the seat counts it writes)
 * goes without hooks and is not a person's change.
 *
 * A line never carries a license key, only its masked form (the four
 * characters at each end, as the Admin Dashboard's list shows it): the key
 * is what an installation activates with, and a log line is read by more
 * people than the license screens are.
 */

// Every record's own columns: its id, its timestamps and its version.
export const LICENSE_RECORD_COLUMNS: ReadonlyArray<string> = [
  "_id",
  "createdAt",
  "updatedAt",
  "deletedAt",
  "version",
];

/*
 * The license server's own bookkeeping: the seat counts installations
 * report, which it writes without hooks. Never a person's change.
 */
export const LICENSE_SERVER_BOOKKEEPING_COLUMNS: ReadonlyArray<
  keyof EnterpriseLicense & string
> = [
  "currentUserCount",
  "userCountUpdatedAt",
  "userCountSource",
  "legacyUserCount",
  "legacyUserCountUpdatedAt",
];

/*
 * The license terms a person sets - on the Admin Dashboard's license forms,
 * with the bulk expiry change, or through the API - whose changes are
 * recorded: every column of the license but the record's own and the
 * license server's bookkeeping, in the order the model declares them. Read
 * off the model, so a term added to it later is recorded too, and so this
 * file names only the terms it treats in a way of its own.
 */
export const ENTERPRISE_LICENSE_AUDITED_COLUMNS: ReadonlyArray<string> =
  new EnterpriseLicense()
    .getTableColumns()
    .columns.filter((column: string): boolean => {
      return (
        !LICENSE_RECORD_COLUMNS.includes(column) &&
        !(LICENSE_SERVER_BOOKKEEPING_COLUMNS as ReadonlyArray<string>).includes(
          column,
        )
      );
    });

/*
 * Columns whose values a line never prints: the contact's email address is a
 * person's, so the line says only that it changed.
 */
const VALUE_NOT_PRINTED: ReadonlySet<string> = new Set<string>(["email"]);

/*
 * The audited columns an update writes, in the order above. Empty for an
 * update that writes none of them.
 */
export const getAuditedColumnsWritten: (
  data: JSONObject | undefined | null,
) => Array<string> = (data: JSONObject | undefined | null): Array<string> => {
  if (!data) {
    return [];
  }

  return ENTERPRISE_LICENSE_AUDITED_COLUMNS.filter((column: string) => {
    return Object.prototype.hasOwnProperty.call(data, column);
  });
};

// A date as its calendar day, the way the license screens show expiry.
const toCalendarDay: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const date: Date =
    value instanceof Date ? value : new Date(String(value).trim());

  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toISOString().slice(0, 10);
};

// One column's value as a line prints it.
export const formatAuditedValue: (column: string, value: unknown) => string = (
  column: string,
  value: unknown,
): string => {
  if (value === null || value === undefined || value === "") {
    return "none";
  }

  if (column === "licenseKey") {
    return EnterpriseLicenseUsageUtil.maskLicenseKey(String(value).trim());
  }

  if (column === "expiresAt") {
    return toCalendarDay(value) || "none";
  }

  return String(value);
};

/*
 * Whether a written value is the one the row holds already: an expiry on the
 * same calendar day, a key that trims to the same key, the same number.
 */
const isSameValue: (
  column: string,
  before: unknown,
  after: unknown,
) => boolean = (column: string, before: unknown, after: unknown): boolean => {
  if (column === "expiresAt") {
    return toCalendarDay(before) === toCalendarDay(after);
  }

  const normalize: (value: unknown) => string = (value: unknown): string => {
    if (value === null || value === undefined) {
      return "";
    }

    return String(value).trim();
  };

  return normalize(before) === normalize(after);
};

// The license as a line names it: its id, its company and its masked key.
export const describeLicenseForAudit: (license: EnterpriseLicense) => string = (
  license: EnterpriseLicense,
): string => {
  const company: string = license.companyName?.trim() || "no company name";
  const key: string = license.licenseKey
    ? EnterpriseLicenseUsageUtil.maskLicenseKey(license.licenseKey.trim())
    : "no key";

  return `${license.id?.toString() || "unknown id"} (${company}, key ${key})`;
};

// Who made the change, as far as the request says.
export const describeActorForAudit: (
  props: DatabaseCommonInteractionProps,
) => string = (props: DatabaseCommonInteractionProps): string => {
  const userId: string = props.userId?.toString() || "";

  if (props.isMasterAdmin) {
    return `master admin ${userId || "unknown"}`;
  }

  if (userId) {
    return `user ${userId}`;
  }

  return "OneUptime";
};

// The line for a license that was issued.
export const buildLicenseIssuedAuditLine: (data: {
  license: EnterpriseLicense;
  props: DatabaseCommonInteractionProps;
}) => string = (data: {
  license: EnterpriseLicense;
  props: DatabaseCommonInteractionProps;
}): string => {
  return `Enterprise license ${describeLicenseForAudit(data.license)}, expiring ${formatAuditedValue(
    "expiresAt",
    data.license.expiresAt,
  )}, issued by ${describeActorForAudit(data.props)}.`;
};

// The line for a license that was deleted.
export const buildLicenseDeletedAuditLine: (data: {
  license: EnterpriseLicense;
  props: DatabaseCommonInteractionProps;
}) => string = (data: {
  license: EnterpriseLicense;
  props: DatabaseCommonInteractionProps;
}): string => {
  return `Enterprise license ${describeLicenseForAudit(data.license)}, expiring ${formatAuditedValue(
    "expiresAt",
    data.license.expiresAt,
  )}, deleted by ${describeActorForAudit(data.props)}.`;
};

/*
 * The line for an update of one license: every audited column the update
 * wrote that now holds another value, old to new. Null when it changed none
 * of them - a save that rewrote the same terms is not a change.
 */
export const buildLicenseUpdatedAuditLine: (data: {
  before: EnterpriseLicense;
  written: JSONObject;
  props: DatabaseCommonInteractionProps;
}) => string | null = (data: {
  before: EnterpriseLicense;
  written: JSONObject;
  props: DatabaseCommonInteractionProps;
}): string | null => {
  const changes: Array<string> = [];

  for (const column of getAuditedColumnsWritten(data.written)) {
    const before: unknown = (data.before as unknown as JSONObject)[column];
    const after: unknown = data.written[column];

    if (isSameValue(column, before, after)) {
      continue;
    }

    if (VALUE_NOT_PRINTED.has(column)) {
      changes.push(`${column} changed`);
      continue;
    }

    changes.push(
      `${column} ${formatAuditedValue(column, before)} -> ${formatAuditedValue(
        column,
        after,
      )}`,
    );
  }

  if (changes.length === 0) {
    return null;
  }

  return `Enterprise license ${describeLicenseForAudit(data.before)} changed by ${describeActorForAudit(
    data.props,
  )}: ${changes.join("; ")}.`;
};
