import {
  boldLabels,
  boldPaths,
  lineShape,
  PATH_SEPARATOR,
  stepCount,
  tabLabels,
  tables,
  unbalancedLines,
} from "./DocsPageShape";
import { describe, expect, it } from "@jest/globals";

/*
 * The page-shape helpers the docs translation suites hold every language
 * to (ProbeDocsTranslations, StatusPageDocsTranslations). A helper that
 * reads a page wrong passes a broken translation, or fails a good one in
 * all sixteen languages at once, so each is pinned here on small pages
 * built for the case.
 */

const PAGE: string = [
  "# Title",
  "",
  "Intro with **Bold** and `code`.",
  "",
  ":::steps",
  "### First",
  "",
  "Open **Monitors → Settings → Probes**.",
  "",
  ":::tabs",
  "@tab Docker",
  "```bash",
  "# a comment, not a heading",
  "docker run **not-bold**",
  "```",
  "@tab Kubernetes",
  "Text.",
  ":::",
  "",
  "#### Inside the first step",
  "",
  "### Second",
  "",
  "| A | B |",
  "| --- | :---: |",
  "| `x` | y |",
  ":::",
  "",
  "Last line.",
].join("\n");

describe("lineShape", () => {
  it("names each line's kind, so two pages can be laid side by side", () => {
    expect(lineShape(PAGE)).toEqual([
      "#",
      "",
      "text",
      "",
      ":::",
      "###",
      "",
      "text",
      "",
      ":::",
      "@tab",
      "```",
      /*
       * Fences are not tracked: a code line starting with "#" reads as a
       * heading. That is the same in every language, because code blocks
       * are kept exactly as the English page writes them.
       */
      "#",
      "text",
      "```",
      "@tab",
      "text",
      ":::",
      "",
      "####",
      "",
      "###",
      "",
      "|",
      "|",
      "|",
      ":::",
      "",
      "text",
    ]);
  });

  it("gives two pages with the same lines in other words the same shape", () => {
    const other: string = PAGE.replace("Intro with", "Einleitung mit").replace(
      "Last line.",
      "Letzte Zeile.",
    );

    expect(lineShape(other)).toEqual(lineShape(PAGE));
  });

  it("tells a page with a line moved from one that kept its lines", () => {
    const moved: string = PAGE.replace("Intro with **Bold** and `code`.\n", "");

    expect(lineShape(moved)).not.toEqual(lineShape(PAGE));
  });
});

describe("stepCount", () => {
  it("counts the headings that start a step, not the deeper ones inside it", () => {
    expect(stepCount(PAGE)).toBe(2);
  });

  it("ignores headings in code blocks and outside the steps", () => {
    const page: string = [
      "## Outside",
      ":::steps",
      "#### One",
      "```bash",
      "#### not a step",
      "```",
      "#### Two",
      ":::",
      "#### After",
    ].join("\n");

    expect(stepCount(page)).toBe(2);
  });

  it("counts nothing on a page with no steps", () => {
    expect(stepCount("# Title\n\n## Section\n")).toBe(0);
  });
});

describe("tabLabels", () => {
  it("lists every tab's label, in order", () => {
    expect(tabLabels(PAGE)).toEqual(["Docker", "Kubernetes"]);
  });
});

describe("boldLabels and boldPaths", () => {
  it("parts a menu path from the single labels, outside code blocks", () => {
    expect(boldLabels(PAGE)).toEqual(["Bold"]);
    expect(boldPaths(PAGE)).toEqual([["Monitors", "Settings", "Probes"]]);
  });

  it("splits a path on the separator the docs write", () => {
    expect(PATH_SEPARATOR).toBe(" → ");
    expect(boldPaths("**A → B**, then **C>D**")).toEqual([["A", "B"]]);
  });
});

describe("unbalancedLines", () => {
  it("finds a line that opens a bold or code span and never closes it", () => {
    expect(
      unbalancedLines(
        ["One **open.", "Two `open.", "Fine **bold** and `code`."].join("\n"),
      ),
    ).toEqual(["One **open.", "Two `open."]);
  });

  it("reads asterisks inside code as code, and skips code blocks", () => {
    expect(
      unbalancedLines(
        ["A cron `*/5 * * * *` line.", "```", "**unclosed in code", "```"].join(
          "\n",
        ),
      ),
    ).toEqual([]);
  });
});

describe("tables", () => {
  it("reads each table's rows, header first, without its delimiter row", () => {
    expect(tables(PAGE)).toEqual([
      [
        ["A", "B"],
        ["`x`", "y"],
      ],
    ]);
  });

  it("starts a new table after any line that is not a row, and skips code blocks", () => {
    const page: string = [
      "| One |",
      "| --- |",
      "| 1 |",
      "",
      "```text",
      "| Not | A | Table |",
      "```",
      "| Two |",
      "| :-- |",
      "| 2 |",
    ].join("\n");

    expect(tables(page)).toEqual([
      [["One"], ["1"]],
      [["Two"], ["2"]],
    ]);
  });
});
