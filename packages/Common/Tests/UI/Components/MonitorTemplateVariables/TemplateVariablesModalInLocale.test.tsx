import "@testing-library/jest-dom";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import { cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import TemplateVariablesModal from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesModal";
import TemplateVariablesCatalog from "../../../../UI/Components/MonitorTemplateVariables/TemplateVariablesCatalog";
import MonitorType from "../../../../Types/Monitor/MonitorType";

/*
 * The Dynamic Template Variables dialog in the reader's language. #5323
 * translated the External Status Page monitor's variable descriptions, but
 * the dialog's own words stayed English in most languages: each variable's
 * "Example:" line, the Syntax tips and their two sentences, the filter and
 * the copy hint. They read in every Dashboard language now, while the
 * {{variables}} themselves - code someone types - read as written.
 */

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

// The dialog's own words, which every language words.
const DIALOG_WORDS: ReadonlyArray<string> = [
  "Dynamic Template Variables",
  "Filter variables…",
  "Syntax tips",
  "Example: {{example}}",
  "Wrap the variable name in double braces: {{example}}",
  "Use dot paths for nested values: {{example}}",
  "A variable with no value is left as written, so a mistyped name shows in the text.",
  "Click to copy {{token}}",
  "No variables match {{search}}.",
  "No variables in this section yet.",
];

const locales: Record<string, Record<string, unknown>> = {};
const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function drawn(language: string, english: string): string {
  const value: unknown = locales[language]?.[english];

  return typeof value === "string" && value.length > 0 ? value : english;
}

beforeAll(async () => {
  locales["en"] = readLocale("en");

  for (const language of ["en", ...LANGUAGES]) {
    const locale: Record<string, unknown> =
      locales[language] || readLocale(language);
    locales[language] = locale;

    const instance: i18n = createInstance();
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"] },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });
    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

function renderModal(language: string): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <TemplateVariablesModal
        monitorType={MonitorType.ExternalStatusPage}
        onClose={(): void => {}}
      />
    </I18nextProvider>,
  );
}

// The words before a {{slot}} of a sentence, in a language.
function lead(language: string, template: string): string {
  return (drawn(language, template).split("{{")[0] as string).trim();
}

describe("the dialog's own words", () => {
  test.each(LANGUAGES)("%s words every one of them", (language: string) => {
    const english: Array<string> = DIALOG_WORDS.filter(
      (words: string): boolean => {
        return drawn(language, words) === words;
      },
    );

    expect({ language, english }).toEqual({ language, english: [] });
  });

  test.each(LANGUAGES)(
    "%s: the Syntax tips and the Example lines read in the language",
    (language: string) => {
      renderModal(language);

      expect(screen.getByText(drawn(language, "Syntax tips"))).toBeVisible();

      const tips: HTMLElement = screen
        .getByText(drawn(language, "Syntax tips"))
        .closest("div") as HTMLElement;
      const items: Array<string> = within(tips)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        });

      expect(items).toHaveLength(3);
      // The sentences in the language, the variables as written.
      expect(items[0]).toContain(
        lead(language, "Wrap the variable name in double braces: {{example}}"),
      );
      expect(items[0]).toContain("{{monitorName}}");
      expect(items[1]).toContain(
        lead(language, "Use dot paths for nested values: {{example}}"),
      );
      expect(items[1]).toContain("{{responseBody.data.status}}");
      expect(items[2]).toBe(
        drawn(
          language,
          "A variable with no value is left as written, so a mistyped name shows in the text.",
        ),
      );

      // Each variable with an example says Example in the language.
      const examples: Array<HTMLElement> = screen.getAllByText(
        (_content: string, element: Element | null): boolean => {
          return Boolean(
            element?.tagName === "P" &&
              element.textContent?.startsWith(
                lead(language, "Example: {{example}}"),
              ),
          );
        },
      );

      expect(examples.length).toBeGreaterThan(0);
      expect(
        screen.queryByText(
          (_content: string, element: Element | null): boolean => {
            return Boolean(
              element?.tagName === "P" &&
                element.textContent?.startsWith("Example: "),
            );
          },
        ),
      ).toBeNull();
    },
  );

  test.each(LANGUAGES)(
    "%s: the filter and each variable's copy hint read in the language",
    (language: string) => {
      renderModal(language);

      expect(
        screen.getByPlaceholderText(drawn(language, "Filter variables…")),
      ).toBeInTheDocument();
      expect(
        screen.getByTitle(
          drawn(language, "Click to copy {{token}}").replace(
            "{{token}}",
            "{{componentNames}}",
          ),
        ),
      ).toBeInTheDocument();
    },
  );

  test("English reads as it always did", () => {
    renderModal("en");

    expect(screen.getByText("Syntax tips")).toBeVisible();
    expect(screen.getByTitle("Click to copy {{componentName}}")).toBeVisible();
  });
});

describe("the External Status Page monitor's componentNames variable", () => {
  test("is offered after componentName, with an example list", () => {
    const keys: Array<string> = (
      TemplateVariablesCatalog.getVariables({
        monitorType: MonitorType.ExternalStatusPage,
      })[2]?.variables || []
    ).map((variable: { key: string }): string => {
      return variable.key;
    });

    expect(keys.indexOf("componentNames")).toBe(
      keys.indexOf("componentName") + 1,
    );
  });

  test.each(LANGUAGES)(
    "%s words its description and shows its example as written",
    (language: string) => {
      const description: string =
        "The same components as a list, for a template that repeats a line for each of them.";

      expect(drawn(language, description)).not.toBe(description);

      renderModal(language);

      const button: HTMLElement = screen.getByTitle(
        drawn(language, "Click to copy {{token}}").replace(
          "{{token}}",
          "{{componentNames}}",
        ),
      );

      expect(button).toHaveTextContent(drawn(language, description));
      expect(button).toHaveTextContent('["Git Operations", "Pull Requests"]');
    },
  );
});
