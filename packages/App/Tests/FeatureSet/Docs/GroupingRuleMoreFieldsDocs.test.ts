import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The grouping rule form's "Show advanced settings" switch added three
 * steps - Episode Lifecycle, Details, On-Call & Ownership. It is gone:
 * everything a rule can do beyond grouping is folded under More fields at
 * the end of the Grouping step, in those three groups, and its folded
 * header names what it holds and draws each setting a rule uses as a chip.
 * The docs describe the form a reader will see, so they say so - in every
 * language that covers grouping rules - and never send anyone looking for
 * the switch again.
 */

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

// The languages whose settings page describes the grouping rule form.
const LANGUAGES_WITH_GROUPING_RULES: Array<string> = ["en", "fa"];

describe("the docs on the grouping rule form", () => {
  const pages: Array<string> = listMarkdown(CONTENT_DIR);

  test("are really read", () => {
    expect(pages.length).toBeGreaterThan(500);

    for (const language of LANGUAGES_WITH_GROUPING_RULES) {
      expect(read(language, "incidents/settings")).toContain(
        "**Grouping Rules**",
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

      expect(settings).toContain("**More fields**");
      expect(settings).toContain("**Grouping**");

      // The groups, in the order the fold draws them.
      const groups: Array<number> = [
        "**On-Call & Ownership** (",
        "**Episode Lifecycle** (",
        "**Details** (",
      ].map((group: string): number => {
        return settings.indexOf(group);
      });

      for (const position of groups) {
        expect(position).toBeGreaterThan(-1);
      }

      expect(
        [...groups].sort((a: number, b: number) => {
          return a - b;
        }),
      ).toEqual(groups);

      // The chips, as the folded header writes them.
      expect(settings).toContain("On-Call Duty Policies: 2");
      expect(settings).toContain(
        "Reopen recently resolved episodes: 30 minutes",
      );

      // The old default assignee is one of them.
      expect(settings).toContain("**Default assignee**");
    },
  );

  test("en: opening More fields adds no step, and the rule is created from the last one", () => {
    const settings: string = read("en", "incidents/settings");

    expect(settings).toContain(
      "Opening it adds no step: **Create Incident Grouping Rule** is on **Which Incidents**, the last step.",
    );
    expect(settings).toContain("so editing a rule never hides what it does");
    // The old default assignee is called out on the folded header.
    expect(settings).toContain(
      "a **Default assignee** chip, and a sentence under it asking you to settle it",
    );
    // No three steps to walk through any more.
    expect(settings).not.toContain("adds three steps");
    expect(settings).not.toContain("walks through them without asking");
  });
});
