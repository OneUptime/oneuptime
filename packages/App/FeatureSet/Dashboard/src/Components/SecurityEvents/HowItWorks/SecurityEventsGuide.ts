import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import { markdownTableCell } from "Common/Utils/Markdown/MarkdownTableCell";

/*
 * A "how it works" guide for one Security Events surface (detection
 * rules, threat intel). Kept as plain data, apart from the card that
 * renders it, for two reasons:
 *
 *  - the same content feeds both the card at the top of the page and the
 *    table header's help (?) modal, so the two cannot tell a customer
 *    different things;
 *  - every number and name a guide states is either imported from the
 *    constants the engine itself runs on, or pinned against the engine by
 *    tests — documentation that drifts from behavior is worse than none.
 */

/*
 * A sentence with numbers in it, as the card looks it up: the sentence (an
 * en.json key, {{name}} where a number goes - the extractor reads it by its
 * property name) and the numbers, each written the reader's way. The plain
 * English beside it (description, label) is the same sentence filled in, for
 * the help modal and the tests.
 */
export interface SecurityEventsGuideTemplate {
  sentence: string;
  values: Record<string, number>;
}

export interface SecurityEventsGuideStep {
  title: string;
  description: string;
  // When the description holds numbers: how the card looks it up.
  descriptionTemplate?: SecurityEventsGuideTemplate | undefined;
  icon: IconProp;
}

export interface SecurityEventsGuideLevel {
  // What the source calls it: a Sigma level, or a confidence band.
  label: string;
  // When the label holds numbers: how the card looks it up.
  labelTemplate?: SecurityEventsGuideTemplate | undefined;
  /*
   * The label is a value written as is in a rule (a Sigma level such as
   * "high"): drawn as written, never translated.
   */
  isLabelAValue?: boolean | undefined;
  // The OCSF severity it becomes, shown with the Events table's pill colors.
  severity: OcsfSeverity;
}

export interface SecurityEventsGuideLevels {
  title: string;
  description: string;
  // The link to the section below: "How severity levels are chosen".
  linkText: string;
  items: Array<SecurityEventsGuideLevel>;
  // The full-guide section that explains the levels in depth.
  sectionId: string;
}

// A template filled in with its numbers as written in English: 1440, not 1,440.
export function fillGuideTemplate(
  guideTemplate: SecurityEventsGuideTemplate,
): string {
  let text: string = guideTemplate.sentence;

  for (const [name, value] of Object.entries(guideTemplate.values)) {
    text = text.split(`{{${name}}}`).join(String(value));
  }

  return text;
}

export interface SecurityEventsGuideSection {
  id: string;
  title: string;
  markdown: string;
}

export interface SecurityEventsGuide {
  // Stable key: suffix of the collapsed-state storage key, and test ids.
  id: string;
  title: string;
  summary: string;
  steps: Array<SecurityEventsGuideStep>;
  levels: SecurityEventsGuideLevels;
  guideTitle: string;
  guideDescription: string;
  sections: Array<SecurityEventsGuideSection>;
  // Path under DOCS_URL of the public page this guide summarizes.
  documentationPath: string;
}

export function getGuideSection(
  guide: SecurityEventsGuide,
  sectionId: string,
): SecurityEventsGuideSection | undefined {
  return guide.sections.find((section: SecurityEventsGuideSection) => {
    return section.id === sectionId;
  });
}

/*
 * The whole guide as one markdown document, for surfaces that can only
 * show a single markdown blob — ModelTable's help (?) modal.
 */
export function guideToMarkdown(guide: SecurityEventsGuide): string {
  return guide.sections
    .map((section: SecurityEventsGuideSection): string => {
      return `### ${section.title}\n\n${section.markdown.trim()}`;
    })
    .join("\n\n---\n\n");
}

/*
 * GitHub-flavored markdown table. Each cell is placed with
 * markdownTableCell, so a value such as a Sigma `field|modifier` key cannot
 * split its column, whatever backslashes it holds, and a line break cannot
 * end its row.
 */
export function markdownTable(
  headers: Array<string>,
  rows: Array<Array<string>>,
): string {
  const toRow: (cells: Array<string>) => string = (
    cells: Array<string>,
  ): string => {
    return `| ${cells
      .map((cell: string): string => {
        return markdownTableCell(cell);
      })
      .join(" | ")} |`;
  };

  return [
    toRow(headers),
    toRow(
      headers.map((): string => {
        return "---";
      }),
    ),
    ...rows.map(toRow),
  ].join("\n");
}
