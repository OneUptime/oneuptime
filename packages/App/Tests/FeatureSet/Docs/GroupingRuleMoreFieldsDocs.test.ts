import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import {
  GROUPING_RULE_COPY,
  GROUPING_SUMMARY_COPY,
  GroupingRuleKind,
  GroupingRuleTranslateFunction,
  createGroupingRuleTranslate,
  formatGroupingDuration,
} from "../../../FeatureSet/Dashboard/src/Utils/GroupingRule/GroupingRuleSetup";
import { Translator } from "Common/Types/Translator";
import {
  dashboardTranslator,
  drawnDashboardLabel,
} from "./DocsDashboardLabels";

/*
 * The grouping rule form's "Show advanced settings" switch added three
 * steps - Episode Lifecycle, Details, On-Call & Ownership. It is gone:
 * everything a rule can do beyond grouping is folded under More fields at
 * the end of the Grouping step, in those three groups, and its folded
 * header - one quiet line - names what it holds and says what each setting
 * a rule uses is set to. The docs describe the form a reader will see, so
 * they say so - in every language that covers grouping rules - and never
 * send anyone looking for the switch again, nor for a chip: More fields
 * draws none since it became a line.
 */

// The folded line's way of naming a set setting, in English.
const SAYS_WHAT_IT_IS_SET_TO: string =
  "each setting a rule uses says what it is set to";

const CONTENT_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
);

// The switch's label, in any case.
const RETIRED_SWITCH: RegExp = /show advanced settings/i;

/*
 * A page about grouping rules. Others may name a "Show Advanced Settings"
 * button of somebody else's (Google Cloud's, on the SMTP page).
 */
const ABOUT_GROUPING_RULES: RegExp = /grouping rule/i;

function listMarkdown(directory: string): Array<string> {
  return fs
    .readdirSync(directory, { withFileTypes: true })
    .flatMap((entry: fs.Dirent): Array<string> => {
      const full: string = path.join(directory, entry.name);

      if (entry.isDirectory()) {
        return listMarkdown(full);
      }

      return entry.name.endsWith(".md") ? [full] : [];
    });
}

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

// A Dashboard label in bold, as this language's Dashboard draws it.
function bold(language: string, english: string): string {
  return `**${drawnDashboardLabel(language, english)}**`;
}

// The languages whose settings page describes the grouping rule form.
const LANGUAGES_WITH_GROUPING_RULES: Array<string> = ["en", "fa"];

/*
 * THE RULE'S OWN WORDS, AS EACH LANGUAGE'S DASHBOARD DRAWS THEM (#7514).
 *
 * The settings page quotes what the rule says about itself: its folded More
 * fields line ("On-Call Policies: 2", "Reopen recently resolved episodes:
 * 30 minutes") and the list's Grouping column ("One episode per monitor",
 * "New incidents join while they arrive within 30 minutes of the last
 * one"). The Dashboard draws all of them in the reader's language - the
 * folded line names each field by its title, looked up, and the rule's
 * setting by its own translated words (getFoldedValue); the column is
 * GroupingRuleSetup's summary, translated whole - so every page quotes them
 * as its Dashboard draws them, worked out here from the same helpers.
 */

/*
 * The grouping rule pages' translate in this language, as
 * translateGroupingRuleText builds it: its counts in the reader's digits.
 */
function groupingTranslate(language: string): GroupingRuleTranslateFunction {
  return createGroupingRuleTranslate(dashboardTranslator(language));
}

// A folded section's item, as FoldedSection draws one: its title looked up, then its value.
function foldedItem(language: string, title: string, value: string): string {
  const translator: Translator = dashboardTranslator(language);

  return `${translator.translateText(title) || title}: ${value}`;
}

const EXAMPLE_MINUTES: number = 30;

// The folded line's two examples: the on-call policies picked, and a lifecycle setting.
function foldedLineExamples(language: string): Array<string> {
  return [
    foldedItem(language, "On-Call Policies", "2"),
    foldedItem(
      language,
      GROUPING_RULE_COPY.reopenWindowTitle,
      formatGroupingDuration({
        minutes: EXAMPLE_MINUTES,
        translate: groupingTranslate(language),
      }),
    ),
  ];
}

// The Grouping column's two examples: a rule grouping by monitor, within its time window.
function groupingColumnExamples(language: string): Array<string> {
  const translate: GroupingRuleTranslateFunction = groupingTranslate(language);

  return [
    translate(GROUPING_SUMMARY_COPY.perMonitor),
    translate(GROUPING_SUMMARY_COPY.timeWindowOn[GroupingRuleKind.Incident], {
      duration: formatGroupingDuration({
        minutes: EXAMPLE_MINUTES,
        translate: translate,
      }),
    }),
  ];
}

describe("the docs on the grouping rule form", () => {
  const pages: Array<string> = listMarkdown(CONTENT_DIR);

  test("are really read", () => {
    expect(pages.length).toBeGreaterThan(500);

    for (const language of LANGUAGES_WITH_GROUPING_RULES) {
      expect(read(language, "incidents/settings")).toContain(
        bold(language, "Grouping Rules"),
      );
    }
  });

  test("never mention the Show advanced settings switch, in any language", () => {
    const aboutGroupingRules: Array<string> = pages.filter(
      (page: string): boolean => {
        return ABOUT_GROUPING_RULES.test(fs.readFileSync(page, "utf8"));
      },
    );

    // The settings pages, the incidents overview, Run rules now.
    expect(aboutGroupingRules.length).toBeGreaterThanOrEqual(4);

    expect(
      aboutGroupingRules
        .filter((page: string): boolean => {
          return RETIRED_SWITCH.test(fs.readFileSync(page, "utf8"));
        })
        .map((page: string): string => {
          return path.relative(CONTENT_DIR, page);
        }),
    ).toEqual([]);
  });

  test.each(LANGUAGES_WITH_GROUPING_RULES)(
    "%s: says everything beyond grouping is folded under More fields, in three groups",
    (language: string) => {
      const settings: string = read(language, "incidents/settings");

      expect(settings).toContain(bold(language, "More fields"));
      expect(settings).toContain(bold(language, "Grouping"));

      // The groups, in the order the fold draws them.
      const groups: Array<number> = [
        "On-Call & Ownership",
        "Episode Lifecycle",
        "Details",
      ].map((group: string): number => {
        return settings.indexOf(`${bold(language, group)} (`);
      });

      for (const position of groups) {
        expect(position).toBeGreaterThan(-1);
      }

      expect(
        [...groups].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(groups);

      // The settings that are set, as this language's folded line writes them.
      for (const said of foldedLineExamples(language)) {
        expect({ language, said, quoted: settings.includes(said) }).toEqual({
          language,
          said,
          quoted: true,
        });
      }

      // The old default assignee is one of them.
      expect(settings).toContain(bold(language, "Default assignee"));
    },
  );

  test("en: opening More fields adds no step, and the rule is created from the last one", () => {
    const settings: string = read("en", "incidents/settings");

    expect(settings).toContain(
      "Opening it adds no step: **Create Incident Grouping Rule** is on **Which Incidents**, the last step.",
    );
    expect(settings).toContain("so editing a rule never hides what it does");
    expect(settings).toContain(SAYS_WHAT_IT_IS_SET_TO);
    // The old default assignee is called out on the folded header.
    expect(settings).toContain(
      "— **Default assignee**, and a sentence under it asking you to settle it —",
    );
    // More fields is a quiet line: what is set on it is no chip.
    expect(settings).not.toContain("**Default assignee** chip");
    expect(settings).not.toContain("is a chip that says what it is set to");

    const episodes: string = read("en", "alerts/episodes");

    expect(episodes).toContain(
      "says what each setting the rule uses is set to, so editing a rule never hides what it does",
    );
    expect(episodes).not.toContain("as a chip");
    // No three steps to walk through any more.
    expect(settings).not.toContain("adds three steps");
    expect(settings).not.toContain("walks through them without asking");
  });
});

describe("the grouping rule lines the settings page quotes", () => {
  test("are worked out from the rule's own helpers, as English draws them", () => {
    expect(foldedLineExamples("en")).toEqual([
      "On-Call Policies: 2",
      "Reopen recently resolved episodes: 30 minutes",
    ]);
    expect(groupingColumnExamples("en")).toEqual([
      "One episode per monitor",
      "New incidents join while they arrive within 30 minutes of the last one",
    ]);
  });

  test("read in a language's own words where its Dashboard has them", () => {
    expect(foldedLineExamples("de")).toEqual([
      "Bereitschaftsrichtlinien: 2",
      "Kürzlich behobene Episoden wieder öffnen: 30 Minuten",
    ]);
    expect(groupingColumnExamples("de")[0]).toBe("Eine Episode pro Monitor");
  });

  test.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
    "%s: quotes the folded line and the Grouping column as its Dashboard draws them",
    (language: string) => {
      const settings: string = read(language, "incidents/settings");

      for (const said of [
        ...foldedLineExamples(language),
        ...groupingColumnExamples(language),
      ]) {
        expect({ language, said, quoted: settings.includes(said) }).toEqual({
          language,
          said,
          quoted: true,
        });
      }

      // A translated page no longer quotes the English its screen dropped.
      if (language !== "en") {
        for (const english of [
          ...foldedLineExamples("en"),
          ...groupingColumnExamples("en"),
        ]) {
          if (
            [
              ...foldedLineExamples(language),
              ...groupingColumnExamples(language),
            ].includes(english)
          ) {
            continue;
          }

          expect({
            language,
            english,
            left: settings.includes(english),
          }).toEqual({ language, english, left: false });
        }
      }
    },
  );
});
