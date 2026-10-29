import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { drawnActionLabel, drawnDashboardLabel } from "./DocsDashboardLabels";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A NEW PERSON'S FIRST HOUR, AS THE DOCS TELL IT.
 *
 * Four docs pages say what a newcomer meets while they set up who is told
 * when something breaks:
 *
 *   - the Quickstart's "Get paged when it goes down": a project's first
 *     on-call policy is asked "Page this policy for every new incident and
 *     alert",
 *     which starts on, and the rule it adds is listed under Incidents >
 *     Rules > On-Call Rules, matching All incidents;
 *   - On-Call Policies' "Create a policy", and the On-Call overview's "Run
 *     the policy automatically": when that switch is asked, and what it adds;
 *   - How OneUptime Reaches You's setup checklist: "Staying informed" names
 *     push only for an update that reaches the reader no other way.
 *
 * Markdown is not compiled, so these tests read the sources of truth - the
 * create form, the shared rule (EveryNewEventRules), the policy service, the
 * rule form's match choice, the setup checklist - and hold every language's
 * page to them, with the words that language's Dashboard draws.
 */

const PACKAGES: string = path.resolve(__dirname, "../../../..");
const CONTENT: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const QUICKSTART: string = "introduction/quickstart.md";
const POLICIES: string = "on-call/policies.md";
const ON_CALL: string = "on-call/index.md";
const REACHING_YOU: string = "notifications/index.md";

const SWITCH: string = "Page this policy for every new incident and alert";
const STAYING_INFORMED: string = "Staying informed";

function read(...segments: Array<string>): string {
  return fs.readFileSync(path.join(...segments), "utf8");
}

function page(language: string, relative: string): string {
  return read(CONTENT, language, relative);
}

function lineWith(markdown: string, needle: string): number {
  return markdown.split("\n").findIndex((line: string): boolean => {
    return line.includes(needle);
  });
}

const FORM: string = read(
  PACKAGES,
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicyCreateForm.ts",
);
const RULES: string = read(
  PACKAGES,
  "Common/Types/OnCallDutyPolicy/EveryNewEventRules.ts",
);
const SERVICE: string = read(
  PACKAGES,
  "Common/Server/Services/OnCallDutyPolicyService.ts",
);

const TRANSLATIONS: Array<string> = SUPPORTED_DOCS_LANGUAGE_CODES.filter(
  (language: string): boolean => {
    return language !== "en";
  },
);

describe("the Quickstart's first on-call policy", () => {
  const english: string = page("en", QUICKSTART);

  it("leaves the switch on, as the create form starts it", () => {
    expect(FORM).toContain(`translationKey("${SWITCH}")`);
    expect(FORM).toContain("defaultValue: true,");
    expect(english).toContain(
      `Leave **${SWITCH}** on, and click **Create On-Call Policy**.`,
    );
  });

  it("says the first policy in a project pages for everything new, as the page offers it only then", () => {
    expect(RULES).toContain("facts.policyCount === 0");
    expect(english).toContain(
      "create an on-call policy: the first one in a project pages for every new incident and alert.",
    );
  });

  it("finds the rule the switch added where the side menu keeps it, matching All incidents", () => {
    // The rule matches every incident: it names no monitor, severity, label or pattern.
    const rule: string = SERVICE.slice(
      SERVICE.indexOf("private getEveryNewIncidentRule("),
      SERVICE.indexOf("private getEveryNewAlertRule("),
    );

    for (const filter of [
      "monitors",
      "incidentSeverities",
      "incidentLabels",
      "monitorLabels",
      "incidentTitlePattern",
    ]) {
      expect(rule).not.toContain(`rule.${filter} =`);
    }

    // What the rule form calls a rule with no conditions.
    expect(
      read(
        PACKAGES,
        "Common/UI/Components/RuleCriteria/RuleCriteriaSubjectCopy.ts",
      ),
    ).toContain('all: translationKey("All incidents")');

    expect(english).toContain("### See the rule that pages it");
    expect(english).toContain(
      "expand **Rules** in the side menu and choose **On-Call Rules**: it matches **All incidents**.",
    );
  });

  it("no longer walks the reader through making that rule by hand", () => {
    expect(english).not.toContain("### Page it for every incident");
    expect(english).not.toContain("On **Match Criteria**, leave");
  });
});

describe("On-Call Policies and the On-Call overview", () => {
  it("say when the switch is asked: a project's first policy, of people who may add on-call rules", () => {
    for (const condition of [
      "facts.mayAddRules",
      "facts.policyCount === 0",
      "facts.incidentRuleCount === 0",
      "facts.alertRuleCount === 0",
    ]) {
      expect(RULES).toContain(condition);
    }

    const policies: string = page("en", POLICIES);

    expect(policies).toContain(
      `A project's first policy is also asked **${SWITCH}**, which starts on.`,
    );
    expect(policies).toContain(
      "It is asked of people who may add on-call rules, while the project has no on-call policy and no on-call rule.",
    );
  });

  it("say what it adds: a rule for incidents and one for alerts, where those rules are listed", () => {
    expect(SERVICE).toContain("await IncidentOnCallRuleService.create({");
    expect(SERVICE).toContain("await AlertOnCallRuleService.create({");

    expect(page("en", POLICIES)).toContain(
      "It adds a rule under **Incidents → Rules → On-Call Rules** and one under **Alerts → Rules → On-Call Rules**, each matching everything and running this policy.",
    );
  });

  it("the overview's set-up steps let the first policy do it as it is created", () => {
    expect(page("en", ON_CALL)).toContain(
      `A project's first policy can do this as it is created: leave **${SWITCH}** on. For any other policy, go to`,
    );
  });
});

describe("the setup checklist names push only when nothing else carries the update", () => {
  it("as the checklist does: push is the one channel named only when alone", () => {
    const checklist: string = read(
      PACKAGES,
      "App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/useSetupChecklist.ts",
    );
    const model: string = read(
      PACKAGES,
      "App/FeatureSet/Dashboard/src/Components/UserSettings/SetupChecklist/ChecklistModel.ts",
    );

    expect(checklist).toContain(
      'export const CHANNELS_NAMED_ONLY_WHEN_ALONE: ReadonlyArray<string> = ["Push"];',
    );
    expect(model).toContain(`title: "${STAYING_INFORMED}",`);

    expect(page("en", REACHING_YOU)).toContain(
      `**${STAYING_INFORMED}** names Push only for an update that reaches you no other way: every update a new member gets by push goes by email as well.`,
    );
  });
});

describe("every translation tells the same story, where the English does", () => {
  const ENGLISH_LINES: Record<string, number> = {
    [QUICKSTART]: lineWith(page("en", QUICKSTART), `**${SWITCH}**`),
    [POLICIES]: lineWith(page("en", POLICIES), `**${SWITCH}**`),
    [ON_CALL]: lineWith(page("en", ON_CALL), `**${SWITCH}**`),
    [REACHING_YOU]: lineWith(
      page("en", REACHING_YOU),
      `**${STAYING_INFORMED}** names Push only`,
    ),
  };

  it("finds each sentence in the English pages", () => {
    for (const [relative, line] of Object.entries(ENGLISH_LINES)) {
      expect({ relative, found: line >= 0 }).toEqual({
        relative,
        found: true,
      });
    }
  });

  it.each(TRANSLATIONS)(
    "%s names the switch as its Dashboard draws it, on the English line",
    (language: string) => {
      const drawn: string = drawnDashboardLabel(language, SWITCH);

      // The switch is translated in every Dashboard language.
      expect(drawn).not.toBe(SWITCH);

      for (const relative of [QUICKSTART, POLICIES, ON_CALL]) {
        const lines: Array<string> = page(language, relative).split("\n");

        expect({
          relative,
          line: lines[ENGLISH_LINES[relative]!]!.includes(`**${drawn}**`),
        }).toEqual({ relative, line: true });
      }
    },
  );

  it.each(TRANSLATIONS)(
    "%s names its own Staying informed on the push line, as the English does",
    (language: string) => {
      const lines: Array<string> = page(language, REACHING_YOU).split("\n");
      const drawn: string = drawnDashboardLabel(language, STAYING_INFORMED);

      expect(lines[ENGLISH_LINES[REACHING_YOU]!]).toContain(`**${drawn}**`);
    },
  );

  it.each(TRANSLATIONS)(
    "%s no longer walks the reader through the rule by hand",
    (language: string) => {
      const quickstart: string = page(language, QUICKSTART);
      const createRule: string = drawnActionLabel(
        language,
        "Create Incident On-Call Rule",
      );

      // The button is still named, once: to add a rule of one's own.
      expect(quickstart.split(`**${createRule}**`).length - 1).toBe(1);
    },
  );
});
