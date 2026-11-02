import {
  DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES,
  MINUTES_IN_A_DAY,
  MINUTES_IN_AN_HOUR,
  SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES,
  SESSION_LENGTH_CHOICES_IN_MINUTES,
} from "Common/Types/UserSession/SessionLength";
import {
  FOLDED_SECTION_ON,
  FoldedSectionItem,
  foldedSectionItem,
} from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * What the Session Length page says (Admin Dashboard > Settings > Session
 * Length, Common/Types/UserSession/SessionLength.ts), kept free of React so
 * the page and its tests read the same words. Every sentence is an English
 * key of the Admin Dashboard's locale files, in every language; the shared
 * components translate them where they are shown. The lengths are "1 hour",
 * "1 day", "{{count}} hours", "{{count}} days" and "{{count}} minutes", in
 * the Dashboard's words for them (its Reader Sessions card says them too).
 */

export const SESSION_LENGTH_PAGE_TEST_ID: string = "session-length-settings";

export const SESSION_LENGTH_CARD_TEST_ID: string = "session-length-card";

export const SSO_SESSION_LENGTH_CARD_TEST_ID: string =
  "sso-session-length-card";

export const SESSION_LENGTH_MORE_SETTINGS_TEST_ID: string =
  "session-length-more-settings";

// One row's test id, by what it sets ("session-length-row-sessionLengthInMinutes").
export const getSessionLengthRowTestId: (column: string) => string = (
  column: string,
): string => {
  return `session-length-row-${column}`;
};

/*
 * The dropdowns' value for what the column holds when nothing is set: No
 * limit for a session length, 30 days for an idle timeout.
 */
export const DEFAULT_CHOICE_VALUE: number = 0;

export interface SessionLengthChoice {
  // Minutes, or DEFAULT_CHOICE_VALUE for the default.
  value: number;
  // English: translated where it is drawn, filled with labelValues when it has them.
  label: string;
  labelValues?: Record<string, string> | undefined;
}

const ONE_HOUR: string = translationKey("1 hour");
const ONE_DAY: string = translationKey("1 day");
const COUNT_MINUTES: string = translationKey("{{count}} minutes");
const COUNT_HOURS: string = translationKey("{{count}} hours");
const COUNT_DAYS: string = translationKey("{{count}} days");

export const SessionLengthCopy: {
  cardTitle: string;
  cardDescription: string;
  lengthLabel: string;
  noLimit: string;
  lengthNoLimitDescription: string;
  lengthSetDescription: string;
  idleLabel: string;
  idleDefaultDescription: string;
  idleSetDescription: string;
  moreSettingsDescription: string;
  ssoCardTitle: string;
  ssoCardDescription: string;
  separateTitle: string;
  separateOffDescription: string;
  separateOnDescription: string;
  notSessionsNote: string;
  loadFailed: string;
  confirmTitle: string;
  confirmIncludesYou: string;
  confirmUnknown: string;
  confirmButton: string;
  confirmUnknownButton: string;
} = {
  cardTitle: translationKey("Session Length"),
  cardDescription: translationKey(
    "How long people stay signed in to the Dashboard, the Admin Dashboard and the mobile app. A change applies to everyone signed in now.",
  ),
  lengthLabel: translationKey("Sign people out after"),
  noLimit: translationKey("No limit"),
  lengthNoLimitDescription: translationKey(
    "People stay signed in for as long as they keep using OneUptime.",
  ),
  lengthSetDescription: translationKey(
    "Everyone signs in again this long after they signed in, however active they are.",
  ),
  idleLabel: translationKey("Sign people out after inactivity"),
  idleDefaultDescription: translationKey(
    "People who have not used OneUptime for 30 days sign in again. It cannot be longer.",
  ),
  idleSetDescription: translationKey(
    "People who have not clicked, typed or scrolled in OneUptime for this long sign in again.",
  ),
  moreSettingsDescription: translationKey(
    "Lengths of their own for sign-ins through SSO.",
  ),
  ssoCardTitle: translationKey("SSO Sign-ins"),
  ssoCardDescription: translationKey(
    "Sign-ins through a project's SAML or OpenID Connect provider, or the server's own.",
  ),
  separateTitle: translationKey("Separate lengths for SSO sign-ins"),
  separateOffDescription: translationKey(
    "SSO sign-ins follow Session Length above.",
  ),
  separateOnDescription: translationKey(
    "SSO sign-ins follow the two settings below. Every other sign-in follows Session Length above.",
  ),
  notSessionsNote: translationKey(
    "API keys and MCP connections are not sign-ins: they keep their own expiry.",
  ),
  loadFailed: translationKey("The session lengths could not be read."),
  confirmTitle: translationKey("Sign people out now?"),
  confirmIncludesYou: translationKey(
    "That includes you: you will go to the sign-in page, and back to this page once you sign in.",
  ),
  confirmUnknown: translationKey(
    "This signs out everyone whose sign-in is already older, or has been idle longer, than it allows.",
  ),
  confirmButton: translationKey("Save and sign them out"),
  confirmUnknownButton: translationKey("Save"),
};

// How many people a change signs out at once, in the confirmation.
export const SESSION_LENGTH_SIGNS_OUT: PluralTemplate = {
  one: translationKey(
    "Saving this signs out {{count}} person right away: their sign-in is already older, or has been idle longer, than it allows.",
  ),
  other: translationKey(
    "Saving this signs out {{count}} people right away: their sign-ins are already older, or have been idle longer, than it allows.",
  ),
};

/*
 * What a length reads as: in whole days when it is days, in hours when it
 * is hours, in minutes otherwise - whichever length it is.
 */
export const getDurationLabel: (
  minutes: number,
) => Pick<SessionLengthChoice, "label" | "labelValues"> = (
  minutes: number,
): Pick<SessionLengthChoice, "label" | "labelValues"> => {
  if (minutes === MINUTES_IN_A_DAY) {
    return { label: ONE_DAY };
  }

  if (minutes % MINUTES_IN_A_DAY === 0) {
    return {
      label: COUNT_DAYS,
      labelValues: { count: String(minutes / MINUTES_IN_A_DAY) },
    };
  }

  if (minutes === MINUTES_IN_AN_HOUR) {
    return { label: ONE_HOUR };
  }

  if (minutes % MINUTES_IN_AN_HOUR === 0) {
    return {
      label: COUNT_HOURS,
      labelValues: { count: String(minutes / MINUTES_IN_AN_HOUR) },
    };
  }

  return { label: COUNT_MINUTES, labelValues: { count: String(minutes) } };
};

// A choice's words in the reader's language.
export const getChoiceText: (
  choice: Pick<SessionLengthChoice, "label" | "labelValues">,
  translator: Translator,
) => string = (
  choice: Pick<SessionLengthChoice, "label" | "labelValues">,
  translator: Translator,
): string => {
  return choice.labelValues
    ? translator.translateTemplate(choice.label, choice.labelValues)
    : translator.translateText(choice.label) || choice.label;
};

// The minutes listed, with a saved one the list does not offer in its place by length.
const withSaved: (
  minutes: ReadonlyArray<number>,
  saved: number | null,
) => Array<number> = (
  minutes: ReadonlyArray<number>,
  saved: number | null,
): Array<number> => {
  const all: Array<number> = [...minutes];

  if (
    saved !== null &&
    saved !== DEFAULT_CHOICE_VALUE &&
    !all.includes(saved)
  ) {
    all.push(saved);
    all.sort((first: number, second: number): number => {
      return first - second;
    });
  }

  return all;
};

/*
 * The session lengths offered, No limit first. A length the server holds
 * that the list does not offer (set through the API) is offered too, in its
 * place by length, so the dropdown always shows what is set.
 */
export const getLengthChoices: (
  savedLengthInMinutes: number | null,
) => Array<SessionLengthChoice> = (
  savedLengthInMinutes: number | null,
): Array<SessionLengthChoice> => {
  return [
    { value: DEFAULT_CHOICE_VALUE, label: SessionLengthCopy.noLimit },
    ...withSaved(SESSION_LENGTH_CHOICES_IN_MINUTES, savedLengthInMinutes).map(
      (minutes: number): SessionLengthChoice => {
        return { value: minutes, ...getDurationLabel(minutes) };
      },
    ),
  ];
};

/*
 * The idle timeouts offered, shortest first, and last the 30 days of the
 * default - the longest there is. A timeout the server holds that the list
 * does not offer is offered too, in its place.
 */
export const getIdleChoices: (
  savedIdleTimeoutInMinutes: number | null,
) => Array<SessionLengthChoice> = (
  savedIdleTimeoutInMinutes: number | null,
): Array<SessionLengthChoice> => {
  return [
    ...withSaved(
      SESSION_IDLE_TIMEOUT_CHOICES_IN_MINUTES,
      toIdleChoiceValue(savedIdleTimeoutInMinutes) === DEFAULT_CHOICE_VALUE
        ? null
        : savedIdleTimeoutInMinutes,
    ).map((minutes: number): SessionLengthChoice => {
      return { value: minutes, ...getDurationLabel(minutes) };
    }),
    {
      value: DEFAULT_CHOICE_VALUE,
      ...getDurationLabel(DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES),
    },
  ];
};

// The dropdown's value for what a session length column holds, and back.
export const toLengthChoiceValue: (minutes: number | null) => number = (
  minutes: number | null,
): number => {
  return minutes === null ? DEFAULT_CHOICE_VALUE : minutes;
};

/*
 * The dropdown's value for what an idle timeout column holds: 30 days,
 * written out or not, is the default.
 */
export const toIdleChoiceValue: (minutes: number | null) => number = (
  minutes: number | null,
): number => {
  return minutes === null || minutes === DEFAULT_SESSION_IDLE_TIMEOUT_IN_MINUTES
    ? DEFAULT_CHOICE_VALUE
    : minutes;
};

// What a pick writes: nothing for the default, the minutes otherwise.
export const fromChoiceValue: (value: number) => number | null = (
  value: number,
): number | null => {
  return value === DEFAULT_CHOICE_VALUE ? null : value;
};

// The sentence under a session length, for what it is set to.
export const getLengthDescription: (minutes: number | null) => string = (
  minutes: number | null,
): string => {
  return minutes === null
    ? SessionLengthCopy.lengthNoLimitDescription
    : SessionLengthCopy.lengthSetDescription;
};

// The sentence under an idle timeout, for what it is set to.
export const getIdleDescription: (minutes: number | null) => string = (
  minutes: number | null,
): string => {
  return toIdleChoiceValue(minutes) === DEFAULT_CHOICE_VALUE
    ? SessionLengthCopy.idleDefaultDescription
    : SessionLengthCopy.idleSetDescription;
};

// The sentence under the SSO switch, for where it is.
export const getSeparateDescription: (isOn: boolean) => string = (
  isOn: boolean,
): string => {
  return isOn
    ? SessionLengthCopy.separateOnDescription
    : SessionLengthCopy.separateOffDescription;
};

/*
 * SSO Sign-ins as the page's folded More settings names it: "SSO Sign-ins:
 * On" while SSO sign-ins have lengths of their own, its name otherwise.
 */
export const getSsoFoldedItem: (isSeparate: boolean) => FoldedSectionItem = (
  isSeparate: boolean,
): FoldedSectionItem => {
  return foldedSectionItem(SessionLengthCopy.ssoCardTitle, {
    isSet: isSeparate,
    value: isSeparate ? FOLDED_SECTION_ON : undefined,
    translateValue: true,
  });
};

export default SessionLengthCopy;
