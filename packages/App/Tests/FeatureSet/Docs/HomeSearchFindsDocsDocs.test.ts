import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { readPage } from "./DocsContentSupport";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Home Page & Shortcuts says what Search (Cmd/Ctrl+K) finds; since #6822
 * that includes the docs, in a group the Dashboard titles with its
 * help.documentation word. The page names that group as each language's
 * Dashboard draws it, and the palette really does draw it so.
 */

const PAGE: string = "introduction/home";
const SECTION: string = "## Searching for a page, a setting or an action";
const DASHBOARD: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

const dashboardWord: (language: string) => string = (
  language: string,
): string => {
  const locale: { help: Record<string, string> } = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD, "Locales", `${language}.json`),
      "utf8",
    ),
  ) as { help: Record<string, string> };

  return locale.help["documentation"] as string;
};

// The first list of the Search section, found by the section's place on the English page.
const searchFinds: (language: string) => Array<string> = (
  language: string,
): Array<string> => {
  const english: Array<string> = readPage("en", PAGE).split("\n");
  const place: number = english
    .filter((line: string): boolean => {
      return line.startsWith("## ");
    })
    .indexOf(SECTION);
  const lines: Array<string> = readPage(language, PAGE).split("\n");
  const start: number = lines.indexOf(
    lines.filter((line: string): boolean => {
      return line.startsWith("## ");
    })[place] as string,
  );
  const list: Array<string> = [];
  let index: number = start + 1;

  while (!(lines[index] as string).startsWith("- ")) {
    index++;
  }
  while ((lines[index] || "").startsWith("- ")) {
    list.push(lines[index] as string);
    index++;
  }

  return list;
};

// The App compiles to a lib without Array.prototype.at.
const lastOf: (list: Array<string>) => string = (
  list: Array<string>,
): string => {
  return list[list.length - 1] || "";
};

describe("Home Page & Shortcuts: Search finds the docs", () => {
  it("says so last in what Search finds, under the Dashboard's word for the group", () => {
    const last: string = lastOf(searchFinds("en"));

    expect(last.startsWith("- **The docs**")).toBe(true);
    expect(last).toContain(`*${dashboardWord("en")}*`);
    expect(last).toContain("new tab");
  });

  it("is what the palette draws: a docs group under that word, opening in a new tab", () => {
    const palette: string = fs.readFileSync(
      path.join(
        DASHBOARD,
        "Components/CommandPalette/DashboardCommandPalette.tsx",
      ),
      "utf8",
    );

    expect(palette).toContain('id: "docs"');
    expect(palette).toContain('sectionTitle: t("help.documentation"');
    expect(palette).toContain("openInNewTab: true");
  });

  it.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.filter((language: string): boolean => {
      return language !== "en";
    }),
  )(
    "%s: says so in the same place, under this language's Dashboard word",
    (language: string) => {
      const list: Array<string> = searchFinds(language);
      const last: string = lastOf(list);

      expect(list).toHaveLength(searchFinds("en").length);
      expect(last).toContain(`*${dashboardWord(language)}*`);
      expect(last).not.toBe(lastOf(searchFinds("en")));
    },
  );
});
