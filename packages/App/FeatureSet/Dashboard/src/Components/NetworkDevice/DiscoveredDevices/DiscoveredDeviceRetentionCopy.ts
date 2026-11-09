import {
  DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS,
  DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS,
  KEEP_EVERY_DISCOVERED_DEVICE,
  isDiscoveredDeviceRetentionOn,
} from "Common/Types/NetworkDevice/DiscoveredDeviceRetention";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * UNSEEN DEVICES (issue #6389): how long a device the project's switches,
 * routers and network controllers saw stays on the Discovered Devices list
 * once nothing sees it any more (Project.discoveredDeviceRetentionInDays,
 * Common/Types/NetworkDevice/DiscoveredDeviceRetention).
 *
 *   - The list says it in one quiet line under the table: "Devices not seen
 *     for 30 days are removed, unless they are monitored or classified.",
 *     with Change for whoever may change it - on a site's list too.
 *   - The setting is one pick, "Remove after", that saves the moment it is
 *     made: a card folded under the Discovered Devices page's More settings,
 *     at #unseen-devices. Folded, the header says what it is set to while it
 *     is not the default ("Unseen Devices: Never").
 *
 * Kept free of React so the card, the list, the page and their tests read
 * these exact strings. Every string is a whole sentence or a whole name,
 * wrapped in translationKey() (or a PluralTemplate) so npm run i18n:extract
 * finds it, and translated in every Dashboard locale file. The lengths are
 * the Dashboard's own "{{count}} days", translated as everywhere else.
 */

export const DISCOVERED_DEVICE_RETENTION_CARD_TEST_ID: string =
  "discovered-device-retention";

export const DISCOVERED_DEVICE_RETENTION_SETTING_TEST_ID: string =
  "discovered-device-retention-setting";

export const DISCOVERED_DEVICES_RETENTION_LINE_TEST_ID: string =
  "discovered-devices-retention-line";

export const DISCOVERED_DEVICES_MORE_SETTINGS_TEST_ID: string =
  "discovered-devices-more-settings";

export const DiscoveredDeviceRetentionCopy: {
  cardTitle: string;
  cardDescription: string;
  label: string;
  never: string;
  onDescription: string;
  offDescription: string;
  keptLine: string;
  change: string;
} = {
  cardTitle: translationKey("Unseen Devices"),
  cardDescription: translationKey(
    "Remove discovered devices nothing has seen for a while. Monitored and classified devices, and ones someone added or changed, always stay.",
  ),
  label: translationKey("Remove after"),
  never: translationKey("Never"),
  // Under the pick, for a length.
  onDescription: translationKey(
    "Checked every hour. Nothing is removed while the switch or controller that saw a device reports nothing, and a device seen again comes back as new.",
  ),
  // Under the pick, for Never.
  offDescription: translationKey(
    "Every device stays until someone deletes it, however long ago it was last seen.",
  ),
  // The list's line, for Never.
  keptLine: translationKey(
    "Devices stay on this list however long ago they were last seen.",
  ),
  // After the list's line, for whoever may change it.
  change: translationKey("Change"),
};

// A length, as the pick and the folded header say it: "30 days".
export const DISCOVERED_DEVICE_RETENTION_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

/*
 * The list's line, for a length. Never said for one day (the shortest is
 * seven), but a plural all the same, so {{count}} is written the reader's
 * way (Persian digits in Persian).
 */
export const DISCOVERED_DEVICE_RETENTION_LINE: PluralTemplate = {
  one: "Devices not seen for {{count}} day are removed, unless they are monitored or classified.",
  other:
    "Devices not seen for {{count}} days are removed, unless they are monitored or classified.",
};

/*
 * The card's place on the Discovered Devices page, its title's
 * (#unseen-devices): where Change and a search for it open the page's More
 * settings.
 */
export const DISCOVERED_DEVICE_RETENTION_PLACE: string =
  getPageAnchorNameForTitle(DiscoveredDeviceRetentionCopy.cardTitle);

// The pick's values: the lengths, shortest first, then Never.
export const getDiscoveredDeviceRetentionChoices: () => Array<number> =
  (): Array<number> => {
    return [
      ...DISCOVERED_DEVICE_RETENTION_CHOICES_IN_DAYS,
      KEEP_EVERY_DISCOVERED_DEVICE,
    ];
  };

// A length as it reads: "30 days", or "Never", in the reader's language.
export const getDiscoveredDeviceRetentionText: (
  retentionInDays: number,
  translator: Translator,
) => string = (retentionInDays: number, translator: Translator): string => {
  if (!isDiscoveredDeviceRetentionOn(retentionInDays)) {
    return (
      translator.translateText(DiscoveredDeviceRetentionCopy.never) ||
      DiscoveredDeviceRetentionCopy.never
    );
  }

  return translator.translatePlural(
    DISCOVERED_DEVICE_RETENTION_DAYS,
    retentionInDays,
  );
};

// The sentence under the pick, for what it is set to.
export const getDiscoveredDeviceRetentionDescription: (
  retentionInDays: number,
) => string = (retentionInDays: number): string => {
  return isDiscoveredDeviceRetentionOn(retentionInDays)
    ? DiscoveredDeviceRetentionCopy.onDescription
    : DiscoveredDeviceRetentionCopy.offDescription;
};

// The list's line, in the reader's language.
export const getDiscoveredDeviceRetentionLine: (
  retentionInDays: number,
  translator: Translator,
) => string = (retentionInDays: number, translator: Translator): string => {
  if (!isDiscoveredDeviceRetentionOn(retentionInDays)) {
    return (
      translator.translateText(DiscoveredDeviceRetentionCopy.keptLine) ||
      DiscoveredDeviceRetentionCopy.keptLine
    );
  }

  return translator.translatePlural(
    DISCOVERED_DEVICE_RETENTION_LINE,
    retentionInDays,
  );
};

/*
 * Unseen Devices as the page's folded More settings names it: a chip with
 * what it is set to while that is not the default ("Unseen Devices:
 * Never", "Unseen Devices: 90 days"), its name otherwise - where every
 * project starts. Unread (undefined), its name.
 */
export const getDiscoveredDeviceRetentionFoldedItem: (
  retentionInDays: number | undefined,
  translator: Translator,
) => FoldedSectionItem = (
  retentionInDays: number | undefined,
  translator: Translator,
): FoldedSectionItem => {
  const isSet: boolean =
    typeof retentionInDays === "number" &&
    retentionInDays !== DEFAULT_DISCOVERED_DEVICE_RETENTION_IN_DAYS;

  return foldedSectionItem(DiscoveredDeviceRetentionCopy.cardTitle, {
    key: DISCOVERED_DEVICE_RETENTION_PLACE,
    isSet: isSet,
    value: isSet
      ? getDiscoveredDeviceRetentionText(retentionInDays as number, translator)
      : undefined,
  });
};

export default DiscoveredDeviceRetentionCopy;
