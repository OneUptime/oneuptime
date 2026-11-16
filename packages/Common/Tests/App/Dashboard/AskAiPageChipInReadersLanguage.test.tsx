import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AskAiPageButtons from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPageButtons";
import CitationChips from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationChips";
import { FindDashboardPageTool } from "../../../Server/Utils/AI/Toolbox/DocsTools";
import {
  ToolContext,
  ToolExecutionResult,
} from "../../../Server/Utils/AI/Toolbox/ToolTypes";
import { AIChatCitation } from "../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { readDashboardLocaleAsDrawn } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A PAGE ASK AI SENDS SOMEONE TO, NAMED IN THEIR LANGUAGE (#8831), AND THE
 * EXPLORER TAB IT COULD NOT SEND THEM TO (#8829).
 *
 * The chip under Sources read "Page: {{path}}" with the path an English
 * string, so a German reader saw "Seite: User Settings > Alerts &
 * Notifications > Notification Methods". Its words now name the page by the
 * Dashboard's keys, said in the reader's language; its label, which the
 * model reads in a turn's history, stays English.
 *
 * And the Traces explorer's Insights tab, which no name alone found first,
 * is cited by its name and its place, as find_dashboard_page's result gave
 * them: the answer ends with a button to the tab.
 *
 * Each citation is the tool's own, as Ask AI mints it, drawn through the
 * real i18next and the Dashboard's locale files.
 */

const navigateMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav",
  () => {
    const actual: JSONObject = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/CitationTargetNav",
    );

    return {
      __esModule: true,
      ...actual,
      navigateToCitationTarget: (target: unknown): void => {
        navigateMock(target);
      },
    };
  },
);

const RENDERED: ReadonlyArray<string> = ["en", "de", "ar", "ja", "es"];

const PROJECT: ObjectID = new ObjectID("88310000-0000-4000-8000-000000000001");

const CONTEXT: ToolContext = {
  projectId: PROJECT,
  props: { tenantId: PROJECT, userId: ObjectID.generate() },
};

const METHODS_PATH: Array<string> = [
  "User Settings",
  "Alerts & Notifications",
  "Notification Methods",
];

async function citationFor(args: JSONObject): Promise<AIChatCitation> {
  const result: ToolExecutionResult = await FindDashboardPageTool.execute(
    args,
    CONTEXT,
  );

  return {
    id: "C2",
    toolName: FindDashboardPageTool.name,
    label: result.citationLabel,
    ...(result.citationWords ? { words: result.citationWords } : {}),
    queryArguments: args,
    rowCount: result.rowCount,
    target: result.citationTarget,
  };
}

function chipLabel(citation: AIChatCitation): string {
  render(<CitationChips citations={[citation]} />);

  return withoutIsolateMarks(
    screen.getByTestId("ai-chat-citation-label").textContent || "",
  );
}

// "Page: {{path}}" as `language` words it, each name of the path as its file words it.
function pageIn(language: string, names: Array<string>): string {
  const words: Record<string, string> = readDashboardLocaleAsDrawn(language);
  const word: (name: string) => string = (name: string): string => {
    if (language === "en") {
      return name === "Insights (explorer analytics)" ? "Insights" : name;
    }

    return words[name] || name;
  };

  return words["Page: {{path}}"]!.replace(
    "{{path}}",
    names.map(word).join(" > "),
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
  navigateMock.mockReset();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("a Dashboard page's chip under Sources (#8831)", () => {
  test("reads in English as the label the model reads", async () => {
    await i18next.changeLanguage("en");

    const citation: AIChatCitation = await citationFor({
      query: "Notification Methods",
    });

    expect(chipLabel(citation)).toBe(
      "Page: User Settings > Alerts & Notifications > Notification Methods",
    );
    expect(citation.label).toBe(
      "Page: User Settings > Alerts & Notifications > Notification Methods",
    );
  });

  test.each([
    [
      "de",
      "Seite: Benutzereinstellungen > Warnungen & Benachrichtigungen > Benachrichtigungsmethoden",
    ],
    ["ar", "الصفحة: إعدادات المستخدم > التنبيهات والإشعارات > طرق الإشعار"],
    ["ja", "ページ: ユーザー設定 > アラートと通知 > 通知方法"],
    [
      "es",
      "Página: Ajustes de usuario > Alertas y notificaciones > Métodos de notificación",
    ],
  ])(
    "reads wholly in %s, the page's place and name with the sentence: %p",
    async (language: string, expected: string) => {
      await i18next.changeLanguage(language);

      const citation: AIChatCitation = await citationFor({
        query: "Notification Methods",
      });
      const label: string = chipLabel(citation);

      expect(label).toBe(expected);
      expect(label).toBe(pageIn(language, METHODS_PATH));
      for (const english of METHODS_PATH) {
        expect(label).not.toContain(english);
      }
      // What the model reads in a turn's history stays English.
      expect(citation.label).toBe(
        "Page: User Settings > Alerts & Notifications > Notification Methods",
      );
    },
  );

  test.each([
    ["en", "Page: Logs > Insights"],
    ["de", "Seite: Protokolle > Einblicke"],
    ["ar", "الصفحة: السجلات > الرؤى"],
    ["ja", "ページ: ログ > インサイト"],
    ["es", "Página: Registros > Análisis"],
  ])(
    "names an explorer's Insights tab in %s by the tab's own word: %p",
    async (language: string, expected: string) => {
      await i18next.changeLanguage(language);

      const citation: AIChatCitation = await citationFor({
        query: "top errors",
      });
      const label: string = chipLabel(citation);

      expect(label).toBe(expected);
      expect(label).not.toContain("explorer analytics");
      expect(citation.label).toBe("Page: Logs > Insights");
    },
  );

  test("a chip saved with its path as one string reads that string as it was", async () => {
    await i18next.changeLanguage("de");

    const saved: AIChatCitation = {
      id: "C2",
      toolName: FindDashboardPageTool.name,
      label: "Page: User Settings > Notification Methods",
      words: {
        template: "Page: {{path}}",
        values: { path: "User Settings > Notification Methods" },
      },
      queryArguments: { query: "Notification Methods" },
      rowCount: 1,
    };

    expect(chipLabel(saved)).toBe(
      "Seite: User Settings > Notification Methods",
    );
  });
});

describe("a question about the Traces explorer's Insights tab ends with a link to it (#8829)", () => {
  test("the tool lists the tab where it is, and cites it by that place", async () => {
    const asked: ToolExecutionResult = await FindDashboardPageTool.execute(
      { query: "Traces Insights" },
      CONTEXT,
    );
    const pages: Array<{ title: string; where: string }> = (
      JSON.parse(asked.dataForLlm) as JSONObject
    )["pages"] as Array<{ title: string; where: string }>;

    expect(pages).toContainEqual({
      title: "Insights",
      where: "Traces",
      kind: "page",
    });
    // Its first page is OneUptime AI's, which shares the name.
    expect(asked.citationTarget?.params?.["path"]).toBe(
      "/dashboard/:projectId/traces/ai/insights",
    );

    const cited: AIChatCitation = await citationFor({
      query: "Insights",
      place: "Traces",
    });

    expect(cited.target?.params?.["path"]).toBe(
      "/dashboard/:projectId/traces/insights",
    );
  });

  test.each([
    ["en", "Go to Insights", "Page: Traces > Insights"],
    ["de", "Zu Einblicke", "Seite: Traces > Einblicke"],
    ["ar", "انتقل إلى الرؤى", "الصفحة: التتبعات > الرؤى"],
    ["ja", "インサイト へ移動", "ページ: トレース > インサイト"],
    ["es", "Ir a Análisis", "Página: Trazas > Análisis"],
  ])(
    "in %s the answer's button reads %p and opens the tab, its chip %p",
    async (language: string, button: string, chip: string) => {
      await i18next.changeLanguage(language);

      const cited: AIChatCitation = await citationFor({
        query: "Insights",
        place: "Traces",
      });

      render(
        <AskAiPageButtons
          text="Open the Traces explorer's Insights tab [C2]."
          citations={[cited]}
        />,
      );

      const drawn: HTMLElement = screen.getByRole("button");

      expect(drawn.textContent).toBe(button);
      fireEvent.click(drawn);
      expect(navigateMock).toHaveBeenCalledWith(cited.target);
      cleanup();

      expect(chipLabel(cited)).toBe(chip);
    },
  );
});
