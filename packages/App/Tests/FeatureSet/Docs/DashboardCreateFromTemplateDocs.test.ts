import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import { drawnCreateButton, drawnDashboardLabel } from "./DocsDashboardLabels";

/*
 * Creating a dashboard, as the guides describe it: Create Dashboard opens
 * Create a dashboard, which asks how to start - Start from scratch, or a
 * template picked the way Create a workflow picks one - then for a name,
 * filled in from a template and numbered when the project has one already.
 * Create opens the new dashboard, an empty one on its canvas with Add
 * Widget on it.
 *
 * The maintainer: "The workflow templates model is a lot easier to
 * understand and use. Please make the dashboard templates model like
 * workflow templates." The guides described the dialog before it - a
 * Create from Template dialog of cards, Blank Dashboard among them - and
 * before that, a flow that never existed ("give it a name, and open it",
 * a canvas that "opens in Edit mode", "the + button"). Markdown is not
 * compiled, so nothing else notices a guide that describes a dialog the
 * product no longer has - in any of the seventeen languages.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");
const CONTENT_DIR: string = path.join(REPO_ROOT, "App/FeatureSet/Docs/Content");

const LANGUAGES: Array<string> = fs
  .readdirSync(CONTENT_DIR, { withFileTypes: true })
  .filter((entry: fs.Dirent): boolean => {
    return entry.isDirectory();
  })
  .map((entry: fs.Dirent): string => {
    return entry.name;
  })
  .sort();

function readPage(language: string, page: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "dashboards", page),
    "utf8",
  );
}

// The first paragraph under the page's title: how to create a dashboard.
function introOf(page: string): string {
  return page.split("\n")[2] || "";
}

// A Dashboard label in bold, as this language's Dashboard draws it.
function drawn(language: string, english: string): string {
  return `**${drawnDashboardLabel(language, english)}**`;
}

// The Create a dashboard section: from its heading to the next "## ".
function createSectionOf(page: string): string {
  const lines: Array<string> = page.split("\n");
  const start: number = lines.findIndex((line: string): boolean => {
    return line === ":::steps";
  });
  const end: number = lines.findIndex((line: string, index: number) => {
    return index > start && line.startsWith("## ");
  });

  return lines.slice(start, end).join("\n");
}

describe("the dashboard guides, in every language", () => {
  it("are read in all seventeen languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
  });

  it.each(LANGUAGES)(
    "%s: creating opens Create a dashboard: Start from scratch, or a template whose name is filled in and numbered",
    (language: string) => {
      const intro: string = introOf(readPage(language, "authoring.md"));

      expect(intro).toContain(
        `**${drawnCreateButton(language, "Create Dashboard")}**`,
      );
      expect(intro).toContain(drawn(language, "Create a dashboard"));
      expect(intro).toContain(drawn(language, "Start from scratch"));
      // A template's name, numbered past the project's dashboards.
      expect(intro).toContain("Kubernetes Dashboard 2");
    },
  );

  it.each(LANGUAGES)(
    "%s: the steps name the dialog's words as its Dashboard draws them",
    (language: string) => {
      const steps: string = createSectionOf(readPage(language, "authoring.md"));

      for (const label of [
        "Create a dashboard",
        "Start from scratch",
        "Or start from a template",
        "Recommended",
        "All templates",
        "Search templates…",
        "Use this template",
        "Enter",
        "More fields",
        "Back",
        "Add Widget",
      ]) {
        expect({
          label,
          named: steps.includes(drawn(language, label)),
        }).toEqual({ label, named: true });
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: no Blank Dashboard card and no Create from Template dialog are left in the guides",
    (language: string) => {
      for (const page of ["authoring.md", "index.md"]) {
        const markdown: string = readPage(language, page);

        expect(markdown).not.toContain("Blank Dashboard");
        expect(markdown).not.toContain(drawn(language, "Create from Template"));
      }
    },
  );

  it.each(LANGUAGES)(
    "%s: no '+' button to open the widget palette",
    (language: string) => {
      const page: string = readPage(language, "authoring.md");

      expect(page).not.toContain("**+**");
    },
  );

  it.each(LANGUAGES)(
    "%s: the overview's first step and example start from scratch, as the dialog words it",
    (language: string) => {
      const steps: Array<string> = readPage(language, "index.md")
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("1. ");
        });

      // Building a dashboard, then the quick example.
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0]).toContain(drawn(language, "Start from scratch"));
      expect(steps[1]).toContain(drawn(language, "Start from scratch"));
      expect(steps[1]).toContain(
        `**${drawnCreateButton(language, "Create Dashboard")}**`,
      );
    },
  );
});

describe("the English guides", () => {
  const authoring: string = readPage("en", "authoring.md");
  const overview: string = readPage("en", "index.md");

  it("say what Create a dashboard asks, and that Create opens the new dashboard", () => {
    expect(introOf(authoring)).toBe(
      'To create a dashboard, open **Products → Dashboards** and click **Create Dashboard**. The **Create a dashboard** dialog asks how you want to start, then for a name. **Start from scratch** gives you an empty dashboard; a template builds its widgets, and often its variables, for you, and fills in its name (numbered, as in "Kubernetes Dashboard 2", when the project already has one). Click **Create Dashboard** and the new dashboard opens. An empty one opens on its canvas, with an **Add Widget** button for its first widget.',
    );
  });

  it("walk the dialog as Create a workflow's is walked: how to start, a template's details, Use this template, then a name", () => {
    const steps: string = createSectionOf(authoring);

    expect(steps).toContain(
      "### Choose how to start\n\nOpen **Products → Dashboards** and click **Create Dashboard**. The **Create a dashboard** dialog opens on **Start from scratch**, an empty dashboard for your own widgets. Below it, **Or start from a template** lists six **Recommended** templates.",
    );
    expect(steps).toContain(
      "Click a template to see what it adds: its widgets, named as **Add Widget** names them, and the variables you narrow it with in its toolbar.",
    );
    expect(steps).toContain("every word you type has to match");
    expect(steps).toContain(
      "Then click **Use this template**, or double-click the template. In the search box, the arrow keys pick a template and **Enter** uses it.",
    );
    expect(steps).toContain(
      "**Back** takes you to the templates as you left them.",
    );
    expect(steps).toContain(
      "The description is optional, folded under **More fields**",
    );
    expect(
      steps.split("\n").filter((line: string): boolean => {
        return line.startsWith("### ");
      }),
    ).toEqual([
      "### Choose how to start",
      "### Pick a template",
      "### Name the dashboard",
      "### Create it",
    ]);
  });

  it("no longer claim a new dashboard opens in Edit mode", () => {
    expect(authoring).not.toContain("give it a name, and open it");
    expect(authoring).not.toContain("The canvas opens in **Edit** mode");
    expect(overview).not.toContain("pick a name. The canvas opens empty.");
  });

  it("open the widget catalog with Add Widget, wherever it is", () => {
    expect(authoring).toContain(
      "Click **Add Widget**: in the toolbar while you edit, or on the canvas of an empty dashboard.",
    );
  });

  it("build the quick example from scratch", () => {
    expect(overview).toContain(
      '1. Click **Create Dashboard**, choose **Start from scratch**, and name the dashboard "Checkout on-call."',
    );
    expect(overview).toContain(
      "1. **Create** — pick a template, or **Start from scratch**. A template fills in the name and opens with its widgets; a dashboard from scratch opens empty, with **Add Widget** on its canvas.",
    );
  });
});
