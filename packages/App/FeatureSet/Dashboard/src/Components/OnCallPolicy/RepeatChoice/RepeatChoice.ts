import { getOnCallPolicyRepeatsAllowed } from "Common/Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import { getIncomingCallPolicyRepeatsAllowed } from "Common/Types/IncomingCall/IncomingCallPolicyRepeat";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT HAPPENS AFTER THE LAST LEVEL: ONE PLAIN CHOICE.
 *
 * An on-call policy's Repeat Policy card, and an incoming call policy's
 * Settings, used to ask two things: a switch ("Repeat if no one
 * acknowledges", "Repeat Policy If No One Answers") whose help explained
 * both of its modes, and a number ("Number of times to repeat", "Repeat
 * Policy Times") that only meant something while the switch was on. On an
 * on-call policy the pair could even say "repeat" and never repeat: the
 * switch on, the number left at 0 - the card then had to explain that the
 * policy "still runs only once".
 *
 * Read together they are one question with two plain answers: stop, or
 * start again from the first level - and only then, how many more times.
 * So each card asks exactly that: a choice, Stop first (what a new policy
 * does), and the number under it only once Start again is picked. Each
 * answer is written into the same two columns, which are unchanged: the
 * API, Terraform, the escalation worker and the call handler keep what
 * they mean.
 *
 * What a stored pair reads as is what it does, read by the same function
 * the worker or the call handler reads it with:
 *   - on-call policy: getOnCallPolicyRepeatsAllowed - the switch on with
 *     0 repeats runs once, so it reads as Stop;
 *   - incoming call policy: getIncomingCallPolicyRepeatsAllowed - the
 *     switch on with 0 rings again once, so it reads as Start again, once.
 *
 * Kept free of React, so App/Tests can read it.
 */

export enum RepeatChoice {
  // After the last level the run ends.
  Stop = "stop",
  // After the last level the first level is paged (or rung) again.
  StartAgain = "start-again",
}

// The answers, in the order the cards offer them: what a new policy does first.
export const REPEAT_CHOICES: ReadonlyArray<RepeatChoice> = [
  RepeatChoice.Stop,
  RepeatChoice.StartAgain,
];

// How many more times a policy starts again when Start again is first picked.
export const DEFAULT_REPEAT_TIMES: number = 1;

// The form value the choice keeps: form-only, never sent.
export const REPEAT_CHOICE_FIELD_KEY: string = "repeatChoice";

// The two columns a choice writes, as each model names them.
export interface RepeatColumnNames {
  // The switch: true to start again.
  repeat: string;
  // How many more times.
  times: string;
}

export interface RepeatChoiceText {
  title: string;
  description: string;
}

export interface RepeatChoiceCopy {
  cardTitle: string;
  cardDescription: string;
  dialogTitle: string;
  // The question the choice answers.
  fieldTitle: string;
  choices: Record<RepeatChoice, RepeatChoiceText>;
  timesTitle: string;
  timesDescription: string;
  // The card's one row: its label, and the Stop answer's title as its value.
  rowTitle: string;
  /*
   * The row's value while the policy starts again; {{times}} is "2 more
   * times", a plural looked up where it is drawn (RepeatChoiceSummary).
   */
  startAgainSummary: string;
}

export interface RepeatChoiceConfig {
  columns: RepeatColumnNames;
  copy: RepeatChoiceCopy;
  /*
   * How many times the stored pair starts again, read as the worker or the
   * call handler reads it.
   */
  getRepeatsAllowed: (record: Record<string, unknown>) => number;
  // What the number column holds for a new record (its column default).
  timesColumnDefault: number;
  // data-testid prefix of the card and its dialog.
  dataTestId: string;
}

export const ON_CALL_POLICY_REPEAT: RepeatChoiceConfig = {
  columns: {
    repeat: "repeatPolicyIfNoOneAcknowledges",
    times: "repeatPolicyIfNoOneAcknowledgesNoOfTimes",
  },
  copy: {
    cardTitle: translationKey("Repeat Policy"),
    cardDescription: translationKey(
      "What happens when nobody acknowledges after the last level.",
    ),
    dialogTitle: translationKey("Edit Repeat Policy"),
    fieldTitle: translationKey("If nobody acknowledges after the last level"),
    choices: {
      [RepeatChoice.Stop]: {
        title: translationKey("Stop paging"),
        description: translationKey("Nobody is paged again."),
      },
      [RepeatChoice.StartAgain]: {
        title: translationKey("Start again from Level 1"),
        description: translationKey("Every level is paged again, in order."),
      },
    },
    timesTitle: translationKey("How many more times?"),
    timesDescription: translationKey("After that, paging stops."),
    rowTitle: translationKey("After the last level"),
    startAgainSummary: translationKey(
      "Start again from Level 1, up to {{times}}",
    ),
  },
  getRepeatsAllowed: (record: Record<string, unknown>): number => {
    return getOnCallPolicyRepeatsAllowed({
      repeatPolicyIfNoOneAcknowledges: record[
        "repeatPolicyIfNoOneAcknowledges"
      ] as boolean | null | undefined,
      repeatPolicyIfNoOneAcknowledgesNoOfTimes: record[
        "repeatPolicyIfNoOneAcknowledgesNoOfTimes"
      ] as number | null | undefined,
    });
  },
  timesColumnDefault: 0,
  dataTestId: "repeat-policy",
};

export const INCOMING_CALL_POLICY_REPEAT: RepeatChoiceConfig = {
  columns: {
    repeat: "repeatPolicyIfNoOneAnswers",
    times: "repeatPolicyIfNoOneAnswersTimes",
  },
  copy: {
    cardTitle: translationKey("Repeat Policy"),
    cardDescription: translationKey(
      "What happens when nobody answers after the last rule.",
    ),
    dialogTitle: translationKey("Edit Repeat Policy"),
    fieldTitle: translationKey("If nobody answers after the last rule"),
    choices: {
      [RepeatChoice.Stop]: {
        title: translationKey("End the call"),
        description: translationKey("The caller hears the No Answer Message."),
      },
      [RepeatChoice.StartAgain]: {
        title: translationKey("Ring again from the first rule"),
        description: translationKey("Every rule rings again, in order."),
      },
    },
    timesTitle: translationKey("How many more times?"),
    timesDescription: translationKey(
      "After that, the caller hears the No Answer Message.",
    ),
    rowTitle: translationKey("After the last rule"),
    startAgainSummary: translationKey(
      "Ring again from the first rule, up to {{times}}",
    ),
  },
  getRepeatsAllowed: (record: Record<string, unknown>): number => {
    return getIncomingCallPolicyRepeatsAllowed({
      repeatPolicyIfNoOneAnswers: record["repeatPolicyIfNoOneAnswers"] as
        | boolean
        | null
        | undefined,
      repeatPolicyIfNoOneAnswersTimes: record[
        "repeatPolicyIfNoOneAnswersTimes"
      ] as number | null | undefined,
    });
  },
  timesColumnDefault: 1,
  dataTestId: "incoming-call-repeat",
};

const asRecord: (values: unknown) => Record<string, unknown> = (
  values: unknown,
): Record<string, unknown> => {
  return values && typeof values === "object"
    ? (values as Record<string, unknown>)
    : {};
};

// The answer a stored pair (or a form's values) makes: what it does.
export const getRepeatChoice: (
  config: RepeatChoiceConfig,
  values: unknown,
) => RepeatChoice = (
  config: RepeatChoiceConfig,
  values: unknown,
): RepeatChoice => {
  return config.getRepeatsAllowed(asRecord(values)) > 0
    ? RepeatChoice.StartAgain
    : RepeatChoice.Stop;
};

// How many more times a stored pair starts again; 0 while it stops.
export const getRepeatTimes: (
  config: RepeatChoiceConfig,
  values: unknown,
) => number = (config: RepeatChoiceConfig, values: unknown): number => {
  return config.getRepeatsAllowed(asRecord(values));
};

export const isRepeatChoice: (value: unknown) => value is RepeatChoice = (
  value: unknown,
): value is RepeatChoice => {
  return REPEAT_CHOICES.includes(value as RepeatChoice);
};

// A whole number of at least 1, or null for anything else (an emptied box).
export const readRepeatTimes: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const times: number = Number(value);

  if (!Number.isFinite(times) || !Number.isInteger(times) || times < 1) {
    return null;
  }

  return times;
};

// A stored number of times: a whole number of 0 or more, or null.
const readStoredTimes: (value: unknown) => number | null = (
  value: unknown,
): number | null => {
  if (value === null || value === undefined) {
    return null;
  }

  if (typeof value === "string" && !value.trim()) {
    return null;
  }

  const times: number = Number(value);

  if (!Number.isFinite(times) || !Number.isInteger(times) || times < 0) {
    return null;
  }

  return times;
};

/*
 * The form values a picked answer makes, written into the two columns:
 *   - Start again: the switch on, and how many more times - the number the
 *     pair starts again with now, else the number left in the box (a policy
 *     whose repeats were switched off gets its old number back), else 1;
 *   - Stop: the switch off, and the number left as it is: while the switch
 *     is off it means nothing, and the API, Terraform and the worker read
 *     the pair that way. An emptied box (a Number field sends "", which
 *     Postgres refuses) gets the column's default back.
 */
export const getValuesForRepeatChoice: (data: {
  config: RepeatChoiceConfig;
  values: unknown;
  choice: RepeatChoice;
}) => Record<string, unknown> = (data: {
  config: RepeatChoiceConfig;
  values: unknown;
  choice: RepeatChoice;
}): Record<string, unknown> => {
  const values: Record<string, unknown> = asRecord(data.values);
  const columns: RepeatColumnNames = data.config.columns;

  if (data.choice === RepeatChoice.StartAgain) {
    const repeatsNow: number = data.config.getRepeatsAllowed(values);

    return {
      ...values,
      [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.StartAgain,
      [columns.repeat]: true,
      [columns.times]:
        repeatsNow > 0
          ? repeatsNow
          : readRepeatTimes(values[columns.times]) || DEFAULT_REPEAT_TIMES,
    };
  }

  const storedTimes: number | null = readStoredTimes(values[columns.times]);

  return {
    ...values,
    [REPEAT_CHOICE_FIELD_KEY]: RepeatChoice.Stop,
    [columns.repeat]: false,
    [columns.times]:
      storedTimes !== null ? storedTimes : data.config.timesColumnDefault,
  };
};
