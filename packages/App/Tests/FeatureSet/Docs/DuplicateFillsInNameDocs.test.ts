import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Duplicate: the copy's name is filled in - the original's, numbered past
 * the project's names ("Checkout API 2", a copy of that one "Checkout API
 * 3") - and the copy opens once it is made.
 *
 * The dashboard guide also sent people to "the dashboards list" to find
 * Duplicate. There is none there: Duplicate Dashboard is a card on the
 * dashboard's own Settings page, beside Export and Archive. Markdown is not
 * compiled, so nothing else notices a guide describing a flow the product
 * no longer has - in any of the seventeen languages.
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
  return fs.readFileSync(path.join(CONTENT_DIR, language, page), "utf8");
}

/*
 * The paragraph under the dashboard guide's sixth heading, "Duplicating a
 * dashboard" in English: the headings before it are the same in every
 * language.
 */
function duplicateDashboardParagraph(language: string): string {
  const lines: Array<string> = readPage(
    language,
    "dashboards/configuration.md",
  ).split("\n");
  const headings: Array<number> = lines
    .map((line: string, index: number): number => {
      return line.startsWith("## ") ? index : -1;
    })
    .filter((index: number): boolean => {
      return index >= 0;
    });
  const heading: number = headings[5] as number;

  return (lines[heading + 2] || "").trim();
}

// The workflow guide's bullet about duplicating, in the Tidying up list.
function duplicateWorkflowBullet(language: string): string {
  return (
    readPage(language, "workflows/authoring.md")
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- ") && line.includes("**Duplicate Workflow**");
      }) || ""
  );
}

describe("the Duplicate guides, in every language", () => {
  it("are read in all seventeen languages", () => {
    expect(LANGUAGES).toHaveLength(17);
    expect(LANGUAGES).toContain("en");
  });

  it.each(LANGUAGES)(
    "%s: a dashboard is duplicated from its own Settings page, the copy's name numbered",
    (language: string) => {
      const paragraph: string = duplicateDashboardParagraph(language);

      expect(paragraph).toContain("**Duplicate Dashboard**");
      expect(paragraph).toContain("→ Duplicate Dashboard**");
      // The copy's name, and a copy of the copy's.
      expect(paragraph).toContain("Checkout API 2");
      expect(paragraph).toContain("Checkout API 3");
    },
  );

  it.each(LANGUAGES)(
    "%s: a workflow's copy is named past the project's workflows",
    (language: string) => {
      const bullet: string = duplicateWorkflowBullet(language);

      expect(bullet).toContain("**Duplicate Workflow**");
      expect(bullet).toContain("Nightly Sync 2");
    },
  );
});

describe("the English guides", () => {
  it("say where Duplicate Dashboard is, what the copy is called, and that it opens", () => {
    expect(duplicateDashboardParagraph("en")).toBe(
      'To copy a dashboard, open it and go to **Settings → Duplicate Dashboard**. The copy\'s name is filled in for you: the dashboard\'s name, numbered past the names the project already has ("Checkout API" is copied as "Checkout API 2", and a copy of that one as "Checkout API 3"). Change it if you like, click **Duplicate Dashboard**, and the copy opens. It has the dashboard\'s widgets, variables, description and labels. Branding and custom domains stay with the original, and public sharing always starts off, so you can decide whether to turn it on.',
    );
  });

  it("no longer send people to a Duplicate in the dashboards list", () => {
    for (const language of LANGUAGES) {
      expect(duplicateDashboardParagraph(language)).not.toContain(
        "**Duplicate**",
      );
    }

    expect(readPage("en", "dashboards/configuration.md")).not.toContain(
      "open the dashboards list and pick **Duplicate**",
    );
  });

  it("say a workflow's copy is named, opens, and starts disabled", () => {
    expect(duplicateWorkflowBullet("en")).toBe(
      '- There\'s no way to duplicate a single block. **Duplicate Workflow** on the workflow\'s **Settings** page copies the whole thing. The copy\'s name is filled in, numbered past the project\'s workflows ("Nightly Sync" is copied as "Nightly Sync 2"), and the copy opens, disabled.',
    );
  });
});
