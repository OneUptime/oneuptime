import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Create a workflow's first step, Start from, used to be a wall of every
 * template at once as large cards. It now opens on a few recommended
 * templates, keeps the rest under categories and a search, and previews a
 * template before it is used. The authoring page described the old step
 * ("pick Start from scratch or one of the templates"), and the Jira guide
 * told people to "pick a card from the Jira group". This reads every
 * language's copy of the page and holds it to the picker, quoting each label
 * the way the Dashboard shows it in that language.
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
 * where the wizard is described.
 */
const openingOf: ReadFunction = (language: string): string => {
  const page: string = readAuthoringPage(language);

  return page.slice(0, page.indexOf("\n## "));
};

const PICKER_LABELS: Array<string> = [
  "Start from scratch",
  "Recommended",
  "All templates",
  "Use this template",
  "Jira",
  "Incidents",
  "Monitors",
];

describe("docs for Create a workflow's Start from step", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test("the labels the docs quote are ones the picker draws", () => {
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
    expect(wizard).toContain('"Use this template"');
    expect(util).toContain('label: "Recommended"');
    expect(util).toContain('label: "All templates"');
  });

  test.each(LANGUAGES)(
    "%s: the opening quotes each of the picker's labels as the Dashboard shows them",
    (language: string) => {
      const opening: string = openingOf(language);

      for (const label of PICKER_LABELS) {
        const shown: string = dashboardLabel(language, label);

        expect({
          label: label,
          quoted: opening.includes(`**${shown}**`),
        }).toEqual({
          label: label,
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
    "%s: Start from scratch is quoted as the Dashboard now translates it, not in English",
    (language: string) => {
      expect(dashboardLabel(language, "Start from scratch")).not.toBe(
        "Start from scratch",
      );
      expect(readAuthoringPage(language)).not.toContain(
        "**Start from scratch**",
      );
    },
  );

  test.each(LANGUAGES)(
    "%s: the opening says a template can be looked at before it is used, from the keyboard too",
    (language: string) => {
      const opening: string = openingOf(language);

      expect(opening).toContain("**Start from**");
      expect(opening).toMatch(/\*\*(Enter|Entrée|Invio)\*\*/);
      expect(opening).toContain("`/`");
      // A list of the two ways in.
      expect(opening.split("\n- ").length - 1).toBe(2);
    },
  );

  test("en: what the page says about Start from matches the picker", () => {
    const opening: string = openingOf("en");

    expect(opening).toContain(
      "**Start from scratch**, beside the search box, gives you an empty canvas.",
    );
    expect(opening).toContain(
      "The step opens on a few **Recommended** templates.",
    );
    expect(opening).toContain("**All templates** lists every one");
    expect(opening).toContain("every word you type has to match");
    expect(opening).toContain(
      "its trigger, the steps it is made of, and the settings it will ask for",
    );

    // The old step: one wall of cards, chosen by clicking a card.
    expect(opening).not.toContain(
      "pick **Start from scratch** or one of the templates",
    );
  });

  test("en: the Jira guide finds its templates the way the picker shows them", () => {
    const jira: string = fs.readFileSync(
      path.join(CONTENT_DIR, "en", "integrations", "jira.md"),
      "utf8",
    );

    expect(jira).toContain("under **Jira** in its list of categories");
    expect(jira).toContain("choose **Jira** from the categories");
    expect(jira).toContain("**Search templates…**");
    expect(jira).toContain("Click **Use this template**.");

    expect(jira).not.toContain("pick a card from the **Jira** group");
    expect(jira).not.toContain("grouped under **Jira**");
  });
});
