import {
  AccessLogCounts,
  ExposureLogRead,
  ExposureLogReadStatus,
  formatBytesInEnglish,
  getReadsFromOutside,
} from "Common/Types/DataSecurity/AccessLogReads";
import {
  BREACH_LAW_RULES,
  BREACH_PLACE_CHOICES,
  BREACH_PLACE_WORDS,
  BreachLawRule,
  BreachPlace,
  getBreachLawRule,
  isUsStateRule,
} from "Common/Types/DataSecurity/BreachLaws";
import {
  ComplianceFact,
  describeComplianceFact,
} from "Common/Types/DataSecurity/ComplianceFacts";
import { DataSecurityExposureAssessmentResponse } from "Common/Types/DataSecurity/DataSecurityApiTypes";
import {
  BreachObligation,
  BreachObligationStatus,
  describeBreachCheckInEnglish,
  describeBreachDeadlineInEnglish,
  EXPOSURE_DRAFT_PART_TITLES,
  EXPOSURE_DRAFT_PARTS,
  EXPOSURE_NOTICE_PARTS,
  ExposureAssessmentView,
  ExposureDraftSection,
  ExposureReadsLogged,
  ExposureSecret,
  ExposureWindow,
  ExposureWindowEndKind,
  ExposureWindowStartKind,
  getBreachLawName,
  isKnownObligation,
  UNCOVERED_LAW_WORDS,
  UncoveredLaw,
} from "Common/Types/DataSecurity/ExposureAssessment";
import { ImpactAssessmentSectionSource } from "Common/Types/DataSecurity/ImpactAssessment";
import { withMeaningKeyAsItsWord } from "Common/Types/MeaningKeys";
import { NO_BREAK_SPACE } from "Common/Types/NoBreakSpaces";
import {
  createTranslator,
  DEFAULT_LANGUAGE,
  Translator,
} from "Common/Types/Translator";
import { PaperworkExportNames } from "../../DataSecurity/CompliancePaperworkExport";

/*
 * A CASE'S BREACH NOTICES AS ONE DOCUMENT (#10955): Export Markdown and
 * Export PDF on the Breach Notices card.
 *
 * One Markdown document, read like the two cards it comes from: that it is
 * a draft and not legal advice, and that nothing was sent, first; then the
 * law due first and its deadline; how long the store was open, who could
 * read it, whose data it was and the secrets to rotate; each law of the
 * table that may apply, with what a person still checks, its source and
 * the day it was checked; what the table does not cover; then each part of
 * the write-up as a person last saved it - who wrote it and when, its
 * words, and the facts a drafted part rests on.
 *
 * It reads only what the card shows - the server's answer, which holds no
 * sample, no record and no secret's value - and never names who read or
 * can reach the store: those are counted. Like the paperwork exports, its
 * own words are the English a team files it under; what a person or
 * OneUptime AI wrote stays as written. Nothing is sent: it is a file the
 * person downloads. The PDF draws this same Markdown
 * (CompliancePaperworkPdfDownload).
 */

export const BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH: string =
  "These are drafts, not legal advice. OneUptime worked out which breach laws may apply from what it recorded, and OneUptime AI drafted the notices for a person to review and edit. Nothing was sent: have them checked by whoever answers for your compliance, usually with counsel, before you send anything.";

export const DRAFT_NOT_LEGAL_ADVICE_ENGLISH: string =
  "A draft, not legal advice.";

const ENGLISH: Translator = createTranslator(undefined, DEFAULT_LANGUAGE);

// A store's breach notices, as their files are titled and named.
export function getExposureNoticesExportNames(
  storeName: string,
): PaperworkExportNames {
  return {
    pdfTitle: `Draft Breach Notices: ${storeName}`,
    fileLabel: `${storeName} breach notices`,
  };
}

// A moment as the document writes it: "2026-11-05 09:00 UTC".
export function exportMoment(value: string | Date | undefined): string {
  if (!value) {
    return "";
  }

  const date: Date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

// A day as the document writes it: YYYY-MM-DD.
function exportDay(value: string | Date | undefined): string {
  return exportMoment(value).slice(0, 10);
}

// Words that start a sentence of the document: "Without undue delay".
function startOfSentence(words: string): string {
  return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : words;
}

function plural(count: number, one: string, other: string): string {
  return `${count.toLocaleString("en-US")}${NO_BREAK_SPACE}${count === 1 ? one : other}`;
}

function englishList(items: ReadonlyArray<string>): string {
  if (items.length <= 1) {
    return items[0] || "";
  }

  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A country by its ISO code, in English: "Germany".
export function countryInEnglish(code: string): string {
  try {
    return (
      new Intl.DisplayNames(["en"], { type: "region" }).of(
        code.toUpperCase(),
      ) || code
    );
  } catch {
    return code;
  }
}

function placeInEnglish(place: string): string {
  const words: string | undefined = BREACH_PLACE_WORDS[place as BreachPlace];

  // A key that names its meaning reads as its word: "Georgia", the US state.
  return words ? withMeaningKeyAsItsWord(words) : place;
}

/*
 * The US states' notices that may apply if any of the people live in a
 * state nobody named (#10952): one line a state, in alphabetical order, as
 * fifty states' notices in full would bury the rest of the document.
 */
function stateLawLines(
  obligations: ReadonlyArray<BreachObligation>,
): Array<string> {
  const byState: Map<string, Array<BreachLawRule>> = new Map();

  // Each state's notices in the table's order: the people's first.
  for (const rule of BREACH_LAW_RULES) {
    if (
      !obligations.some((obligation: BreachObligation): boolean => {
        return obligation.ruleId === rule.id;
      })
    ) {
      continue;
    }

    const state: string = withMeaningKeyAsItsWord(
      BREACH_PLACE_CHOICES[rule.places![0]!],
    );

    byState.set(state, [...(byState.get(state) || []), rule]);
  }

  return [...byState.keys()]
    .sort((a: string, b: string): number => {
      return a.localeCompare(b);
    })
    .map((state: string): string => {
      const notices: Array<string> = byState
        .get(state)!
        .map((rule: BreachLawRule): string => {
          return `${getBreachLawName(rule.id)}: ${rule.action} (${describeBreachDeadlineInEnglish(rule)}${
            rule.minimumPeople
              ? `, if it affects ${rule.minimumPeople.isMoreThan ? "more than " : ""}${rule.minimumPeople.count.toLocaleString("en-US")}${rule.minimumPeople.isMoreThan ? "" : " or more"} people`
              : ""
          })`;
        });

      return `- **${state}:** ${notices.join("; ")}.`;
    });
}

// How long the store was open, in English.
export function describeWindowInEnglish(window: ExposureWindow | null): string {
  if (!window) {
    return "Data Security recorded no time the store was open to people outside your company.";
  }

  const from: string =
    window.startKind === ExposureWindowStartKind.Change
      ? `From ${exportMoment(window.start)}${window.startOperation ? `, when ${window.startOperation} opened it` : ""}`
      : `At least since ${exportMoment(window.start)}, the first scan that saw it exposed`;
  const length: string =
    window.days >= 1
      ? plural(window.days, "day", "days")
      : window.hours >= 1
        ? plural(window.hours, "hour", "hours")
        : "less than an hour";

  if (window.isStillOpen) {
    return `${from}, and it is still open: ${length} so far.`;
  }

  let until: string;

  switch (window.endKind) {
    case ExposureWindowEndKind.Change:
      until = `until ${exportMoment(window.end)}${window.endOperation ? `, when ${window.endOperation} closed it` : ""}`;
      break;
    case ExposureWindowEndKind.ResponseAction:
      until = `until ${exportMoment(window.end)}, when Data Security's response closed it`;
      break;
    default:
      until = `until ${exportMoment(window.end)} at the latest, when a scan saw it closed`;
  }

  return `${from}, ${until}: ${length}.`;
}

// Whether reads were logged and who could read it, counted - never named.
export function describeReadsInEnglish(
  view: ExposureAssessmentView,
): Array<string> {
  const reads: ExposureAssessmentView["reads"] = view.reads;
  const lines: Array<string> = [];

  switch (reads.logged) {
    case ExposureReadsLogged.NotLogged:
      lines.push("Reads were not logged. Treat the data as read.");
      break;
    case ExposureReadsLogged.Logged:
      lines.push("Reads were logged. The store's access logs say who read it.");
      break;
    default:
      lines.push(
        "Whether reads were logged is not known. Treat the data as read until someone checks.",
      );
  }

  if (reads.isPublic) {
    lines.push("Anyone on the internet could read it.");
  }

  if (reads.outsideAccounts > 0) {
    lines.push(
      `${plural(reads.outsideAccounts, "account", "accounts")} outside your company could read it.`,
    );
  }

  if (reads.outsideAccountsUsedInWindow > 0) {
    lines.push(
      reads.outsideAccountsUsedInWindow === 1
        ? "1 of them used its access while it was open."
        : `${reads.outsideAccountsUsedInWindow.toLocaleString("en-US")} of them used their access while it was open.`,
    );
  }

  lines.push(...describeLogReadsInEnglish(reads));

  return lines;
}

/*
 * What the store's own access logs say (#10951), once OneUptime read them
 * for the window as it is now: counted - the document never names who.
 */
export function describeLogReadsInEnglish(
  reads: ExposureAssessmentView["reads"],
): Array<string> {
  const read: ExposureLogRead | undefined = reads.fromLogs;

  if (
    !read ||
    read.status !== ExposureLogReadStatus.Read ||
    reads.isFromLogsCurrent === false
  ) {
    return [];
  }

  const outside: AccessLogCounts = getReadsFromOutside(read);
  const files: string = read.isComplete
    ? `It read ${plural(read.logFilesRead, "log file", "log files")} of the window.`
    : `It read ${plural(read.logFilesRead, "log file", "log files")}, to ${exportMoment(read.readThrough)}: the counts are those so far.`;

  if (outside.reads === 0) {
    return [
      read.isComplete
        ? "OneUptime read the store's access logs for this window: no read from outside your accounts."
        : "OneUptime read part of the store's access logs for this window: no read from outside your accounts so far.",
      files,
      "S3 delivers its access logs on a best effort basis, so a person still checks.",
    ];
  }

  const who: Array<string> = [
    read.anonymous.reads > 0
      ? `${read.anonymous.reads.toLocaleString("en-US")} by anyone on the internet, from ${plural(read.anonymous.addresses, "address", "addresses")}`
      : "",
    read.outside.reads > 0
      ? `${read.outside.reads.toLocaleString("en-US")} by ${plural(read.outside.accounts, "account", "accounts")} outside your company`
      : "",
    read.unknown.reads > 0
      ? `${read.unknown.reads.toLocaleString("en-US")} by requesters OneUptime cannot place`
      : "",
  ].filter(Boolean);

  return [
    `OneUptime read the store's access logs for this window: ${plural(outside.reads, "read", "reads")} from outside your accounts.`,
    `${who.join("; ")}.`,
    `${plural(outside.objects, "object", "objects")} read, ${formatBytesInEnglish(outside.bytes)} sent.`,
    files,
  ];
}

// Whose data it was, in English.
export function describeWhoseInEnglish(
  view: ExposureAssessmentView,
): Array<string> {
  const whose: ExposureAssessmentView["whose"] = view.whose;
  const lines: Array<string> = [];
  const types: Array<string> = whose.dataTypes.map(
    (type: { name: string }): string => {
      return type.name;
    },
  );

  lines.push(
    types.length > 0
      ? `It holds ${englishList(types)}${whose.categories.length > 0 ? ` (${whose.categories.join(", ")})` : ""}.`
      : "The scans found no data type in it.",
  );

  if (whose.specialCategories.length > 0) {
    lines.push(
      `Special category data among it: ${whose.specialCategories.join(", ")}.`,
    );
  }

  if (whose.records !== undefined) {
    lines.push(`About ${plural(whose.records, "record", "records")}.`);
  }

  if (whose.people.length > 0) {
    lines.push(
      `Its record of processing says it is about: ${whose.people.join(", ")}.`,
    );
  }

  if (whose.countriesFromData.length > 0) {
    lines.push(
      `Its data shows people in ${englishList(
        whose.countriesFromData.map(countryInEnglish),
      )}.`,
    );
  }

  if (whose.placesNamed && whose.placesNamed.length > 0) {
    lines.push(
      `A person said the people live in ${englishList(
        whose.placesNamed.map(placeInEnglish),
      )}.`,
    );
  } else if (whose.places.length === 0) {
    lines.push("Nobody has said where the people live yet.");
  }

  return lines;
}

// The secrets to rotate: each by its type and where - never its value.
export function describeSecretsInEnglish(
  view: ExposureAssessmentView,
): Array<string> {
  if (view.secretsToRotate.length === 0) {
    return ["No secret was found in the store while it was exposed."];
  }

  const lines: Array<string> = view.secretsToRotate.map(
    (secret: ExposureSecret): string => {
      return `${secret.dataTypeName}, at ${secret.location}${secret.isStillThere ? " (still there)" : " (fixed since)"}.`;
    },
  );

  if (view.hasMoreSecrets) {
    lines.push("More were found than an assessment lists.");
  }

  return lines;
}

// One law of the table that may apply, as a block of the document.
function obligationLines(
  obligation: BreachObligation,
  isFirst: boolean,
): Array<string> {
  const rule: BreachLawRule = getBreachLawRule(obligation.ruleId);
  const lines: Array<string> = [
    `### ${getBreachLawName(rule.id)}${isFirst ? " (due first)" : ""}`,
    "",
    `- **What it asks:** ${rule.action}.`,
    `- **Who is told:** ${rule.recipient}.`,
    `- **Deadline:** ${startOfSentence(describeBreachDeadlineInEnglish(rule))}${
      obligation.dueAt
        ? `. Due ${exportMoment(obligation.dueAt)}${obligation.isDueAtTheLatest ? " at the latest" : ""}`
        : ""
    }.${rule.deadlineNote ? ` ${rule.deadlineNote}` : ""}`,
  ];
  const checks: Array<string> = obligation.checks
    .map(describeBreachCheckInEnglish)
    .filter((check: string): boolean => {
      return check.length > 0;
    });

  if (checks.length > 0) {
    lines.push(`- **Still to check:** ${checks.join(" ")}`);
  }

  if (rule.note) {
    lines.push(`- **Note:** ${rule.note}`);
  }

  lines.push(
    `- **Source:** ${rule.sourceTitle}, ${rule.sourceUrl}, checked on ${rule.checkedOn}.`,
    "",
  );

  return lines;
}

// The law due first, or why none is.
function dueFirstLines(view: ExposureAssessmentView): Array<string> {
  const first: BreachObligation | null = view.mostUrgent;

  if (first && isKnownObligation(first)) {
    const rule: BreachLawRule = getBreachLawRule(first.ruleId);

    return [
      `**${getBreachLawName(rule.id)}: ${rule.action}.** ${rule.recipient}.`,
      "",
      `Due ${exportMoment(first.dueAt)}${first.isDueAtTheLatest ? " at the latest" : ""}: ${describeBreachDeadlineInEnglish(rule)}, counted from ${exportMoment(first.foundAt)}, when Data Security found the exposure.`,
      "",
    ];
  }

  if (view.isPlaceUnknown) {
    return [
      "Where the people live decides which laws apply, and nobody has said yet. Say where they live on the case's Was It a Breach? card.",
      "",
    ];
  }

  const mayApply: number = view.obligations.filter(
    (obligation: BreachObligation): boolean => {
      return obligation.status === BreachObligationStatus.MayApply;
    },
  ).length;

  return [
    mayApply > 0
      ? "No law with a deadline is known to apply yet: those below may, depending on what a person checks."
      : "No law in OneUptime's table asks for a notice on these facts. Check what it does not cover, below.",
    "",
  ];
}

// What the table does not cover, in English.
function uncoveredLines(view: ExposureAssessmentView): Array<string> {
  return view.uncovered.map((law: UncoveredLaw): string => {
    return `- ${ENGLISH.translateTemplate(UNCOVERED_LAW_WORDS[law.kind], {
      countries: englishList((law.countries || []).map(countryInEnglish)),
      states: englishList((law.states || []).map(placeInEnglish)),
    })}`;
  });
}

function bylineOf(
  section: ExposureDraftSection,
  editors: Record<string, string>,
): string {
  if (section.source === ImpactAssessmentSectionSource.Edited) {
    const name: string | undefined = section.editedByUserId
      ? editors[section.editedByUserId]
      : undefined;

    return `_Edited${name ? ` by ${name}` : ""} on ${exportDay(section.editedAt)}._`;
  }

  return `_Drafted by OneUptime AI on ${exportDay(section.draftedAt)}._`;
}

// The case's breach notices as one Markdown document.
export function getExposureNoticesMarkdown(data: {
  answer: DataSecurityExposureAssessmentResponse;
  exportedAt: Date;
}): string {
  const answer: DataSecurityExposureAssessmentResponse = data.answer;
  const view: ExposureAssessmentView | null = answer.view;
  const storeName: string =
    view?.store.name ||
    answer.stores.find((store: { dataStoreId: string }): boolean => {
      return store.dataStoreId === answer.dataStoreId;
    })?.name ||
    "";
  const lines: Array<string> = [
    `# ${getExposureNoticesExportNames(storeName).pdfTitle}`,
    "",
    `${[view?.store.kind, view?.store.region].filter(Boolean).join(", ")}${
      view ? ". " : ""
    }Exported from OneUptime on ${exportDay(data.exportedAt)}.`,
    "",
    `> ${BREACH_NOTICES_NOT_LEGAL_ADVICE_ENGLISH}`,
    "",
  ];

  if (view) {
    const mayApply: Array<BreachObligation> = view.obligations.filter(
      (obligation: BreachObligation): boolean => {
        return (
          obligation.status === BreachObligationStatus.MayApply &&
          isKnownObligation(obligation)
        );
      },
    );
    const known: Array<BreachObligation> = mayApply.filter(
      (obligation: BreachObligation): boolean => {
        return obligation.isPlaceKnown;
      },
    );
    const elsewhere: Array<BreachObligation> = mayApply.filter(
      (obligation: BreachObligation): boolean => {
        return (
          !obligation.isPlaceKnown &&
          !isUsStateRule(getBreachLawRule(obligation.ruleId))
        );
      },
    );
    const inStatesNobodyNamed: Array<BreachObligation> = mayApply.filter(
      (obligation: BreachObligation): boolean => {
        return (
          !obligation.isPlaceKnown &&
          isUsStateRule(getBreachLawRule(obligation.ruleId))
        );
      },
    );

    lines.push(
      "## Due First",
      "",
      ...dueFirstLines(view),
      "## How Long It Was Open",
      "",
      describeWindowInEnglish(view.window),
      "",
      "## Who Could Read It",
      "",
      ...describeReadsInEnglish(view).map((line: string): string => {
        return `- ${line}`;
      }),
      "",
      "## Whose Data",
      "",
      ...describeWhoseInEnglish(view).map((line: string): string => {
        return `- ${line}`;
      }),
      "",
      "## Secrets to Rotate",
      "",
      ...describeSecretsInEnglish(view).map((line: string): string => {
        return `- ${line}`;
      }),
      "",
      "## Breach Laws That May Apply",
      "",
    );

    if (
      known.length === 0 &&
      elsewhere.length === 0 &&
      inStatesNobodyNamed.length === 0
    ) {
      lines.push("None of the table's laws may apply on these facts.", "");
    }

    for (const obligation of known) {
      lines.push(
        ...obligationLines(
          obligation,
          obligation.ruleId === view.mostUrgent?.ruleId,
        ),
      );
    }

    if (elsewhere.length > 0) {
      lines.push(
        "## If Any of the People Live Elsewhere",
        "",
        "Each of these applies only if some of the people live where it says. Nobody has said they do.",
        "",
      );

      for (const obligation of elsewhere) {
        lines.push(...obligationLines(obligation, false));
      }
    }

    if (inStatesNobodyNamed.length > 0) {
      lines.push(
        "## If Any of the People Live in These US States",
        "",
        "Each state's notices apply only if some of the people live in that state. Nobody has said which states they live in: say so on the case's Was It a Breach? card, and only those states' laws stay. Each notice's source and what a person still checks are on the card.",
        "",
        ...stateLawLines(inStatesNobodyNamed),
        "",
      );
    }

    if (view.uncovered.length > 0) {
      lines.push(
        "## What This Does Not Cover",
        "",
        ...uncoveredLines(view),
        "",
      );
    }
  }

  const facts: ReadonlyArray<ComplianceFact> = answer.assessment?.facts || [];
  const cited: Set<string> = new Set();

  for (const part of EXPOSURE_DRAFT_PARTS) {
    const section: ExposureDraftSection | undefined =
      answer.assessment?.sections[part];

    lines.push(`## ${EXPOSURE_DRAFT_PART_TITLES[part]}`, "");

    if (EXPOSURE_NOTICE_PARTS.includes(part)) {
      lines.push(`_${DRAFT_NOT_LEGAL_ADVICE_ENGLISH}_`, "");
    }

    if (!section) {
      lines.push("_Not written yet._", "");
      continue;
    }

    lines.push(bylineOf(section, answer.editors));

    if (answer.staleParts.includes(part)) {
      lines.push("", "_The facts it rests on changed since it was written._");
    }

    lines.push("", section.markdown, "");

    const ids: Array<string> = facts
      .filter((fact: ComplianceFact): boolean => {
        return section.factKeys.includes(fact.key);
      })
      .map((fact: ComplianceFact): string => {
        cited.add(fact.key);
        return fact.id;
      });

    if (ids.length > 0) {
      lines.push(`Rests on: ${ids.join(", ")}.`, "");
    }
  }

  const citedFacts: Array<ComplianceFact> = facts.filter(
    (fact: ComplianceFact): boolean => {
      return cited.has(fact.key);
    },
  );

  if (citedFacts.length > 0) {
    lines.push(
      "## The Facts the Drafts Rest On",
      "",
      ...citedFacts.map((fact: ComplianceFact): string => {
        return `- **${fact.id}.** ${describeComplianceFact(fact)}`;
      }),
      "",
    );
  }

  return lines.join("\n");
}
