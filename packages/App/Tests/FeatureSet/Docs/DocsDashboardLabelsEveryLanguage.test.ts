import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import SubscriptionPlan, {
  PlanType,
} from "Common/Types/Billing/SubscriptionPlan";
import { BillingPeriod } from "Common/Types/Billing/SubscriptionPlanPricing";
import { getPlanPickerOptionText } from "Common/UI/Components/Billing/PlanPicker/PlanPickerCopy";
import { getChoiceRowPlanPillText } from "Common/UI/Components/ChoiceRows/ChoiceRows";
import {
  TRANSLATED_LANGUAGES,
  hasPage,
  listPages,
  readPage,
} from "./DocsContentSupport";
import {
  PLAN_NAMES,
  dashboardLabel,
  dashboardLocale,
  dashboardTranslator,
  drawnActionLabel,
  drawnDashboardLabel,
  isActionLabel,
  isPlanName,
  writtenPlanName,
} from "./DocsDashboardLabels";
import { EITHER_ARROW } from "./DocsPageShape";
import { boldSpans, prose } from "./DocsTranslationChecks";
import { isPermissionTitleKeptInEnglish } from "./DocsRoleNames";
import {
  WORKFLOW_STEP_NAMES,
  isLookedUp,
  isStepNameOnPage,
  workflowStepPage,
} from "./DocsWorkflowStepNames";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every docs language names the Dashboard as that language's Dashboard
 * draws it (#7100).
 *
 * The Persian incident pages used to quote about 750 Dashboard labels in
 * English: DocsDashboardLabels held a list of languages whose pages kept the
 * Dashboard's English names, and several suites had a copy of it, while the
 * Persian Dashboard draws those labels in Persian. A reader matching the
 * page to the screen found words the screen does not have. These tests keep
 * that exception gone:
 *
 *   - dashboardLabel, which the suites check the pages with, is the drawn
 *     label in every docs language, Persian included;
 *   - no docs suite declares a list of languages whose pages keep the
 *     English names, with Persian on it;
 *   - the Persian incident pages and the IRC page (the pages the exception
 *     covered) quote in English only the names kept on purpose, each with
 *     the reason, and each still quoted - a label the Persian locale has in
 *     English stays English, and is not counted. Where the product can
 *     confirm a reason (a permission's title, a plan's name), the test
 *     asks it. A workflow step's own names are no reason: the builder draws
 *     them in Persian, and the pages name them so (#7511).
 */

const DOCS_TESTS_DIR: string = __dirname;
const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const PERSIAN: string = "fa";

// Arabic-script letters, which every Persian word contains.
const PERSIAN_LETTER: RegExp = /[؀-ۿ]/;

// Text with no letter outside printable ASCII, a dash and an ellipsis.
const LATIN_ONLY: RegExp = /^[ -~—…]+$/;

const BOLD: RegExp = /\*\*([^*\n]+?)\*\*/g;

// A plan pill's sentence and the values it is filled with (ChoiceRows, the navbar menus).
const PLAN_PILL_CALL: RegExp =
  /translateTemplate\("\{\{planName\}\} Plan", \{([^}]*)\}/g;

// A value handed to a translator: translatableTerm(), translateText().
const LOOKED_UP: RegExp = /translat/;

// A headline's colon, ASCII or full-width, and the space French puts first.
const TRAILING_COLON: RegExp = /\s*[:：]$/;

interface KeptName {
  name: string;
  why: string;
}

/*
 * The reasons a name is kept that the product itself can confirm: each
 * name kept for one of them is checked against it below.
 */
const PERMISSION_NAME: string =
  "A permission's name, as a custom role lists it, which every language keeps in English.";
const PLAN_NAME: string =
  "A plan's name, which the Dashboard shows as written in every language, as on the invoice.";
const CHAT_NOTE_MODAL: string =
  "The Slack and Microsoft Teams note modal, which is not translated.";

/*
 * The pages the exception covered, and the bold names each keeps in English
 * although the Persian Dashboard words them.
 */
const KEPT_ON_PERSIAN_PAGES: Record<string, ReadonlyArray<KeptName>> = {
  // Who may hand the Incident Commander's role on from the header (#10273).
  "incidents/index": [{ name: "Edit Incident Member", why: PERMISSION_NAME }],
  "incidents/declaring-incidents": [
    {
      name: "Primary",
      why: "An on-call policy's name inside the feed line, which the server writes in English.",
    },
    { name: "Growth", why: PLAN_NAME },
  ],
  "incidents/states-and-severities": [
    {
      name: "Investigating",
      why: "A custom state a project might add: a name people give.",
    },
    {
      name: "Closed",
      why: "A custom state a project might add: a name people give.",
    },
    {
      name: "Time to Acknowledge",
      why: "The metric's name, as the metrics explorer lists it.",
    },
    {
      name: "Status",
      why: "The subscriber email's row, quoted as the email shows it.",
    },
    { name: "Create Incident State Timeline", why: PERMISSION_NAME },
    { name: "Create Alert Internal Note", why: PERMISSION_NAME },
    { name: "Create Alert Episode Internal Note", why: PERMISSION_NAME },
    { name: "Create Incident Episode Internal Note", why: PERMISSION_NAME },
  ],
  "incidents/notes-owners-and-feed": [
    { name: "Public Note", why: CHAT_NOTE_MODAL },
    { name: "Private Note", why: CHAT_NOTE_MODAL },
    { name: "Note", why: CHAT_NOTE_MODAL },
  ],
  "incidents/linked-alerts": [
    { name: "Create Alert State Timeline", why: PERMISSION_NAME },
    { name: "Edit Alert", why: PERMISSION_NAME },
    { name: "Create Incident Alert", why: PERMISSION_NAME },
    { name: "Delete Incident Alert", why: PERMISSION_NAME },
    { name: "Edit Incident Alert", why: PERMISSION_NAME },
    {
      name: "Incident",
      why: "The permission group the linking permissions are listed under, named in English as they are.",
    },
  ],
  "incidents/settings": [
    { name: "Edit Incident Template", why: PERMISSION_NAME },
    { name: "Edit Incident Custom Field", why: PERMISSION_NAME },
    { name: "Edit Project", why: PERMISSION_NAME },
    // What a role's Reassign and Remove each need (#10273).
    { name: "Edit Incident Member", why: PERMISSION_NAME },
    { name: "Delete Incident Member", why: PERMISSION_NAME },
  ],
  "integrations/irc": [{ name: "Growth", why: PLAN_NAME }],
};

type ReasonCheck = (name: string) => boolean;

// What the product says about a name kept for each checkable reason.
const REASON_CHECKS: Array<{ why: string; holds: ReasonCheck }> = [
  {
    why: PERMISSION_NAME,
    holds: (name: string): boolean => {
      return isPermissionTitleKeptInEnglish(name);
    },
  },
  {
    why: PLAN_NAME,
    holds: (name: string): boolean => {
      return (Object.values(PlanType) as Array<string>).includes(name);
    },
  },
];

const PERSIAN_PAGES: Array<string> = Object.keys(KEPT_ON_PERSIAN_PAGES);

function readPersianPage(page: string): string {
  return fs.readFileSync(path.join(CONTENT_DIR, PERSIAN, `${page}.md`), "utf8");
}

/*
 * The bold names, and the segments of bold menu paths (whichever way their
 * arrows point, #7611), a Persian page writes in English although the
 * Persian Dashboard draws them in other words: a
 * label, a Create or Add button, or a named action on a model ("Edit
 * Incident Template", which a page's Edit button draws from "Edit
 * {{itemName}}") or a headline the Dashboard writes with a colon, which the
 * pages quote without it ("Will notify", from "Will notify:").
 */
function englishDashboardLabels(markdown: string): Array<string> {
  const found: Set<string> = new Set<string>();

  for (const match of markdown.matchAll(BOLD)) {
    for (const segment of (match[1] as string).split(EITHER_ARROW)) {
      const name: string = segment.trim();

      if (!LATIN_ONLY.test(name)) {
        continue;
      }

      const headline: string = `${name}:`;

      if (
        (isActionLabel(name) && drawnActionLabel(PERSIAN, name) !== name) ||
        (typeof dashboardLocale("en")[headline] === "string" &&
          drawnDashboardLabel(PERSIAN, headline)
            .trim()
            .replace(TRAILING_COLON, "") !== name)
      ) {
        found.add(name);
      }
    }
  }

  return Array.from(found).sort();
}

// A list of languages, named for keeping English, with Persian on it.
const ENGLISH_LANGUAGE_LIST: RegExp =
  /const\s+(\w*ENGLISH\w*)\s*:[^=;]*=\s*([^;]*);/g;

// The lists a docs suite's source declares that keep Persian in English.
function persianKeptInEnglish(source: string): Array<string> {
  return Array.from(source.matchAll(ENGLISH_LANGUAGE_LIST))
    .filter((match: RegExpMatchArray): boolean => {
      const value: string = match[2] as string;

      return value.includes(`"${PERSIAN}"`) || value.includes("PERSIAN");
    })
    .map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });
}

describe("every docs language names the Dashboard as it draws it", () => {
  it("checks every docs language, Persian among them", () => {
    expect(SUPPORTED_DOCS_LANGUAGE_CODES).toContain(PERSIAN);
    expect(SUPPORTED_DOCS_LANGUAGE_CODES.length).toBe(17);
  });

  it("dashboardLabel is the label as drawn, in every docs language", () => {
    expect(dashboardLabel).toBe(drawnDashboardLabel);

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const english of [
        "Owners",
        "Save",
        "Incident Template",
        "Chart summary",
        "Average",
        "Create Incident Role",
      ]) {
        expect({
          language: language,
          english: english,
          named: dashboardLabel(language, english),
        }).toEqual({
          language: language,
          english: english,
          named: drawnDashboardLabel(language, english),
        });
      }
    }
  });

  it("names a label in Persian as the Persian Dashboard draws it, not in English", () => {
    for (const english of [
      "Owners",
      "Save",
      "Incident Template",
      "Chart summary",
      "Average",
      "Create Incident Role",
    ]) {
      const named: string = dashboardLabel(PERSIAN, english);

      expect({ english: english, persian: PERSIAN_LETTER.test(named) }).toEqual(
        { english: english, persian: true },
      );
    }

    // A label the Persian locale has in English stays English.
    expect(dashboardLabel(PERSIAN, "Markdown")).toBe("Markdown");
  });

  it("no docs suite keeps a list of languages whose pages name the Dashboard in English, with Persian on it", () => {
    const sources: Array<string> = fs
      .readdirSync(DOCS_TESTS_DIR)
      .filter((file: string): boolean => {
        return file.endsWith(".ts") && file !== path.basename(__filename);
      });

    expect(sources.length).toBeGreaterThan(100);

    const lists: Array<string> = sources.flatMap(
      (file: string): Array<string> => {
        return persianKeptInEnglish(
          fs.readFileSync(path.join(DOCS_TESTS_DIR, file), "utf8"),
        ).map((name: string): string => {
          return `${file}: ${name}`;
        });
      },
    );

    expect(lists).toEqual([]);
  });

  it("would find such a list again", () => {
    expect(
      persianKeptInEnglish(
        'const ENGLISH_UI_NAME_LANGUAGES: ReadonlyArray<string> = ["en", "fa"];',
      ),
    ).toEqual(["ENGLISH_UI_NAME_LANGUAGES"]);
    expect(
      persianKeptInEnglish(
        'const ENGLISH_UI_LANGUAGES: ReadonlySet<string> = new Set<string>(["en", PERSIAN]);',
      ),
    ).toEqual(["ENGLISH_UI_LANGUAGES"]);
    // A list of English names, or a list without Persian, is not one.
    expect(
      persianKeptInEnglish(
        'const ENGLISH_HEADING: Record<string, string> = { en: "A", fa: "ب" };',
      ),
    ).toEqual([]);
    expect(
      persianKeptInEnglish(
        'const ENGLISH_ONLY_LANGUAGES: Array<string> = ["en"];',
      ),
    ).toEqual([]);
  });
});

describe("the Persian pages the exception covered", () => {
  it("give each name they keep in English a reason, once", () => {
    for (const page of PERSIAN_PAGES) {
      const names: Array<string> = (KEPT_ON_PERSIAN_PAGES[page] || []).map(
        (kept: KeptName): string => {
          return kept.name;
        },
      );

      expect({ page: page, names: new Set<string>(names).size }).toEqual({
        page: page,
        names: names.length,
      });

      for (const kept of KEPT_ON_PERSIAN_PAGES[page] || []) {
        expect({ name: kept.name, reason: kept.why.length > 20 }).toEqual({
          name: kept.name,
          reason: true,
        });
      }
    }
  });

  it("keep a name for a reason the product confirms, where it can", () => {
    let checked: number = 0;

    for (const page of PERSIAN_PAGES) {
      for (const kept of KEPT_ON_PERSIAN_PAGES[page] || []) {
        const check: { why: string; holds: ReasonCheck } | undefined =
          REASON_CHECKS.find((reason: { why: string }): boolean => {
            return reason.why === kept.why;
          });

        if (!check) {
          continue;
        }

        checked++;
        expect({ page: page, name: kept.name, holds: true }).toEqual({
          page: page,
          name: kept.name,
          holds: check.holds(kept.name),
        });
      }
    }

    // Permission titles and plan names; a step's own names left the lists (#7511).
    expect(checked).toBeGreaterThan(10);
  });

  it("would refuse a reason the product does not confirm", () => {
    const holds: (why: string, name: string) => boolean = (
      why: string,
      name: string,
    ): boolean => {
      return Boolean(
        REASON_CHECKS.find((reason: { why: string }): boolean => {
          return reason.why === why;
        })?.holds(name),
      );
    };

    // A label is not a permission or a plan.
    expect(holds(PERMISSION_NAME, "Owners")).toBe(false);
    expect(holds(PLAN_NAME, "Owners")).toBe(false);
    // A built-in role's name reads in the page's language.
    expect(holds(PERMISSION_NAME, "Project Owner")).toBe(false);
    /*
     * Incident Member is a role, عضو حوادث on the incident pages, and Edit
     * Incident Member the permission a custom role gives to hand the
     * commander's role on (#10273): only the permission stays in English.
     */
    expect(holds(PERMISSION_NAME, "Incident Member")).toBe(false);
    expect(holds(PERMISSION_NAME, "Edit Incident Member")).toBe(true);
    expect(holds(PERMISSION_NAME, "Delete Incident Member")).toBe(true);
    // And each confirms what it names.
    expect(holds(PERMISSION_NAME, "Edit Incident Template")).toBe(true);
    expect(holds(PLAN_NAME, "Growth")).toBe(true);
  });

  it("keep no workflow step's name for being one: the builder draws it in Persian (#7511)", () => {
    for (const page of PERSIAN_PAGES) {
      for (const kept of KEPT_ON_PERSIAN_PAGES[page] || []) {
        const isStepName: boolean =
          WORKFLOW_STEP_NAMES.has(kept.name) && isLookedUp(kept.name);

        if (!isStepName) {
          continue;
        }

        /*
         * A step's name kept here is another screen's word on the page
         * (DocsWorkflowStepNames' otherWords), such as the chat note
         * modal's Note.
         */
        expect({
          page,
          name: kept.name,
          isTheStepsThere: workflowStepPage(page)
            ? isStepNameOnPage(page, kept.name)
            : false,
        }).toEqual({ page, name: kept.name, isTheStepsThere: false });
        expect(kept.why).not.toMatch(/workflow|step/i);
      }
    }
  });

  it.each(PERSIAN_PAGES)(
    "fa/%s quotes in English only the Dashboard labels it keeps on purpose, and still quotes each",
    (page: string) => {
      expect(englishDashboardLabels(readPersianPage(page))).toEqual(
        (KEPT_ON_PERSIAN_PAGES[page] || [])
          .map((kept: KeptName): string => {
            return kept.name;
          })
          .sort(),
      );
    },
  );

  it("would find an English label put back, in prose or in a menu path", () => {
    expect(
      englishDashboardLabels(
        "**مالکان** and **Owners**, then **حوادث → Settings → قالب‌های حادثه**",
      ),
    ).toEqual(["Owners", "Settings"]);
    // A path with "←" beside its Persian steps, as the pages write it (#7611).
    expect(englishDashboardLabels("**حوادث ← Settings ← قواعد**")).toEqual([
      "Settings",
    ]);
    // A named action, which the page's button draws from its template.
    expect(englishDashboardLabels("**Edit Incident Template**")).toEqual([
      "Edit Incident Template",
    ]);
    // A headline the Dashboard writes with a colon, quoted without it.
    expect(englishDashboardLabels("**Will notify**")).toEqual(["Will notify"]);
    // Not a product name, nor a label the Persian locale has in English.
    expect(englishDashboardLabels("**OneUptime** and **Markdown**")).toEqual(
      [],
    );
  });
});

/*
 * A PLAN'S NAME, AS WRITTEN, IN EVERY LANGUAGE (#7512).
 *
 * The Dashboard writes a plan's name as it is in every language, as the
 * invoice does (writtenPlanName). A locale can still word the same English
 * for another use: Persian's "Growth" is رشد and its "Free" رایگان. Fourteen
 * Persian pages named the Growth plan رشد, and the Vercel page named the
 * Free plan رایگان, while the screen beside them said Growth and Free. So
 * a translated page whose English page names a plan never bolds the
 * locale's word for it, and still names the plan as written.
 */

// A plan's name as a whole word: "Growth", not "Growths" or "OverGrowth".
function namesPlan(markdown: string, plan: string): boolean {
  return new RegExp(`(?<![A-Za-z])${plan}(?![A-Za-z])`).test(markdown);
}

/*
 * The plans the English page names, each with the bold word the translated
 * page gives it in their place: the locale's word, where it differs.
 */
function planWordsInPlaceOfNames(
  language: string,
  english: string,
  translated: string,
): Array<string> {
  const spans: Array<string> = boldSpans(prose(translated));

  return PLAN_NAMES.filter((plan: string): boolean => {
    return namesPlan(prose(english), plan);
  }).flatMap((plan: string): Array<string> => {
    const word: string = drawnDashboardLabel(language, plan);

    return word !== plan && spans.includes(word) ? [`${plan} -> ${word}`] : [];
  });
}

// The plans the English page names in bold that the translated page does not write.
function plansNotWritten(english: string, translated: string): Array<string> {
  return boldSpans(prose(english)).filter((span: string): boolean => {
    return isPlanName(span) && !namesPlan(prose(translated), span);
  });
}

// Every page of a translated language that has an English page.
function translatedPagesOf(language: string): Array<string> {
  return listPages(language).filter((page: string): boolean => {
    return hasPage("en", page);
  });
}

describe("every docs language names a plan as it is written", () => {
  it("the helper writes each plan as it is, and refuses a name that is no plan's", () => {
    expect([...PLAN_NAMES].sort()).toEqual(
      (Object.values(PlanType) as Array<string>).sort(),
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const plan of PLAN_NAMES) {
        expect({
          language,
          plan,
          written: writtenPlanName(language, plan),
        }).toEqual({ language, plan, written: plan });
      }
    }

    expect(isPlanName("Growth")).toBe(true);
    expect(isPlanName("growth")).toBe(false);
    expect(isPlanName("Owners")).toBe(false);
    expect((): string => {
      return writtenPlanName(PERSIAN, "Owners");
    }).toThrow("Not a plan's name: Owners");
  });

  it("a locale words a plan's English for another use, which is why no page looks a plan up", () => {
    // The words this guard keeps off the pages.
    expect(drawnDashboardLabel(PERSIAN, PlanType.Growth)).toBe("رشد");
    expect(drawnDashboardLabel(PERSIAN, PlanType.Free)).toBe("رایگان");
    expect(writtenPlanName(PERSIAN, PlanType.Growth)).toBe("Growth");
  });

  it("the plan pills write the plan's name as it is, in every Dashboard language", () => {
    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      for (const plan of Object.values(PlanType)) {
        const pill: string = getChoiceRowPlanPillText(
          dashboardTranslator(language),
          plan,
        );
        const word: string = drawnDashboardLabel(language, plan);

        expect({
          language,
          plan,
          written: namesPlan(pill, plan),
          worded: word !== plan && pill.includes(word),
        }).toEqual({ language, plan, written: true, worded: false });
      }
    }
  });

  it("the plan picker names a plan as it is, in every Dashboard language", () => {
    const growth: SubscriptionPlan = new SubscriptionPlan(
      "price_growth_month",
      "price_growth_year",
      PlanType.Growth,
      22,
      20,
      2,
      14,
    );

    for (const language of SUPPORTED_DOCS_LANGUAGE_CODES) {
      expect({
        language,
        name: getPlanPickerOptionText({
          plan: growth,
          period: BillingPeriod.Monthly,
          translator: dashboardTranslator(language),
        }).name,
      }).toEqual({ language, name: PlanType.Growth });
    }
  });

  it("the navbar menus fill the plan pill with the plan itself, not a word to look up", () => {
    for (const file of [
      "Common/UI/Components/Navbar/NavBarMobileMenu.tsx",
      "Common/UI/Components/Navbar/NavBarMenuModal.tsx",
      "Common/UI/Components/ChoiceRows/ChoiceRows.tsx",
    ]) {
      const source: string = fs.readFileSync(
        path.resolve(__dirname, "../../../..", file),
        "utf8",
      );
      const calls: Array<string> = Array.from(
        source.matchAll(PLAN_PILL_CALL),
      ).map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect({ file, calls: calls.length > 0 }).toEqual({ file, calls: true });

      for (const call of calls) {
        expect({ file, call, looksUp: LOOKED_UP.test(call) }).toEqual({
          file,
          call,
          looksUp: false,
        });
      }
    }
  });

  it("would find a plan given its locale's word, and a plan's name left out", () => {
    const english: string = "Schedules need the **Growth** plan.";

    expect(
      planWordsInPlaceOfNames(PERSIAN, english, "به طرح **رشد** نیاز دارد."),
    ).toEqual(["Growth -> رشد"]);
    expect(
      planWordsInPlaceOfNames(PERSIAN, english, "به طرح **Growth** نیاز دارد."),
    ).toEqual([]);
    // The word for growth in running text is not the plan.
    expect(
      planWordsInPlaceOfNames(
        PERSIAN,
        english,
        "به طرح **Growth** نیاز دارد. آنچه رشد کرده را ببینید.",
      ),
    ).toEqual([]);
    // A page that does not name the plan may bold the word.
    expect(
      planWordsInPlaceOfNames(PERSIAN, "Find what grew.", "**رشد**"),
    ).toEqual([]);
    expect(plansNotWritten(english, "به طرح **رشد** نیاز دارد.")).toEqual([
      "Growth",
    ]);
    expect(plansNotWritten(english, "Braucht **Growth**.")).toEqual([]);
  });

  it.each(TRANSLATED_LANGUAGES)(
    "%s: no page gives a plan its locale's word in place of its name",
    (language: string) => {
      const found: Array<string> = translatedPagesOf(language).flatMap(
        (page: string): Array<string> => {
          return planWordsInPlaceOfNames(
            language,
            readPage("en", page),
            readPage(language, page),
          ).map((word: string): string => {
            return `${page}: ${word}`;
          });
        },
      );

      expect(found).toEqual([]);
    },
  );

  it.each(TRANSLATED_LANGUAGES)(
    "%s: every page writes each plan its English page names in bold",
    (language: string) => {
      const missing: Array<string> = translatedPagesOf(language).flatMap(
        (page: string): Array<string> => {
          return plansNotWritten(
            readPage("en", page),
            readPage(language, page),
          ).map((plan: string): string => {
            return `${page}: ${plan}`;
          });
        },
      );

      expect(missing).toEqual([]);
    },
  );

  it("checks the pages that named a plan by its locale's word", () => {
    const pages: Array<string> = translatedPagesOf(PERSIAN).filter(
      (page: string): boolean => {
        return boldSpans(prose(readPage("en", page))).includes(PlanType.Growth);
      },
    );

    for (const page of [
      "on-call/policies",
      "on-call/schedules",
      "alerts/settings",
      "scheduled-maintenance/states",
      "runbooks/variables",
      "terraform/troubleshooting",
    ]) {
      expect(pages).toContain(page);
    }

    expect(boldSpans(prose(readPage("en", "integrations/vercel")))).toContain(
      PlanType.Free,
    );
  });
});
