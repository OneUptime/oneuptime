import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import OnCallDutyPolicyEscalationRule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyEscalationRuleSchedule from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleTeam";
import OnCallDutyPolicyEscalationRuleUser from "Common/Models/DatabaseModels/OnCallDutyPolicyEscalationRuleUser";
import { slugifyMarkdownHeading } from "Common/Server/Types/MarkdownSlugify";
import OnCallPolicyRunMessageView from "Common/Server/Utils/Workspace/LiveMessages/OnCallPolicyRunMessageView";
import {
  DEFAULT_ESCALATE_AFTER_IN_MINUTES,
  getDefaultEscalationRuleName,
} from "Common/Types/OnCallDutyPolicy/EscalationRuleDefaults";
import { NEXT_IN_ROTATION_SCHEDULES_KEY } from "Common/Types/OnCallDutyPolicy/NextInRotation";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { toLatinDigits } from "./DocsTranslationChecks";
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
  it("is linked from the On Call nav group, right after the policies it belongs to", () => {
    const links: Array<NavLink> = onCallGroup().links;

    // The overview and the policies come first; their pages pin them.
    expect(links[0]?.title).toBe("On-Call Overview");
    expect(links[1]?.title).toBe("On-Call Policies");
    expect(links[2]).toEqual({ title: PAGE_TITLE, url: PAGE_URL });
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
          MORE_FIELDS_SECTION_TITLE,
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
          // The wait in the language's digits: Persian writes 30 as ۳۰.
          expect({
            lang,
            fact,
            found: toLatinDigits(page).includes(fact),
          }).toEqual({
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

  /*
   * A user override with nobody named to cover skips the person (task
   * oncall-skip-user-until): the escalation does not page them, and its log
   * says they are away and until when.
   */
  it("says a user override that names nobody to cover skips the person, as the escalation does", () => {
    const escalation: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "Common/Server/Services/OnCallDutyPolicyEscalationRuleService.ts",
      ),
      "utf8",
    );
    const awayMessage: string = fs.readFileSync(
      path.join(
        REPO_ROOT,
        "Common/Types/OnCallDutyPolicy/AwayTimelineMessage.ts",
      ),
      "utf8",
    );

    expect(escalation).toContain("getAwayTimelineMessage(");
    expect(awayMessage).toContain('"Skipped because this user is away until "');
    expect(PAGE).toContain(
      "One that names nobody to cover skips them: they are not paged, the policy's run says they are away and until when, and in an on-call schedule each of their turns goes to the next person in the rotation.",
    );
  });
});

/*
 * A level can page the next person in an on-call schedule's rotation (task
 * oncall-escalate-next-in-rotation): the backup after whoever is on call,
 * from the same rotation. The page gives it a section of its own, right after
 * how the levels page people, which its cards and the Notify table link to.
 * The section names the picker's group and the run's timeline as the
 * dashboard draws them and quotes the run's message as the server words it;
 * the API section gives the misc data key the server reads and the schedule
 * row's column.
 */
const NEXT_IN_ROTATION: string = "Next in rotation";
const NEXT_IN_ROTATION_HEADING: string =
  "Escalating to the next person in the rotation";
const PEOPLE_PICKER_KINDS_FILE: string =
  "Common/UI/Components/PeoplePicker/PeoplePickerKinds.ts";
const TIMELINE_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable.tsx";
const EXECUTION_TIMELINE: string = "Execution Timeline";

/*
 * Where the sections are, in every language: the English page's outline.
 * Passing a page on (PassOnDocs.test.ts) sits between the rotation and the
 * editing sections.
 */
const LEVELS_SECTION: number = 2;
const NEXT_IN_ROTATION_SECTION: number = 3;
const API_SECTION: number = 6;

// A schedule the section's example names, and the run message it quotes.
const EXAMPLE_SCHEDULE: string = "Payments primary";
const EXAMPLE_PERSON: string = "Sam Lee";

interface PageSection {
  heading: string;
  body: string;
}

// The page's "## " sections, by heading, with their text.
function sectionsOf(markdown: string): Array<PageSection> {
  return markdown
    .split(/^## /m)
    .slice(1)
    .map((part: string): PageSection => {
      const newline: number = part.indexOf("\n");

      return {
        heading: part.slice(0, newline).trim(),
        body: part.slice(newline + 1),
      };
    });
}

// The lines of a page that link to a heading of the same page.
function linesLinkingTo(markdown: string, heading: string): Array<string> {
  const target: string = `](#${slugifyMarkdownHeading(heading)})`;

  return markdown.split("\n").filter((line: string): boolean => {
    return line.includes(target);
  });
}

describe("the Escalation Rules docs page, on paging the next person in the rotation", () => {
  const sections: Array<PageSection> = sectionsOf(PAGE);

  it("has a section of its own, right after how the levels page people", () => {
    expect(sections[LEVELS_SECTION]?.heading).toBe(
      "How the levels page people",
    );
    expect(sections[NEXT_IN_ROTATION_SECTION]?.heading).toBe(
      NEXT_IN_ROTATION_HEADING,
    );
    expect(sections[API_SECTION]?.heading).toBe(
      "Creating rules with the API or Terraform",
    );
  });

  it("is linked from the cards and from the Notify table's row for it", () => {
    const linking: Array<string> = linesLinkingTo(
      PAGE,
      NEXT_IN_ROTATION_HEADING,
    );

    expect(linking).toHaveLength(2);
    expect(linking[0]!.startsWith("- [")).toBe(true);
    expect(
      linking[1]!.startsWith("| A schedule's **Next in rotation** |"),
    ).toBe(true);
  });

  it("names the picker's group, the dialog's controls and the run's timeline as the dashboard draws them", () => {
    expect(readRepoFile(PEOPLE_PICKER_KINDS_FILE)).toContain(
      `translationKey("${NEXT_IN_ROTATION}")`,
    );
    expect(readRepoFile(TIMELINE_FILE)).toContain(
      `translationKey("${EXECUTION_TIMELINE}")`,
    );

    const section: string = sections[NEXT_IN_ROTATION_SECTION]!.body;

    for (const label of [
      NEXT_IN_ROTATION,
      "Add Escalation Rule",
      "Add responder",
      "Escalate after (in minutes)",
      "Create Rule",
      EXECUTION_TIMELINE,
    ]) {
      expect({ label, found: section.includes(`**${label}**`) }).toEqual({
        label,
        found: true,
      });
    }

    // The recommended ladder: the schedule, its next person, then a team.
    for (const level of [1, 2, 3]) {
      expect(section).toContain(
        `| **${getDefaultEscalationRuleName(level)}** |`,
      );
    }

    expect(section).toContain(
      `| **${getDefaultEscalationRuleName(2)}** | The same schedule's **${NEXT_IN_ROTATION}** |`,
    );
  });

  it("quotes the run's message as the server words it", () => {
    const reason: string =
      OnCallPolicyRunMessageView.getNextInRotationReason(
        EXAMPLE_SCHEDULE,
      ).toString();

    expect(reason).toBe(`next in the ${EXAMPLE_SCHEDULE} rotation`);
    expect(sections[NEXT_IN_ROTATION_SECTION]!.body).toContain(
      `"${EXAMPLE_PERSON} (${reason})"`,
    );
  });

  it("gives the API: the misc data key the server reads, and the schedule row's column, set only when the row is created", () => {
    const api: string = sections[API_SECTION]!.body;
    const row: OnCallDutyPolicyEscalationRuleSchedule =
      new OnCallDutyPolicyEscalationRuleSchedule();

    expect(api).toContain(
      `\`${NEXT_IN_ROTATION_SCHEDULES_KEY}\` (a list of schedule ids) in its \`miscDataProps\``,
    );
    expect(row.hasColumn("pageNextInRotation")).toBe(true);
    expect(row.getColumnAccessControlFor("pageNextInRotation")?.update).toEqual(
      [],
    );
    expect(api).toContain(
      "a row with `pageNextInRotation` set to `true` does the same; it is set when the row is created.",
    );
  });

  describe("in every docs language", () => {
    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "%s has the section, links to it, and names the dashboard and the API alike",
      (lang: string) => {
        const page: string = readPage(lang);
        const dashboard: Record<string, string> = readDashboardLocale(lang);
        const pageSections: Array<PageSection> = sectionsOf(page);

        expect(pageSections).toHaveLength(sections.length);

        const section: PageSection = pageSections[NEXT_IN_ROTATION_SECTION]!;

        // The card and the Notify table's row link to the translated heading.
        expect({
          lang,
          links: linesLinkingTo(page, section.heading).length,
        }).toEqual({
          lang,
          links: 2,
        });

        for (const label of [NEXT_IN_ROTATION, EXECUTION_TIMELINE]) {
          expect({
            lang,
            label,
            found: section.body.includes(`**${dashboard[label]}**`),
          }).toEqual({ lang, label, found: true });
        }

        for (const level of [1, 2, 3]) {
          expect({
            lang,
            level,
            found: section.body.includes(
              `**${getDefaultEscalationRuleName(level)}**`,
            ),
          }).toEqual({ lang, level, found: true });
        }

        // The run's message is the server's, in English.
        expect({
          lang,
          quoted: section.body.includes(
            `${EXAMPLE_PERSON} (next in the ${EXAMPLE_SCHEDULE} rotation)`,
          ),
        }).toEqual({ lang, quoted: true });

        const api: string = pageSections[API_SECTION]!.body;

        for (const fact of [
          `\`${NEXT_IN_ROTATION_SCHEDULES_KEY}\``,
          "`pageNextInRotation`",
          "`-schedule`",
          "`true`",
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
