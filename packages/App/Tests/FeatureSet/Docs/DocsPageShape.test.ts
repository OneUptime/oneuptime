import {
  boldLabels,
  boldPaths,
  detailsBlocks,
  detailsBody,
  DocsTabPanel,
  isArrowPath,
  lineShape,
  PATH_SEPARATOR,
  pathArrowPattern,
  pathSteps,
  pathWithArrows,
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

/*
 * Persian lines as the pages write them: "←" beside a step in Persian
 * words, "→" between two steps in Latin letters, which are drawn from the
 * left (#7611).
 */
const PERSIAN_PAGE: string = [
  "در پروژه به **تنظیمات کاربر ← ترجیحات ایمیل** بروید.",
  "",
  "در **AWS Console → App Runner → Services ← سرویس شما** را باز کنید.",
  "",
  "سپس **ذخیره** را بزنید.",
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

  it("reads a Persian path written with ←, and one that mixes → and ←, as one path each", () => {
    expect(boldPaths(PERSIAN_PAGE)).toEqual([
      ["تنظیمات کاربر", "ترجیحات ایمیل"],
      ["AWS Console", "App Runner", "Services", "سرویس شما"],
    ]);
    expect(boldLabels(PERSIAN_PAGE)).toEqual(["ذخیره"]);
  });
});

describe("pathWithArrows, pathSteps and pathArrowPattern", () => {
  it("joins the steps with → in a language read from the left", () => {
    expect(pathWithArrows(["Monitors", "Settings", "Probes"], "de")).toBe(
      "Monitors → Settings → Probes",
    );
  });

  it("writes ← beside a Persian step, and keeps → between two Latin ones", () => {
    expect(pathWithArrows(["تنظیمات کاربر", "ترجیحات ایمیل"], "fa")).toBe(
      "تنظیمات کاربر ← ترجیحات ایمیل",
    );
    expect(
      pathWithArrows(
        ["AWS Console", "App Runner", "Services", "سرویس شما"],
        "fa",
      ),
    ).toBe("AWS Console → App Runner → Services ← سرویس شما");
    expect(pathWithArrows(["Settings", "Probes"], "fa")).toBe(
      "Settings → Probes",
    );
  });

  it("reads back the steps of a path it wrote, whichever way its arrows point", () => {
    for (const steps of [
      ["Monitors", "Settings", "Probes"],
      ["تنظیمات کاربر", "ترجیحات ایمیل"],
      ["AWS Console", "App Runner", "Services", "سرویس شما"],
    ]) {
      expect({ steps, read: pathSteps(pathWithArrows(steps, "fa")) }).toEqual({
        steps,
        read: steps,
      });
      expect(isArrowPath(pathWithArrows(steps, "fa"))).toBe(true);
    }

    expect(isArrowPath("ذخیره")).toBe(false);
  });

  it("matches either arrow beside a step whose words it does not know in a language read from the right, and → in one read from the left", () => {
    const toYourPage: (language: string) => RegExp = (
      language: string,
    ): RegExp => {
      return new RegExp(`^Status Pages${pathArrowPattern(language)}[^→←]+$`);
    };

    expect(toYourPage("fa").test("Status Pages → My Page")).toBe(true);
    expect(toYourPage("fa").test("Status Pages ← صفحه من")).toBe(true);
    expect(toYourPage("de").test("Status Pages → Meine Seite")).toBe(true);
    expect(toYourPage("de").test("Status Pages ← Meine Seite")).toBe(false);
  });
});

/*
 * A Persian path written with "←" is checked step by step, as one written
 * with "→" was (#7611): a translation suite reads each step of a page's
 * paths and holds it to the Dashboard's words, so a wrong step fails.
 */
describe("a Persian path written with ←, checked step by step", () => {
  // The Persian Dashboard's words for a path's steps.
  const DRAWN: Array<string> = ["تنظیمات کاربر", "ترجیحات ایمیل"];

  // The steps of a page's paths that are not the Dashboard's words.
  function wrongSteps(page: string): Array<string> {
    return boldPaths(page).flatMap((steps: Array<string>): Array<string> => {
      return steps.filter((step: string, index: number): boolean => {
        return step !== DRAWN[index];
      });
    });
  }

  it("passes the path as the Dashboard words it, and fails a wrong step in it", () => {
    const right: string = `در پروژه به **${pathWithArrows(DRAWN, "fa")}** بروید.`;
    const wrong: string = `در پروژه به **${pathWithArrows(
      ["تنظیمات کاربر", "ترجیحات پیامک"],
      "fa",
    )}** بروید.`;

    expect(right).toBe("در پروژه به **تنظیمات کاربر ← ترجیحات ایمیل** بروید.");
    expect(boldPaths(right)).toEqual([DRAWN]);
    expect(wrongSteps(right)).toEqual([]);
    expect(wrongSteps(wrong)).toEqual(["ترجیحات پیامک"]);
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
        body: [
          "```bash",
          "# a comment, not a heading",
          "docker run **not-bold**",
          "```",
        ].join("\n"),
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
      [
        "Run it.",
        ":::details Why",
        "Because.",
        ":::",
        "After the details.",
      ].join("\n"),
    );
    expect(tabPanel(page, "Docker Compose")).toBe(
      ["```yaml", ":::", "@tab not a tab", "```"].join("\n"),
    );
    expect(
      tabPanels(page).map((panel: DocsTabPanel): string => {
        return panel.label;
      }),
    ).toEqual(["install.sh", "Docker Compose"]);
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
