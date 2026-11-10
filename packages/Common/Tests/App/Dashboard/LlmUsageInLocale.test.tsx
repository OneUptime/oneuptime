import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import fs from "fs";
import path from "path";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE USAGE TAB IN THE READER'S LANGUAGE: German, and Persian (drawn right
 * to left), from the locale files the Dashboard ships. Each expectation is
 * read from the locale file itself, so the tab is held to its
 * translations: the tiles' words, the table's lines and header, and the
 * Unattributed note - a sentence with slots, which falls back to English
 * whole when it is drawn with a slot its words do not have.
 */

const getListMock: MockFunction = getJestMockFunction();
const getCurrentProjectIdMock: MockFunction = getJestMockFunction();
const fetchUsageMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmObservabilityReads",
  () => {
    return {
      __esModule: true,
      fetchLlmUsage: (...args: Array<unknown>) => {
        return fetchUsageMock(...args);
      },
    };
  },
);

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (...args: Array<unknown>) => {
        return getCurrentProjectIdMock(...args);
      },
    },
  };
});

import LlmUsageBreakdown from "../../../../App/FeatureSet/Dashboard/src/Components/AI/LlmUsageBreakdown";
import ObjectID from "../../../Types/ObjectID";
import {
  LlmUsageGroup,
  LlmUsageSource,
  emptyLlmUsageFigures,
  emptyLlmUsageResponse,
} from "../../../Types/Telemetry/LlmUsageApi";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(locale: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
}

const LOCALES: Record<string, Record<string, string>> = {
  de: readLocale("de"),
  fa: readLocale("fa"),
};

function word(
  locale: string,
  key: string,
  values: Record<string, string> = {},
): string {
  const translated: string | undefined = LOCALES[locale]![key];

  // A key the locale lacks would make every check below read English.
  expect(translated).toBeTruthy();

  let value: string = translated!;

  for (const [name, replacement] of Object.entries(values)) {
    value = value.split(`{{${name}}}`).join(replacement);
  }

  return value;
}

function group(
  overrides: Partial<LlmUsageGroup> & { key: string },
): LlmUsageGroup {
  return { ...emptyLlmUsageFigures(), ...overrides };
}

/*
 * Calls whose model has no price (no cost reported), one of them sent with
 * no user.email (the Unattributed row), read by a role that may not read
 * metrics.
 */
function serve(): void {
  fetchUsageMock.mockResolvedValue({
    ...emptyLlmUsageResponse(),
    totals: {
      ...emptyLlmUsageFigures(),
      calls: 3,
      inputTokens: 120,
      totalTokens: 120,
      tokenSource: LlmUsageSource.Calls,
    },
    groups: [
      group({
        key: "ana@example.com",
        calls: 2,
        inputTokens: 100,
        totalTokens: 100,
        tokenSource: LlmUsageSource.Calls,
      }),
      group({
        key: "",
        calls: 1,
        inputTokens: 20,
        totalTokens: 20,
        tokenSource: LlmUsageSource.Calls,
      }),
    ],
    metricsLeftOut: true,
  } as never);
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: { translation: LOCALES["de"]! },
      fa: { translation: LOCALES["fa"]! },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  getListMock.mockReset();
  getCurrentProjectIdMock.mockReset();
  fetchUsageMock.mockReset();
  getCurrentProjectIdMock.mockReturnValue(
    new ObjectID("11111111-1111-4111-8111-111111111111"),
  );
  getListMock.mockResolvedValue({ data: [] } as never);
  serve();
});

afterEach(() => {
  cleanup();
});

describe.each(["de", "fa"])("the Usage tab in %s", (locale: string) => {
  beforeEach(async () => {
    await i18next.changeLanguage(locale);

    await act(async () => {
      render(
        <MemoryRouter>
          <LlmUsageBreakdown />
        </MemoryRouter>,
      );
    });
  });

  test("the tiles: AI calls, and a cost nobody reported", () => {
    expect(screen.getByTestId("llm-usage-totals-calls")).toHaveTextContent(
      word(locale, "AI calls"),
    );
    expect(screen.getByTestId("llm-usage-totals-cost-value")).toHaveTextContent(
      /^—$/,
    );
    expect(screen.getByTestId("llm-usage-totals-cost-hint")).toHaveTextContent(
      word(locale, "No cost reported"),
    );
  });

  test("the table's lines and its share header", () => {
    expect(screen.getByTestId("llm-usage-breakdown-top")).toHaveTextContent(
      word(locale, "Ranked by cost over the selected range."),
    );
    expect(screen.getByTestId("llm-usage-metrics-left-out")).toHaveTextContent(
      word(
        locale,
        "Usage metrics are left out: your role cannot read metrics. Ask a project admin for access.",
      ),
    );

    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      });

    expect(headers).toContain(word(locale, "Share of cost"));
    expect(headers).not.toContain("Share of cost");
  });

  test("the Unattributed note, whole, with its row's name and the attribute in it", () => {
    const note: HTMLElement = screen.getByTestId("llm-usage-unattributed-note");

    /*
     * Right to left, each slot is set apart from the words around it
     * (first-strong isolate ... pop directional isolate): read without.
     */
    const isolates: RegExp = new RegExp(
      `[${String.fromCharCode(0x2068, 0x2069)}]`,
      "g",
    );
    const text: string = (note.textContent || "").replace(isolates, "");

    expect(text).toContain(
      word(
        locale,
        "{{unattributed}} is usage that doesn't say who made it, for example sent without {{userEmail}}.",
        {
          unattributed: word(locale, "Unattributed"),
          userEmail: "user.email",
        },
      ),
    );
    expect(note).not.toHaveTextContent("is usage that doesn't say");
    expect(within(note).getByText("user.email").tagName).toBe("CODE");
    expect(
      within(note).getByRole("link", {
        name: word(locale, "How to attribute AI coding assistant usage"),
      }),
    ).toHaveAttribute("href", "/docs/telemetry/ai-coding-assistants");
  });
});
