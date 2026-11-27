/** @timezone UTC */

import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * SPLIT BY A SCRUB RULE, IN THE READER'S LANGUAGE (#11026) - from the
 * Dashboard's own locale files, as it hands them to i18next.
 *
 * The toggle beside Assigned to me says what it lists in every Dashboard
 * language, in each one's words for the Split pill and the split note
 * ("Abgespalten", "règle de masquage", "قاعدة تنقية"), with its hover text
 * and its count in the reader's digits. The real ExceptionsViewer runs with
 * TelemetryViewer captured and the data layer mocked, as in
 * ExceptionsSplitByScrubRule.test, and the toolbar it hands TelemetryViewer
 * is drawn in each language.
 */

let viewerProps: any = null;

jest.mock("../../../UI/Components/TelemetryViewer/TelemetryViewer", () => {
  return {
    __esModule: true,
    default: (props: any) => {
      viewerProps = props;
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Telemetry/TelemetrySavedViewsControl",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

const getListMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
      updateById: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return error instanceof Error ? error.message : "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: async () => {
        return { data: [], count: 0 };
      },
    },
  };
});

jest.mock("../../../UI/Utils/Telemetry/UseTelemetryEntityNames", () => {
  return {
    __esModule: true,
    default: () => {
      return {};
    },
    useTelemetryEntityLookup: () => {
      return { names: {}, notFound: new Set<string>() };
    },
  };
});

import ExceptionsViewer from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionsViewer";
import { forgetRememberedSplitExceptions } from "../../../../App/FeatureSet/Dashboard/src/Utils/ExceptionSplitPairs";
import NotNull from "../../../Types/BaseDatabase/NotNull";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";
import UserUtil from "../../../UI/Utils/User";
import {
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

const LABEL: string = "Split by a scrub rule";
const HOVER: string =
  "Only the exceptions a scrub rule split from another one, each pair once. Open one to merge the two.";
// How many split exceptions the project has, in every language below.
const SPLIT_COUNT: number = 1234;

const LANGUAGES: Array<string> = [...DASHBOARD_LANGUAGES];

interface Drawn {
  label: string;
  hover: string;
  count: string;
  assignedToMe: string;
}

async function settle(): Promise<void> {
  for (let round: number = 0; round < 8; round++) {
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  await settle();
}

// The toggle as the toolbar the viewer last handed TelemetryViewer draws it.
async function drawnToggle(): Promise<Drawn> {
  let view: RenderResult | null = null;
  await act(async () => {
    view = render(viewerProps.toolbarLeadingActions);
  });

  try {
    const toggle: HTMLElement = view!.getByTestId(
      "exceptions-split-by-scrub-rule",
    );
    const count: HTMLElement = view!.getByTestId(
      "exceptions-split-by-scrub-rule-count",
    );

    return {
      label: toggle.childNodes[0]!.textContent || "",
      hover: toggle.getAttribute("title") || "",
      count: count.textContent || "",
      assignedToMe:
        view!.getByTestId("exceptions-assigned-to-me").textContent || "",
    };
  } finally {
    view!.unmount();
  }
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {
    en: { translation: readDashboardLocaleAsDrawn("en") },
  };

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocaleAsDrawn(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
  });
});

beforeEach(async () => {
  // A page load in a browser that has seen no project before.
  forgetRememberedSplitExceptions();
  window.localStorage.clear();
  viewerProps = null;
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID("11111111-1111-4111-8111-111111111111"));
  jest
    .spyOn(UserUtil, "getUserId")
    .mockReturnValue(new ObjectID("77777777-7777-4777-8777-777777777777"));

  getListMock.mockReset();
  countMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
  });
  /*
   * The project's split exceptions, and the list's (the toggle's figure,
   * which carries the list's class lens); every other count (the error
   * classes, each naming its class as a word) 0.
   */
  countMock.mockImplementation(async (args: unknown) => {
    const query: Record<string, unknown> = (
      args as { query: Record<string, unknown> }
    ).query;
    return query["splitFromTelemetryExceptionId"] instanceof NotNull &&
      typeof query["errorClass"] !== "string"
      ? SPLIT_COUNT
      : 0;
  });
  postMock.mockImplementation(async () => {
    return { data: { facets: {}, buckets: [], attributes: [] } };
  });

  window.history.replaceState({}, "", "/dashboard/project/exceptions");
  await act(async () => {
    render(<ExceptionsViewer />);
  });
  await settle();
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  window.history.replaceState({}, "", "/");
});

afterAll(() => {
  cleanup();
});

describe("Split by a scrub rule in the reader's language", () => {
  test("reads as before in English, its count grouped as English groups it", async () => {
    expect(await drawnToggle()).toEqual({
      label: LABEL,
      hover: HOVER,
      count: "1,234",
      assignedToMe: "Assigned to me",
    });
  });

  test("every Dashboard language words its label and its hover text", () => {
    const unworded: Array<string> = [];

    for (const language of LANGUAGES) {
      for (const key of [LABEL, HOVER]) {
        if (!isWordedInDashboardLocale(key, language)) {
          unworded.push(`${language}: ${key}`);
        }
      }
    }

    expect(unworded).toEqual([]);
  });

  test.each(LANGUAGES)(
    "%s: the label, its hover text and its count, all in the reader's words and digits",
    async (language: string) => {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);

      await inLanguage(language);

      const drawn: Drawn = await drawnToggle();

      expect(drawn).toEqual({
        label: words[LABEL],
        hover: words[HOVER],
        count: dashboardTranslator(language).formatNumber(SPLIT_COUNT),
        assignedToMe: words["Assigned to me"],
      });
      expect(drawn.label).not.toBe(LABEL);
      expect(drawn.hover).not.toBe(HOVER);
    },
  );

  test("Persian writes the count in its own digits, Arabic in Latin ones", async () => {
    await inLanguage("fa");
    expect((await drawnToggle()).count).toBe("۱٬۲۳۴");

    await inLanguage("ar");
    expect((await drawnToggle()).count).toMatch(/^1[,٬.]?234$/);
  });

  /*
   * Each language words the label as its Split pill and its Assigned to me
   * do, so the two toggles read alike and the pill and the filter are one
   * thing: German's pill says "Abgespalten" and its toggle "... abgespalten",
   * French's "Séparée", its toggle "Séparées ...".
   */
  test("each language's label says its own word for a scrub rule, as its split note does", () => {
    const SCRUB_RULE_WORDS: Record<string, string> = {
      de: "Scrub-Regel",
      fr: "règle de masquage",
      es: "regla de depuración",
      it: "regola di mascheramento",
      pt: "regra de mascaramento",
      nl: "scrub-regel",
      da: "scrub-regel",
      no: "scrub-regel",
      sv: "scrub-regel",
      ru: "правилом очистки",
      ja: "スクラブルール",
      ko: "스크럽 규칙",
      "zh-CN": "清理规则",
      "zh-TW": "清理規則",
      hi: "स्क्रब नियम",
      fa: "قاعدهٔ پالایش",
      ar: "قاعدة تنقية",
    };

    expect(Object.keys(SCRUB_RULE_WORDS).sort()).toEqual([...LANGUAGES].sort());

    for (const language of LANGUAGES) {
      const words: Record<string, string> =
        readDashboardLocaleAsDrawn(language);
      const word: string = SCRUB_RULE_WORDS[language]!;

      expect({ language, label: words[LABEL] }).toEqual({
        language,
        label: expect.stringContaining(word),
      });
      // The split note words a scrub rule the same way.
      expect({
        language,
        note: words[
          "A scrub rule split this exception and another one apart. Open it to merge them."
        ],
      }).toEqual({
        language,
        note: expect.stringContaining(
          language === "ru" ? "Правило очистки" : word,
        ),
      });
    }
  });
});
