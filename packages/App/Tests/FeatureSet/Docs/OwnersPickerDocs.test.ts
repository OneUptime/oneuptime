import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The dashboard asks for owners with one Owners field - people and teams in
 * one list, opened with Add owner - everywhere it used to ask with an
 * "Owner - Teams" and an "Owner - Users" dropdown. The docs name the fields
 * a reader will see, in bold, so they must not send anyone looking for the
 * two dropdowns: not in English, not in any translation.
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

const RETIRED_FIELD_NAMES: Array<string> = [
  "Owner - Teams",
  "Owner - Users",
  "Owner Teams",
  "Owner Users",
  "Owners (Teams)",
  "Owners (Users)",
  "Alert Owner Teams",
  "Alert Owner Users",
  "Incident Owner Teams",
  "Incident Owner Users",
  "Owners to Assign",
];

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

describe("the docs on picking owners", () => {
  const pages: Array<string> = listMarkdown(CONTENT_DIR);

  test("read every page, in every language", () => {
    expect(pages.length).toBeGreaterThan(500);
    expect(
      pages.some((page: string): boolean => {
        return page.includes(`${path.sep}fa${path.sep}`);
      }),
    ).toBe(true);
  });

  test("never name the two dropdowns, or the two tables, as fields to find", () => {
    const hits: Array<string> = [];

    for (const page of pages) {
      const markdown: string = fs.readFileSync(page, "utf8");

      for (const name of RETIRED_FIELD_NAMES) {
        if (markdown.includes(`**${name}**`)) {
          hits.push(`${path.relative(CONTENT_DIR, page)}: **${name}**`);
        }
      }
    }

    expect(hits).toEqual([]);
  });

  /*
   * The template's owners have no step of their own any more: they fold
   * under Advanced at the end of Incident Details, beside the labels
   * (labels-not-a-step), listed there as one field.
   */
  test.each(["en", "fa"])(
    "%s: the incident template's owners are one Owners field, under Advanced on Incident Details",
    (language: string) => {
      const settings: string = read(language, "incidents/settings");
      const declaring: string = read(language, "incidents/declaring-incidents");

      expect(settings).not.toMatch(/^- \*\*Owners\*\* — \*\*Owners\*\*/m);
      expect(settings).toMatch(/^ {2}- \*\*Owners\*\* — /m);
      expect(settings).toContain("**Add owner**");
      expect(declaring).toMatch(
        /\*\*Owners\*\*.{1,10}\*\*Labels\*\*.{1,40}\*\*Advanced\*\*/,
      );
      // One row for owners in the template fields table.
      expect(declaring).toMatch(/^\| \*\*Owners\*\* +\|/m);
    },
  );

  test("the owner rules say how owners are picked", () => {
    expect(read("en", "incidents/notes-owners-and-feed")).toContain(
      "- **Owners** — **Add owner** opens one list of people and teams",
    );
    expect(read("en", "slo/label-and-owner-rules")).toContain(
      "the **Owners** to add — people and teams, picked from one list with **Add owner**",
    );
  });

  test("the Forms On Submit settings and table have one Owners field and row", () => {
    const onSubmit: string = read("en", "forms/on-submit");

    expect(onSubmit).toMatch(
      /^\| \*\*Owners\*\* +\| \*\*Owners\*\* +\| \*\*Owners\*\* +\|$/m,
    );
    expect(onSubmit).toContain("**Owners** is one picker for people and teams");
  });
});
