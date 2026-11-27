import {
  ABOUT_RECORDS,
  ANSWER_LAW_DUE,
  ANSWER_LAWS,
  ANSWER_NO_LAWS,
  ANSWER_NO_SECRETS,
  ANSWER_SAY_WHERE,
  ANSWER_SECRETS,
  ANSWER_SUMMARY_DRAFTED,
  ANSWER_SUMMARY_DRAFTED_ON_NOTICES,
  ANSWER_SUMMARY_TO_WRITE,
  ANSWER_SUMMARY_TO_WRITE_ON_NOTICES,
  DUE_ON,
  DUE_ON_AT_THE_LATEST,
  IF_AT_LEAST_PEOPLE,
  IF_FEWER_PEOPLE,
  IF_HELD_WITH_NAMES,
  IF_MORE_THAN_PEOPLE,
  IF_PEOPLE_LIVE_IN,
  IF_READ_FROM_OUTSIDE,
  IN_FORCE_FROM,
  LAW_AND_PROVISION,
  NO_FIXED_TIME,
  READS_LOGGED,
  READS_NOT_LOGGED,
  READS_UNKNOWN,
  REASON_HOLDS_NONE,
  REASON_NO_PERSONAL_DATA,
  REASON_NOT_ENOUGH_PEOPLE,
  REASON_PEOPLE_ELSEWHERE,
  WHEN_PEOPLE_TOLD,
  WITHIN_BUSINESS_DAYS,
  WITHIN_CALENDAR_DAYS,
  WITHIN_DAYS_OF_PEOPLE,
  WITHIN_DAYS_OF_YEAR_END,
  WITHIN_HOURS,
  WITHOUT_UNDUE_DELAY,
} from "./ExposureAssessmentCopy";
import OneUptimeDate from "Common/Types/Date";
import {
  BREACH_CONDITION_WORDS,
  BREACH_PLACE_WORDS,
  BreachDeadlineStart,
  BreachDeadlineUnit,
  BreachLawRule,
  BreachPlace,
  getBreachLawRule,
} from "Common/Types/DataSecurity/BreachLaws";
import {
  BreachCheck,
  BreachCheckKind,
  BreachObligation,
  BreachObligationStatus,
  BreachReason,
  BreachReasonKind,
  ExposureAssessmentView,
  ExposureDraftPart,
  ExposureReadsLogged,
  StoredExposureAssessment,
} from "Common/Types/DataSecurity/ExposureAssessment";
import { ExposureChecklistItem } from "Common/Types/DataSecurity/ExposureChecklist";
import {
  Translator,
  composedValue,
  formatList,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A CASE'S EXPOSURE ASSESSMENT SAYS, IN THE READER'S WORDS (#10377).
 *
 * Plain code worked the assessment out on the server
 * (Common/Types/DataSecurity/ExposureAssessment); this words it: a law's
 * deadline in its own units and what it counts from, how far off it is,
 * what a person still checks, why a law does not apply, and each line of
 * the case's checklist answered. Pure, so a test reads every wording.
 */

// A key in the reader's words, its English where the language has none.
export function say(translator: Translator, key: string): string {
  return translator.translateText(key) || key;
}

// How a deadline stands now: past it, within a day of it, or further off.
export enum DueState {
  Overdue = "overdue",
  DueSoon = "due-soon",
  Due = "due",
}

const MINUTE_IN_MS: number = 60 * 1000;
const DAY_IN_MINUTES: number = 24 * 60;

export interface DueReading {
  state: DueState;
  // How far it is from now, either way, in whole minutes.
  minutes: number;
}

export function readDue(
  dueAt: string | undefined,
  now: Date,
): DueReading | null {
  if (!dueAt) {
    return null;
  }

  const due: number = new Date(dueAt).getTime();

  if (Number.isNaN(due)) {
    return null;
  }

  const minutes: number = Math.round((due - now.getTime()) / MINUTE_IN_MS);

  if (minutes < 0) {
    return { state: DueState.Overdue, minutes: -minutes };
  }

  return {
    state: minutes <= DAY_IN_MINUTES ? DueState.DueSoon : DueState.Due,
    minutes,
  };
}

// The tone each state is drawn in.
export function getDueToneClassName(state: DueState): string {
  switch (state) {
    case DueState.Overdue:
      return "bg-red-50 text-red-700 ring-red-600/20";
    case DueState.DueSoon:
      return "bg-amber-50 text-amber-800 ring-amber-600/20";
    default:
      return "bg-gray-50 text-gray-700 ring-gray-500/20";
  }
}

// The laws an assessment lists, as the card groups them.
export interface ObligationGroups {
  // The one due first, where the people are known to live.
  dueFirst: BreachObligation | null;
  // The others that may apply where the people are known to live.
  mayApply: Array<BreachObligation>;
  // Those that may apply if any of the people live where nobody said.
  ifPeopleLiveElsewhere: Array<BreachObligation>;
  // Not in force yet, then not triggered: folded until asked for.
  folded: Array<BreachObligation>;
}

export function groupObligations(
  view: Pick<ExposureAssessmentView, "obligations" | "mostUrgent">,
): ObligationGroups {
  const dueFirst: BreachObligation | null = view.mostUrgent || null;
  const others: Array<BreachObligation> = view.obligations.filter(
    (obligation: BreachObligation): boolean => {
      return obligation.ruleId !== dueFirst?.ruleId;
    },
  );

  return {
    dueFirst,
    mayApply: others.filter((obligation: BreachObligation): boolean => {
      return (
        obligation.status === BreachObligationStatus.MayApply &&
        obligation.isPlaceKnown
      );
    }),
    ifPeopleLiveElsewhere: others.filter(
      (obligation: BreachObligation): boolean => {
        return (
          obligation.status === BreachObligationStatus.MayApply &&
          !obligation.isPlaceKnown
        );
      },
    ),
    folded: [
      ...others.filter((obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.NotYetInForce;
      }),
      ...others.filter((obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.NotTriggered;
      }),
    ],
  };
}

// "GDPR Article 33": the law and its provision, as the table cites them.
export function describeLaw(
  rule: BreachLawRule,
  translator: Translator,
): string {
  return translator.translateTemplate(LAW_AND_PROVISION, {
    law: rule.law,
    provision: rule.provision,
  });
}

// A law's deadline in its own units, and what it counts from.
export function describeDeadline(
  rule: BreachLawRule,
  translator: Translator,
): string {
  const amount: number = rule.deadline.amount || 0;

  switch (rule.deadline.unit) {
    case BreachDeadlineUnit.WithoutUndueDelay:
      return say(translator, WITHOUT_UNDUE_DELAY);
    case BreachDeadlineUnit.NoFixedTime:
      return say(translator, NO_FIXED_TIME);
    default:
      break;
  }

  if (rule.deadline.start === BreachDeadlineStart.PeopleNotified) {
    return amount === 0
      ? say(translator, WHEN_PEOPLE_TOLD)
      : translator.translatePlural(WITHIN_DAYS_OF_PEOPLE, amount);
  }

  if (rule.deadline.start === BreachDeadlineStart.EndOfCalendarYear) {
    return translator.translatePlural(WITHIN_DAYS_OF_YEAR_END, amount);
  }

  switch (rule.deadline.unit) {
    case BreachDeadlineUnit.Hours:
      return translator.translatePlural(WITHIN_HOURS, amount);
    case BreachDeadlineUnit.BusinessDays:
      return translator.translatePlural(WITHIN_BUSINESS_DAYS, amount);
    default:
      return translator.translatePlural(WITHIN_CALENDAR_DAYS, amount);
  }
}

// "Due Nov 5, 2026, 9:00 AM", in the reader's zone and language.
export function describeDueDate(
  obligation: BreachObligation,
  translator: Translator,
): string {
  if (!obligation.dueAt) {
    return "";
  }

  return translator.translateTemplate(
    obligation.isDueAtTheLatest ? DUE_ON_AT_THE_LATEST : DUE_ON,
    {
      date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        obligation.dueAt,
      ),
    },
  );
}

// Places in the reader's words: "the EU or EEA or the United Kingdom".
export function describePlaces(
  places: ReadonlyArray<string>,
  translator: Translator,
): string {
  return formatList(
    places.map((place: string): string => {
      const words: string | undefined =
        BREACH_PLACE_WORDS[place as BreachPlace];

      return words ? say(translator, words) : place;
    }),
    translator,
  );
}

// What a person still checks before the law applies, in the reader's words.
export function describeCheck(
  check: BreachCheck,
  translator: Translator,
): string {
  switch (check.kind) {
    case BreachCheckKind.Condition: {
      const words: string | undefined = check.condition
        ? BREACH_CONDITION_WORDS[check.condition]
        : undefined;

      return words ? say(translator, words) : "";
    }
    case BreachCheckKind.PeopleLiveIn:
      return translator.translateTemplate(IF_PEOPLE_LIVE_IN, {
        places: composedValue((sentence: Translator): string => {
          return describePlaces(check.places || [], sentence);
        }),
      });
    case BreachCheckKind.PeopleCount:
      return check.threshold
        ? translator.translatePlural(
            check.threshold.isMoreThan
              ? IF_MORE_THAN_PEOPLE
              : IF_AT_LEAST_PEOPLE,
            check.threshold.count,
          )
        : "";
    case BreachCheckKind.FewerPeopleThan:
      return translator.translatePlural(IF_FEWER_PEOPLE, check.count || 0);
    case BreachCheckKind.HeldWithNames:
      return say(translator, IF_HELD_WITH_NAMES);
    case BreachCheckKind.ReadFromOutside:
      return say(translator, IF_READ_FROM_OUTSIDE);
    default:
      return "";
  }
}

/*
 * Why a law does not apply, or is not in force yet: the reasons that rule
 * it out, in the reader's words. The ones that say why it may apply are
 * drawn elsewhere on the card (what it holds, where its people live).
 */
export function describeWhyNot(
  obligation: BreachObligation,
  translator: Translator,
): Array<string> {
  const lines: Array<string> = [];

  for (const reason of obligation.reasons) {
    const line: string = describeReasonAgainst(reason, translator);

    if (line && !lines.includes(line)) {
      lines.push(line);
    }
  }

  if (
    obligation.status === BreachObligationStatus.NotTriggered &&
    lines.length === 0 &&
    obligation.checks.some((check: BreachCheck): boolean => {
      return (
        check.kind === BreachCheckKind.PeopleCount ||
        check.kind === BreachCheckKind.FewerPeopleThan
      );
    })
  ) {
    lines.push(say(translator, REASON_NOT_ENOUGH_PEOPLE));
  }

  return lines;
}

function describeReasonAgainst(
  reason: BreachReason,
  translator: Translator,
): string {
  switch (reason.kind) {
    case BreachReasonKind.PeopleNamedElsewhere:
      return say(translator, REASON_PEOPLE_ELSEWHERE);
    case BreachReasonKind.HoldsNoneOf:
      return say(translator, REASON_HOLDS_NONE);
    case BreachReasonKind.NoPersonalData:
      return say(translator, REASON_NO_PERSONAL_DATA);
    case BreachReasonKind.NotInForce:
      return reason.date
        ? translator.translateTemplate(IN_FORCE_FROM, {
            date: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
              `${reason.date}T00:00:00.000Z`,
              true,
            ),
          })
        : "";
    default:
      return "";
  }
}

// The line that says whether the reads were logged: the brief's words, where they apply.
export function getReadsLine(logged: ExposureReadsLogged): string {
  switch (logged) {
    case ExposureReadsLogged.NotLogged:
      return READS_NOT_LOGGED;
    case ExposureReadsLogged.Logged:
      return READS_LOGGED;
    default:
      return READS_UNKNOWN;
  }
}

// About how many records, in the reader's plural.
export function describeRecords(
  records: number | undefined,
  translator: Translator,
): string {
  return records === undefined
    ? ""
    : translator.translatePlural(ABOUT_RECORDS, records);
}

/*
 * Each line of the case's checklist, answered by the assessment: on the
 * card, or under its task on the case's Tasks page (isOnTasksPage), where
 * the Breach Notices card is not below it.
 */
export function answerChecklistItem(data: {
  item: ExposureChecklistItem;
  view: ExposureAssessmentView;
  assessment: StoredExposureAssessment | null;
  translator: Translator;
  isOnTasksPage?: boolean | undefined;
}): string {
  const translator: Translator = data.translator;

  switch (data.item) {
    case ExposureChecklistItem.WhoReadIt:
      return say(translator, getReadsLine(data.view.reads.logged));
    case ExposureChecklistItem.MustReport: {
      const first: BreachObligation | null = data.view.mostUrgent;
      const rule: BreachLawRule | undefined = first
        ? getBreachLawRule(first.ruleId)
        : undefined;

      if (first && rule) {
        return translator.translateTemplate(ANSWER_LAW_DUE, {
          law: describeLaw(rule, translator),
          due: composedValue((sentence: Translator): string => {
            return first.dueAt
              ? describeDueDate(first, sentence)
              : describeDeadline(rule, sentence);
          }),
        });
      }

      const mayApply: number = data.view.obligations.filter(
        (obligation: BreachObligation): boolean => {
          return obligation.status === BreachObligationStatus.MayApply;
        },
      ).length;

      if (data.view.isPlaceUnknown && mayApply > 0) {
        return say(translator, ANSWER_SAY_WHERE);
      }

      return mayApply > 0
        ? translator.translatePlural(ANSWER_LAWS, mayApply)
        : say(translator, ANSWER_NO_LAWS);
    }
    case ExposureChecklistItem.RotateSecrets:
      return data.view.secretsToRotate.length > 0
        ? translator.translatePlural(
            ANSWER_SECRETS,
            data.view.secretsToRotate.length,
          )
        : say(translator, ANSWER_NO_SECRETS);
    default: {
      const isWritten: boolean = Boolean(
        data.assessment?.sections[ExposureDraftPart.InternalSummary]?.markdown,
      );

      if (data.isOnTasksPage) {
        return say(
          translator,
          isWritten
            ? ANSWER_SUMMARY_DRAFTED_ON_NOTICES
            : ANSWER_SUMMARY_TO_WRITE_ON_NOTICES,
        );
      }

      return say(
        translator,
        isWritten ? ANSWER_SUMMARY_DRAFTED : ANSWER_SUMMARY_TO_WRITE,
      );
    }
  }
}
