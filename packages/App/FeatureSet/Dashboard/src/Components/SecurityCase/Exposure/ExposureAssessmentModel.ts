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
  LOGS_BEST_EFFORT,
  LOGS_BY_ACCOUNTS,
  LOGS_BY_ANYONE,
  LOGS_BY_UNPLACED,
  LOGS_FILES_READ,
  LOGS_FROM_OUTSIDE,
  LOGS_LISTINGS,
  LOGS_LOGGING_OFF,
  LOGS_NO_CONTENT_ACCESS,
  LOGS_NONE_FROM_OUTSIDE,
  LOGS_NONE_SO_FAR,
  LOGS_NOT_SUPPORTED,
  LOGS_OBJECTS_SENT,
  LOGS_OLDER_WINDOW,
  LOGS_PART_READ,
  LOGS_PRINCIPAL_LINE,
  LOGS_UNREADABLE,
  LOGS_UNREADABLE_SOMEWHERE,
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
  WITHIN_BUSINESS_DAYS_OF_PEOPLE,
  WITHIN_CALENDAR_DAYS,
  WITHIN_DAYS_OF_PEOPLE,
  WITHIN_DAYS_OF_YEAR_END,
  WITHIN_HOURS,
  WITHOUT_UNDUE_DELAY,
  WITHOUT_UNREASONABLE_DELAY,
} from "./ExposureAssessmentCopy";
import OneUptimeDate from "Common/Types/Date";
import {
  AccessLogCounts,
  ExposureLogPrincipal,
  ExposureLogRead,
  ExposureLogReadStatus,
  ExposureLogUnreadReason,
  getReadsFromOutside,
} from "Common/Types/DataSecurity/AccessLogReads";
import { TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB } from "Common/Types/Telemetry/TelemetryIngestionBudget";
import { formatTelemetryUsageSize } from "Common/UI/Components/TelemetryUsage/TelemetryUsageWords";
import {
  BREACH_CONDITION_WORDS,
  BREACH_LAW_RULES,
  BREACH_PLACE_WORDS,
  BreachDeadlineStart,
  BreachDeadlineUnit,
  BreachLawRule,
  BreachPlace,
  getBreachLawRule,
  isBreachLawId,
  isUsStateRule,
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
  ExposureReads,
  ExposureReadsLogged,
  StoredExposureAssessment,
} from "Common/Types/DataSecurity/ExposureAssessment";
import { ExposureChecklistItem } from "Common/Types/DataSecurity/ExposureChecklist";
import {
  Translator,
  composedValue,
  formatList,
  getInlineSeparator,
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
  // Those that may apply if any of the people live where nobody said: every row but a US state's.
  ifPeopleLiveElsewhere: Array<BreachObligation>;
  /*
   * The US states' that may apply if any of the people live in a state
   * nobody named (#10952), by state: drawn together, folded, as fifty
   * states' rows would bury every other law.
   */
  stateLawsIfPeopleLiveThere: Array<StateObligations>;
  // Not in force yet, then not triggered: folded until asked for.
  folded: Array<BreachObligation>;
  /*
   * The US states nobody named whose laws do not apply on these facts -
   * the people live elsewhere, or the store holds none of what they cover:
   * counted, not listed.
   */
  statesNotApplying: number;
}

// A US state's notices, as the card draws them under its name.
export interface StateObligations {
  place: BreachPlace;
  obligations: Array<BreachObligation>;
}

// Where a row is in the table: its notices are read in that order.
function tableIndexOf(obligation: BreachObligation): number {
  return BREACH_LAW_RULES.findIndex((rule: BreachLawRule): boolean => {
    return rule.id === obligation.ruleId;
  });
}

// The US state a row is of, or null for any other row.
export function getStateOfObligation(
  obligation: BreachObligation,
): BreachPlace | null {
  if (!isBreachLawId(obligation.ruleId)) {
    return null;
  }

  const rule: BreachLawRule = getBreachLawRule(obligation.ruleId);

  return isUsStateRule(rule) && rule.places ? rule.places[0]! : null;
}

/*
 * A US state's row is drawn on its own where a person named its state, or
 * where it is known to apply; the others are drawn together (#10952).
 */
function isDrawnTogether(
  obligation: BreachObligation,
  named: ReadonlyArray<BreachPlace>,
): boolean {
  const state: BreachPlace | null = getStateOfObligation(obligation);

  return (
    state !== null &&
    !named.includes(state) &&
    !(
      obligation.status === BreachObligationStatus.MayApply &&
      obligation.isPlaceKnown
    )
  );
}

export function groupObligations(
  view: Pick<ExposureAssessmentView, "obligations" | "mostUrgent"> & {
    whose?: Pick<ExposureAssessmentView["whose"], "placesNamed"> | undefined;
  },
): ObligationGroups {
  const dueFirst: BreachObligation | null = view.mostUrgent || null;
  const named: ReadonlyArray<BreachPlace> = view.whose?.placesNamed || [];
  const others: Array<BreachObligation> = view.obligations.filter(
    (obligation: BreachObligation): boolean => {
      return obligation.ruleId !== dueFirst?.ruleId;
    },
  );
  const alone: Array<BreachObligation> = others.filter(
    (obligation: BreachObligation): boolean => {
      return !isDrawnTogether(obligation, named);
    },
  );
  const together: Array<BreachObligation> = others.filter(
    (obligation: BreachObligation): boolean => {
      return isDrawnTogether(obligation, named);
    },
  );
  const byState: Map<BreachPlace, Array<BreachObligation>> = new Map();

  for (const obligation of together) {
    if (obligation.status === BreachObligationStatus.MayApply) {
      const state: BreachPlace = getStateOfObligation(obligation)!;

      byState.set(state, [...(byState.get(state) || []), obligation]);
    }
  }

  // A state any of whose notices may apply is drawn with them, not counted.
  const statesNotApplying: Set<BreachPlace> = new Set();

  for (const obligation of together) {
    const state: BreachPlace = getStateOfObligation(obligation)!;

    if (!byState.has(state)) {
      statesNotApplying.add(state);
    }
  }

  return {
    dueFirst,
    mayApply: alone.filter((obligation: BreachObligation): boolean => {
      return (
        obligation.status === BreachObligationStatus.MayApply &&
        obligation.isPlaceKnown
      );
    }),
    ifPeopleLiveElsewhere: alone.filter(
      (obligation: BreachObligation): boolean => {
        return (
          obligation.status === BreachObligationStatus.MayApply &&
          !obligation.isPlaceKnown
        );
      },
    ),
    // Each state's notices in the table's order: the people's first.
    stateLawsIfPeopleLiveThere: [...byState.entries()].map(
      ([place, obligations]: [
        BreachPlace,
        Array<BreachObligation>,
      ]): StateObligations => {
        return {
          place,
          obligations: [...obligations].sort(
            (a: BreachObligation, b: BreachObligation): number => {
              return tableIndexOf(a) - tableIndexOf(b);
            },
          ),
        };
      },
    ),
    folded: [
      ...alone.filter((obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.NotYetInForce;
      }),
      ...alone.filter((obligation: BreachObligation): boolean => {
        return obligation.status === BreachObligationStatus.NotTriggered;
      }),
    ],
    statesNotApplying: statesNotApplying.size,
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
    case BreachDeadlineUnit.WithoutUnreasonableDelay:
      return say(translator, WITHOUT_UNREASONABLE_DELAY);
    case BreachDeadlineUnit.NoFixedTime:
      return say(translator, NO_FIXED_TIME);
    default:
      break;
  }

  if (rule.deadline.start === BreachDeadlineStart.PeopleNotified) {
    if (amount === 0) {
      return say(translator, WHEN_PEOPLE_TOLD);
    }

    return translator.translatePlural(
      rule.deadline.unit === BreachDeadlineUnit.BusinessDays
        ? WITHIN_BUSINESS_DAYS_OF_PEOPLE
        : WITHIN_DAYS_OF_PEOPLE,
      amount,
    );
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

/*
 * What the store's own access logs say, in the reader's words (#10951): a
 * headline - who read it from outside, or that the logs show nobody did -
 * and the lines under it: who made those reads, what was read and sent,
 * listings, and how far the read went. Null when OneUptime read no logs.
 */
export interface LogReadsWords {
  headline: string;
  details: Array<string>;
  // A read made for the window as it was: the counts are of that one.
  isOlderWindow: boolean;
  // The logs could not be read: the headline says why.
  isUnread: boolean;
  // Where the logs are, for the sentence that names it as code.
  unreadableLocation?: string | undefined;
}

function sizeOf(bytes: number, translator: Translator): string {
  return formatTelemetryUsageSize(
    bytes / TELEMETRY_INGESTION_BUDGET_BYTES_PER_GB,
    translator,
  );
}

function when(value: string | undefined): string {
  return value
    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(value)
    : "";
}

export function describeLogReads(
  reads: ExposureReads,
  translator: Translator,
): LogReadsWords | null {
  const read: ExposureLogRead | undefined = reads.fromLogs;

  if (!read) {
    return null;
  }

  if (read.status !== ExposureLogReadStatus.Read) {
    switch (read.reason) {
      case ExposureLogUnreadReason.NoContentAccess:
        return {
          headline: say(translator, LOGS_NO_CONTENT_ACCESS),
          details: [],
          isOlderWindow: false,
          isUnread: true,
        };
      case ExposureLogUnreadReason.LoggingOff:
        return {
          headline: say(translator, LOGS_LOGGING_OFF),
          details: [],
          isOlderWindow: false,
          isUnread: true,
        };
      case ExposureLogUnreadReason.LogsUnreadable:
        return {
          headline: read.logLocation
            ? translator.translateTemplate(LOGS_UNREADABLE, {
                location: read.logLocation,
              })
            : say(translator, LOGS_UNREADABLE_SOMEWHERE),
          details: [],
          isOlderWindow: false,
          isUnread: true,
          unreadableLocation: read.logLocation,
        };
      case ExposureLogUnreadReason.NotSupported:
        return {
          headline: say(translator, LOGS_NOT_SUPPORTED),
          details: [],
          isOlderWindow: false,
          isUnread: true,
        };
      default:
        return null;
    }
  }

  if (reads.isFromLogsCurrent === false) {
    return {
      headline: translator.translateTemplate(LOGS_OLDER_WINDOW, {
        date: when(read.readAt),
      }),
      details: [],
      isOlderWindow: true,
      isUnread: false,
    };
  }

  const outside: AccessLogCounts = getReadsFromOutside(read);
  const details: Array<string> = [];
  const files: string = read.isComplete
    ? translator.translatePlural(LOGS_FILES_READ, read.logFilesRead)
    : translator.translatePlural(LOGS_PART_READ, read.logFilesRead, {
        date: when(read.readThrough),
      });

  if (outside.reads > 0) {
    const who: Array<string> = [];

    if (read.anonymous.reads > 0) {
      who.push(
        translator.translatePlural(LOGS_BY_ANYONE, read.anonymous.addresses, {
          reads: translator.formatNumber(read.anonymous.reads),
        }),
      );
    }

    if (read.outside.reads > 0) {
      who.push(
        translator.translatePlural(LOGS_BY_ACCOUNTS, read.outside.accounts, {
          reads: translator.formatNumber(read.outside.reads),
        }),
      );
    }

    if (read.unknown.reads > 0) {
      who.push(
        translator.translateTemplate(LOGS_BY_UNPLACED, {
          reads: translator.formatNumber(read.unknown.reads),
        }),
      );
    }

    details.push(who.join(getInlineSeparator(translator.language)));
    details.push(
      translator.translatePlural(LOGS_OBJECTS_SENT, outside.objects, {
        size: composedValue((sentence: Translator): string => {
          return sizeOf(outside.bytes, sentence);
        }),
      }),
    );
  }

  if (read.listingsFromOutside > 0) {
    details.push(
      translator.translatePlural(LOGS_LISTINGS, read.listingsFromOutside),
    );
  }

  details.push(files);

  if (outside.reads === 0) {
    details.push(say(translator, LOGS_BEST_EFFORT));
  }

  return {
    headline:
      outside.reads > 0
        ? translator.translatePlural(LOGS_FROM_OUTSIDE, outside.reads)
        : say(
            translator,
            read.isComplete ? LOGS_NONE_FROM_OUTSIDE : LOGS_NONE_SO_FAR,
          ),
    details,
    isOlderWindow: false,
    isUnread: false,
  };
}

// An outside principal's reads, in the reader's words: "3 reads, 2.1 GB, from ... to ...".
export function describeLogPrincipal(
  principal: ExposureLogPrincipal,
  translator: Translator,
): string {
  return translator.translatePlural(LOGS_PRINCIPAL_LINE, principal.reads, {
    size: composedValue((sentence: Translator): string => {
      return sizeOf(principal.bytes, sentence);
    }),
    first: when(principal.firstAt),
    last: when(principal.lastAt),
  });
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
    case ExposureChecklistItem.WhoReadIt: {
      // What the store's own logs say, once read for this window (#10951).
      const fromLogs: LogReadsWords | null = describeLogReads(
        data.view.reads,
        translator,
      );

      return fromLogs && !fromLogs.isUnread && !fromLogs.isOlderWindow
        ? fromLogs.headline
        : say(translator, getReadsLine(data.view.reads.logged));
    }
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
