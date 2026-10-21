import Handlebars from "handlebars";
import fs from "fs";
import Path from "path";
import { describe, expect, test } from "@jest/globals";
import { registerEmailDetailCardHelpers } from "../../FeatureSet/Notification/Utils/EmailDetailCard";
import { readEmailMarkup } from "./Fixtures/EmailMarkupTree";
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
