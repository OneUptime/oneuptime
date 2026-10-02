import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import { MONITOR_SECRET_ACCESS_TITLES } from "../../../FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorSecretAccessFormFields";
import MonitorSecretAccess from "Common/Types/Monitor/MonitorSecretAccess";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Monitors > Settings > Secrets has three access options (#1467), and the
 * monitor secrets page explains them in seventeen languages, most of which
 * nobody on the team can proofread. So this reads every copy and holds what
 * it quotes to what the product shows in that language: the option names
 * the access cards draw, the Access step and the Edit button - and, for API
 * and Terraform users, the stored values of `monitorAccess`, which are not
 * translated anywhere.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const PAGE: string = "monitor/monitor-secrets.md";

const LANGUAGES: Array<string> = [...SUPPORTED_DOCS_LANGUAGE_CODES];

type ReadFunction = (language: string) => string;

const readPage: ReadFunction = (language: string): string => {
  return fs.readFileSync(path.join(CONTENT_DIR, language, PAGE), "utf8");
};

type DashboardLabelFunction = (language: string, english: string) => string;

// What the dashboard draws for a label in that language.
const dashboardLabel: DashboardLabelFunction = (
  language: string,
  english: string,
): string => {
  const translations: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_LOCALES_DIR, `${language}.json`),
      "utf8",
    ),
  );

  return translations[english] || english;
};

describe("monitor secrets docs: which monitors can use a secret", () => {
  test("every docs language is checked", () => {
    expect(LANGUAGES.length).toBe(17);
    expect(LANGUAGES).toContain("en");
  });

  test.each(LANGUAGES)(
    "%s names the three options as the access cards draw them",
    (language: string) => {
      const page: string = readPage(language);

      for (const access of Object.values(MonitorSecretAccess)) {
        const label: string = dashboardLabel(
          language,
          MONITOR_SECRET_ACCESS_TITLES[access],
        );

        expect({
          language,
          access,
          quoted: page.includes(`**${label}**`),
        }).toEqual({ language, access, quoted: true });
      }
    },
  );

  test.each(LANGUAGES)(
    "%s sends people to the Access step and the Edit button by their names in that language",
    (language: string) => {
      const page: string = readPage(language);

      expect(page).toContain(`**${dashboardLabel(language, "Access")}**`);
      expect(page).toContain(`**${dashboardLabel(language, "Edit")}**`);
    },
  );

  test.each(LANGUAGES)(
    "%s gives the API field and its values exactly as the API takes them",
    (language: string) => {
      const page: string = readPage(language);

      expect(page).toContain("`monitorAccess`");
      expect(page).toContain("`monitors`");
      expect(page).toContain("`labels`");

      for (const access of Object.values(MonitorSecretAccess)) {
        expect(page).toContain(`\`${access}\``);
      }
    },
  );

  test.each(LANGUAGES)(
    "%s keeps one section per subject: adding, choosing access, using",
    (language: string) => {
      const headings: Array<string> = readPage(language)
        .split("\n")
        .filter((line: string): boolean => {
          return line.startsWith("### ");
        });

      // The old fourth section, "Monitor Secret Permissions", is gone.
      expect(headings).toHaveLength(3);
    },
  );

  test("the English page no longer says access is only granted monitor by monitor", () => {
    const page: string = readPage("en");

    expect(page).not.toContain("Monitor Secret Permissions");
    expect(page).not.toContain("selected monitors to have access to it");
    expect(page).toContain(
      "A secret is never available to monitors in another project.",
    );
  });
});
