import {
  PRIVATE_USER_SESSION_IDLE_DAYS,
  PRIVATE_USER_SESSION_LENGTH_CHOICES_IN_HOURS,
} from "Common/Types/StatusPage/PrivateUserSessionLength";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * The Sessions card on a status page's Security -> Access page: how long a
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
 * seventeen Dashboard locale files.
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
  // What the option reads as, in English: translated where it is drawn.
  label: string;
}

const CHOICE_LABELS: Record<number, string> = {
  1: translationKey("1 hour"),
  4: translationKey("4 hours"),
  8: translationKey("8 hours"),
  12: translationKey("12 hours"),
  24: translationKey("1 day"),
  72: translationKey("3 days"),
  168: translationKey("7 days"),
  336: translationKey("14 days"),
  720: translationKey("30 days"),
};

export const StatusPageSessionLengthCopy: {
  cardTitle: string;
  cardDescription: string;
  label: string;
  noLimit: string;
  noLimitDescription: string;
  limitDescription: string;
  // A length set through the API that the list does not offer.
  otherLength: string;
} = {
  cardTitle: translationKey("Sessions"),
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
  otherLength: translationKey("{{hours}} hours"),
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
        label: CHOICE_LABELS[value] || StatusPageSessionLengthCopy.otherLength,
      };
    }),
  ];
};

// Whether a choice reads its hours into the label ("36 hours").
export const isOtherSessionLength: (value: number) => boolean = (
  value: number,
): boolean => {
  return value !== NO_SESSION_LENGTH_VALUE && !CHOICE_LABELS[value];
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

export default StatusPageSessionLengthCopy;
