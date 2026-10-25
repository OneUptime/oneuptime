import {
  AI_SRE_PAGE,
  DOCS_CONTENT_DIR,
  UPGRADING_PAGE,
  getHeadings,
  getSection,
  read,
} from "./KubernetesAiAgentDocsSupport";
import { dashboardLocale } from "./DocsDashboardLabels";
import { AUTO_REMEDIATION_MORE_FIELDS_COPY } from "../../../FeatureSet/Dashboard/src/Components/AutoRemediation/AutoRemediationRuleCopy";
import { RULE_CODE_REPOSITORIES_FIELD_COPY } from "../../../FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import {
  GLOBAL_RUNNER_CHOICE_LABEL,
  REMEDIATION_NO_RUNNER_PLACEHOLDER,
} from "../../../FeatureSet/Dashboard/src/Components/Runner/RunnerPickerModel";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  AUTOMATIC_FIX_SWITCH_COLUMNS,
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS,
} from "Common/Types/AI/AutomaticFixPullRequests";
import { INCIDENT_AND_ALERT_TRIGGER_ENTITIES } from "Common/Types/AutoRemediation/AutoRemediationTriggerEntity";
import { SIGNAL_COLUMNS } from "Common/Server/Infrastructure/Postgres/SchemaMigrations/1805830000000-MoveFixPullRequestSwitchesIntoRules";
import slugify from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Both of these toggles should be inside of Remediation Rule, inside of
 * More, and they should be checked by default. They should be true by
 * default. If there are no rules, by the way, this should happen by
 * default." - the maintainer.
 *
 * The two pull requests fixing opens - a fix to the code, and the telemetry
 * an investigation found missing - are each AI rule's now (each auto
 * remediation rule's, before the two kinds of rule became one)
 * (Common/Types/AI/AutomaticFixPullRequests): on for a new rule, on with no
 * rule, opening only while fixing is on, in the code repositories the rules
 * name. The docs say so in the words the dashboard uses, and the upgrade
 * note says what that changes for an existing project and for API and
 * Terraform users.
 */

const THIRTEEN_TO_FOURTEEN_HEADING: string =
  "## Upgrading from OneUptime 13 → 14";
const NOTE_HEADING: string =
  "### The pull-request switches moved into the auto remediation rules";
const FIXING_NOTE_HEADING: string =
  "### Fixing new incidents and alerts has a switch of its own";
// The note on the AI rules follows it, then the edition checks.
const AI_RULES_NOTE_HEADING: string =
  "### Investigation rules and auto remediation rules are now AI rules";
const EDITION_NOTE_HEADING: string = "### Verify the edition and the license";
const NEW_PROJECTS_NOTE_HEADING: string =
  "### New projects start with every AI feature on";

// The switches as the AI card drew them, before the rules held them.
const OLD_SWITCH_TITLES: Array<string> = [
  "Open a fix pull request when an investigation finds a code change",
  "Open a pull request that adds missing telemetry",
];

const AI_AGENT_PAGE: string = path.join(DOCS_CONTENT_DIR, "ai/ai-agent.md");
const INCIDENT_SETTINGS_PAGE: string = path.join(
  DOCS_CONTENT_DIR,
  "incidents/settings.md",
);

// Any run of whitespace, read as one space.
const WHITESPACE: RegExp = /\s+/g;

// A capital letter of a camelCase field.
const CAPITAL: RegExp = /[A-Z]/g;

function flat(text: string): string {
  return text.replace(WHITESPACE, " ").trim();
}

// camelCase to the Terraform provider's snake_case attribute.
function terraformName(column: string): string {
  return column.replace(CAPITAL, (letter: string): string => {
    return `_${letter.toLowerCase()}`;
  });
}

const RETIRED_PROJECT_FIELDS: Array<string> = [
  "enableAutomaticIncidentCodeFixes",
  "enableIncidentInstrumentationFixTasks",
  "enableAutomaticAlertCodeFixes",
  "enableAlertInstrumentationFixTasks",
];

const RULE_FIELDS: Array<string> = [
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS.CodeFix,
  REMEDIATION_RULE_PULL_REQUEST_COLUMNS.MissingTelemetry,
  "codeRepositories",
];

describe("the upgrade note", () => {
  const upgrading: string = read(UPGRADING_PAGE);
  const note: string = flat(getSection(upgrading, NOTE_HEADING));

  it("sits in the 13 → 14 notes, right after fixing's own note and before the AI rules' note and the edition checks, once", () => {
    const headings: Array<string> = getHeadings(
      getSection(upgrading, THIRTEEN_TO_FOURTEEN_HEADING),
    );
    const position: number = headings.indexOf(NOTE_HEADING);

    expect(position).toBeGreaterThan(0);
    expect(headings[position - 1]).toBe(FIXING_NOTE_HEADING);
    expect(headings[position + 1]).toBe(AI_RULES_NOTE_HEADING);
    expect(headings[position + 2]).toBe(EDITION_NOTE_HEADING);
    expect(
      getHeadings(upgrading).filter((heading: string): boolean => {
        return heading === NOTE_HEADING;
      }),
    ).toHaveLength(1);
    expect(upgrading).not.toContain(
      "### The pull-request switches are part of fixing",
    );
  });

  it("names the switches as they were drawn, and where they went: under each rule's More fields, on for a new rule", () => {
    for (const title of OLD_SWITCH_TITLES) {
      expect(note).toContain(`**${title}**`);
    }
    expect(note).toContain(
      `as **${AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixTitle}** and **${AUTO_REMEDIATION_MORE_FIELDS_COPY.telemetryTitle}** under its **More fields**, both on for a new rule.`,
    );
    expect(note).toContain(
      "A pull request still opens on its own only while **Fix new incidents automatically** (or **Fix new alerts automatically**) is on:",
    );
  });

  it("says what opens with no rule, and with rules - in which repositories", () => {
    expect(note).toContain(
      "With no rule, both pull requests open, in any connected repository.",
    );
    expect(note).toContain(
      `With rules, a pull request opens only for an incident (or alert) a rule matches, when a matching rule has it on, and only in the repositories the matching rules name under **${RULE_CODE_REPOSITORIES_FIELD_COPY.title}**.`,
    );
    expect(note).toContain(
      "A rule that names none allows every connected repository",
    );
  });

  it("says every project keeps its choice, and names the rule the upgrade adds as the migration names it", () => {
    expect(note).toContain("Every project keeps its choice:");
    expect(
      SIGNAL_COLUMNS.map((signal: { ruleName: string }) => {
        return signal.ruleName;
      }),
    ).toEqual(["All incidents", "All alerts"]);
    expect(note).toContain(
      `With no enabled rule of that kind, it gets one, **${SIGNAL_COLUMNS[0]!.ruleName}** (or **${SIGNAL_COLUMNS[1]!.ruleName}**)`,
    );
    expect(note).toContain(
      "fixes without asking the way OneUptime AI fixed with no rule, and holds the two switches as the project had them.",
    );
    expect(note).toContain(
      "**Open Fix PR from this analysis** on an investigation is unchanged.",
    );
  });

  /*
   * "If there are no runners, it should use the global runner by default" -
   * the maintainer. A rule that picked none reads Global Runner, as the
   * picker draws it, and OneUptime AI runs no Bash commands there.
   */
  it("says a rule's Runner lists your Runners and the Global Runner, and what a rule that picked none reads", () => {
    expect(note).toContain(
      `A rule's **Runner** lists your own Runners and **${GLOBAL_RUNNER_CHOICE_LABEL}**.`,
    );
    expect(note).toContain(
      "commands on the affected cluster or host always go through its AI agent, whatever the rule picks.",
    );
    expect(note).toContain(
      `A rule that picked none reads **${GLOBAL_RUNNER_CHOICE_LABEL}** and fixes as before: OneUptime AI runs no Bash commands on a global Runner.`,
    );
    // No longer what a rule that picked none reads where there is a Global Runner.
    expect(note).not.toContain(
      `reads **${REMEDIATION_NO_RUNNER_PLACEHOLDER}**`,
    );
    expect(note).not.toContain("lists your own Runners only");
  });

  it("tells API and Terraform users which project fields are gone, and the rule fields that hold them now", () => {
    for (const column of RETIRED_PROJECT_FIELDS) {
      expect(note).toContain(`\`${column}\``);
    }
    expect(note).toContain(
      `\`${terraformName("enableAutomaticIncidentCodeFixes")}\``,
    );

    for (const column of RULE_FIELDS) {
      expect(note).toContain(`\`${column}\``);
      expect(note).toContain(`\`${terraformName(column)}\``);
    }

    expect(terraformName(REMEDIATION_RULE_PULL_REQUEST_COLUMNS.CodeFix)).toBe(
      "open_code_fix_pull_requests",
    );
    expect(note).toContain("remove them from your configuration.");
  });

  it("the new-projects note no longer counts the pull requests among what starts on, and links here", () => {
    const newProjects: string = flat(
      getSection(upgrading, NEW_PROJECTS_NOTE_HEADING),
    );

    expect(newProjects).toContain(
      "The pull requests OneUptime AI opens for incidents and alerts are part of fixing, which starts off",
    );

    const link: string = `(#${slugify(NOTE_HEADING.replace("### ", ""))})`;
    expect(link).toBe(
      "(#the-pull-request-switches-moved-into-the-auto-remediation-rules)",
    );
    expect(newProjects).toContain(link);
  });
});

describe("the AI SRE page", () => {
  const page: string = flat(read(AI_SRE_PAGE));
  const codeFixes: string = flat(
    getSection(read(AI_SRE_PAGE), "## Automatic code fixes"),
  );
  const rules: string = flat(
    getSection(
      read(AI_SRE_PAGE),
      "## Which incidents are investigated and fixed",
    ),
  );

  it("no longer names the switches the AI card had", () => {
    for (const title of OLD_SWITCH_TITLES) {
      expect(page).not.toContain(title);
    }
    // The Runner choice a rule no longer offers.
    expect(page).not.toContain("**AI agent on the cluster or host**");
  });

  it("says the pull requests are part of fixing, and each rule sets them", () => {
    expect(page).toContain(
      "Fixing starts off, and the pull requests that are part of it open only while it is on",
    );
    expect(page).toContain(
      "each AI rule sets them: with no rule both open, and a rule can turn either off under its **More fields**",
    );
    expect(codeFixes).toContain(
      "they open only while **Fix new incidents automatically** (on **Incidents → AI → Settings**) or **Fix new alerts automatically** (on **Alerts → AI → Settings**) is on, and fixing starts **off**, for new projects too.",
    );
    expect(codeFixes).toContain(
      `With no AI rule they open for every investigation that qualifies; with rules, each rule says for what it matches, with **${AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixTitle}** under its **More fields**, on for a new rule.`,
    );
    expect(codeFixes).toContain(
      `**${AUTO_REMEDIATION_MORE_FIELDS_COPY.telemetryTitle}**, beside it under a rule's **More fields** and on for a new rule too,`,
    );
  });

  it("says rules hold the pull requests to what they match, and to the repositories they name", () => {
    expect(codeFixes).toContain(
      "With rules set up, a pull request opens only for an incident (or alert) a rule matches, when a matching rule has that pull request on, and only in the code repositories the matching rules name; a matching rule that names none allows every connected repository.",
    );
    expect(codeFixes).toContain(
      "To get the pull requests without OneUptime AI changing your clusters or hosts, turn fixing on, keep **Fixes** off on each Kubernetes cluster's and host's **AI agent** page (off is their default), and add no AI rule",
    );
  });

  it("names the fields the API and Terraform write, and links to the upgrade note", () => {
    for (const signal of INCIDENT_AND_ALERT_TRIGGER_ENTITIES) {
      expect(codeFixes).toContain(
        `\`${AUTOMATIC_FIX_SWITCH_COLUMNS[signal]}\``,
      );
    }

    for (const column of RULE_FIELDS) {
      expect(codeFixes).toContain(`\`${column}\``);
    }

    for (const column of RETIRED_PROJECT_FIELDS) {
      expect(codeFixes).not.toContain(column);
    }

    expect(codeFixes).toContain(
      `(/docs/installation/upgrading#${slugify(NOTE_HEADING.replace("### ", ""))})`,
    );
  });

  it("lists a rule's Runner, code repositories and pull requests under More fields, as the form draws them", () => {
    expect(rules).toContain(
      `- **Runner** — where OneUptime AI runs Bash commands for the rule. It lists your own Runners and **${GLOBAL_RUNNER_CHOICE_LABEL}**: a new rule starts on the project's default Runner, listed first, or on **${GLOBAL_RUNNER_CHOICE_LABEL}** when the project has no default.`,
    );
    expect(rules).toContain(
      `In a project that does not use global Runners, or on a server that runs none, the field reads **${REMEDIATION_NO_RUNNER_PLACEHOLDER}** instead.`,
    );
    expect(rules).toContain(
      `- **${RULE_CODE_REPOSITORIES_FIELD_COPY.title}** — the repositories OneUptime AI may read while it investigates and fixes, and open pull requests in. With none picked (**${RULE_CODE_REPOSITORIES_FIELD_COPY.placeholder}**) it may use every repository connected to the project.`,
    );
    expect(rules).toContain(
      `- **${AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixTitle}** and **${AUTO_REMEDIATION_MORE_FIELDS_COPY.telemetryTitle}** — whether OneUptime AI opens a fix pull request, or one that adds missing telemetry, for the incidents the rule matches`,
    );
    // One list for both: the pull requests are only a rule that fixes'.
    expect(rules).toContain(
      "the runbooks, the Runner and the two pull requests are only for a rule that fixes",
    );
  });
});

describe("the other pages that name the pull requests", () => {
  it("Code says the automatic fix pull request is part of fixing, and each rule's", () => {
    const section: string = flat(
      getSection(
        read(AI_AGENT_PAGE),
        "## Automatic code fixes from investigations",
      ),
    );

    expect(section).toContain(
      "Eligible fixes happen without the click while **Fix new incidents automatically** is on",
    );
    expect(section).toContain(
      `With no AI rule every eligible fix opens; with rules, only one for what a rule matches, when the rule has **${AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixTitle}** on (a new rule does), in the code repositories it names.`,
    );
    for (const title of OLD_SWITCH_TITLES) {
      expect(section).not.toContain(title);
    }
  });

  it("the incident settings page no longer draws pull requests under fixing", () => {
    const settings: string = flat(read(INCIDENT_SETTINGS_PAGE));

    expect(settings).toContain(
      "fixing them automatically (off until you turn it on), and drafting postmortems on or off",
    );
    expect(settings).toContain(
      "narrow which incidents are investigated and fixed, and with which code repositories and pull requests,",
    );
    expect(settings).not.toContain("drawn under it");
  });

  /*
   * Every language names the rule's new fields the way its Dashboard
   * draws them.
   */
  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "the %s AI SRE page names a rule's pull requests and repositories as its Dashboard does",
    (language: string) => {
      const translated: string = fs.readFileSync(
        path.join(DOCS_CONTENT_DIR, "..", language, "ai", "ai-sre.md"),
        "utf8",
      );
      const locale: Record<string, unknown> = dashboardLocale(language);

      for (const label of [
        AUTO_REMEDIATION_MORE_FIELDS_COPY.codeFixTitle,
        AUTO_REMEDIATION_MORE_FIELDS_COPY.telemetryTitle,
        RULE_CODE_REPOSITORIES_FIELD_COPY.title,
        RULE_CODE_REPOSITORIES_FIELD_COPY.placeholder,
        REMEDIATION_NO_RUNNER_PLACEHOLDER,
        GLOBAL_RUNNER_CHOICE_LABEL,
      ]) {
        expect([
          label,
          translated.includes(`**${String(locale[label])}**`),
        ]).toEqual([label, true]);
      }
    },
  );
});
