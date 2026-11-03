import Email from "Common/Types/Email";
import Phone from "Common/Types/Phone";
import SubscriberContactKey from "Common/Types/StatusPage/SubscriberContactKey";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT ADD IN BULK ADDS, ONE ENTRY PER LINE.
 *
 * Add in Bulk on a status page's subscriber lists and on its private users
 * takes what was pasted, or the rows of a CSV file, and adds one record for
 * each (useStatusPageBulkAdd). Every entry is accounted for in the result:
 * added, not added with the server's reason, or skipped - a line that is
 * not an address or a number is never sent, and is listed with why. A line
 * that says the same as one before it is added once, as the forms say
 * ("Invalid and duplicate ones are skipped").
 *
 * React-free, so the parsing is tested on its own.
 */

export interface StatusPageBulkAddEntry {
  // What is added, and how the result names it: an address, a number, a URL.
  value: string;
  /*
   * Why it is left out, when it is: nothing is sent for it, and the result
   * lists it as skipped, with this reason.
   */
  skippedReason?: string | undefined;
  // A CSV file's row, for its other columns (a Slack workspace's name).
  row?: Record<string, string> | undefined;
}

export const BULK_ADD_EMAIL_NOT_VALID: string = translationKey(
  "Email is not valid.",
);

export const BULK_ADD_PHONE_NOT_VALID: string = translationKey(
  "Phone number is not valid.",
);

/*
 * The result's words: what Add in Bulk did is add, so "1,997 Subscribers
 * added", "1 Subscriber not added" (the server's reason under it) and
 * "2 Subscribers skipped" (not an address, with why).
 */
export const BULK_ADD_RESULT_LABELS: {
  succeeded: PluralTemplate;
  failed: PluralTemplate;
  unchanged: PluralTemplate;
} = {
  succeeded: {
    one: "{{count}} {{itemName}} added",
    other: "{{count}} {{itemsName}} added",
  },
  failed: {
    one: "{{count}} {{itemName}} not added",
    other: "{{count}} {{itemsName}} not added",
  },
  unchanged: {
    one: "{{count}} {{itemName}} skipped",
    other: "{{count}} {{itemsName}} skipped",
  },
};

// Addresses are pasted one a line, or separated by commas or spaces.
const EMAIL_SEPARATORS: RegExp = /[\s,;]+/;

/*
 * Numbers one a line, or separated by commas: never by spaces, which a
 * number is often written with ("+1 415 555 0100").
 */
const PHONE_SEPARATORS: RegExp = /[\n,;]+/;

const splitLines: (input: string, separators: RegExp) => Array<string> = (
  input: string,
  separators: RegExp,
): Array<string> => {
  return (input || "")
    .split(separators)
    .map((line: string): string => {
      return line.trim();
    })
    .filter((line: string): boolean => {
      return line.length > 0;
    });
};

/*
 * The pasted email addresses, in the order they were pasted: each address
 * once, in lower case as it is kept; a line that is not an address as it
 * was written, skipped with why.
 */
export const getBulkEmailEntries: (
  input: string,
) => Array<StatusPageBulkAddEntry> = (
  input: string,
): Array<StatusPageBulkAddEntry> => {
  const seen: Set<string> = new Set<string>();
  const entries: Array<StatusPageBulkAddEntry> = [];

  for (const line of splitLines(input, EMAIL_SEPARATORS)) {
    const normalized: string = line.toLowerCase();

    if (seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);

    entries.push(
      Email.isValid(normalized)
        ? { value: normalized }
        : { value: line, skippedReason: BULK_ADD_EMAIL_NOT_VALID },
    );
  }

  return entries;
};

/*
 * The pasted phone numbers, in the order they were pasted: one number once
 * however it is written - a status page takes each line once
 * (SubscriberContactKey), so "+1 415 555 0100" after "+14155550100" would
 * only be refused as already subscribed - and a line that is not a number
 * skipped with why.
 */
export const getBulkPhoneEntries: (
  input: string,
) => Array<StatusPageBulkAddEntry> = (
  input: string,
): Array<StatusPageBulkAddEntry> => {
  const seen: Set<string> = new Set<string>();
  const entries: Array<StatusPageBulkAddEntry> = [];

  for (const line of splitLines(input, PHONE_SEPARATORS)) {
    const key: string = SubscriberContactKey.forPhone(line) || line;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);

    let isValid: boolean = true;

    try {
      new Phone(line);
    } catch {
      isValid = false;
    }

    entries.push(
      isValid
        ? { value: line }
        : { value: line, skippedReason: BULK_ADD_PHONE_NOT_VALID },
    );
  }

  return entries;
};

/*
 * A CSV file's rows, in the file's order: the value is the row's URL, the
 * contact a subscriber is told on, which the result names it by.
 */
export const getBulkCsvEntries: (
  rows: Array<Record<string, string>>,
  valueColumn: string,
) => Array<StatusPageBulkAddEntry> = (
  rows: Array<Record<string, string>>,
  valueColumn: string,
): Array<StatusPageBulkAddEntry> => {
  return rows.map((row: Record<string, string>): StatusPageBulkAddEntry => {
    return { value: (row[valueColumn] || "").trim(), row: row };
  });
};

// Whether anything would be sent at all: one entry not skipped.
export const hasBulkAddEntryToAdd: (
  entries: Array<StatusPageBulkAddEntry>,
) => boolean = (entries: Array<StatusPageBulkAddEntry>): boolean => {
  return entries.some((entry: StatusPageBulkAddEntry): boolean => {
    return !entry.skippedReason;
  });
};
