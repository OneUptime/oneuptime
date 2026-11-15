import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";
import { act, cleanup, render } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import LogsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsNavTabs";
import TracesNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesNavTabs";
import { readDashboardLocaleAsDrawn } from "../../Helpers/DashboardLocales";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * AN EXPLORER'S INSIGHTS TAB, APART FROM ONEUPTIME AI'S FINDINGS (#8629).
 *
 * "Insights" named two things: OneUptime AI's findings (the Products menu's
 * Insights, each AI section's page) and the Logs, Traces, Metrics and
 * Exceptions explorers' tab that counts and charts what came in. One key
 * is one word in a language, so Spanish named both "Análisis" beside
 * sentences about "hallazgos", and Italian named both "Informazioni".
 *
 * The tab has its own key now, "Insights (explorer analytics)", which
 * English reads as "Insights" (MeaningKeys). Drawn here through the real
 * i18next and the Dashboard's locale files: Spanish's tab reads "Análisis"
 * while its findings read "Hallazgos", Italian's "Analisi" and "Insight",
 * and every other language its tab as before.
 */

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "fa", "es", "it"];

const TAB_KEY: string = "Insights (explorer analytics)";

function tabLabels(): Array<string> {
  return Array.from(document.querySelectorAll("nav a")).map(
    (link: Element): string => {
      return link.textContent?.trim() || "";
    },
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of RENDERED) {
    resources[language] = {
      translation: readDashboardLocaleAsDrawn(language),
    };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/logs`);
});

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("an explorer's Insights tab", () => {
  test("reads Insights in English, as it always did", async () => {
    await inLanguage("en");
    render(
      <MemoryRouter>
        <LogsNavTabs active="viewer" />
      </MemoryRouter>,
    );

    expect(tabLabels()[1]).toBe("Insights");
    expect(tabLabels().join(" ")).not.toContain("explorer analytics");
  });

  test.each(
    RENDERED.filter((language: string): boolean => {
      return language !== "en";
    }),
  )("reads in %s as the tab's own key words it", async (language: string) => {
    const words: Record<string, string> = readDashboardLocaleAsDrawn(language);

    await inLanguage(language);
    render(
      <MemoryRouter>
        <LogsNavTabs active="viewer" />
        <TracesNavTabs active="viewer" />
      </MemoryRouter>,
    );

    const labels: Array<string> = tabLabels();

    expect(labels[1]).toBe(words[TAB_KEY]);
    expect(labels).toContain(words[TAB_KEY]);
    expect(labels.join(" ")).not.toContain("explorer analytics");
  });

  test.each([
    ["es", "Análisis", "Hallazgos"],
    ["it", "Analisi", "Insight"],
    ["de", "Einblicke", "Einblicke"],
    ["fa", "بینش‌ها", "بینش‌ها"],
    ["ar", "الرؤى", "الرؤى"],
  ])(
    "in %s the tab reads %p and OneUptime AI's findings %p",
    async (language: string, tab: string, findings: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      await inLanguage(language);
      render(
        <MemoryRouter>
          <LogsNavTabs active="viewer" />
        </MemoryRouter>,
      );

      expect(tabLabels()[1]).toBe(tab);
      expect(words["Insights"]).toBe(findings);
    },
  );
});
