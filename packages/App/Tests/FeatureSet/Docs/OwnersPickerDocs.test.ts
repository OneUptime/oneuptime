import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { drawnDashboardLabel } from "./DocsDashboardLabels";
import { escapeRegExp } from "./DocsTranslationChecks";

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
  // Grouping rules: replaced by Episode Owners.
  "Default Assign To Team",
  "Default Assign To User",
  "Default Assignees",
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

// A Dashboard label in bold, as this language's Dashboard draws it.
function bold(language: string, english: string): string {
  return `**${drawnDashboardLabel(language, english)}**`;
}

// The same, as a regular expression source.
function boldPattern(language: string, english: string): string {
  return escapeRegExp(bold(language, english));
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
   * under More fields at the end of Incident Details, beside the labels
   * (labels-not-a-step), listed there as one field.
   */
  test.each(["en", "fa"])(
    "%s: the incident template's owners are one Owners field, under More fields on Incident Details",
    (language: string) => {
      const settings: string = read(language, "incidents/settings");
      const declaring: string = read(language, "incidents/declaring-incidents");

      const owners: string = boldPattern(language, "Owners");

      expect(settings).not.toMatch(new RegExp(`^- ${owners} — ${owners}`, "m"));
      expect(settings).toMatch(new RegExp(`^ {2}- ${owners} — `, "m"));
      expect(settings).toContain(bold(language, "Add owner"));
      expect(declaring).toMatch(
        new RegExp(
          `${owners}.{1,10}${boldPattern(language, "Labels")}.{1,40}${boldPattern(language, "More fields")}`,
        ),
      );
      // One row for owners in the template fields table.
      expect(declaring).toMatch(new RegExp(`^\\| ${owners} +\\|`, "m"));
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

  /*
   * Grouping rules used to set a default team and user that nothing showed.
   * Their On-Call & Ownership step asks for Episode Owners instead, and an
   * old rule's default assignee is a line under it with Add as owners and
   * Remove.
   */
  test.each(["en", "fa"])(
    "%s: grouping rules ask for Episode Owners, and say what became of the default assignee",
    (language: string) => {
      const settings: string = read(language, "incidents/settings");

      expect(settings).toMatch(
        new RegExp(
          `${boldPattern(language, "On-Call & Ownership")} \\([^)]*${boldPattern(language, "Episode Owners")}`,
        ),
      );

      for (const label of [
        "Episode Owners",
        "Add owner",
        "Default assignee",
        "Add as owners",
        "Remove",
      ]) {
        expect(settings).toContain(bold(language, label));
      }
      // The API keeps its contract, and says so by the columns' names.
      for (const column of [
        "`defaultAssignToUser`",
        "`defaultAssignToTeam`",
        "`assignedToUser`",
        "`assignedToTeam`",
      ]) {
        expect(settings).toContain(column);
      }
    },
  );

  test("en: the grouping rules' owners are notified, and only the project's people and teams", () => {
    const settings: string = read("en", "incidents/settings");

    expect(settings).toContain(
      "becomes an owner of every episode the rule opens: listed on the episode's **Owners** page and notified like any other owner",
    );
    expect(settings).toContain(
      "Only your project's teams and members can be picked",
    );
    expect(settings).not.toContain("the default team and user, and episode");
  });

  test("the Forms On Submit settings and table have one Owners field and row", () => {
    const onSubmit: string = read("en", "forms/on-submit");

    expect(onSubmit).toMatch(
      /^\| \*\*Owners\*\* +\| \*\*Owners\*\* +\| \*\*Owners\*\* +\|$/m,
    );
    expect(onSubmit).toContain("**Owners** is one picker for people and teams");
  });
});
