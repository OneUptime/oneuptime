import { DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES } from "Common/Types/NetworkDevice/DiscoveryImport";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * How each polling interval reads, in English - the keys every language's
 * Dashboard looks the words up under. Whole phrases, not a number dropped
 * into "Every {{count}} minutes", so a language words "every hour" its own
 * way. Shared by the import dialog's "Check every" and the auto import
 * rule's, so both read alike.
 */
export const POLLING_INTERVAL_LABELS: Readonly<Record<number, string>> = {
  1: translationKey("Every minute"),
  2: translationKey("Every 2 minutes"),
  5: translationKey("Every 5 minutes"),
  10: translationKey("Every 10 minutes"),
  15: translationKey("Every 15 minutes"),
  30: translationKey("Every 30 minutes"),
  60: translationKey("Every hour"),
};

// The English label of an interval; a value that is no choice reads as minutes.
export function getPollingIntervalLabel(minutes: number): string {
  return POLLING_INTERVAL_LABELS[minutes] || `Every ${minutes} minutes`;
}

/*
 * The intervals as dropdown options, in English: the Dropdown looks each
 * label up in the reader's language itself.
 */
export function getPollingIntervalOptions(): Array<DropdownOption> {
  return DISCOVERY_IMPORT_POLLING_INTERVALS_IN_MINUTES.map(
    (minutes: number): DropdownOption => {
      return {
        value: minutes,
        label: getPollingIntervalLabel(minutes),
      };
    },
  );
}
