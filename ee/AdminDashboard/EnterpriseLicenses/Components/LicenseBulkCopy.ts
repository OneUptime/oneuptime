import EnterpriseLicenseUsageUtil from "Common/Utils/EnterpriseLicense/EnterpriseLicenseUsage";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Enterprise Licenses list says when licenses are deleted or have
 * their expiry changed - one at a time from a row's ⋯, or several at once
 * from Bulk Actions.
 *
 * A license is named by its company AND its masked key: the Admin Dashboard
 * can hold two licenses for one company (an evaluation and the production
 * one, or a duplicate made by mistake), and a dialog asking "Delete
 * Netlock.hu?" twice over could not say which. The key is masked exactly as
 * the list's License Key column shows it, so the name in a dialog is
 * something the reader can find in the row.
 *
 * Kept free of React so ee/Tests read these exact strings, and every one has
 * an entry in all seventeen Admin Dashboard locale files
 * (ee/Tests/UI/EnterpriseLicenses/LicenseBulkLocales).
 */

// Between a license's company and its masked key, in every language.
export const LICENSE_NAME_SEPARATOR: string = " · ";

/*
 * A license as a row, a dialog and a bulk result name it: "Netlock.hu ·
 * da74••••7c7a". Either half alone when the other is missing.
 */
export const getLicenseItemName: (license: {
  companyName?: string | undefined;
  licenseKey?: string | undefined;
}) => string = (license: {
  companyName?: string | undefined;
  licenseKey?: string | undefined;
}): string => {
  const company: string = license.companyName?.trim() || "";
  const key: string = license.licenseKey?.trim()
    ? EnterpriseLicenseUsageUtil.maskLicenseKey(license.licenseKey.trim())
    : "";

  return [company, key]
    .filter((part: string): boolean => {
      return part.length > 0;
    })
    .join(LICENSE_NAME_SEPARATOR);
};

/*
 * A date as its calendar day ("2027-10-14"), as the date field gives the day
 * picked and as the license's expiry is stored (midnight UTC of that day).
 * Empty for no date.
 */
export const toCalendarDay: (
  value: Date | string | undefined | null,
) => string = (value: Date | string | undefined | null): string => {
  if (!value) {
    return "";
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return date.toISOString().slice(0, 10);
};

// Whether a license already expires on the day picked.
export const expiresOnDay: (
  expiresAt: Date | string | undefined | null,
  day: string,
) => boolean = (
  expiresAt: Date | string | undefined | null,
  day: string,
): boolean => {
  const picked: string = toCalendarDay(day);

  return picked.length > 0 && toCalendarDay(expiresAt) === picked;
};

export interface LicenseBulkCopyStrings {
  // The Bulk Actions item, the dialog's title and its button.
  changeExpiryTitle: string;
  // What the change does, counted by the licenses selected.
  changeExpiryDescription: PluralTemplate;
  newExpiryDateTitle: string;
  newExpiryDateDescription: string;
  // Why a license the change leaves alone is listed as not changed.
  alreadyExpiresOnDay: string;
  // The result's counts.
  updatedCount: PluralTemplate;
  notUpdatedCount: PluralTemplate;
}

export const LicenseBulkCopy: LicenseBulkCopyStrings = {
  changeExpiryTitle: translationKey("Change Expiry Date"),
  changeExpiryDescription: {
    one: "The selected license will expire on the date you pick.",
    other: "The {{count}} selected licenses will expire on the date you pick.",
  },
  newExpiryDateTitle: translationKey("New Expiry Date"),
  /*
   * What happens to the customers, not only to the rows: an installation
   * reads its license's terms back with its daily report to oneuptime.com,
   * so a new expiry reaches it within a day - at once if an admin there
   * presses Refresh license (the button on its own license dialog).
   */
  newExpiryDateDescription: translationKey(
    "A date after today. Installations get it with their daily report, or at once when their admin presses Refresh license.",
  ),
  alreadyExpiresOnDay: translationKey("Already expires on this date."),
  updatedCount: {
    one: "{{count}} {{itemName}} updated",
    other: "{{count}} {{itemsName}} updated",
  },
  notUpdatedCount: {
    one: "{{count}} {{itemName}} not updated",
    other: "{{count}} {{itemsName}} not updated",
  },
};

export default LicenseBulkCopy;
