import { AI_SRE } from "./AiDocsPages";
import { hasPage } from "./DocsContentSupport";
import { englishSection, readRepoFile } from "./InventoryAndApiDocsSupport";
import { describe, expect, it } from "@jest/globals";

/*
 * WHAT THE AI SRE PAGE SAYS OF DATA SECURITY ON AI RESULTS, HELD TO THE
 * CODE (#10364).
 *
 * How well OneUptime AI is doing counts Data Security: of the changes
 * OneUptime AI made for Data Security issues, how many the issue's own
 * check proved; beside them the changes still waiting for it, undone and
 * that could not be made, the proposals approved and dismissed, the issues
 * analyzed and the median time from an issue opening to its check passing.
 * A change counts in the week it was made; each number lists its issues,
 * linked to their pages; By kind shows once two kinds were made.
 */

const section: string = englishSection(
  AI_SRE,
  "## How well OneUptime AI is doing",
);

const CARD_DATA: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsData.ts",
);
const RECORDS_DIALOG: string = readRepoFile(
  "App/FeatureSet/Dashboard/src/Components/AI/Results/AiResultsRecordsDialog.tsx",
);
const BUILDER: string = readRepoFile(
  "Common/Server/Utils/AI/Outcomes/AiOutcomesBuilder.ts",
);
const READER: string = readRepoFile(
  "Common/Server/Utils/AI/Outcomes/AiOutcomesReader.ts",
);

describe("AI Results counts Data Security", () => {
  it("says the page counts the Data Security issues you may see, as the page says when you may see none", () => {
    expect(section).toContain(
      "It changes nothing, and counts only the incidents, alerts, on-call pages, fixes and Data Security issues you may see.",
    );
    expect(CARD_DATA).toContain(
      '"These results count incidents, alerts, on-call pages, fixes and Data Security issues, and your role cannot read any of them. A Project Admin can give you access."',
    );
    // Read under the caller's own props, never as root.
    expect(READER).toContain("return DataSecurityAiProposalService.findBy({");
    expect(READER).not.toMatch(
      /DataSecurity\w*Service\.findBy\(\{[^}]*props: \{ isRoot: true \}/,
    );
  });

  it("names the card as the page does, and says what worked is what the issue's own check proved", () => {
    expect(section).toContain(
      "- **Data Security** — of the changes OneUptime AI made for Data Security issues (see [OneUptime AI in Data Security](/docs/data-security/ai)), how many worked: the issue's own check passed after the change.",
    );
    expect(CARD_DATA).toContain(
      'export const DATA_SECURITY_TITLE: string = translationKey("Data Security");',
    );
    expect(CARD_DATA).toContain(
      '"{{value}} of {{count}} changes OneUptime AI made worked."',
    );
    // Worked: made, standing, and its issue's check passed since (verifiedAt).
    expect(BUILDER).toContain(
      'return toTime(row.verifiedAt) === null ? "waiting" : "proven";',
    );
    expect(hasPage("en", "data-security/ai")).toBe(true);
  });

  it("says what is shown beside them, as the card draws it", () => {
    expect(section).toContain(
      "Changes still waiting for the check to pass, changes someone undid and changes that could not be made are shown beside them, with the proposals your team approved or dismissed, the issues OneUptime AI analyzed, and the median time from an issue opening to its check passing after a change.",
    );

    for (const label of [
      '"Waiting for the issue\'s check to pass"',
      '"Undone by a person"',
      '"Could not be made: nothing changed"',
      '"Proposals your team decided on"',
      '"Issues OneUptime AI analyzed"',
      '"Median time from an issue opening to its check passing"',
    ]) {
      expect(CARD_DATA).toContain(label);
    }

    // Approved by a person, never a change made without asking.
    expect(BUILDER).toContain("row.isApprovedByPerson &&");
    // The issues analyzed: the evaluations that analyzed one, each issue once.
    expect(READER).toContain("didAnalyze: true,");
    // From when each issue opened, its first detection.
    expect(READER).toContain("select: { _id: true, firstDetectedAt: true },");
    expect(BUILDER).toContain("Math.round(getMedian(minutes))");
  });

  it("says a change counts in the week it was made, and each number lists its issues, linked to their pages", () => {
    expect(section).toContain(
      "A change counts in the week it was made, and each number lists the issues it counts, each linked to its page.",
    );
    expect(READER).toContain('> = ["appliedAt", "failedAt", "dismissedAt"];');
    expect(READER).toContain(
      "proposal.appliedAt || proposal.failedAt || proposal.dismissedAt;",
    );
    expect(RECORDS_DIALOG).toContain(
      "RouteMap[PageMap.DATA_SECURITY_ISSUE_VIEW] as Route,",
    );
  });

  it("says how each kind did shows once more than one kind of change was made", () => {
    expect(section).toContain(
      "Once OneUptime AI has made more than one kind of change, the card shows how each kind did.",
    );
    expect(CARD_DATA).toContain("return rows.length >= 2 ? { rows } : null;");
  });
});
