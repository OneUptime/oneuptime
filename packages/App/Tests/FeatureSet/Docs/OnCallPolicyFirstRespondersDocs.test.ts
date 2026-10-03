import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
} from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { FIRST_RESPONDER_KEYS } from "Common/Types/OnCallDutyPolicy/FirstResponders";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * "Who gets paged first", on the Escalation Rules docs page, against the
 * form and the API it describes.
 *
 * Creating an on-call policy asks who gets paged first, and whoever is picked
 * becomes the policy's first escalation rule. The docs page says so in every
 * docs language, and says how the API does the same. Markdown is not
 * compiled, so these tests read the sources of truth - the create form's
 * module, the On-Call side menu, the shared defaults, the misc data keys the
 * server reads, the policy's route - and check every language's page still
 * tells the same story, with the words that language's dashboard shows.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const PAGE_RELATIVE_PATH: string = "on-call/escalation-rules.md";

const CREATE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallPolicyCreateForm.ts";
const ON_CALL_SIDE_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu.tsx";
const POLICIES_PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicies.tsx";

const QUESTION: string = "Who gets paged first?";
const POLICIES_MENU_ENTRY: string = "On-Call Policies";

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, PAGE_RELATIVE_PATH),
    "utf8",
  );
}

// The words a language's dashboard shows: English where it has none.
function readDashboardLocale(lang: string): Record<string, string> {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

// The page's "## " sections, by heading, with their text.
function sections(markdown: string): Array<{ heading: string; body: string }> {
  const found: Array<{ heading: string; body: string }> = [];

  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline: number = part.indexOf("\n");

    found.push({
      heading: part.slice(0, newline).trim(),
      body: part.slice(newline + 1),
    });
  }

  return found;
}

const ENGLISH: string = readPage("en");

describe("the Escalation Rules docs page, on who gets paged first", () => {
  it("has the section before Adding an escalation rule", () => {
    expect(
      sections(ENGLISH).map((section: { heading: string }): string => {
        return section.heading;
      }),
    ).toEqual([
      "Who gets paged first",
      "Adding an escalation rule",
      "How the levels page people",
      "Editing, reordering and deleting rules",
      "Creating rules with the API or Terraform",
    ]);
  });

  it("names the question the create form asks, and the page it is asked on", () => {
    expect(readRepoFile(CREATE_FORM_FILE)).toContain(`title: "${QUESTION}"`);
    expect(readRepoFile(ON_CALL_SIDE_MENU_FILE)).toContain(
      `title: "${POLICIES_MENU_ENTRY}"`,
    );

    const section: string = sections(ENGLISH)[0]!.body;

    expect(section).toContain(`**${QUESTION}**`);
    expect(section).toContain(`**${POLICIES_MENU_ENTRY}**`);
    expect(section).toContain("**Name**");
    expect(section).toContain("**Notify**");
    expect(section).toContain("**Advanced**");
  });

  it("states the first rule the server makes: Level 1, waiting 30 minutes", () => {
    const section: string = sections(ENGLISH)[0]!.body;

    expect(section).toContain(`**${getDefaultEscalationRuleName(1)}**`);
    expect(section).toContain(
      `**${DEFAULT_ESCALATE_AFTER_IN_MINUTES} minutes**`,
    );
  });

  it("says where a new policy opens, as the policies page sends it there", () => {
    expect(readRepoFile(POLICIES_PAGE_FILE)).toContain(
      "PageMap.ON_CALL_DUTY_POLICY_VIEW_ESCALATION",
    );
    expect(sections(ENGLISH)[0]!.body).toContain(
      "The new policy then opens on its **Escalation Rules** page",
    );
  });

  it("says the question is optional, and what an empty one means", () => {
    const section: string = sections(ENGLISH)[0]!.body;

    expect(section).toContain(`**${QUESTION}** is optional`);
    expect(section).toContain("pages nobody until you add one");
  });

  it("gives the API: the policy's route and the misc data keys the server reads", () => {
    const api: string = sections(ENGLISH)[4]!.body;

    expect(api).toContain(
      `\`/api${String(new OnCallDutyPolicy().crudApiPath)}\``,
    );
    expect(api).toContain("`miscDataProps`");

    for (const key of FIRST_RESPONDER_KEYS) {
      expect(api).toContain(`\`${key}\``);
    }

    expect(api).toContain(
      `with an \`escalateAfterInMinutes\` of ${DEFAULT_ESCALATE_AFTER_IN_MINUTES}`,
    );
    expect(api).toContain("Terraform's policy resource does not send them");
  });

  /*
   * Each translation has the section first, and names the form with the
   * words that language's dashboard shows.
   */
  describe("in every docs language", () => {
    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "%s tells the same story",
      (lang: string) => {
        const page: string = readPage(lang);
        const dashboard: Record<string, string> = readDashboardLocale(lang);
        const pageSections: Array<{ heading: string; body: string }> =
          sections(page);

        expect(pageSections).toHaveLength(5);

        const first: string = pageSections[0]!.body;
        const api: string = pageSections[4]!.body;

        for (const label of [
          QUESTION,
          POLICIES_MENU_ENTRY,
          "Name",
          "Notify",
          "Escalation Rules",
          "Advanced",
        ]) {
          expect({
            lang,
            label,
            found: first.includes(`**${dashboard[label]}**`),
          }).toEqual({
            lang,
            label,
            found: true,
          });
        }

        for (const fact of [
          `**${getDefaultEscalationRuleName(1)}**`,
          `**${DEFAULT_ESCALATE_AFTER_IN_MINUTES}`,
        ]) {
          expect({ lang, fact, found: first.includes(fact) }).toEqual({
            lang,
            fact,
            found: true,
          });
        }

        for (const fact of [
          "`/api/on-call-duty-policy`",
          "`miscDataProps`",
          ...FIRST_RESPONDER_KEYS.map((key: string): string => {
            return `\`${key}\``;
          }),
          `\`escalateAfterInMinutes\``,
          `**${getDefaultEscalationRuleName(1)}**`,
        ]) {
          expect({ lang, fact, found: api.includes(fact) }).toEqual({
            lang,
            fact,
            found: true,
          });
        }
      },
    );
  });
});
