import {
  PRIVATE_USER_SESSION_IDLE_DAYS,
  PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS,
} from "Common/Types/StatusPage/PrivateUserSessionLength";
import {
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import { getPageAnchorNameForTitle } from "Common/UI/Utils/PageAnchor";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Reader Sessions card on a status page's Security -> Access page: how long a
 * reader stays signed in after signing in, however active they are
 * (StatusPage.privateUserSessionLengthInHours, see
 * Common/Types/StatusPage/PrivateUserSessionLength). One pick from a short
 * list, which saves the moment it is made, as the other settings on the
 * page do.
 *
 * Without a limit, a reader stays signed in for as long as they open the
 * page at least once every 30 days, and an identity provider is asked only
 * at the first sign-in. With one, readers sign in again that often - with
 * SSO, back through the identity provider, which decides afresh.
 *
 * Kept free of React so the card and its tests read these exact strings.
 * Every string is a whole sentence or a whole name, wrapped in
 * translationKey() so npm run i18n:extract finds it, and translated in all
 * seventeen Dashboard locale files. The lengths are the Dashboard's own
 * "1 hour", "1 day", "{{count}} hours" and "{{count}} days", translated as
 * everywhere else they are used.
 */

export const STATUS_PAGE_SESSION_LENGTH_CARD_TEST_ID: string =
  "status-page-session-length";

export const STATUS_PAGE_SESSION_LENGTH_SETTING_TEST_ID: string =
  "status-page-session-length-setting";

// The dropdown's value for "No limit": the column holds nothing then.
export const NO_SESSION_LENGTH_VALUE: number = 0;

export interface SessionLengthChoice {
  // Hours, or NO_SESSION_LENGTH_VALUE for no limit.
  value: number;
  /*
   * What the option reads as, in English: translated where it is drawn,
   * with labelValues filled in when it has them ("{{count}} days").
   */
  label: string;
  labelValues?: Record<string, string> | undefined;
}

const ONE_HOUR: string = translationKey("1 hour");
const ONE_DAY: string = translationKey("1 day");
const COUNT_HOURS: string = translationKey("{{count}} hours");
const COUNT_DAYS: string = translationKey("{{count}} days");

/*
 * What a length reads as: in whole days when it is days, in hours when it
 * is not ("36 hours"), whichever length it is.
 */
export const getSessionLengthLabel: (
  hours: number,
) => Pick<SessionLengthChoice, "label" | "labelValues"> = (
  hours: number,
): Pick<SessionLengthChoice, "label" | "labelValues"> => {
  if (hours === 1) {
    return { label: ONE_HOUR };
  }

  if (hours === 24) {
    return { label: ONE_DAY };
  }

  if (hours % 24 === 0) {
    return { label: COUNT_DAYS, labelValues: { count: String(hours / 24) } };
  }

  return { label: COUNT_HOURS, labelValues: { count: String(hours) } };
};

export const StatusPageSessionLengthCopy: {
  cardTitle: string;
  cardDescription: string;
  label: string;
  noLimit: string;
  noLimitDescription: string;
  limitDescription: string;
} = {
  cardTitle: translationKey("Reader Sessions"),
  cardDescription: translationKey(
    "How long readers stay signed in to this status page after they sign in.",
  ),
  label: translationKey("Sign readers out after"),
  noLimit: translationKey("No limit"),
  noLimitDescription: translationKey(
    "Readers stay signed in as long as they open the page at least once every 30 days.",
  ),
  limitDescription: translationKey(
    "Readers sign in again this long after they signed in, however active they are. With SSO or OIDC, your identity provider checks them again then. This applies to readers who are signed in now.",
  ),
};

/*
 * The choices the dropdown offers, No limit first. A length the page holds
 * that the list does not offer (set through the API or Terraform) is
 * offered too, in its place by length, so the dropdown always shows what
 * the page has.
 */
export const getSessionLengthChoices: (
  savedLengthInHours: number | null,
) => Array<SessionLengthChoice> = (
  savedLengthInHours: number | null,
): Array<SessionLengthChoice> => {
  const hours: Array<number> = [
    ...PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS,
  ];

  if (savedLengthInHours !== null && !hours.includes(savedLengthInHours)) {
    hours.push(savedLengthInHours);
    hours.sort((first: number, second: number): number => {
      return first - second;
    });
  }

  return [
    {
      value: NO_SESSION_LENGTH_VALUE,
      label: StatusPageSessionLengthCopy.noLimit,
    },
    ...hours.map((value: number): SessionLengthChoice => {
      return {
        value,
        ...getSessionLengthLabel(value),
      };
    }),
  ];
};

// Whether a length is one the list does not offer (set through the API).
export const isOtherSessionLength: (value: number) => boolean = (
  value: number,
): boolean => {
  return (
    value !== NO_SESSION_LENGTH_VALUE &&
    !PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS.includes(value)
  );
};

// The dropdown's value for what the column holds, and back.
export const toSessionLengthChoiceValue: (
  lengthInHours: number | null,
) => number = (lengthInHours: number | null): number => {
  return lengthInHours === null ? NO_SESSION_LENGTH_VALUE : lengthInHours;
};

export const fromSessionLengthChoiceValue: (value: number) => number | null = (
  value: number,
): number | null => {
  return value === NO_SESSION_LENGTH_VALUE ? null : value;
};

// The sentence under the dropdown, for what it is set to.
export const getSessionLengthDescription: (
  lengthInHours: number | null,
) => string = (lengthInHours: number | null): string => {
  return lengthInHours === null
    ? StatusPageSessionLengthCopy.noLimitDescription
    : StatusPageSessionLengthCopy.limitDescription;
};

// Kept in step with the sentence above, which says "30 days" in words.
export const SESSION_IDLE_DAYS_IN_COPY: number = PRIVATE_USER_SESSION_IDLE_DAYS;

// A length as it reads: "1 hour", "8 hours", "30 days", in the reader's language.
export const getSessionLengthText: (
  lengthInHours: number,
  translator: Translator,
) => string = (lengthInHours: number, translator: Translator): string => {
  const length: Pick<SessionLengthChoice, "label" | "labelValues"> =
    getSessionLengthLabel(lengthInHours);

  return length.labelValues
    ? translator.translateTemplate(length.label, length.labelValues)
    : translator.translateText(length.label) || length.label;
};

/*
 * The card's place in the Access page's More settings: its title's
 * (#reader-sessions), the Enterprise card's and the upsell's alike.
 */
export const STATUS_PAGE_SESSION_LENGTH_PLACE: string =
  getPageAnchorNameForTitle(StatusPageSessionLengthCopy.cardTitle);

/*
 * Reader Sessions as the Access page's folded More settings names it: a
 * chip with the length while one is set ("Reader Sessions: 8 hours"), its
 * name otherwise - where every page starts. Unread (undefined), its name.
 */
export const getSessionLengthFoldedItem: (
  lengthInHours: number | null | undefined,
  translator: Translator,
) => FoldedSectionItem = (
  lengthInHours: number | null | undefined,
  translator: Translator,
): FoldedSectionItem => {
  const isSet: boolean = typeof lengthInHours === "number" && lengthInHours > 0;

  return foldedSectionItem(StatusPageSessionLengthCopy.cardTitle, {
    key: STATUS_PAGE_SESSION_LENGTH_PLACE,
    isSet: isSet,
    value: isSet
      ? getSessionLengthText(lengthInHours as number, translator)
      : undefined,
  });
};

export default StatusPageSessionLengthCopy;
