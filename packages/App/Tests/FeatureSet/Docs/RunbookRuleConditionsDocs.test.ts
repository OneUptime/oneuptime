import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { RUNBOOK_RULE_CRITERIA_FIELDS } from "Common/Types/Runbook/RunbookRuleCriteria";

/*
 * Runbook rules match on what the other rules of their product match on -
 * monitors, severities, labels, monitor labels, monitor names and
 * descriptions - not only on the title and description. The runbook docs
 * describe the conditions a rule offers, and markdown is not compiled, so
 * nothing else notices a page that still says a runbook rule is "a regex on
 * the title".
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const RUNBOOK_DOCS: string = path.join(
  REPO_ROOT,
  "App/FeatureSet/Docs/Content/en/runbooks",
);

const RULES_PAGE: string = fs.readFileSync(
  path.join(RUNBOOK_DOCS, "rules.md"),
  "utf8",
);
const OVERVIEW_PAGE: string = fs.readFileSync(
  path.join(RUNBOOK_DOCS, "index.md"),
  "utf8",
);

// The section of a page under one "## " heading.
function section(markdown: string, heading: string): string {
  const start: number = markdown.indexOf(`\n## ${heading}\n`);

  expect({ heading, found: start > -1 }).toEqual({ heading, found: true });

  const rest: string = markdown.slice(start + heading.length + 5);
  const next: number = rest.indexOf("\n## ");

  return next === -1 ? rest : rest.slice(0, next);
}

/*
 * How the page names each criterion a runbook rule can use, in the words of
 * the Criteria dropdown: one name per trigger where the name says which.
 */
const CRITERIA_NAMES: Record<string, string> = {
  monitors: "**Monitors**",
  incidentSeverities: "**Incident Severities**",
  alertSeverities: "**Alert Severities**",
  labels: "**Incident Labels** / **Alert Labels** / **Event Labels**",
  monitorLabels: "**Monitor Labels**",
  titlePattern: "**Incident Title** / **Alert Title** / **Event Title**",
  descriptionPattern:
    "**Incident Description** / **Alert Description** / **Event Description**",
  monitorNamePattern: "**Monitor Name**",
  monitorDescriptionPattern: "**Monitor Description**",
};

describe("runbook rule conditions in the docs", () => {
  const conditions: string = section(RULES_PAGE, "Conditions");

  it("names every criterion a runbook rule can use", () => {
    expect(Object.keys(CRITERIA_NAMES).sort()).toEqual(
      [...RUNBOOK_RULE_CRITERIA_FIELDS].sort(),
    );

    for (const field of RUNBOOK_RULE_CRITERIA_FIELDS) {
      expect({
        field,
        named: conditions.includes(CRITERIA_NAMES[field]!),
      }).toEqual({ field, named: true });
    }
  });

  it("says scheduled maintenance rules have no severity to match", () => {
    expect(conditions).toContain(
      "Scheduled maintenance events have no severity",
    );
  });

  it("explains the list operators the new criteria use", () => {
    for (const operator of ["Has any of", "Has all of", "Has none of"]) {
      expect(conditions).toContain(`**${operator}**`);
    }
  });

  it("never names a criterion after its pattern column", () => {
    expect(RULES_PAGE).not.toMatch(/\*\*[^*\n]*\bPattern\*\*/);
    expect(RULES_PAGE).not.toMatch(/Title Pattern|Description Pattern/);
  });

  it("explains that monitor conditions are checked one monitor at a time", () => {
    expect(section(RULES_PAGE, "Matching semantics")).toContain(
      "Monitor conditions are checked one monitor at a time",
    );
  });

  it("shows a rule scoped by monitor labels and severity", () => {
    expect(RULES_PAGE).toContain("Monitor Labels has any of Production");
    expect(RULES_PAGE).toContain("Incident Severities has any of Critical");
  });

  it("no longer describes a runbook rule as a regex on the title or description", () => {
    const glossaryRow: string | undefined = OVERVIEW_PAGE.split("\n").find(
      (line: string): boolean => {
        return line.startsWith("| **Runbook Rule** |");
      },
    );

    expect(glossaryRow).toBeDefined();
    expect(glossaryRow).not.toMatch(/regex/i);
    expect(glossaryRow).toContain("labels");
    expect(glossaryRow).toContain("severity");
  });
});
