import {
  flattened,
  otherChangesItemAtEnglishPlace,
  otherChangesItems,
} from "./UpgradingDocsNotes";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The upgrade note that says OneUptime AI fixes with any runbook or only the
 * ones a rule allows, that a rule picks its Runner, and that Runners lose
 * their "Runs AI Remediation Commands" switch - held to the code that makes
 * it true.
 *
 * The note (installation/upgrading, "Other changes in 14") sits after the
 * note on a code repository's Runner (CodeRepositoryRunnerUpgradeDocs) and
 * before the note on runbook step approvals (RunbookStepApprovalUpgradeDocs),
 * and every translation carries it in the English note's place, naming the
 * switch and the rule's fields the way the reader's Dashboard draws them,
 * with a link to the AI SRE page's section on the rules in the reader's
 * language. What it claims is what the upgrade does:
 *
 *   - a rule no longer asks Fix With: OneUptime AI fixes, with any runbook
 *     or only the rule's (AutoRemediationFix), and runs commands on the
 *     rule's Runner (AutoRemediationRule.runnerId);
 *   - with no rule, OneUptime AI proposes the runbook that fits;
 *   - picking a Runner is what lets OneUptime AI's commands run on it
 *     (RunnerAiCommandsPick); picking one that held SSH credentials took
 *     the read of runbook credentials until they were removed (the note
 *     "Runbook credentials are removed" says so), and asks nothing more
 *     now;
 *   - the migration writes out the Runners a command rule ran on, picks the
 *     one, and changes no Runner's switch.
 */

const PACKAGES_DIR: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LEAD: string =
  "OneUptime AI fixes with any runbook, or only the ones a rule allows, and a rule picks its Runner.";
const NOTE_LEAD: string = `**${LEAD}**`;
// The note before it (CodeRepositoryRunnerUpgradeDocs).
const PREVIOUS_LEAD: string =
  "**A code repository picks its Runner, and Runners lose their AI code fix switch.**";
// The note after it (RunbookStepApprovalUpgradeDocs).
const NEXT_LEAD: string =
  "**A runbook step asks for approval before it runs.**";

const AI_SRE_PAGE: string = "ai/ai-sre";
const SECTION_HEADING: string = "## Which incidents are investigated and fixed";

// The Dashboard labels the note names, as the reader's Dashboard draws them.
const LABELS: Array<string> = [
  "Fix With",
  "Runbooks",
  "More fields",
  "Runner",
  "Run them every time",
  "Runs AI Remediation Commands",
];

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

function source(relativePath: string): string {
  return fs.readFileSync(path.join(PACKAGES_DIR, relativePath), "utf8");
}

// The anchor of the AI SRE page's section on the rules, per language.
function sectionAnchor(language: string): string {
  const headingsOf: (code: string) => Array<string> = (
    code: string,
  ): Array<string> => {
    return fs
      .readFileSync(path.join(CONTENT_DIR, code, `${AI_SRE_PAGE}.md`), "utf8")
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("#");
      });
  };
  const index: number = headingsOf("en").indexOf(SECTION_HEADING);

  expect(index).toBeGreaterThan(-1);

  const heading: string | undefined = headingsOf(language)[index];

  expect(heading).toBeDefined();

  return slugifyMarkdownHeading(heading!.replace(/^#+\s+/, ""));
}

const ENGLISH_ITEMS: Array<string> = otherChangesItems("en");
const NOTE_INDEX: number = ENGLISH_ITEMS.findIndex((item: string): boolean => {
  return flattened(item).startsWith(`- ${NOTE_LEAD}`);
});
const ENGLISH_NOTE: string = flattened(ENGLISH_ITEMS[NOTE_INDEX] || "");

describe("the English upgrade note on auto remediation rules' runbooks and Runner", () => {
  it("is a note of the 13 → 14 changes, once, after the note on a code repository's Runner and before the note on runbook step approvals", () => {
    expect(NOTE_INDEX).toBeGreaterThan(0);
    expect(
      ENGLISH_ITEMS.filter((item: string): boolean => {
        return flattened(item).includes(NOTE_LEAD);
      }),
    ).toHaveLength(1);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX - 1]!).startsWith(
        `- ${PREVIOUS_LEAD}`,
      ),
    ).toBe(true);
    expect(
      flattened(ENGLISH_ITEMS[NOTE_INDEX + 1]!).startsWith(`- ${NEXT_LEAD}`),
    ).toBe(true);
  });

  it("says what a rule asks now, what OneUptime AI may run, where its commands run, and what the upgrade keeps", () => {
    for (const claim of [
      "An auto remediation rule no longer asks **Fix With**: OneUptime AI fixes what it matches through the AI agent on the affected cluster or host, may run the project's runbook that fits - any of them, or only the **Runbooks** the rule names under **More fields** - and runs commands of its own on the **Runner** the rule picks there.",
      "With no rule, OneUptime AI also proposes the runbook that fits each new incident or alert, for your approval.",
      "A rule saved with **Fix With** set to **Runbooks** keeps starting its runbooks for every match (**Run them every time**).",
      "Runners lose their **Runs AI Remediation Commands** switch: picking a Runner for a rule, or for a Kubernetes cluster's AI access, is what lets OneUptime AI's commands run on it, and picking one that holds SSH credentials takes permission to read runbook credentials.",
      "The upgrade keeps every rule doing what it did: a rule that has AI compose commands and named no Runner names the Runners of its project it ran on, and picks the Runner it ran on as its Runner when there was just one.",
      "No Runner's switch changes, so a cluster bound to a Runner with it off asks you to choose the Runner again on its AI agent page.",
    ]) {
      expect({ claim, said: ENGLISH_NOTE.includes(claim) }).toEqual({
        claim,
        said: true,
      });
    }

    expect(ENGLISH_NOTE).toContain(
      `[Which incidents are investigated and fixed](/docs/${AI_SRE_PAGE}#${sectionAnchor("en")})`,
    );
  });
});

describe("the note is true to the upgrade", () => {
  const migration: string = source(
    "Common/Server/Infrastructure/Postgres/SchemaMigrations/1804750000000-AddAutoRemediationRuleRunner.ts",
  );

  it("adds the rule's Runner, writes out the Runners a command rule ran on, and picks the one", () => {
    expect(migration).toContain(
      'ALTER TABLE "AutoRemediationRule" ADD "runnerId" uuid',
    );
    expect(migration).toContain(
      `INSERT INTO "AutoRemediationRuleRunner" ("autoRemediationRuleId", "runnerId") SELECT rule."_id", runner."_id"`,
    );
    expect(migration).toContain("HAVING count(*) = 1");
  });

  it("changes no Runner's switch", () => {
    expect(migration).not.toMatch(/UPDATE "Runner"/);
  });

  it("lets a pick, not a switch, decide where OneUptime AI's commands run", () => {
    const runner: string = source("Common/Models/DatabaseModels/Runner.ts");
    const pick: string = source(
      "Common/Server/Utils/Runner/RunnerAiCommandsPick.ts",
    );

    // Nobody may write the column: OneUptime writes it when a pick names the Runner.
    expect(
      runner.slice(
        runner.lastIndexOf(
          "@ColumnAccessControl",
          runner.indexOf("canRunAiCommands?: boolean"),
        ),
        runner.indexOf("canRunAiCommands?: boolean"),
      ),
    ).toMatch(/update: \[\]/);
    expect(pick).toContain("canRunAiCommands: true");

    /*
     * Picking one that held SSH credentials took the read of runbook
     * credentials until they were removed; a pick asks nothing more now,
     * and the upgrade guide says what changed.
     */
    expect(pick).not.toContain("assertNoCredentialsForAiCommands");
    expect(
      fs.readFileSync(
        path.join(CONTENT_DIR, "en", "installation/upgrading.md"),
        "utf8",
      ),
    ).toContain("\n### Runbook credentials are removed\n");
  });

  it("proposes a runbook OneUptime AI picks with no rule set up, never starting it", () => {
    const engine: string = source(
      "Common/Server/Services/AutoRemediationRuleEngineService.ts",
    );
    const defaultPick: string = engine.slice(
      engine.indexOf("private async startDefaultRunbookPick("),
      engine.indexOf("private async hasRunbooksToPick("),
    );

    expect(defaultPick).toContain("rule: null,");
    expect(defaultPick).toContain(
      "executionMode: AutoRemediationExecutionMode.Suggest,",
    );
  });
});

describe("every translation carries the note", () => {
  it.each(TRANSLATIONS)(
    "%s has the note in the English note's place, naming the switch and the fields as its Dashboard draws them, and linking its own AI SRE section",
    (language: string) => {
      const note: string = flattened(
        otherChangesItemAtEnglishPlace(language, LEAD),
      );

      for (const label of LABELS) {
        const drawn: string = drawnDashboardLabel(language, label);

        expect({ label, named: note.includes(`**${drawn}**`) }).toEqual({
          label,
          named: true,
        });
      }

      // The section, in the reader's own language.
      expect(note).toContain(
        `(/docs/${AI_SRE_PAGE}#${sectionAnchor(language)})`,
      );

      // A translated lead, not the English words.
      expect(note.startsWith(`- ${NOTE_LEAD}`)).toBe(false);
      expect(note).not.toContain(LEAD);
    },
  );
});
