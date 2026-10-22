import {
  DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES,
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
  getOnCallAcknowledgementTimeoutInMinutes,
} from "Common/Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * A POLICY'S ACKNOWLEDGEMENT TIMEOUT, IN THE DASHBOARD: ONE PLAIN CHOICE,
 * FOLDED AWAY.
 *
 * "Page again if it is acknowledged but not resolved in N minutes" (issue
 * #5123; what it does is in Common/Types/OnCallDutyPolicy/
 * OnCallAcknowledgementTimeout). Most teams never need it, so it is not on
 * the policy's Escalation Rules page until somebody opens More settings at
 * the bottom - which names it, and says what it is set to while it is on.
 *
 * Its card asks one thing, as the Repeat Policy card above it does: don't
 * page again (what every policy does until somebody changes it), or page
 * again - and only then, after how many minutes (half an hour to start
 * with). Who is paged and how many times is decided for everybody, so there
 * is nothing else to pick. Both answers write the one column,
 * acknowledgementTimeoutInMinutes: empty, or the minutes.
 *
 * Kept free of React, so App/Tests can read it.
 */

export enum AcknowledgementTimeoutChoice {
  // Acknowledging stops the paging for good: what every policy does at first.
  Off = "off",
  // Pages again when it is still not resolved after the minutes chosen.
  PageAgain = "page-again",
}

// The answers, in the order the card offers them.
export const ACKNOWLEDGEMENT_TIMEOUT_CHOICES: ReadonlyArray<AcknowledgementTimeoutChoice> =
  [AcknowledgementTimeoutChoice.Off, AcknowledgementTimeoutChoice.PageAgain];

// The policy's column both answers write.
export const ACKNOWLEDGEMENT_TIMEOUT_COLUMN: string =
  "acknowledgementTimeoutInMinutes";

// The form value the choice keeps: form-only, never sent.
export const ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY: string =
  "acknowledgementTimeoutChoice";

// data-testid prefix of the card, its dialog and the fold around it.
export const ACKNOWLEDGEMENT_TIMEOUT_TEST_ID: string =
  "acknowledgement-timeout";

export const ACKNOWLEDGEMENT_TIMEOUT_MORE_SETTINGS_TEST_ID: string =
  "on-call-policy-more-settings";

export const AcknowledgementTimeoutCopy: {
  cardTitle: string;
  cardDescription: string;
  dialogTitle: string;
  fieldTitle: string;
  choices: Record<
    AcknowledgementTimeoutChoice,
    { title: string; description: string }
  >;
  minutesTitle: string;
  minutesDescription: string;
  rowTitle: string;
  pageAgainSummary: PluralTemplate;
  foldedValue: string;
} = {
  cardTitle: translationKey("Acknowledgement Timeout"),
  cardDescription: translationKey(
    "What happens when someone acknowledges but nobody resolves.",
  ),
  dialogTitle: translationKey("Edit Acknowledgement Timeout"),
  fieldTitle: translationKey("If it is acknowledged but not resolved"),
  choices: {
    [AcknowledgementTimeoutChoice.Off]: {
      title: translationKey("Don't page again"),
      description: translationKey("Acknowledging stops the paging for good."),
    },
    [AcknowledgementTimeoutChoice.PageAgain]: {
      title: translationKey("Page again"),
      description: translationKey(
        "Pages whoever acknowledged it, and whoever is on call now.",
      ),
    },
  },
  minutesTitle: translationKey("After how many minutes?"),
  /*
   * "5 times at most" is ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
   * the same for every policy (a test holds the two together).
   */
  minutesDescription: translationKey(
    "Counted from each acknowledgement. It pages again 5 times at most.",
  ),
  rowTitle: translationKey("After an acknowledgement"),
  /*
   * The card's row while it pages again: "Page again if not resolved within
   * 30 minutes". A plural, looked up with the minutes as its count.
   */
  pageAgainSummary: {
    one: "Page again if not resolved within {{count}} minute",
    other: "Page again if not resolved within {{count}} minutes",
  },
  // What More settings says it is set to, folded: "30 min".
  foldedValue: translationKey("{{minutes}} min"),
};

// The minutes "Page again" starts with, the bounds the box takes, and the cap.
export const ACKNOWLEDGEMENT_TIMEOUT_DEFAULT_MINUTES: number =
  DEFAULT_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES;
export const ACKNOWLEDGEMENT_TIMEOUT_MIN_MINUTES: number =
  MIN_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES;
export const ACKNOWLEDGEMENT_TIMEOUT_MAX_MINUTES: number =
  MAX_ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_IN_MINUTES;
export const ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN: number =
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN;

const asRecord: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

/*
 * The policy's timeout in minutes, read from a stored policy (or a form's
 * values) as the worker reads it; null while it does not page again.
 */
export const getAcknowledgementTimeoutMinutes: (
  values: unknown,
) => number | null = (values: unknown): number | null => {
  return getOnCallAcknowledgementTimeoutInMinutes({
    acknowledgementTimeoutInMinutes: asRecord(values)[
      ACKNOWLEDGEMENT_TIMEOUT_COLUMN
    ] as number | null | undefined,
  });
};

export const isAcknowledgementTimeoutChoice: (
  value: unknown,
) => value is AcknowledgementTimeoutChoice = (
  value: unknown,
): value is AcknowledgementTimeoutChoice => {
  return ACKNOWLEDGEMENT_TIMEOUT_CHOICES.includes(
    value as AcknowledgementTimeoutChoice,
  );
};

// The answer a stored policy makes: what it does.
export const getAcknowledgementTimeoutChoice: (
  values: unknown,
) => AcknowledgementTimeoutChoice = (
  values: unknown,
): AcknowledgementTimeoutChoice => {
  return getAcknowledgementTimeoutMinutes(values) === null
    ? AcknowledgementTimeoutChoice.Off
    : AcknowledgementTimeoutChoice.PageAgain;
};

/*
 * The answer the form shows: the one picked in it, once one is - so
 * emptying the minutes box to type another number does not flip it back to
 * Don't page again - and otherwise the one the stored policy makes.
 */
export const getAcknowledgementTimeoutChoiceInForm: (
  values: unknown,
) => AcknowledgementTimeoutChoice = (
  values: unknown,
): AcknowledgementTimeoutChoice => {
  const picked: unknown = asRecord(values)[
    ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY
  ];

  if (isAcknowledgementTimeoutChoice(picked)) {
    return picked;
  }

  return getAcknowledgementTimeoutChoice(values);
};

/*
 * The form values a picked answer makes, in the one column:
 *   - Page again: the minutes the policy pages again after now, else 30;
 *   - Don't page again: empty.
 */
export const getValuesForAcknowledgementTimeoutChoice: (data: {
  values: unknown;
  choice: AcknowledgementTimeoutChoice;
}) => Record<string, unknown> = (data: {
  values: unknown;
  choice: AcknowledgementTimeoutChoice;
}): Record<string, unknown> => {
  const values: Record<string, unknown> = asRecord(data.values);

  if (data.choice === AcknowledgementTimeoutChoice.PageAgain) {
    return {
      ...values,
      [ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY]:
        AcknowledgementTimeoutChoice.PageAgain,
      [ACKNOWLEDGEMENT_TIMEOUT_COLUMN]:
        getAcknowledgementTimeoutMinutes(values) ??
        ACKNOWLEDGEMENT_TIMEOUT_DEFAULT_MINUTES,
    };
  }

  return {
    ...values,
    [ACKNOWLEDGEMENT_TIMEOUT_CHOICE_FIELD_KEY]: AcknowledgementTimeoutChoice.Off,
    [ACKNOWLEDGEMENT_TIMEOUT_COLUMN]: null,
  };
};
