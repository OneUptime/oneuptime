import {
  KEEP_EVERY_RESOLVED_RECORD,
  RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS,
  ResolvedRecordKind,
  ResolvedRecordRetentionServerLimits,
  isResolvedRecordRetentionOn,
} from "Common/Types/Retention/ResolvedRecordRetention";
import {
  PluralTemplate,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * THE SERVER'S LIMITS ON RESOLVED INCIDENTS AND ALERTS (issue #6941), the
 * words of Admin Dashboard > Settings > Data Retention's first two cards,
 * "Resolved Incidents" and "Resolved Alerts". Each project picks how long it
 * keeps a resolved incident (alert) on its own Data Retention page; each
 * card here has two picks that save the moment they are made:
 *
 *   - "Keep for at most" (GlobalConfig.maxIncidentRetentionInDays,
 *     maxAlertRetentionInDays): No limit - where every server starts - or a
 *     length no project keeps one longer than, projects set to Never
 *     included. A pick that deletes more (a limit where there was none, or
 *     a shorter one) asks first, saying how many projects it reaches; a
 *     longer limit, or No limit, saves at once.
 *   - "New projects delete after" (defaultIncidentRetentionInDays,
 *     defaultAlertRetentionInDays): Never - where every server starts - or
 *     the length a new project starts with. The lengths longer than the
 *     limit are shown, and locked. It asks nothing: projects that exist keep
 *     their own.
 *
 * Kept free of React so the card and its tests read these exact strings.
 * Every string is a whole sentence or a whole name, wrapped in
 * translationKey() (or a PluralTemplate) so AdminOwnPagesStringsLocales
 * finds it, and worded in each of the Admin Dashboard's locale files. A
 * sentence that names a length is a plural of its own for days and for
 * years, as the project's card words them: a length is never a value put
 * into a sentence, which a language that declines it ("nach 90 Tagen") or
 * counts it as a label ("الأيام: 30") could not read.
 */

export const RESOLVED_RECORD_RETENTION_LIMITS_CARD_TEST_ID: string =
  "resolved-record-retention-limits";

export const RESOLVED_RECORD_RETENTION_MAXIMUM_TEST_ID: string =
  "resolved-record-retention-maximum";

export const RESOLVED_RECORD_RETENTION_DEFAULT_TEST_ID: string =
  "resolved-record-retention-default";

export const RESOLVED_RECORD_RETENTION_REACH_TEST_ID: string =
  "resolved-record-retention-reach";

// The GlobalConfig columns a card reads and writes.
export type ResolvedRecordRetentionMaximumColumn =
  | "maxIncidentRetentionInDays"
  | "maxAlertRetentionInDays";

export type ResolvedRecordRetentionDefaultColumn =
  | "defaultIncidentRetentionInDays"
  | "defaultAlertRetentionInDays";

// What one card says: incidents, or alerts.
export interface ResolvedRecordRetentionLimitsKindCopy {
  kind: ResolvedRecordKind;
  maximumColumn: ResolvedRecordRetentionMaximumColumn;
  defaultColumn: ResolvedRecordRetentionDefaultColumn;
  cardTitle: string;
  cardDescription: string;
  // Under "Keep for at most", for No limit.
  noMaximumDescription: string;
  // Under "Keep for at most", for a limit in days or in years.
  maximumInDays: PluralTemplate;
  maximumInYears: PluralTemplate;
  // The question asked before a limit that deletes more.
  confirmTitle: string;
  // What it deletes, for a limit in days or in years.
  confirmInDays: PluralTemplate;
  confirmInYears: PluralTemplate;
  // Under "New projects delete after", for Never while there is no limit.
  defaultNeverDescription: string;
  // Under "New projects delete after", for a length in days or in years.
  defaultInDays: PluralTemplate;
  defaultInYears: PluralTemplate;
}

// What both cards say.
export const ResolvedRecordRetentionLimitsCopy: {
  maximumLabel: string;
  defaultLabel: string;
  noMaximum: string;
  never: string;
  longerThanMaximum: string;
  defaultNeverUnderMaximum: string;
  counting: string;
  reach: PluralTemplate;
  reachesNone: string;
  confirmButton: string;
} = {
  maximumLabel: translationKey("Keep for at most"),
  defaultLabel: translationKey("New projects delete after"),
  // The Admin Dashboard's own words for an empty limit and for Never.
  noMaximum: translationKey("No limit"),
  never: translationKey("Never"),
  // Beside a length a new project cannot start with: longer than the limit.
  longerThanMaximum: translationKey("Longer than the limit above."),
  // Under "New projects delete after", for Never while there is a limit.
  defaultNeverUnderMaximum: translationKey(
    "A new project starts at Never and is held to the limit above until its owners pick a length.",
  ),
  // Under the question, while the projects it reaches are counted.
  counting: translationKey("Counting the projects this reaches…"),
  reach: {
    one: "This reaches {{count}} project.",
    other: "This reaches {{count}} projects.",
  },
  reachesNone: translationKey(
    "No project keeps them longer, so nothing more is deleted now.",
  ),
  confirmButton: translationKey("Limit Projects"),
};

export const INCIDENT_RETENTION_LIMITS_COPY: ResolvedRecordRetentionLimitsKindCopy =
  {
    kind: ResolvedRecordKind.Incident,
    maximumColumn: "maxIncidentRetentionInDays",
    defaultColumn: "defaultIncidentRetentionInDays",
    cardTitle: translationKey("Resolved Incidents"),
    cardDescription: translationKey(
      "Each project picks how long it keeps resolved incidents; you can hold every project to a limit and choose where new projects start.",
    ),
    noMaximumDescription: translationKey(
      "Each project keeps resolved incidents for as long as it chooses.",
    ),
    maximumInDays: {
      one: "No project keeps a resolved incident longer than {{count}} day, even one set to Never, except incidents it keeps for a completed postmortem.",
      other:
        "No project keeps a resolved incident longer than {{count}} days, even one set to Never, except incidents it keeps for a completed postmortem.",
    },
    maximumInYears: {
      one: "No project keeps a resolved incident longer than {{count}} year, even one set to Never, except incidents it keeps for a completed postmortem.",
      other:
        "No project keeps a resolved incident longer than {{count}} years, even one set to Never, except incidents it keeps for a completed postmortem.",
    },
    confirmTitle: translationKey(
      "Limit how long projects keep resolved incidents?",
    ),
    confirmInDays: {
      one: "Every project deletes resolved incidents older than {{count}} day within the hour, with their timeline, notes and logs. They can't be brought back.",
      other:
        "Every project deletes resolved incidents older than {{count}} days within the hour, with their timeline, notes and logs. They can't be brought back.",
    },
    confirmInYears: {
      one: "Every project deletes resolved incidents older than {{count}} year within the hour, with their timeline, notes and logs. They can't be brought back.",
      other:
        "Every project deletes resolved incidents older than {{count}} years within the hour, with their timeline, notes and logs. They can't be brought back.",
    },
    defaultNeverDescription: translationKey(
      "A new project keeps every resolved incident until its owners pick a length.",
    ),
    defaultInDays: {
      one: "A new project deletes resolved incidents after {{count}} day until its owners change it. Projects that exist keep their own.",
      other:
        "A new project deletes resolved incidents after {{count}} days until its owners change it. Projects that exist keep their own.",
    },
    defaultInYears: {
      one: "A new project deletes resolved incidents after {{count}} year until its owners change it. Projects that exist keep their own.",
      other:
        "A new project deletes resolved incidents after {{count}} years until its owners change it. Projects that exist keep their own.",
    },
  };

export const ALERT_RETENTION_LIMITS_COPY: ResolvedRecordRetentionLimitsKindCopy =
  {
    kind: ResolvedRecordKind.Alert,
    maximumColumn: "maxAlertRetentionInDays",
    defaultColumn: "defaultAlertRetentionInDays",
    cardTitle: translationKey("Resolved Alerts"),
    cardDescription: translationKey(
      "Each project picks how long it keeps resolved alerts; you can hold every project to a limit and choose where new projects start.",
    ),
    noMaximumDescription: translationKey(
      "Each project keeps resolved alerts for as long as it chooses.",
    ),
    maximumInDays: {
      one: "No project keeps a resolved alert longer than {{count}} day, including projects set to Never.",
      other:
        "No project keeps a resolved alert longer than {{count}} days, including projects set to Never.",
    },
    maximumInYears: {
      one: "No project keeps a resolved alert longer than {{count}} year, including projects set to Never.",
      other:
        "No project keeps a resolved alert longer than {{count}} years, including projects set to Never.",
    },
    confirmTitle: translationKey(
      "Limit how long projects keep resolved alerts?",
    ),
    confirmInDays: {
      one: "Every project deletes resolved alerts older than {{count}} day within the hour, with their timeline, notes and logs. They can't be brought back.",
      other:
        "Every project deletes resolved alerts older than {{count}} days within the hour, with their timeline, notes and logs. They can't be brought back.",
    },
    confirmInYears: {
      one: "Every project deletes resolved alerts older than {{count}} year within the hour, with their timeline, notes and logs. They can't be brought back.",
      other:
        "Every project deletes resolved alerts older than {{count}} years within the hour, with their timeline, notes and logs. They can't be brought back.",
    },
    defaultNeverDescription: translationKey(
      "A new project keeps every resolved alert until its owners pick a length.",
    ),
    defaultInDays: {
      one: "A new project deletes resolved alerts after {{count}} day until its owners change it. Projects that exist keep their own.",
      other:
        "A new project deletes resolved alerts after {{count}} days until its owners change it. Projects that exist keep their own.",
    },
    defaultInYears: {
      one: "A new project deletes resolved alerts after {{count}} year until its owners change it. Projects that exist keep their own.",
      other:
        "A new project deletes resolved alerts after {{count}} years until its owners change it. Projects that exist keep their own.",
    },
  };

// A length in days, as a pick says it: "30 days" - the Admin Dashboard's own words.
export const RETENTION_DAYS: PluralTemplate = {
  one: "{{count}} day",
  other: "{{count}} days",
};

// A whole number of years, as a pick says it: "1 year", "2 years".
export const RETENTION_YEARS: PluralTemplate = {
  one: "{{count}} year",
  other: "{{count}} years",
};

/*
 * The picks' value for "No limit" and for "Never": what GlobalConfig stores
 * as empty (null). A pick's value is a number, as a dropdown's must be.
 */
export const NO_LENGTH_CHOICE: number = KEEP_EVERY_RESOLVED_RECORD;

// Each pick's values: No limit (or Never) first, then the project choices.
export const getLimitChoices: () => Array<number> = (): Array<number> => {
  return [NO_LENGTH_CHOICE, ...RESOLVED_RECORD_RETENTION_CHOICES_IN_DAYS];
};

// What a pick saves: the length, or null for No limit and Never.
export const toStoredLength: (choice: number) => number | null = (
  choice: number,
): number | null => {
  return isResolvedRecordRetentionOn(choice) ? choice : null;
};

// The limit a pick of "Keep for at most" means: undefined for No limit.
export const toMaximumInDays: (choice: number) => number | undefined = (
  choice: number,
): number | undefined => {
  return isResolvedRecordRetentionOn(choice) ? choice : undefined;
};

// The pick of "Keep for at most" that shows a limit: No limit for none.
export const toMaximumChoice: (maximumInDays: number | undefined) => number = (
  maximumInDays: number | undefined,
): number => {
  return maximumInDays === undefined ? NO_LENGTH_CHOICE : maximumInDays;
};

const DAYS_IN_A_YEAR: number = 365;

// A length as the reader counts it: whole years in years, the rest in days.
export interface RetentionLength {
  unit: "days" | "years";
  count: number;
}

export const getRetentionLength: (
  retentionInDays: number,
) => RetentionLength = (retentionInDays: number): RetentionLength => {
  if (
    retentionInDays >= DAYS_IN_A_YEAR &&
    retentionInDays % DAYS_IN_A_YEAR === 0
  ) {
    return { unit: "years", count: retentionInDays / DAYS_IN_A_YEAR };
  }

  return { unit: "days", count: retentionInDays };
};

// The sentence for a length: its template in days or in years, worded for the count.
const translateForLength: (data: {
  inDays: PluralTemplate;
  inYears: PluralTemplate;
  retentionInDays: number;
  translator: Translator;
}) => string = (data: {
  inDays: PluralTemplate;
  inYears: PluralTemplate;
  retentionInDays: number;
  translator: Translator;
}): string => {
  const length: RetentionLength = getRetentionLength(data.retentionInDays);

  return data.translator.translatePlural(
    length.unit === "years" ? data.inYears : data.inDays,
    length.count,
  );
};

// A length as a pick says it: "90 days", "1 year", in the reader's language.
export const getRetentionLengthText: (
  retentionInDays: number,
  translator: Translator,
) => string = (retentionInDays: number, translator: Translator): string => {
  return translateForLength({
    inDays: RETENTION_DAYS,
    inYears: RETENTION_YEARS,
    retentionInDays,
    translator,
  });
};

// A fixed word in the reader's language.
const translateWord: (text: string, translator: Translator) => string = (
  text: string,
  translator: Translator,
): string => {
  return translator.translateText(text) || text;
};

// What "Keep for at most" shows: "No limit", or the limit.
export const getMaximumChoiceText: (
  choice: number,
  translator: Translator,
) => string = (choice: number, translator: Translator): string => {
  return isResolvedRecordRetentionOn(choice)
    ? getRetentionLengthText(choice, translator)
    : translateWord(ResolvedRecordRetentionLimitsCopy.noMaximum, translator);
};

// What "New projects delete after" shows: "Never", or the length.
export const getDefaultChoiceText: (
  choice: number,
  translator: Translator,
) => string = (choice: number, translator: Translator): string => {
  return isResolvedRecordRetentionOn(choice)
    ? getRetentionLengthText(choice, translator)
    : translateWord(ResolvedRecordRetentionLimitsCopy.never, translator);
};

// The sentence under "Keep for at most", for what it is set to.
export const getMaximumDescription: (
  copy: ResolvedRecordRetentionLimitsKindCopy,
  choice: number,
  translator: Translator,
) => string = (
  copy: ResolvedRecordRetentionLimitsKindCopy,
  choice: number,
  translator: Translator,
): string => {
  if (!isResolvedRecordRetentionOn(choice)) {
    return translateWord(copy.noMaximumDescription, translator);
  }

  return translateForLength({
    inDays: copy.maximumInDays,
    inYears: copy.maximumInYears,
    retentionInDays: choice,
    translator,
  });
};

// What the question before a limit that deletes more says goes.
export const getMaximumConfirmation: (
  copy: ResolvedRecordRetentionLimitsKindCopy,
  maximumInDays: number,
  translator: Translator,
) => string = (
  copy: ResolvedRecordRetentionLimitsKindCopy,
  maximumInDays: number,
  translator: Translator,
): string => {
  return translateForLength({
    inDays: copy.confirmInDays,
    inYears: copy.confirmInYears,
    retentionInDays: maximumInDays,
    translator,
  });
};

/*
 * How far the question's limit reaches, as the server counted it (GET
 * /global-config/resolved-record-retention/projects-reached).
 */
export type ProjectsReach =
  | { isCounting: true }
  | { isCounting: false; count: number | null };

/*
 * The line under the question: "This reaches 12 projects.", that nothing
 * more is deleted when no project keeps them longer, "Counting the
 * projects this reaches…" while it is counted - or nothing at all when it
 * could not be counted: the question is asked without it, never with a
 * count that reads as none.
 */
export const getReachText: (
  reach: ProjectsReach,
  translator: Translator,
) => string | null = (
  reach: ProjectsReach,
  translator: Translator,
): string | null => {
  if (reach.isCounting) {
    return translateWord(
      ResolvedRecordRetentionLimitsCopy.counting,
      translator,
    );
  }

  if (reach.count === null) {
    return null;
  }

  if (reach.count === 0) {
    return translateWord(
      ResolvedRecordRetentionLimitsCopy.reachesNone,
      translator,
    );
  }

  return translator.translatePlural(
    ResolvedRecordRetentionLimitsCopy.reach,
    reach.count,
  );
};

// Whether a new project may not start with `choice`: a length longer than the limit.
export const isLongerThanMaximum: (
  choice: number,
  maximumInDays: number | undefined,
) => boolean = (choice: number, maximumInDays: number | undefined): boolean => {
  return (
    maximumInDays !== undefined &&
    isResolvedRecordRetentionOn(choice) &&
    choice > maximumInDays
  );
};

// The sentence under "New projects delete after", for what it is set to.
export const getDefaultDescription: (data: {
  copy: ResolvedRecordRetentionLimitsKindCopy;
  defaultInDays: number;
  maximumInDays: number | undefined;
  translator: Translator;
}) => string = (data: {
  copy: ResolvedRecordRetentionLimitsKindCopy;
  defaultInDays: number;
  maximumInDays: number | undefined;
  translator: Translator;
}): string => {
  if (isResolvedRecordRetentionOn(data.defaultInDays)) {
    return translateForLength({
      inDays: data.copy.defaultInDays,
      inYears: data.copy.defaultInYears,
      retentionInDays: data.defaultInDays,
      translator: data.translator,
    });
  }

  // Never, under a limit, is the limit: a project set to Never is held to it.
  return translateWord(
    data.maximumInDays === undefined
      ? data.copy.defaultNeverDescription
      : ResolvedRecordRetentionLimitsCopy.defaultNeverUnderMaximum,
    data.translator,
  );
};

/*
 * The limits after the limit is saved, where they could not be read back:
 * what the server does in the same write (GlobalConfigService's
 * applyResolvedRecordRetentionLimitRules) - a default longer than the new
 * limit is lowered to it.
 */
export const getLimitsAfterMaximum: (
  limits: ResolvedRecordRetentionServerLimits,
  maximumInDays: number | undefined,
) => ResolvedRecordRetentionServerLimits = (
  limits: ResolvedRecordRetentionServerLimits,
  maximumInDays: number | undefined,
): ResolvedRecordRetentionServerLimits => {
  return {
    maximumInDays: maximumInDays,
    defaultInDays:
      maximumInDays !== undefined &&
      isLongerThanMaximum(limits.defaultInDays, maximumInDays)
        ? maximumInDays
        : limits.defaultInDays,
  };
};

export default ResolvedRecordRetentionLimitsCopy;
