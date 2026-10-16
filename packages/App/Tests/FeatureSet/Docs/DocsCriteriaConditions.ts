import {
  dashboardLabel,
  drawnDashboardLabel,
  isDashboardLabel,
} from "./DocsDashboardLabels";
import { boldSpans } from "./DocsTranslationChecks";
import { FilterType } from "Common/Types/Monitor/CriteriaFilter";

/*
 * How a translated docs page names a monitor criteria's condition: Greater
 * Than, Not Equal To, Contains, Is Empty, True (FilterType).
 *
 * The criteria form offers the conditions as Dropdown options labelled with
 * their FilterType value, and the Dropdown draws every option through the
 * Dashboard's translator (tx(option.label)). So a condition is drawn in the
 * reader's language as soon as the Dashboard's locales have a key for it:
 * Contains, True and False always had one, and adc8421a1b gave the other
 * comparisons theirs ("Greater Than" is "Größer als" in German). No German
 * screen shows "Greater Than" any more, so no German page may name it so.
 *
 * A page names a condition in bold where it points at the screen ("set the
 * condition to **Größer als**"), and in plain text in a table of the
 * conditions a filter offers or in a sentence that names one ("Größer als,
 * Kleiner als and the other number conditions"). Both are read here, outside
 * code: a code span or block is a value as typed (Terraform's
 * `filter_type = "Greater Than"`), which stays English.
 *
 * True and False are read in bold only: in plain text they are as often a
 * word of a longer English name ("False Positive") as the condition.
 *
 * The Persian incident pages keep the Dashboard's English names, as they
 * always have (DocsDashboardLabels.dashboardLabel); every other page names a
 * condition as its language's Dashboard draws it (drawnDashboardLabel).
 *
 * DocsCriteriaConditions.test.ts holds every page in every language to it.
 */

// The conditions the Dashboard translates: the FilterType values it has a key for.
export const DRAWN_CONDITIONS: ReadonlyArray<string> = Object.values(
  FilterType,
).filter((condition: string): boolean => {
  return isDashboardLabel(condition);
});

// The conditions read in bold only: in prose they are often a word of another name.
export const BOLD_ONLY_CONDITIONS: ReadonlyArray<string> = [
  FilterType.True,
  FilterType.False,
];

/*
 * Longer names a condition's name is a part of, which are not that
 * condition: the other FilterType values ("Evaluates To True"), and the
 * workspace rules' Contains Any and Contains All, labels of their own.
 */
export const LONGER_NAMES: ReadonlyArray<string> = [
  ...Object.values(FilterType).filter((value: string): boolean => {
    return !DRAWN_CONDITIONS.includes(value);
  }),
  "Contains Any",
  "Contains All",
];

const INCIDENT_PAGES_PREFIX: string = "incidents/";

// A fenced code block's opening or closing line, as prose() reads one.
const FENCE_LINE: RegExp = /^ {0,3}```/;
// An inline code span, which is a value as typed, not a name.
const INLINE_CODE_SPAN: RegExp = /`[^`\n]*`/g;
// A letter of a Latin word: a name found inside a longer word is not the name.
const LATIN_LETTER: RegExp = /[A-Za-z]/;
const BOLD_MARKER: string = "**";

/*
 * How a page in this language names a condition: as the Dashboard draws it,
 * or, on the Persian incident pages, in English.
 */
export function expectedConditionName(
  language: string,
  page: string,
  condition: string,
): string {
  return page.startsWith(INCIDENT_PAGES_PREFIX)
    ? dashboardLabel(language, condition)
    : drawnDashboardLabel(language, condition);
}

/*
 * The page's lines with every line of a fenced code block left empty, so a
 * line keeps the page's own number. The lines left are prose()'s
 * (DocsTranslationChecks).
 */
export function proseLines(markdown: string): Array<string> {
  let inFence: boolean = false;

  return markdown.split("\n").map((line: string): string => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return "";
    }

    return inFence ? "" : line;
  });
}

// A line with each inline code span blanked out, so its positions stay the line's.
export function withoutInlineCode(line: string): string {
  return line.replace(INLINE_CODE_SPAN, (span: string): string => {
    return " ".repeat(span.length);
  });
}

// A name found in a line: where it starts and ends.
export interface NameFound {
  start: number;
  end: number;
  name: string;
}

/*
 * Every name of `names` in a line, whole words only, the longest first where
 * two overlap: "Greater Than Or Equal To" is one name, not also "Greater
 * Than" and "Equal To".
 */
export function namesInLine(
  line: string,
  names: ReadonlyArray<string>,
): Array<NameFound> {
  const found: Array<NameFound> = [];

  for (const name of names) {
    let from: number = line.indexOf(name);

    while (from >= 0) {
      const end: number = from + name.length;
      const before: string = from > 0 ? (line[from - 1] as string) : "";
      const after: string = end < line.length ? (line[end] as string) : "";

      if (!LATIN_LETTER.test(before) && !LATIN_LETTER.test(after)) {
        found.push({ start: from, end: end, name: name });
      }

      from = line.indexOf(name, from + 1);
    }
  }

  found.sort((a: NameFound, b: NameFound): number => {
    return a.start - b.start || b.end - a.end;
  });

  const kept: Array<NameFound> = [];

  for (const candidate of found) {
    const last: NameFound | undefined = kept[kept.length - 1];

    if (last && candidate.start < last.end) {
      continue;
    }

    kept.push(candidate);
  }

  return kept;
}

// A place where a page names a condition in English, though its language draws it otherwise.
export interface EnglishCondition {
  line: number;
  condition: string;
  drawn: string;
  bold: boolean;
}

/*
 * The places a translated page names a condition in English where its
 * language's Dashboard draws it otherwise: every bold span that is the
 * condition, and every other mention outside code (a plain one, or one in a
 * longer bold span such as "**Equal To 0**"), by line.
 */
export function englishConditionsOn(
  language: string,
  page: string,
  markdown: string,
): Array<EnglishCondition> {
  const drawnOtherwise: Array<string> = DRAWN_CONDITIONS.filter(
    (condition: string): boolean => {
      return expectedConditionName(language, page, condition) !== condition;
    },
  );
  const findings: Array<EnglishCondition> = [];

  proseLines(markdown).forEach((line: string, index: number): void => {
    const text: string = withoutInlineCode(line);
    const spans: Array<string> = boldSpans(text);

    for (const found of namesInLine(text, [
      ...drawnOtherwise,
      ...LONGER_NAMES,
    ])) {
      if (!drawnOtherwise.includes(found.name)) {
        continue;
      }

      const bold: boolean =
        text.slice(found.start - BOLD_MARKER.length, found.start) ===
          BOLD_MARKER &&
        text.slice(found.end, found.end + BOLD_MARKER.length) ===
          BOLD_MARKER &&
        spans.includes(found.name);

      if (!bold && BOLD_ONLY_CONDITIONS.includes(found.name)) {
        continue;
      }

      findings.push({
        line: index + 1,
        condition: found.name,
        drawn: expectedConditionName(language, page, found.name),
        bold: bold,
      });
    }
  });

  return findings;
}
