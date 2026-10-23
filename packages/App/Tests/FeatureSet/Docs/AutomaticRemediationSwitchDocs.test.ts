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
  AUTO_REMEDIATION_FIX_WITH_TEXT,
  AUTO_REMEDIATION_MORE_FIELDS_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import {
  AI_RULE_COLUMN_TITLE,
  AI_RULE_DOES_NOT_INVESTIGATE_TEXT,
  AI_RULE_FIX_FIELD_COPY,
  AI_RULE_FIX_OPTIONS,
  AI_RULE_ONLY_FIXES_COPY,
} from "../../../FeatureSet/Dashboard/src/Components/AISettings/AiRuleCopy";
import { REMEDIATION_NO_RUNNER_PLACEHOLDER } from "../../../FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { CATCH_ALL_RULE_NAMES } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1799400000000-AddAutomaticRemediationSwitchesAndInvestigationRules";
import AutoRemediationAction from "Common/Types/AutoRemediation/AutoRemediationAction";
import { describe, expect, it } from "@jest/globals";
import path from "path";

/*
 * Fixing new incidents and alerts has a switch of its own, off by default,
 * and the AI rules - folded under More settings on the AI settings page -
 * narrow which incidents are investigated and which are fixed, and how. The
 * docs say so in the words the dashboard and the upgrade use: the switch
 * titles, the rule form's steps and choices, the rules the upgrade adds and
 * the API values.
 */

// The AI rule form's steps (AiRulesTable), one question each.
const AI_RULE_STEP_TITLES: Array<string> = [
  "Match",
  "Investigate",
  AI_RULE_FIX_FIELD_COPY.title,
];

const RULES_HEADING: string = "## Which incidents are investigated and fixed";
const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string =
  "### Fixing new incidents and alerts has a switch of its own";
const PREVIOUS_NOTE_HEADING: string =
  "### The AI Logs get an index for the daily AI limits";
// Fixing's own note is followed by the one on the pull requests it opens.
const NEXT_NOTE_HEADING: string =
  "### The pull-request switches moved into the auto remediation rules";

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
    const named: Array<string> = titles(AiLane.Incident).map(
      (title: string): string => {
        return `_${title}_`;
      },
    );

    expect(titles(AiLane.Incident)[1]).toBe("Fix new incidents automatically");
    expect(named).toHaveLength(3);
    expect(page).toContain(
      `The incident page has three, under **What OneUptime AI does**: ${named
        .slice(0, -1)
        .join(", ")} and ${named.slice(-1)[0]}.`,
    );
  });

  /*
   * "Both of these toggles should be inside of Remediation Rule, inside of
   * More, and they should be checked by default" - the maintainer. Fixing
   * has no switch under it: its two pull requests are each AI rule's.
   */
  it("names the two pull requests as part of fixing, set by each AI rule", () => {
    expect(AI_LANE_SWITCHES[AiLane.Incident][1]!.children).toBeUndefined();
    expect(page).toContain(
      "The pull requests it opens, a fix to your code and the telemetry an investigation found missing, are part of it, and each AI rule sets them: with no rule both open, and a rule can turn either off under its **More fields**",
    );
    expect(page).not.toContain("Two more switches are part of it");
    // The page no longer counts them as switches of their own.
    expect(page).not.toContain("The incident page has five");
  });

  it("says fixing starts off, for new projects too", () => {
    expect(page).toContain(
      "_Fix new incidents automatically_ (and _Fix new alerts automatically_) starts **off**, for new projects too",
    );
  });

  it("has a section on the AI rules, which says what no rule means, and what rules do", () => {
    expect(getHeadings(read(AI_SRE_PAGE))).toContain(RULES_HEADING);
    expect(rules).toContain(
      "- With no rule, OneUptime AI investigates every new incident right away and, while _Fix new incidents automatically_ is on, fixes every one",
    );
    expect(rules).toContain(
      "- With rules, OneUptime AI investigates only the incidents that match at least one enabled rule, and fixes only those a rule that fixes matches",
    );
    // An incident only rules that don't fix matched says so on its card.
    expect(rules).toContain(
      "and one only rules that don't fix matched on its **Remediation** card",
    );
    // Rules that cannot be read never stop an investigation.
    expect(rules).toContain(
      "the incident is investigated as if there were none",
    );
  });

  /*
   * The maintainer: "Since its not possible to remediate without
   * investigation", one AI rule asks three questions - what it matches,
   * when OneUptime AI investigates it, and whether and how it is fixed -
   * and folds the rest under More fields, named as the form names them.
   */
  it("asks the rule form's three questions, a step each, with the Fix step's choices as the form names them, and no Fix With", () => {
    for (const option of AI_RULE_FIX_OPTIONS) {
      expect({
        option: option.title,
        named: rules.includes(`**${option.title}**`),
      }).toEqual({ option: option.title, named: true });
    }

    AI_RULE_STEP_TITLES.forEach((step: string, index: number) => {
      expect(rules).toContain(`${index + 1}. **${step}** — `);
    });

    expect(rules).toContain("An AI rule asks three questions, a step each:");
    expect(rules).toContain("A new rule asks before fixing.");
    expect(rules).not.toContain("**Fix With**");
  });

  /*
   * A rule made on the dashboard always investigates; one that was an auto
   * remediation rule, or an API client made without saying, may only fix,
   * and the table and its Investigate step say so as the form draws it.
   */
  it("says a rule made on the dashboard investigates, and how a rule that only fixes reads", () => {
    expect(rules).toContain(
      "There is no fixing without investigating, so every rule made on the dashboard investigates.",
    );
    expect(rules).toContain(
      `its **${AI_RULE_COLUMN_TITLE}** column says **${AI_RULE_DOES_NOT_INVESTIGATE_TEXT}**`,
    );
    expect(rules).toContain(
      `**${AI_RULE_ONLY_FIXES_COPY[AiLane.Incident].investigateToo}** makes it a rule like any other`,
    );
    expect(rules).toContain(
      "A rule that neither investigates nor fixes is refused.",
    );
  });

  it("says what More fields holds, as the form names it: the runbooks OneUptime AI may run, Run them every time, and the Runner", () => {
    expect(MORE_FIELDS_SECTION_TITLE).toBe("More fields");
    expect(rules).toContain(`folded under **${MORE_FIELDS_SECTION_TITLE}**`);

    for (const title of [
      AUTO_REMEDIATION_MORE_FIELDS_COPY.runbooksTitle,
      AUTO_REMEDIATION_MORE_FIELDS_COPY.everyTimeTitle,
      AUTO_REMEDIATION_MORE_FIELDS_COPY.runnerTitle,
    ]) {
      expect({ title, named: rules.includes(`- **${title}** — `) }).toEqual({
        title,
        named: true,
      });
    }

    // What none picked means, as the form draws it.
    expect(rules).toContain(
      `With none picked (**${AUTO_REMEDIATION_MORE_FIELDS_COPY.runbooksPlaceholder}**) it may pick any of the project's enabled runbooks; pick some to let it run only those.`,
    );
    /*
     * A rule's Runner lists the project's own Runners: no "AI agent on the
     * cluster or host" - commands on the affected cluster or host go
     * through its AI agent whatever the rule picks.
     */
    expect(rules).toContain(
      `It lists your own Runners, the project's default first, and a new rule starts on the default; with **${REMEDIATION_NO_RUNNER_PLACEHOLDER}**, OneUptime AI runs no commands of its own for the rule. Commands on the affected Kubernetes cluster or host always go through its AI agent, whatever the rule picks, and a global Runner never runs OneUptime AI's commands.`,
    );
    expect(rules).toContain(
      "A runbook it picks from any of them is always proposed for approval.",
    );
    expect(rules).toContain(
      "Picking one of your Runners is what lets OneUptime AI run commands on it: a Runner has no switch for that.",
    );
  });

  it("says an agent that asks still asks, and that one rule that asks makes the AI fixes ask", () => {
    expect(rules).toContain(
      "a cluster or host set to ask for approval still asks",
    );
    expect(rules).toContain(
      "If any matching rule that fixes with OneUptime AI asks before fixing, every OneUptime AI fix for the incident asks first",
    );
    expect(rules).toContain(
      "A matching rule that doesn't fix adds nothing to the fix.",
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

  it("says the postmortem rules, under More settings, decide which resolved incidents get a draft", () => {
    const postmortem: string = flat(
      getSection(read(AI_SRE_PAGE), "## Auto-postmortem"),
    );

    expect(postmortem).toContain(
      "**Postmortem rules**, folded under **More settings** on the same page, decide which resolved incidents get a draft and which postmortem templates it may follow. With no rule, every resolved incident gets one, in OneUptime AI's standard outline.",
    );
    expect(postmortem).toContain(
      "an incident no rule matches gets no draft, and no incident gets one while the rules cannot be read.",
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
      "**Incidents → AI → Settings** one more, under **More settings**: **AI rules**.",
    );
    expect(settings).toContain(
      "- **AI rules**, under **AI** → **Settings** — which new incidents OneUptime AI investigates and, while **Fix new incidents automatically** is on, which it fixes, and how",
    );
    expect(settings).toContain(
      "With no rule, every new incident is investigated, and fixed while fixing is on.",
    );
    expect(settings).not.toContain("**Investigation Rules**");
    expect(settings).not.toContain("**Auto Remediation Rules**");
    expect(settings).toContain("Do not assume one model applies to all nine.");
  });

  /*
   * Postmortem rules sit under the same More settings, but look at an
   * incident when it resolves, not when it is created: the page names them
   * apart from the nine rules that run on a new incident.
   */
  it("name the postmortem rules as a second table under More settings, for when an incident resolves", () => {
    const settings: string = flat(read(INCIDENT_SETTINGS_PAGE));

    expect(settings).toContain(
      "the postmortem rules that choose which resolved incidents get a draft and the templates it follows, and the optional limits AI works under, are folded under **More settings**",
    );
    expect(settings).toContain(
      "A second table under **More settings** there, **Postmortem Rules**, looks at an incident when it resolves instead: which resolved incidents OneUptime AI drafts a postmortem for, and the templates the draft may follow. See [Postmortems](/docs/incidents/postmortems#choose-which-incidents-get-a-draft-and-its-template).",
    );
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
