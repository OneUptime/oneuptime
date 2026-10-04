import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A resource product's label and owner rules are created in two steps -
 * Match, then Labels or Owners - where what the rule adds is required and
 * its name is filled in from it, and the description (and Notify Owners)
 * waits under More fields (Dashboard Utils/Form/ResourceRuleForm). The
 * pages that describe those forms field by field say so, in English and in
 * Persian, the two languages that describe them: nobody is sent looking for
 * a Basic Info step or told a rule's labels are optional.
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

function read(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, `${page}.md`),
    "utf8",
  );
}

const PAGES: Array<string> = ["slo/label-and-owner-rules", "rum/applications"];

describe.each(["en", "fa"])(
  "%s docs of label and owner rules",
  (language: string) => {
    test.each(PAGES)(
      "%s names the steps and what is filled in",
      (page: string) => {
        const content: string = read(language, page);

        expect(content).toContain("**Match**");
        expect(content).toContain("**Labels**");
        expect(content).toContain("**Name**");
        expect(content).toContain("**More fields**");
        expect(content).not.toContain("Basic Info");
      },
    );

    test("the SLO page says what the name is filled in from, for both kinds", () => {
      const content: string = read(language, "slo/label-and-owner-rules");

      expect(content).toContain("_Add Checkout, Production_");
      expect(content).toContain("_Add Checkout team as owners_");
      expect(content).toMatch(
        /\*\*Notify Owners\*\* \([^)]*\*\*More fields\*\*/,
      );
    });
  },
);

describe("the English docs of label and owner rules", () => {
  test("say a rule has to add something", () => {
    for (const page of PAGES) {
      expect(read("en", page)).toMatch(/has to add at least one/);
    }
  });

  test("no longer list a name and description before what the rule matches", () => {
    const content: string = read("en", "slo/label-and-owner-rules");

    expect(content).not.toContain(
      "A label rule has a name, an optional description, its match criteria",
    );
    expect(content).not.toContain(
      "An owner rule has a name, an optional description, whether to **Notify Owners**",
    );
  });
});
