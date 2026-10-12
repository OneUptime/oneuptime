import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Create a workflow dialog, as the docs describe it.
 *
 * The dialog was simplified: Start from scratch first, then "Or start from a
 * template" with a few recommended templates, a search box and a category
 * select, a template's details only once it is picked, and no progress rail
 * - so no "Start from" step to name. The authoring page described the busier
 * version before it (a "Start from" step, Start from scratch beside the
 * search, categories with counts), and the Jira guide pointed at a preview
 * beside the list. This reads every language's copy of the page and holds it
 * to the dialog, quoting each label the way the Dashboard shows it in that
 * language.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

type ReadFunction = (language: string) => string;

const readAuthoringPage: ReadFunction = (language: string): string => {
  return fs.readFileSync(
    path.join(CONTENT_DIR, language, "workflows/authoring.md"),
    "utf8",
  );
};

type DashboardLabelFunction = (language: string, english: string) => string;

// The label as the Dashboard draws it in that language, or English if it has no translation.
const dashboardLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  const translations: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  );

  return translations[english] || english;
};

/*
 * The opening of the page: from the top down to the first section heading,
 * where the dialog is described.
 */
const openingOf: ReadFunction = (language: string): string => {
  const page: string = readAuthoringPage(language);

  return page.slice(0, page.indexOf("\n## "));
};

const DIALOG_LABELS: Array<string> = [
  "Create a workflow",
  "Start from scratch",
  "Or start from a template",
  "Recommended",
  "All templates",
  "Search templates…",
  "Use this template",
  "Jira",
  "Incidents",
  "Monitors",
];

// The Enter key, as each language's Dashboard names it (Intro, Entrée...).
const enterKey: (language: string) => string = (language: string): string => {
  return `**${dashboardLabel(language, "Enter")}**`;
};

describe("docs for the Create a workflow dialog", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test("the labels the docs quote are ones the dialog draws", () => {
    const picker: string = fs.readFileSync(
      path.join(
        DASHBOARD_SRC,
        "Components/Workflow/WorkflowTemplatePicker.tsx",
      ),
      "utf8",
    );
    const wizard: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components/Workflow/CreateWorkflowModal.tsx"),
      "utf8",
    );
    const util: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Utils/Workflow/WorkflowTemplatePickerUtil.ts"),
      "utf8",
    );

    expect(picker).toContain('tx("Start from scratch")');
    expect(picker).toContain('tx("Or start from a template")');
    expect(picker).toContain('tx("Search templates…")');
    expect(wizard).toContain('title="Create a workflow"');
    expect(wizard).toContain('"Use this template"');
    expect(util).toContain('label: "Recommended"');
    expect(util).toContain('label: "All templates"');
  });

  test.each(LANGUAGES)(
    "%s: the opening quotes each of the dialog's labels as the Dashboard shows them",
    (language: string) => {
      const opening: string = openingOf(language);

      for (const label of DIALOG_LABELS) {
        const shown: string = dashboardLabel(language, label);

        expect({
          label: label,
          shown: shown,
          quoted: opening.includes(`**${shown}**`),
        }).toEqual({
          label: label,
          shown: shown,
          quoted: true,
        });
      }
    },
  );

  test.each(
    LANGUAGES.filter((language: string) => {
      return language !== "en";
    }),
  )(
    "%s: the dialog's title and Start from scratch are quoted as the Dashboard now translates them, not in English",
    (language: string) => {
      const page: string = readAuthoringPage(language);

      for (const label of ["Create a workflow", "Start from scratch"]) {
        expect(dashboardLabel(language, label)).not.toBe(label);
        expect(page).not.toContain(`**${label}**`);
      }
    },
  );

  /*
   * The dialog has no steps to name any more. "Start from" was the first
   * step's title on a progress rail that is gone.
   */
  test.each(LANGUAGES)(
    "%s: the opening no longer names a Start from step",
    (language: string) => {
      expect(readAuthoringPage(language)).not.toContain("**Start from**");
    },
  );

  test.each(LANGUAGES)(
    "%s: the opening lists the two ways in, Start from scratch first, and the keyboard too",
    (language: string) => {
      const opening: string = openingOf(language);
      const bullets: Array<string> = opening.split("\n- ").slice(1);

      expect(bullets).toHaveLength(2);
      expect(bullets[0]).toContain(
        `**${dashboardLabel(language, "Start from scratch")}**`,
      );
      expect(bullets[1]).toContain(
        `**${dashboardLabel(language, "Or start from a template")}**`,
      );
      expect(opening).toContain(enterKey(language));
      expect(opening).toContain("`/`");
    },
  );

  test("en: what the page says about the dialog matches it", () => {
    const opening: string = openingOf("en");

    expect(opening).toContain(
      "The **Create a workflow** dialog asks how you want to start, then for a name.",
    );
    expect(opening).toContain(
      "**Start from scratch**, at the top of the dialog, gives you an empty canvas.",
    );
    expect(opening).toContain(
      "**Or start from a template** lists a few **Recommended** templates.",
    );
    expect(opening).toContain("Every word you type has to match.");
    expect(opening).toContain(
      "its trigger, the blocks it is made of, and the settings it will ask for",
    );
    expect(opening).toContain(
      "Workflows are created switched off, so nothing runs until you turn them on.",
    );
    // Creating a workflow goes straight to its builder.
    expect(opening).toContain("A new workflow opens in the **Builder**");

    // The step-by-step wizard of before, and its busier first step.
    expect(opening).not.toContain("beside the search box, gives you");
    expect(opening).not.toContain("each with how many templates it holds");
    expect(opening).not.toContain("open **Builder** in the left menu");
  });

  test("en: the Jira guide finds its templates the way the dialog shows them", () => {
    const jira: string = fs.readFileSync(
      path.join(CONTENT_DIR, "en", "integrations", "jira.md"),
      "utf8",
    );

    expect(jira).toContain("under **Jira** in its category list");
    expect(jira).toContain(
      "Under **Or start from a template**, choose **Jira**",
    );
    expect(jira).toContain("**Search templates…**");
    expect(jira).toContain("Click **Use this template**.");

    expect(jira).not.toContain("Under **Start from**");
    expect(jira).not.toContain("The preview beside the list");
    expect(jira).not.toContain("pick a card from the **Jira** group");
    expect(jira).not.toContain("grouped under **Jira**");
  });
});
