import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
} from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "Escalation Rules" docs page against the dialog and the API it
 * describes.
 *
 * Markdown is not compiled, so nothing else notices when the dialog's field
 * titles, the default wait, the "Level N" name, the side menu entry, the
 * picker's button or the API routes change. Each test reads the source of
 * truth - the nav, the shared defaults, the form module, the page and its side
 * menu, the models' routes - and checks the page still tells the same story.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const NAV_GROUP_TITLE: string = "On Call";
const PAGE_TITLE: string = "Escalation Rules";
const PAGE_RELATIVE_PATH: string = "on-call/escalation-rules";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;

const FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRuleForm.ts";
const RULES_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/EscalationRule/EscalationRules.tsx";
const SIDE_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutyPolicy/SideMenu.tsx";
const REPEAT_POLICY_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/RepeatPolicy.tsx";

// The rule card's buttons: Add in its header, the rest on each rule.
const RULE_BUTTONS: Array<string> = [
  "Add Escalation Rule",
  "Edit rule",
  "Move up",
  "Move down",
  "Delete rule",
];

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const FENCE_LINE: RegExp = /^\s*```/;
const HEADING_LINE: RegExp = /^(#{1,6})\s+\S/;

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
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

// The level of every heading outside a fenced block, in order.
function headingOutline(markdown: string): Array<number> {
  const outline: Array<number> = [];
  let inFence: boolean = false;

  for (const line of markdown.split("\n")) {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      continue;
    }

    if (inFence) {
      continue;
    }

    const heading: RegExpMatchArray | null = line.match(HEADING_LINE);

    if (heading && heading[1]) {
      outline.push(heading[1].length);
    }
  }

  return outline;
}

const PAGE: string = readPage("en");

function onCallGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
    return candidate.title === NAV_GROUP_TITLE;
  });

  if (!group) {
    throw new Error("No On Call nav group");
  }

  return group;
}

describe("the Escalation Rules docs page", () => {
  it("is linked from the On Call nav group, right after the schedule timeline", () => {
    const links: Array<NavLink> = onCallGroup().links;

    // The schedule timeline keeps the first place (its own page pins it).
    expect(links[0]?.title).toBe("Schedule Timeline");
    expect(links[1]).toEqual({ title: PAGE_TITLE, url: PAGE_URL });
    expect(
      links.filter((link: NavLink): boolean => {
        return link.url === PAGE_URL;
      }),
    ).toHaveLength(1);
  });

  it("has an English page whose title is the nav title", () => {
    expect(PAGE.split("\n")[0]).toBe(`# ${PAGE_TITLE}`);
  });

  it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "names its nav link in %s",
    (lang: string) => {
      const locale: { navLinks: Record<string, string> } = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"),
      );

      expect(typeof locale.navLinks[PAGE_TITLE]).toBe("string");
      expect(locale.navLinks[PAGE_TITLE]!.trim().length).toBeGreaterThan(0);

      if (lang !== "en") {
        expect(locale.navLinks[PAGE_TITLE]).not.toBe(PAGE_TITLE);
      }

      const localized: Array<string> = getLocalizedNav(lang).flatMap(
        (group: { links: Array<{ title: string; url: string }> }) => {
          return group.links
            .filter((link: { url: string }): boolean => {
              return link.url.endsWith(PAGE_RELATIVE_PATH);
            })
            .map((link: { title: string }): string => {
              return link.title;
            });
        },
      );

      expect(localized).toEqual([locale.navLinks[PAGE_TITLE]]);
    },
  );

  it("sends readers to the side menu entry the dashboard really has", () => {
    expect(readRepoFile(SIDE_MENU_FILE)).toContain(`title: "${PAGE_TITLE}"`);
    expect(PAGE).toContain(`choose **${PAGE_TITLE}**`);
  });

  it("names the buttons and fields the dialog draws", () => {
    const form: string = readRepoFile(FORM_FILE);
    const rules: string = readRepoFile(RULES_FILE);

    for (const title of [
      "Notify",
      "Escalate after (in minutes)",
      "Name",
      "Description",
    ]) {
      expect(form).toContain(`title: "${title}"`);
      expect(PAGE).toContain(`**${title}**`);
    }

    expect(form).toContain('translationKey("Add responder")');
    expect(PAGE).toContain("**Add responder**");

    for (const button of RULE_BUTTONS) {
      expect(rules).toContain(`"${button}"`);
      expect(PAGE).toContain(`**${button}**`);
    }
  });

  it("names the Repeat Policy card below the rules as the dashboard titles it", () => {
    expect(readRepoFile(REPEAT_POLICY_FILE)).toContain(
      'translateText("Repeat Policy")',
    );
    expect(PAGE).toContain("its **Repeat Policy** (below the rules)");
  });

  it("states the wait the dialog starts with", () => {
    expect(PAGE).toContain(
      `It starts at **${DEFAULT_ESCALATE_AFTER_IN_MINUTES} minutes**`,
    );
    expect(PAGE).toContain(
      `${DEFAULT_ESCALATE_AFTER_IN_MINUTES} is what the dashboard suggests`,
    );
  });

  it("names rules the way the server does", () => {
    for (const level of [1, 2, 3]) {
      expect(PAGE).toContain(`**${getDefaultEscalationRuleName(level)}**`);
    }
  });

  it("gives the API routes the models really have", () => {
    const routeOf: (model: {
      new (): { crudApiPath?: unknown };
    }) => string = (model: { new (): { crudApiPath?: unknown } }): string => {
      return `/api${String(new model().crudApiPath)}`;
    };

    expect(PAGE).toContain(`\`${routeOf(OnCallDutyPolicyEscalationRule)}\``);
    expect(PAGE).toContain(
      `\`${routeOf(OnCallDutyPolicyEscalationRuleUser)}\``,
    );

    for (const model of [
      OnCallDutyPolicyEscalationRuleTeam,
      OnCallDutyPolicyEscalationRuleSchedule,
    ]) {
      const suffix: string = routeOf(model).replace(
        routeOf(OnCallDutyPolicyEscalationRuleUser).replace(/-user$/, ""),
        "",
      );

      expect(PAGE).toContain(`\`${suffix}\``);
    }
  });

  /*
   * The on-call docs are mirrored in every docs language. Each translation
   * keeps the English page's shape, is titled as its nav link, and names the
   * dialog's fields, the rule card's buttons and the Repeat Policy card with
   * the words that language's dashboard shows - the English ones where the
   * dashboard still shows English. A dashboard translation that renames one
   * has to bring the page along.
   */
  describe("in every docs language", () => {
    const englishOutline: Array<number> = headingOutline(PAGE);

    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "%s has the page",
      (lang: string) => {
        const page: string = readPage(lang);
        const docsLocale: { navLinks: Record<string, string> } = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"),
        );
        const dashboard: Record<string, string> = readDashboardLocale(lang);

        expect(page.split("\n")[0]).toBe(
          `# ${docsLocale.navLinks[PAGE_TITLE]}`,
        );
        expect(headingOutline(page)).toEqual(englishOutline);

        for (const label of [
          "Escalation Rules",
          "Notify",
          "Add responder",
          "Escalate after (in minutes)",
          "Advanced",
          ...RULE_BUTTONS,
          "Repeat Policy",
        ]) {
          expect({
            lang,
            label,
            found: page.includes(`**${dashboard[label]}**`),
          }).toEqual({ lang, label, found: true });
        }

        for (const fact of [
          `**${DEFAULT_ESCALATE_AFTER_IN_MINUTES}`,
          `**${getDefaultEscalationRuleName(1)}**`,
          `**${getDefaultEscalationRuleName(2)}**`,
          `**${getDefaultEscalationRuleName(3)}**`,
          "`/api/on-call-duty-policy-escalation-rule`",
          "`escalateAfterInMinutes`",
        ]) {
          expect({ lang, fact, found: page.includes(fact) }).toEqual({
            lang,
            fact,
            found: true,
          });
        }
      },
    );
  });

  it("does not claim the API names or waits differently from the code", () => {
    // escalateAfterInMinutes has no default outside the dashboard.
    expect(
      new OnCallDutyPolicyEscalationRule().getTableColumnMetadata(
        "escalateAfterInMinutes",
      ).required,
    ).toBe(false);
    expect(PAGE).toContain(
      "`escalateAfterInMinutes` has no default outside the dashboard",
    );

    // The name stays a required column: Terraform still sends one.
    expect(
      new OnCallDutyPolicyEscalationRule().getRequiredColumns().columns,
    ).toContain("name");
    expect(PAGE).toContain(
      "Terraform's escalation rule resource still takes a name",
    );
  });
});
