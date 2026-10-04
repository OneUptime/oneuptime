import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Creating a dashboard: Create Dashboard opens the template picker, a
 * template fills in the dashboard's name (numbered when the project has
 * one already), Blank Dashboard asks for one, and Create opens the new
 * dashboard - a blank one on its empty canvas, with Add Widget on it.
 *
 * The guides said to "give it a name, and open it", that "the canvas opens
 * in Edit mode" (it never did: it opens in View mode, and editing is in the
 * dashboard's ⋯ menu) and to click "the + button" (there is none: the
 * button says Add Widget). Markdown is not compiled, so nothing else
 * notices a guide that describes a flow the product no longer has - in any
 * of the seventeen languages.
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

describe("the dashboard guides, in every language", () => {
  it("are read in all seventeen languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
  });

  it.each(LANGUAGES)(
    "%s: creating starts from a template or Blank Dashboard, the name filled in and numbered",
    (language: string) => {
      const intro: string = introOf(readPage(language, "authoring.md"));

      expect(intro).toContain("**Blank Dashboard**");
      // A template's name, numbered past the project's dashboards.
      expect(intro).toContain("Kubernetes Dashboard 2");
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
    "%s: the overview's first step and example start from Blank Dashboard",
    (language: string) => {
      const steps: Array<string> = readPage(language, "index.md")
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("1. ");
        });

      // Building a dashboard, then the quick example.
      expect(steps.length).toBeGreaterThanOrEqual(2);
      expect(steps[0]).toContain("**Blank Dashboard**");
      expect(steps[1]).toContain("**Blank Dashboard**");
    },
  );
});

describe("the English guides", () => {
  const authoring: string = readPage("en", "authoring.md");
  const overview: string = readPage("en", "index.md");

  it("say Create opens the new dashboard, a blank one with Add Widget", () => {
    expect(introOf(authoring)).toBe(
      'To create a dashboard, open **Dashboards → Create Dashboard** and pick a template, or **Blank Dashboard** to start from scratch. A template fills in the dashboard\'s name for you (numbered, as in "Kubernetes Dashboard 2", when the project already has one); a blank dashboard asks you for a name. Click **Create Dashboard** and the new dashboard opens. A blank one opens on its empty canvas, with an **Add Widget** button for its first widget.',
    );
  });

  it("no longer claim a new dashboard opens in Edit mode", () => {
    expect(authoring).not.toContain("give it a name, and open it");
    expect(authoring).not.toContain("The canvas opens in **Edit** mode");
    expect(overview).not.toContain("pick a name. The canvas opens empty.");
  });

  it("open the widget palette with Add Widget, wherever it is", () => {
    expect(authoring).toContain(
      "1. Click **Add Widget** to open the widget palette: on the canvas of an empty dashboard, or in the toolbar while you edit the dashboard.",
    );
  });

  it("build the quick example from Blank Dashboard", () => {
    expect(overview).toContain(
      '1. Create a **Blank Dashboard** called "Checkout on-call."',
    );
    expect(overview).toContain(
      "1. **Create** — pick a template, or **Blank Dashboard**. A template fills in the name and opens with its widgets; a blank dashboard opens empty, with **Add Widget** on its canvas.",
    );
  });
});
