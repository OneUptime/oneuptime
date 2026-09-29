import IconProp from "Common/Types/Icon/IconProp";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";

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

export interface SecurityEventsGuideStep {
  title: string;
  description: string;
  icon: IconProp;
}

export interface SecurityEventsGuideLevel {
  // What the source calls it: a Sigma level, or a confidence band.
  label: string;
  // The OCSF severity it becomes, shown with the Events table's pill colors.
  severity: OcsfSeverity;
}

export interface SecurityEventsGuideLevels {
  title: string;
  description: string;
  items: Array<SecurityEventsGuideLevel>;
  // The full-guide section that explains the levels in depth.
  sectionId: string;
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
 * GitHub-flavored markdown table. Pipes inside cells are escaped so a
 * value such as a Sigma `field|modifier` key cannot split its column.
 */
export function markdownTable(
  headers: Array<string>,
  rows: Array<Array<string>>,
): string {
  const escapeCell: (cell: string) => string = (cell: string): string => {
    return cell.replace(/\|/g, "\\|");
  };

  const toRow: (cells: Array<string>) => string = (
    cells: Array<string>,
  ): string => {
    return `| ${cells.map(escapeCell).join(" | ")} |`;
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
