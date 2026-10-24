import {
  DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES,
  INVESTIGATION_RULE_WAIT_COLUMN,
  MAX_INVESTIGATION_RULE_WAIT_MINUTES,
  getInvestigationRuleWaitMinutes,
  getInvestigationRuleWaitProblem,
} from "Common/Types/AI/InvestigationRuleWait";
import {
  translatePlural,
  translateText,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { AiLane } from "./ProjectAiSettingsCopy";

/*
 * WHEN AN INVESTIGATION RULE INVESTIGATES: ONE CHOICE (issue #5074).
 *
 * A rule's Investigate step asks one question with two answers - right
 * away, the default and what every rule did before, or only if the incident
 * is still open after a wait - and only the second one asks how long. The
 * answer is written into the rule's one column (onlyIfOpenAfterMinutes):
 * empty for right away, the minutes otherwise. The API, Terraform and every
 * stored rule read that column as before (Types/AI/InvestigationRuleWait).
 *
 * React-free on purpose: App's tests read it without the page.
 */

export enum InvestigationRuleTiming {
  RightAway = "right-away",
  AfterWait = "after-wait",
}

// The form value the choice keeps; never sent (formOnly).
export const INVESTIGATION_RULE_TIMING_FIELD_KEY: string =
  "investigationTiming";

// The rule's column the choice writes.
export const INVESTIGATION_RULE_WAIT_FIELD: string =
  INVESTIGATION_RULE_WAIT_COLUMN;

// In the order the form offers them: the default first.
export const INVESTIGATION_RULE_TIMINGS: ReadonlyArray<InvestigationRuleTiming> =
  [InvestigationRuleTiming.RightAway, InvestigationRuleTiming.AfterWait];

export interface InvestigationRuleTimingCopy {
  title: string;
  description: string;
}

export const INVESTIGATION_RULE_TIMING_COPY: Record<
  AiLane,
  Record<InvestigationRuleTiming, InvestigationRuleTimingCopy>
> = {
  [AiLane.Incident]: {
    [InvestigationRuleTiming.RightAway]: {
      title: translationKey("Right away"),
      description: translationKey(
        "OneUptime AI starts as soon as the incident is declared.",
      ),
    },
    [InvestigationRuleTiming.AfterWait]: {
      title: translationKey("Only if still open after a wait"),
      description: translationKey(
        "Incidents resolved during the wait are not investigated.",
      ),
    },
  },
  [AiLane.Alert]: {
    [InvestigationRuleTiming.RightAway]: {
      title: translationKey("Right away"),
      description: translationKey(
        "OneUptime AI starts as soon as the alert is created.",
      ),
    },
    [InvestigationRuleTiming.AfterWait]: {
      title: translationKey("Only if still open after a wait"),
      description: translationKey(
        "Alerts resolved during the wait are not investigated.",
      ),
    },
  },
};

export const INVESTIGATION_RULE_TIMING_FIELD_TITLE: string = translationKey(
  "When to investigate",
);

export const INVESTIGATION_RULE_WAIT_FIELD_TITLE: string =
  translationKey("Wait (Minutes)");

export const INVESTIGATION_RULE_WAIT_FIELD_DESCRIPTION: Record<AiLane, string> =
  {
    [AiLane.Incident]: translationKey(
      "Counted from when the incident is declared. When several rules match, the shortest wait decides. At most 1440 (a day).",
    ),
    [AiLane.Alert]: translationKey(
      "Counted from when the alert is created. When several rules match, the shortest wait decides. At most 1440 (a day).",
    ),
  };

export const INVESTIGATION_RULE_WAIT_NOT_WHOLE: string = translationKey(
  "Enter a whole number of minutes, from 1 to 1440.",
);

/*
 * The rules table's widths, measured at 1280px beside the side menu (a
 * 938px card, in Inter). The column that says when a rule investigates
 * (and, under it, how it fixes - AiRulesTable's one column for both) is
 * capped at room for "If still open after 1,440 minutes" (200px) and never
 * narrower than "If still open after 120 minutes", so a wait reads on one
 * line in English however the table is squeezed; a longer language ("Falls
 * nach 1.440 Minuten noch offen") takes two. Name's floor is lower than a
 * table's 10rem, which is what keeps German's table (wider pills and
 * "Bearbeiten") inside its card with Status in sight rather than under the
 * row's buttons.
 */
export const INVESTIGATION_RULE_TIMING_COLUMN_CLASS_NAME: string =
  "max-w-[14rem]";

export const INVESTIGATION_RULE_TIMING_COLUMN_FLOOR_CLASS_NAME: string =
  "min-w-[12rem]";

export const INVESTIGATION_RULE_NAME_COLUMN_CLASS_NAME: string = "min-w-[8rem]";

export const INVESTIGATION_RULE_RIGHT_AWAY: string =
  translationKey("Right away");

export function isInvestigationRuleTiming(
  value: unknown,
): value is InvestigationRuleTiming {
  return (
    typeof value === "string" &&
    (INVESTIGATION_RULE_TIMINGS as ReadonlyArray<string>).includes(value)
  );
}

type Values = Record<string, unknown>;

const asValues: (values: unknown) => Values = (values: unknown): Values => {
  return values && typeof values === "object" ? (values as Values) : {};
};

/*
 * The answer a rule's column makes: a wait of a minute or more is "only if
 * still open after a wait", and anything else - empty, 0, unreadable -
 * "right away", as the server reads it.
 */
export function getInvestigationRuleTiming(
  values: unknown,
): InvestigationRuleTiming {
  return getInvestigationRuleWaitMinutes(
    asValues(values)[INVESTIGATION_RULE_WAIT_FIELD],
  ) > 0
    ? InvestigationRuleTiming.AfterWait
    : InvestigationRuleTiming.RightAway;
}

/*
 * Whether the form is on "only if still open after a wait": the choice as
 * picked, or - before anything is picked - as the rule's column makes it.
 */
export function isWaitChosen(values: unknown): boolean {
  const chosen: unknown = asValues(values)[INVESTIGATION_RULE_TIMING_FIELD_KEY];

  if (isInvestigationRuleTiming(chosen)) {
    return chosen === InvestigationRuleTiming.AfterWait;
  }

  return (
    getInvestigationRuleTiming(values) === InvestigationRuleTiming.AfterWait
  );
}

/*
 * The form values an answer makes: right away clears the wait (null, so an
 * edit clears what a rule stored); a wait keeps the minutes already there,
 * or starts on the rule's own default - `defaultWaitMinutes`, for a lane
 * that looks less often than incidents open (the Profiler looks once an
 * hour) - or DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES. Everything else as it
 * was.
 */
export function getValuesForInvestigationRuleTiming<TValues>(data: {
  values: TValues;
  timing: InvestigationRuleTiming;
  defaultWaitMinutes?: number | undefined;
}): TValues {
  const values: Values = asValues(data.values);
  const current: number = getInvestigationRuleWaitMinutes(
    values[INVESTIGATION_RULE_WAIT_FIELD],
  );

  return {
    ...values,
    [INVESTIGATION_RULE_TIMING_FIELD_KEY]: data.timing,
    [INVESTIGATION_RULE_WAIT_FIELD]:
      data.timing === InvestigationRuleTiming.AfterWait
        ? current ||
          data.defaultWaitMinutes ||
          DEFAULT_INVESTIGATION_RULE_WAIT_MINUTES
        : null,
  } as unknown as TValues;
}

/*
 * The minutes field's check, as the reader's language words it: a whole
 * number from 1 to MAX_INVESTIGATION_RULE_WAIT_MINUTES while a wait is
 * chosen. Null when it is fine (or no wait is chosen).
 */
export function validateInvestigationRuleWait(values: unknown): string | null {
  if (!isWaitChosen(values)) {
    return null;
  }

  const value: unknown = asValues(values)[INVESTIGATION_RULE_WAIT_FIELD];
  const isBlank: boolean =
    value === null ||
    value === undefined ||
    (typeof value === "string" && !value.trim());

  if (
    isBlank ||
    getInvestigationRuleWaitProblem(value) !== null ||
    getInvestigationRuleWaitMinutes(value) < 1
  ) {
    return (
      translateText(INVESTIGATION_RULE_WAIT_NOT_WHOLE) ||
      INVESTIGATION_RULE_WAIT_NOT_WHOLE
    );
  }

  return null;
}

/*
 * What the rules table says a rule does, in the reader's language: "Right
 * away", or "If still open after 10 minutes".
 */
export function describeInvestigationRuleTiming(minutes: unknown): string {
  const wait: number = getInvestigationRuleWaitMinutes(minutes);

  if (wait === 0) {
    return (
      translateText(INVESTIGATION_RULE_RIGHT_AWAY) ||
      INVESTIGATION_RULE_RIGHT_AWAY
    );
  }

  return translatePlural(
    {
      one: "If still open after {{count}} minute",
      other: "If still open after {{count}} minutes",
    },
    wait,
  );
}

// The longest wait the form takes, as the server holds it.
export const INVESTIGATION_RULE_MAX_WAIT_MINUTES: number =
  MAX_INVESTIGATION_RULE_WAIT_MINUTES;
