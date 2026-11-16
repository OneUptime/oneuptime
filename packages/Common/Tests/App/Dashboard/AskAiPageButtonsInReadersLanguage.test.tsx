import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import AskAiPageButtons from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPageButtons";
import { FindDashboardPageTool } from "../../../Server/Utils/AI/Toolbox/DocsTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import {
  AIChatCitation,
  AIChatCitationTargetType,
} from "../../../Types/AI/AIChatTypes";
import ObjectID from "../../../Types/ObjectID";
import { readDashboardLocaleAsDrawn } from "../../Helpers/DashboardLocales";

/*
 * "GO TO INSIGHTS", IN THE READER'S LANGUAGE, FOR AN EXPLORER'S TAB (#8817).
 *
 * The Logs, Metrics, Traces and Exceptions explorers' Insights tab has a
 * key of its own, "Insights (explorer analytics)", apart from OneUptime
 * AI's findings' "Insights" (#8629). find_dashboard_page tells the model
 * the tab's English title, "Insights", and its citation carries the key
 * beside it; the button under the answer draws the key, so it reads the
 * tab's own word: Spanish "Análisis", not the findings' "Hallazgos".
 *
 * The citation is the tool's own, as Ask AI mints it, and the button is
 * drawn through the real i18next and the Dashboard's locale files.
 */

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "ja", "es", "it"];

const TAB_KEY: string = "Insights (explorer analytics)";

const PROJECT: ObjectID = new ObjectID("88170000-0000-4000-8000-000000000001");

const CONTEXT: ToolContext = {
  projectId: PROJECT,
  props: { tenantId: PROJECT, userId: ObjectID.generate() },
};

// The citation Ask AI mints from a find_dashboard_page result.
async function citationFor(query: string): Promise<AIChatCitation> {
  const result: ToolExecutionResult = await FindDashboardPageTool.execute(
    { query },
    CONTEXT,
  );

  return {
    id: "C2",
    toolName: FindDashboardPageTool.name,
    label: result.citationLabel,
    queryArguments: { query },
    rowCount: result.rowCount,
    target: result.citationTarget,
  };
}

// A citation as an older answer saved it: no key beside its title.
function savedCitation(title: string): AIChatCitation {
  return {
    id: "C2",
    toolName: FindDashboardPageTool.name,
    label: `Page: Logs > ${title}`,
    queryArguments: { query: "top errors" },
    rowCount: 1,
    target: {
      type: AIChatCitationTargetType.DashboardPage,
      params: { path: "/dashboard/:projectId/logs/insights", title },
    },
  };
}

// Before anything is drawn: each test draws its button in the language it set.
async function inLanguage(language: string): Promise<void> {
  await i18next.changeLanguage(language);
}

function buttonText(citation: AIChatCitation): string {
  render(
    <AskAiPageButtons
      text="Open the Logs explorer's Insights tab [C2]."
      citations={[citation]}
    />,
  );

  const buttons: Array<HTMLElement> = screen.getAllByRole("button");

  expect(buttons).toHaveLength(1);

  return buttons[0]!.textContent || "";
}

// "Go to {{page}}" as `language` words it, around `page`.
function goTo(language: string, page: string): string {
  const words: Record<string, string> = readDashboardLocaleAsDrawn(language);

  return (words["Go to {{page}}"] || "Go to {{page}}").replace(
    "{{page}}",
    page,
  );
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

afterEach(() => {
  cleanup();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("the Go to button of an explorer's Insights tab", () => {
  test("the tool's citation carries the tab's English title and its own key", async () => {
    const citation: AIChatCitation = await citationFor("top errors");

    expect(citation.target).toEqual({
      type: AIChatCitationTargetType.DashboardPage,
      params: {
        path: "/dashboard/:projectId/logs/insights",
        title: "Insights",
        titleKey: TAB_KEY,
      },
    });
    expect(citation.label).toBe("Page: Logs > Insights");
  });

  test("reads Go to Insights in English, with no note to translators", async () => {
    await inLanguage("en");

    const text: string = buttonText(await citationFor("top errors"));

    expect(text).toBe("Go to Insights");
    expect(text).not.toContain("explorer analytics");
  });

  test.each([
    ["de", "Zu Einblicke"],
    ["ar", "انتقل إلى الرؤى"],
    ["ja", "インサイト へ移動"],
    ["es", "Ir a Análisis"],
    ["it", "Vai a Analisi"],
  ])(
    "reads in %s as the tab's own key words it: %p",
    async (language: string, expected: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      await inLanguage(language);

      const text: string = buttonText(await citationFor("top errors"));

      expect(text).toBe(expected);
      expect(text).toBe(goTo(language, words[TAB_KEY]!));
      expect(text).not.toContain("explorer analytics");
      expect(text).not.toContain("Go to");
    },
  );

  test.each([
    ["es", "Hallazgos"],
    ["it", "Insight"],
  ])(
    "in %s it never reads OneUptime AI's findings' word, %p, as the bare title would",
    async (language: string, findings: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      expect(words["Insights"]).toBe(findings);

      await inLanguage(language);

      expect(buttonText(await citationFor("error trends"))).toBe(
        goTo(language, words[TAB_KEY]!),
      );
      cleanup();

      // A citation with no key draws its title, which names the findings.
      expect(buttonText(savedCitation("Insights"))).toBe(
        goTo(language, findings),
      );
    },
  );

  test.each(["en", "de", "ar", "ja", "es"])(
    "in %s a citation saved with the key as its title still draws the tab's word",
    async (language: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);
      const word: string =
        language === "en" ? "Insights" : (words[TAB_KEY] as string);

      await inLanguage(language);

      expect(buttonText(savedCitation(TAB_KEY))).toBe(goTo(language, word));
    },
  );

  test("OneUptime AI's own Insights page reads the findings' word, in Spanish Hallazgos", async () => {
    const citation: AIChatCitation = await citationFor("Traces Insights");

    expect(citation.target?.params).toEqual({
      path: "/dashboard/:projectId/traces/ai/insights",
      title: "Insights",
    });

    await inLanguage("es");

    expect(buttonText(citation)).toBe("Ir a Hallazgos");
  });
});
