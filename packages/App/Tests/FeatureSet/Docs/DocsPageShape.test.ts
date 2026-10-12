import {
  boldLabels,
  boldPaths,
  detailsBlocks,
  detailsBody,
  lineShape,
  PATH_SEPARATOR,
  stepCount,
  tabLabels,
  tabPanel,
  tabPanels,
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

/*
 * Sections that moved into components: a tab panel holds what a page once
 * put under a heading (an install method, a language), and a :::details
 * block a troubleshooting entry. Suites that hold such a part to the code
 * read it through these.
 */
describe("tabPanels and tabPanel", () => {
  it("reads each panel's lines up to the next tab, code blocks included", () => {
    expect(tabPanels(PAGE)).toEqual([
      {
        label: "Docker",
        body: ["```bash", "# a comment, not a heading", "docker run **not-bold**", "```"].join("\n"),
      },
      { label: "Kubernetes", body: "Text." },
    ]);
  });

  it("ends the last panel at the tabs' own close, not at a nested component's", () => {
    const page: string = [
      ":::steps",
      "### Install",
      ":::tabs",
      "@tab install.sh",
      "Run it.",
      ":::details Why",
      "Because.",
      ":::",
      "After the details.",
      "@tab Docker Compose",
      "```yaml",
      ":::",
      "@tab not a tab",
      "```",
      ":::",
      "Outside the tabs.",
      ":::",
    ].join("\n");

    expect(tabPanel(page, "install.sh")).toBe(
      ["Run it.", ":::details Why", "Because.", ":::", "After the details."].join("\n"),
    );
    expect(tabPanel(page, "Docker Compose")).toBe(
      ["```yaml", ":::", "@tab not a tab", "```"].join("\n"),
    );
    expect(tabPanels(page).map((panel) => panel.label)).toEqual([
      "install.sh",
      "Docker Compose",
    ]);
  });

  it("picks a later panel with the same label by its place, and fails on a label the page lacks", () => {
    const page: string = [
      ":::tabs",
      "@tab systemd",
      "First.",
      ":::",
      "",
      ":::tabs",
      "@tab systemd",
      "Second.",
      ":::",
    ].join("\n");

    expect(tabPanel(page, "systemd")).toBe("First.");
    expect(tabPanel(page, "systemd", 1)).toBe("Second.");
    expect(() => {
      return tabPanel(page, "Windows");
    }).toThrow('No tab panel "Windows"');
    expect(() => {
      return tabPanel(page, "systemd", 2);
    }).toThrow();
  });
});

describe("detailsBlocks and detailsBody", () => {
  const page: string = [
    "## Troubleshooting",
    "",
    ":::details Run the diagnostic script first",
    "It checks everything.",
    "",
    "```bash",
    ":::",
    "```",
    ":::",
    "",
    ":::details No cluster appears",
    "1. Read the logs.",
    ":::",
  ].join("\n");

  it("reads each block's summary and lines, a code block's ::: included", () => {
    expect(detailsBlocks(page)).toEqual([
      {
        summary: "Run the diagnostic script first",
        body: ["It checks everything.", "", "```bash", ":::", "```"].join("\n"),
      },
      { summary: "No cluster appears", body: "1. Read the logs." },
    ]);
  });

  it("finds a block by its summary, and fails on one the page lacks", () => {
    expect(detailsBody(page, "No cluster appears")).toBe("1. Read the logs.");
    expect(() => {
      return detailsBody(page, "Something else");
    }).toThrow('No :::details block "Something else"');
  });
});
