import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { SubscriberEmailFooterCopy } from "./SubscriberEmailFooterCopy";
import {
  getSubscriberRestrictionsFoldedItem,
  SubscriberRestrictionsState,
} from "./SubscriberRestrictionsCopy";

/*
 * SUBSCRIBERS -> SUBSCRIBER SETTINGS: WHAT VISITORS PICK WHEN THEY
 * SUBSCRIBE, AND WHAT IS RARELY CHANGED.
 *
 * The page ended in four cards drawn the old way, each with an "Edit Status
 * Page" button: "Advanced Subscriber Settings - Advanced subscriber settings
 * for this status page." (two switches and the subscriber timezones), "Email
 * Footer Settings" (a switch, "Enable Custom Email Footer Text - If
 * disabled, default footer text will be used.", over the text it turned on),
 * "Custom SMTP" and "Twilio Config".
 *
 * The two switches decide whether the subscribe form lets a visitor pick
 * what they hear about - which parts of the page, which kinds of event - so
 * they are their own card now, Subscriber Choices, each saved the moment it
 * is flipped like every other switch on the page. That also lets the
 * timezones be saved on any plan: the two switches can only be turned on on
 * the Scale plan, and the old dialog sent all three columns at once, so on
 * a lower plan, while either switch was on (left on by a trial, say), it
 * refused to save a timezone (ColumnPermission refuses a plan-gated column
 * in a write unless it puts the column back to its default). A switch the
 * plan does not allow says which plan does, beside it.
 *
 * The footer is one choice: the default footer, or your own text
 * (SubscriberEmailFooter.ts). The timezones, the footer, and the page's own
 * mail server and Twilio account are set once, if ever, so they are folded
 * under More settings, which names them - and says what each is set to when
 * it is not what a new page starts with.
 *
 * Kept free of React so the components and App/Tests read these exact
 * strings. Every string is a whole sentence or a whole name, wrapped in
 * translationKey() so npm run i18n:extract finds it, and translated in all
 * seventeen Dashboard locale files.
 */

// The status page columns the Subscriber Choices card switches.
export type SubscriberChoiceColumn =
  | "allowSubscribersToChooseResources"
  | "allowSubscribersToChooseEventTypes";

export const SUBSCRIBER_CHOICE_COLUMNS: ReadonlyArray<SubscriberChoiceColumn> =
  ["allowSubscribersToChooseResources", "allowSubscribersToChooseEventTypes"];

export const SUBSCRIBER_CHOICES_CARD_TEST_ID: string =
  "status-page-subscriber-choices";

// The data-testid of a column's switch on the card.
export const getSubscriberChoiceSwitchTestId: (
  column: SubscriberChoiceColumn,
) => string = (column: SubscriberChoiceColumn): string => {
  return `subscriber-choice-switch-${column}`;
};

// The page's folded More settings section.
export const SUBSCRIBER_SETTINGS_MORE_TEST_ID: string =
  "status-page-subscriber-settings-more";

export const SubscriberChoicesCopy: {
  cardTitle: string;
  cardDescription: string;
  resourcesTitle: string;
  resourcesOnDescription: string;
  resourcesOffDescription: string;
  eventTypesTitle: string;
  eventTypesOnDescription: string;
  eventTypesOffDescription: string;
  // More settings, and the cards in it.
  moreDescription: string;
  timezonesTitle: string;
  timezonesDescription: string;
  timezonesPlaceholder: string;
  smtpTitle: string;
  smtpDescription: string;
  smtpPlaceholder: string;
  twilioTitle: string;
  twilioDescription: string;
  twilioPlaceholder: string;
  /*
   * Under the page's Twilio config when that config is used for calls only
   * (Common/Types/CallAndSMS/TwilioConfigUse): it sends no SMS, so the
   * page's subscribers get theirs as without a config. The picker no longer
   * offers such a config; a page keeps one that was switched afterwards.
   */
  twilioCallsOnlyNote: string;
} = {
  cardTitle: translationKey("Subscriber Choices"),
  cardDescription: translationKey(
    "What visitors can pick when they subscribe.",
  ),
  resourcesTitle: translationKey("Allow Subscribers to Choose Resources"),
  resourcesOnDescription: translationKey(
    "On: visitors pick the monitors and groups they hear about.",
  ),
  resourcesOffDescription: translationKey(
    "Off: subscribers hear about everything on this status page.",
  ),
  eventTypesTitle: translationKey("Allow Subscribers to Choose Event Types"),
  eventTypesOnDescription: translationKey(
    "On: visitors pick from incidents, announcements and scheduled maintenance.",
  ),
  eventTypesOffDescription: translationKey(
    "Off: subscribers hear about every kind of event.",
  ),
  moreDescription: translationKey(
    "Who can subscribe, timezones, the email footer, and your own mail server or Twilio account.",
  ),
  timezonesTitle: translationKey("Subscriber Timezones"),
  timezonesDescription: translationKey(
    "Times in notifications are shown in these timezones.",
  ),
  timezonesPlaceholder: translationKey(
    "None picked: times are shown in UTC, London, New York, Los Angeles, Kolkata and Sydney time.",
  ),
  smtpTitle: translationKey("Custom SMTP"),
  smtpDescription: translationKey(
    "Send subscriber email from your own mail server.",
  ),
  smtpPlaceholder: translationKey("None: OneUptime sends subscriber email."),
  twilioTitle: translationKey("Twilio Config"),
  twilioDescription: translationKey(
    "Send subscriber text messages from your own Twilio account.",
  ),
  twilioPlaceholder: translationKey(
    "None: OneUptime sends subscriber text messages.",
  ),
  twilioCallsOnlyNote: translationKey(
    "Used for calls only: OneUptime sends subscriber text messages.",
  ),
};

// The sentence under a choice's switch, for the way it is set.
export const getSubscriberChoiceDescription: (
  column: SubscriberChoiceColumn,
  isOn: boolean,
) => string = (column: SubscriberChoiceColumn, isOn: boolean): string => {
  if (column === "allowSubscribersToChooseResources") {
    return isOn
      ? SubscriberChoicesCopy.resourcesOnDescription
      : SubscriberChoicesCopy.resourcesOffDescription;
  }

  return isOn
    ? SubscriberChoicesCopy.eventTypesOnDescription
    : SubscriberChoicesCopy.eventTypesOffDescription;
};

// A choice's switch title.
export const getSubscriberChoiceTitle: (
  column: SubscriberChoiceColumn,
) => string = (column: SubscriberChoiceColumn): string => {
  return column === "allowSubscribersToChooseResources"
    ? SubscriberChoicesCopy.resourcesTitle
    : SubscriberChoicesCopy.eventTypesTitle;
};

/*
 * What the cards under More settings hold, as each one has loaded it.
 * Anything not loaded yet is left out, and counts as what a new status page
 * starts with.
 */
export interface SubscriberSettingsMoreValues {
  restrictions?: SubscriberRestrictionsState | undefined;
  timezoneCount?: number | undefined;
  isCustomFooter?: boolean | undefined;
  smtpConfigName?: string | null | undefined;
  twilioConfigName?: string | null | undefined;
}

/*
 * What the folded More settings header lists: its five cards, each a chip
 * once it holds something a new status page does not - who may subscribe,
 * how many timezones, your own footer, which mail server, which Twilio
 * account - so folding never hides a setting in force.
 */
export const getSubscriberSettingsMoreItems: (
  values: SubscriberSettingsMoreValues,
) => Array<FoldedSectionItem> = (
  values: SubscriberSettingsMoreValues,
): Array<FoldedSectionItem> => {
  const timezoneCount: number = values.timezoneCount || 0;

  return [
    getSubscriberRestrictionsFoldedItem(values.restrictions),
    foldedSectionItem(SubscriberChoicesCopy.timezonesTitle, {
      isSet: timezoneCount > 0,
      value: String(timezoneCount),
    }),
    foldedSectionItem(SubscriberEmailFooterCopy.cardTitle, {
      isSet: values.isCustomFooter === true,
      value: SubscriberEmailFooterCopy.customTitle,
      translateValue: true,
    }),
    foldedSectionItem(SubscriberChoicesCopy.smtpTitle, {
      isSet: Boolean(values.smtpConfigName),
      value: values.smtpConfigName || undefined,
    }),
    foldedSectionItem(SubscriberChoicesCopy.twilioTitle, {
      isSet: Boolean(values.twilioConfigName),
      value: values.twilioConfigName || undefined,
    }),
  ];
};

export default SubscriberChoicesCopy;
