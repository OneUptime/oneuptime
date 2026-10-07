import {
  AI_SRE_PAGE,
  DOCS_CONTENT_DIR,
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import {
  AI_LANE_SWITCHES,
  AiLane,
  ProjectAiSwitchDefinition,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import {
  AUTO_REMEDIATION_APPROVAL_OPTIONS,
  AUTO_REMEDIATION_FIX_WITH_OPTIONS,
  AUTO_REMEDIATION_FIX_WITH_TEXT,
} from "../../../FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import { CATCH_ALL_RULE_NAMES } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1799400000000-AddAutomaticRemediationSwitchesAndInvestigationRules";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * Fixing new incidents and alerts has a switch of its own, off by default,
 * and rules - folded under More settings on the AI settings page - narrow
 * which incidents are investigated and which are fixed, and how. The docs
 * say so in the words the dashboard and the upgrade use: the switch titles,
 * the rule form's choices, the rules the upgrade adds and the API values.
 */

const RULES_HEADING: string = "## Which incidents are investigated and fixed";
const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string =
  "### Fixing new incidents and alerts has a switch of its own";
const PREVIOUS_NOTE_HEADING: string =
  "### The AI Logs get an index for the daily AI limits";
const NEXT_NOTE_HEADING: string = "### Verify the edition and the license";

const INCIDENT_SETTINGS_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "incidents/settings.md",
);
const INCIDENT_OVERVIEW_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "incidents/index.md",
);

function flat(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function titles(lane: AiLane): Array<string> {
  return AI_LANE_SWITCHES[lane].map(
    (definition: ProjectAiSwitchDefinition<string>): string => {
      return definition.title;
    },
  );
}

describe("the AI SRE page", () => {
  const page: string = flat(read(AI_SRE_PAGE));
  const rules: string = flat(getSection(read(AI_SRE_PAGE), RULES_HEADING));

  it("names the incident page's switches as the dashboard titles them, in order", () => {
    const named: string = titles(AiLane.Incident)
      .map((title: string): string => {
        return `_${title}_`;
      })
      .join(", ");

    expect(titles(AiLane.Incident)[1]).toBe("Fix new incidents automatically");
    expect(page).toContain(
      `The incident page has five, under **What OneUptime AI does**: ${named
        .split(", ")
        .slice(0, -1)
        .join(", ")} and _${titles(AiLane.Incident).slice(-1)[0]}_.`,
    );
  });

  it("says fixing starts off, for new projects too", () => {
    expect(page).toContain(
      "_Fix new incidents automatically_ (and _Fix new alerts automatically_) is the one switch that starts **off**, for new projects too",
    );
  });

  it("has a section on the rules, which says what no rule means for each", () => {
    expect(getHeadings(read(AI_SRE_PAGE))).toContain(RULES_HEADING);
    expect(rules).toContain(
      "- **Investigation rules** — which new incidents are investigated. With no rule, every one is.",
    );
    expect(rules).toContain(
      "- **Auto remediation rules** — which new incidents are fixed, and how, while _Fix new incidents automatically_ is on. With no rule, OneUptime AI fixes every new incident",
    );
    // Rules that cannot be read never stop an investigation.
    expect(rules).toContain(
      "the incident is investigated as if there were none",
    );
  });

  it("asks the rule form's three questions, with its choices as the form names them", () => {
    for (const option of [
      ...AUTO_REMEDIATION_FIX_WITH_OPTIONS,
      ...AUTO_REMEDIATION_APPROVAL_OPTIONS,
    ]) {
      expect({
        option: option.title,
        named: rules.includes(`**${option.title}**`),
      }).toEqual({ option: option.title, named: true });
    }

    for (const question of ["**Conditions**", "**Fix With**", "**Approval**"]) {
      expect(rules).toContain(question);
    }
  });

  it("says an agent that asks still asks, and that one rule that asks makes the AI fixes ask", () => {
    expect(rules).toContain(
      "a cluster or host set to ask for approval still asks",
    );
    expect(rules).toContain(
      "If any matching OneUptime AI rule asks before fixing, every OneUptime AI fix for the incident asks first",
    );
  });

  it("names the older rules as the table does, and says they keep working", () => {
    expect(rules).toContain(
      `**${AUTO_REMEDIATION_FIX_WITH_TEXT.runnerCommands}**`,
    );
    expect(rules).toContain(
      `**${AUTO_REMEDIATION_FIX_WITH_TEXT.aiPickedRunbook}**`,
    );
    expect(rules).toContain(
      "A rule saved before rules were simplified keeps doing what it did.",
    );
  });

  it("no longer says Enable AI is the only switch fixes need", () => {
    expect(page).not.toContain("The only project switch fixes need is");
    expect(page).not.toContain(
      "A cluster's fixes need no Auto Remediation Rule",
    );
    expect(page).not.toMatch(/\bAI\s*>\s*Auto Remediation Rules\b/);
  });
});

describe("the incident pages", () => {
  it("say the AI settings page switches fixing, and holds the rules under More settings", () => {
    const settings: string = flat(read(INCIDENT_SETTINGS_PAGE));

    expect(settings).toContain(
      "fixing them automatically (off until you turn it on)",
    );
    expect(settings).toContain(
      "**Incidents → AI → Settings** two more, under **More settings**: **Auto Remediation Rules** and **Investigation Rules**.",
    );
    expect(settings).toContain(
      "- **Investigation Rules**, under **AI** → **Settings** — which new incidents OneUptime AI investigates. With no rule, every one is.",
    );
    expect(settings).toContain("Do not assume one model applies to all ten.");
  });

  it("list three pages in the AI section", () => {
    expect(flat(read(INCIDENT_OVERVIEW_PAGE))).toContain(
      "| **AI** | **Insights**, **Logs**, **Settings**: what OneUptime AI learned",
    );
  });
});

describe("the upgrade note", () => {
  const note: string = flat(getSection(read(UPGRADING_PAGE), NOTE_HEADING));

  it("sits in the 13 → 14 notes, after the AI Logs index note and before the edition checks, once", () => {
    const headings: Array<string> = getHeadings(
      getSection(read(UPGRADING_PAGE), THIRTEEN_TO_FOURTEEN_HEADING),
    );
    const position: number = headings.indexOf(NOTE_HEADING);

    expect(position).toBeGreaterThan(0);
    expect(headings[position - 1]).toBe(PREVIOUS_NOTE_HEADING);
    expect(headings[position + 1]).toBe(NEXT_NOTE_HEADING);
    expect(
      getHeadings(read(UPGRADING_PAGE)).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
  });

  it("names the switches, and says they start off", () => {
    expect(note).toContain(
      "**Fix new incidents automatically** and **Fix new alerts automatically**",
    );
    expect(note).toContain("It starts off, for new projects too");
  });

  it("says who gets the switch on, and names the rules the upgrade adds as the migration does", () => {
    expect(note).toContain(
      "The switch is on for incidents (or alerts) in a project that had an enabled auto remediation rule for them, or fixes on for any of its Kubernetes clusters or hosts.",
    );
    expect(note).toContain(`**${CATCH_ALL_RULE_NAMES.Incident}**`);
    expect(note).toContain(`**${CATCH_ALL_RULE_NAMES.Alert}**`);
    expect(note).toContain(
      "Delete it to fix only what your other rules match.",
    );
  });

  it("says where the rules are now, and that the old addresses still lead there", () => {
    expect(note).toContain("`…/ai/auto-remediation-rules`");
    expect(note).toContain("`…/settings/auto-remediation-rules`");
    expect(note).toContain("**Investigation Rules**");
  });

  it("gives the API and Terraform names, and the values a rule's Fix With takes", () => {
    for (const name of [
      "`enableAutomaticIncidentRemediation`",
      "`enableAutomaticAlertRemediation`",
      "`enable_automatic_incident_remediation`",
      "`enable_automatic_alert_remediation`",
      "`remediationAction`",
    ]) {
      expect(note).toContain(name);
    }

    for (const value of Object.values(AutoRemediationAction)) {
      expect(note).toContain(`\`${value}\``);
    }
  });
});
