import Handlebars from "handlebars";
import { registerEmailLanguageHelpers } from "../../FeatureSet/Notification/Utils/EmailLanguage";
import fs from "fs";
import Path from "path";
import { describe, expect, test } from "@jest/globals";
import { registerEmailDetailCardHelpers } from "../../FeatureSet/Notification/Utils/EmailDetailCard";
import { readEmailMarkup } from "./Fixtures/EmailMarkupTree";
import { visibleText } from "Common/Tests/Helpers/HtmlText";
import {
  DetailCard,
  DetailCardRow,
  detailCards,
} from "./Fixtures/EmailDividers";

/*
 * THE APPROVAL EMAIL SAYS WHAT THE STEP WOULD ACT ON.
 *
 * A Contain step proposes the users or hosts it would suspend or isolate,
 * and the approver ticks the ones to keep (SecurityPlaybookTargets). The
 * email asking for the approval names them in a "Would Act On" row, right
 * under the step, so the approver sees what is at stake before opening the
 * case. A step that acts on nobody in particular has no such row. The names
 * come from detections, so they are escaped.
 */

const TEMPLATES_DIR: string = Path.resolve(
  __dirname,
  "../../FeatureSet/Notification/Templates",
);
const PARTIALS_DIR: string = Path.join(TEMPLATES_DIR, "Partials");

const engine: typeof Handlebars = Handlebars.create();
// The email language helpers the templates word their text with.
registerEmailLanguageHelpers(engine);

for (const name of fs.readdirSync(PARTIALS_DIR)) {
  if (name.endsWith(".hbs")) {
    engine.registerPartial(
      name.slice(0, -4),
      fs.readFileSync(Path.join(PARTIALS_DIR, name), "utf8"),
    );
  }
}

registerEmailDetailCardHelpers(engine);

function render(vars: Record<string, string>): string {
  return engine.compile(
    fs.readFileSync(
      Path.join(TEMPLATES_DIR, "SecurityPlaybookApprovalRequested.hbs"),
      "utf8",
    ),
  )({
    emailTitle: "Approval needed: Contain compromised host",
    leadSentence: "A playbook step on CASE-12 is waiting for your approval.",
    reasonSentence: "You are on this case and can approve its playbook steps.",
    playbookName: "Contain compromised host",
    stepDescription: "step 2 (Contain the host in CrowdStrike)",
    startedBy: "Automatically, for a new case",
    caseTitle: "Brute force against web-01",
    casePriority: "Critical",
    projectName: "Acme",
    caseViewLink: "https://oneuptime.example.com/dashboard/case",
    ...vars,
  });
}

function rowLabels(html: string): Array<string> {
  const cards: Array<DetailCard> = detailCards(readEmailMarkup(html));

  expect(cards).toHaveLength(1);

  return cards[0]!.rows.map((row: DetailCardRow): string => {
    return row.label;
  });
}

describe("the approval email's Would Act On row", () => {
  test("names the proposed targets, right under the step", () => {
    const html: string = render({ stepTargets: "web-01, db-02" });

    expect(rowLabels(html)).toEqual([
      "Playbook:",
      "Step Waiting:",
      "Would Act On:",
      "Started:",
      "Case:",
      "Priority:",
      "Project:",
    ]);
    expect(html).toContain("web-01, db-02");
  });

  test("is left out when the step acts on nobody in particular", () => {
    expect(rowLabels(render({ stepTargets: "" }))).not.toContain(
      "Would Act On:",
    );
    expect(rowLabels(render({}))).not.toContain("Would Act On:");
  });

  test("escapes a target, which a detection named", () => {
    const target: string = '<img src="x">-host';
    const html: string = render({ stepTargets: target });

    expect(html).not.toContain(target);
    expect(html).toContain(Handlebars.escapeExpression(target));
  });
});

/*
 * THE EVIDENCE, IN THE EMAIL AS IN CHAT (#10341).
 *
 * What the step will do and through which connection, what it leaves alone
 * and why, the evidence behind the case, and whether it can be undone -
 * the approval's own words (SecurityPlaybookApprovalWords), in rows around
 * the targets, so nobody approves blind. Each row is left out when the
 * approval has nothing to say there. Its button opens the approval on the
 * case: it never decides, since a mail scanner follows every link.
 */
describe("the approval email's evidence", () => {
  const EVIDENCE: Record<string, string> = {
    approvalAction: "Contain the host in CrowdStrike, through CrowdStrike (prod)",
    stepTargets: "web-01: the case is grouped on it",
    approvalLeftAlone: "db-02: on your protected list (db-*)",
    approvalEvidence:
      "12 requests behind the case: Turned away: 9, Reached the app: 3",
    approvalUndo:
      "Can be undone: each one, with Lift containment in CrowdStrike on the case.",
  };

  test("what it will do, to what, what it leaves alone, the evidence and the undo, in that order", () => {
    const html: string = render(EVIDENCE);

    expect(rowLabels(html)).toEqual([
      "Playbook:",
      "Step Waiting:",
      "Will Do:",
      "Would Act On:",
      "Left Alone:",
      "Evidence:",
      "Can Be Undone:",
      "Started:",
      "Case:",
      "Priority:",
      "Project:",
    ]);

    // Each row reads its label, then the approval's words.
    const text: string = visibleText(html).replace(/\s+/g, " ");

    for (const [label, value] of [
      ["Will Do:", EVIDENCE["approvalAction"]],
      ["Would Act On:", EVIDENCE["stepTargets"]],
      ["Left Alone:", EVIDENCE["approvalLeftAlone"]],
      ["Evidence:", EVIDENCE["approvalEvidence"]],
      ["Can Be Undone:", EVIDENCE["approvalUndo"]],
    ] as Array<[string, string]>) {
      expect(text).toContain(`${label} ${value}`);
    }
  });

  test("a row the approval has nothing to say in is left out", () => {
    const labels: Array<string> = rowLabels(
      render({ approvalAction: EVIDENCE["approvalAction"]! }),
    );

    expect(labels).toContain("Will Do:");
    expect(labels).not.toContain("Left Alone:");
    expect(labels).not.toContain("Evidence:");
    expect(labels).not.toContain("Can Be Undone:");
  });

  test("escapes what detections and people named", () => {
    const named: string = '<a href="https://evil.example">CrowdStrike</a>';
    const html: string = render({
      approvalAction: `Contain the host, through ${named}`,
      approvalLeftAlone: `${named}: on your protected list`,
      approvalEvidence: `${named} 3 requests`,
      approvalUndo: `Can be undone: ${named}`,
    });

    expect(html).not.toContain(named);
    expect(html).not.toContain('href="https://evil.example"');
    expect(html).toContain(Handlebars.escapeExpression(named));
  });

  test("its button opens the approval on the case, and is the only link to it", () => {
    const approvalUrl: string =
      "https://oneuptime.example.com/dashboard/p/security-events/cases/c/playbook-runs";
    const html: string = render({ ...EVIDENCE, caseViewLink: approvalUrl });

    expect(html).toContain(`href="${approvalUrl}"`);
    expect(html).toContain("Approve or Reject");
    expect(html).not.toMatch(/href="[^"]*\/(approve|reject)\b/);
  });
});
